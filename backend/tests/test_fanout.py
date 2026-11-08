"""Issue #41: fan-out, bounded cutout pool, photometry pool, two-stage answer, job registry,
background bakes and the start-up warm cache. Offline: a fake IRSA serves the recorded cutout
bytes with seeded random delays (and an optional gate), so finishing order can be shuffled.

Done when (#41): same inputs give the same refined card whatever order frames arrive in.
"""

from __future__ import annotations

import json
import random
import shutil
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import irsa_cutout
from app.adapters.irsa_sia import SiaRow
from app.cache.store import LiveResponse, Served
from app.context import Context, make_context
from app.core.card.assets import AssetStore
from app.core.card.service import ObjectPipeline, ObjectResult
from app.core.find.frames import FrameService
from app.core.find.resolver import ResolvedObject, resolve
from app.core.jobs import JobRegistry
from app.core.measure.pool import MeasurePool, measure_bytes
from app.core.measure.spectrum import SpectrumService
from app.core.render import background
from app.core.render.background import TextureBaker
from app.core.render.bake import bake_dir
from app.main import create_app
from tests.conftest import FIXTURE_CACHE, purge_derived
from tests.conftest import make_settings as base_settings

QUERY = "WISE J085510.83-071442.5"  # brown dwarf: 3 measured points, baked textures


def make_settings(cache: Path, **kw: Any) -> Any:
    return base_settings(cache, **kw)


def canon(doc: Any) -> bytes:
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


@dataclass
class FakeIrsa:
    """Replaces the live cutout download: recorded bytes, random delay, optional gate."""

    bodies: dict[str, tuple[bytes, dict[str, Any]]]  # cache key digest -> (body, meta)
    seed: int = 0
    gate: threading.Event = field(default_factory=threading.Event)
    calls: list[str] = field(default_factory=list)
    active: int = 0
    max_active: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)
        self.gate.set()

    def fetch_cutout(self, ctx: Context, row: SiaRow, ra: float, dec: float, **_: Any) -> Served:
        key = irsa_cutout.key_for(ctx, row, ra, dec)

        def live() -> LiveResponse:
            with self.lock:
                self.calls.append(row.frame_id)
                self.active += 1
                self.max_active = max(self.max_active, self.active)
                delay = self.rng.uniform(0.02, 0.15)
            try:
                time.sleep(delay)
                assert self.gate.wait(30), "gate never opened"
                body, meta = self.bodies[key.digest]
                extra = {k: meta[k] for k in ("original_sha256", "original_size", "dropped_hdus")}
                return LiveResponse(body, meta["url"], 200, meta["content_type"], extra)
            finally:
                with self.lock:
                    self.active -= 1

        return ctx.cache.fetch(key, live)


@dataclass
class World:
    obj: ResolvedObject
    base: ObjectResult  # the answer from the complete offline cache
    base_spectrum: dict[str, Any]
    live_cache: Path
    bodies: dict[str, tuple[bytes, dict[str, Any]]]
    n_frames: int


def no_network(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503, content=b"no network in tests")


@pytest.fixture
def world(tmp_path: Path) -> World:
    base_cache = tmp_path / "base"
    shutil.copytree(FIXTURE_CACHE, base_cache)
    purge_derived(base_cache)
    ctx = make_context(make_settings(base_cache))
    obj = resolve(ctx, QUERY, {}).obj
    fs = FrameService(ctx)
    fr = fs.get_frames(obj)
    spectrum = SpectrumService(fs).get_spectrum(obj, fr).body
    base = ObjectPipeline(FrameService(ctx), AssetStore(ctx.cache, None, "spherex_qr2")).run(obj)
    assert base.measuring == ()
    bodies: dict[str, tuple[bytes, dict[str, Any]]] = {}
    for f in fr.frames:
        entry = ctx.cache.get(irsa_cutout.key_for(ctx, f.sia_row(), f.ra, f.dec))
        assert entry is not None
        bodies[entry.key.digest] = (entry.body, entry.meta)
    # The live world: the same cache without the cutouts and without derived results.
    live_cache = tmp_path / "live"
    shutil.copytree(FIXTURE_CACHE, live_cache)
    purge_derived(live_cache)
    live_ctx = make_context(make_settings(live_cache))
    for f in fr.frames:
        live_ctx.cache.delete(irsa_cutout.key_for(live_ctx, f.sia_row(), f.ra, f.dec))
    return World(obj, base, spectrum, live_cache, bodies, len(fr.frames))


def live_ctx(world: World, **kw: Any) -> Context:
    settings = make_settings(world.live_cache, offline=False, **kw)
    return make_context(settings, transport=httpx.MockTransport(no_network))


@pytest.fixture
def fake(world: World, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeIrsa]:
    f = FakeIrsa(world.bodies)
    monkeypatch.setattr(irsa_cutout, "fetch_cutout", f.fetch_cutout)  # frames calls it by module
    yield f
    f.gate.set()


# --- bounded cutout pool ------------------------------------------------------------------


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_concurrent_cutouts_give_the_same_frame_list(
    world: World, fake: FakeIrsa, seed: int
) -> None:
    fake.rng = random.Random(seed)
    ctx = live_ctx(world, cutout_concurrency=2)
    fs = FrameService(ctx)
    try:
        events: list[str] = []
        fr = fs.get_frames(
            world.obj, unlimited_live=True, on_frame=lambda e: events.append(e.frame_id)
        )
    finally:
        fs.close()
    assert len(fake.calls) == world.n_frames
    assert fake.max_active <= 2  # SX_CUTOUT_CONCURRENCY holds
    assert sorted(events) == sorted(f.frame_id for f in fr.frames)
    ref = SpectrumService(FrameService(ctx)).get_spectrum(world.obj, fr).body
    assert canon(ref) == canon(world.base_spectrum)


def test_downloads_overlap(world: World, fake: FakeIrsa) -> None:
    ctx = live_ctx(world, cutout_concurrency=6)
    fs = FrameService(ctx)
    try:
        fs.get_frames(world.obj, unlimited_live=True)
    finally:
        fs.close()
    assert fake.max_active > 1  # really in parallel, not one after another


def test_concurrency_one_downloads_in_the_calling_thread(world: World, fake: FakeIrsa) -> None:
    ctx = live_ctx(world, cutout_concurrency=1)
    fr = FrameService(ctx).get_frames(world.obj, unlimited_live=True)
    assert fake.max_active == 1 and len(fr.frames) == world.n_frames


def test_a_capped_request_hands_downloads_to_the_job(world: World, fake: FakeIrsa) -> None:
    ctx = live_ctx(world)
    fs = FrameService(ctx)
    started: list[str] = []
    fs.on_request = lambda obj: started.append(obj.id)
    fr = fs.get_frames(world.obj)
    assert fake.calls == []  # the request downloaded nothing itself
    assert f"cutouts:deferred:{world.n_frames}" in fr.missing
    assert started == [world.obj.id]


# --- photometry pool ----------------------------------------------------------------------


def test_photometry_in_worker_processes_matches_in_thread(world: World) -> None:
    pool = MeasurePool(2)
    try:
        for body, _meta in world.bodies.values():
            # Any pixel works for the comparison; use the cutout centre.
            fut = pool.submit(body, 29.0, 29.0)
            assert fut.result(timeout=120) == measure_bytes(body, 29.0, 29.0)
    finally:
        pool.close()


def test_spectrum_through_the_pool_matches(world: World) -> None:
    base_cache = world.live_cache.parent / "base"
    ctx = make_context(make_settings(base_cache))
    purge_derived(base_cache)
    pool = MeasurePool(2)
    try:
        body = SpectrumService(FrameService(ctx), pool=pool).get_spectrum(world.obj).body
    finally:
        pool.close()
    assert canon(body) == canon(world.base_spectrum)


# --- two-stage answer ---------------------------------------------------------------------


def pipeline_for(ctx: Context, workers: int = 0) -> tuple[ObjectPipeline, MeasurePool]:
    pool = MeasurePool(workers)
    fs = FrameService(ctx)
    pipe = ObjectPipeline(fs, AssetStore(ctx.cache, None, "spherex_qr2"), measure_pool=pool)
    fs.on_request = pipe.ensure_job
    return pipe, pool


def test_first_stage_lists_measuring_and_never_guesses(world: World, fake: FakeIrsa) -> None:
    fake.gate.clear()
    ctx = live_ctx(world, first_answer_wait_s=0.2)
    pipe, pool = pipeline_for(ctx)
    try:
        t0 = time.monotonic()
        first = pipe.run(world.obj)
        assert time.monotonic() - t0 < 10
        assert first.measuring, "expected a first-stage answer while cutouts are held"
        card, params = first.card, first.params
        for key in ("flux_45um", "spherex_rgb"):
            assert card[key]["value"] is None
            assert card[key]["source"].startswith("measuring:")
        assert "measuring:spectrum" in params["missing"]
        assert "spectrum" not in params["missing"]
        for layer in ("emissive", "flux_pulse", "spherex_ir"):
            assert f"measuring:{layer}" in params["missing"]
            assert layer not in params["missing"]
        assert set(first.measuring) == {m for m in params["missing"] if m.startswith("measuring:")}
        # Everything not from SPHEREx is already there and equals the refined answer.
        for key in ("id", "name", "type", "spectral_class", "radius_rjup"):
            assert card[key] == world.base.card[key]
        job = pipe.jobs.get(world.obj.id)
        assert job is not None and job.snapshot()["state"] == "running"
        fake.gate.set()
        final = job.wait_final(timeout=60)
        assert final is not None and final.measuring == ()
        assert canon(final.card) == canon(world.base.card)
        assert canon(final.params) == canon(world.base.params)
        assert pipe.run(world.obj) is final  # a finished job is reused (SX_JOB_TTL_S)
    finally:
        fake.gate.set()
        pipe.frames.close()
        pool.close()


@pytest.mark.parametrize(("seed", "workers"), [(11, 0), (12, 2), (13, 0)])
def test_refined_card_is_the_same_whatever_order_frames_arrive(
    world: World, fake: FakeIrsa, seed: int, workers: int
) -> None:
    fake.rng = random.Random(seed)
    ctx = live_ctx(world, cutout_concurrency=3, first_answer_wait_s=0.0)
    pipe, pool = pipeline_for(ctx, workers)
    try:
        job = pipe.ensure_job(world.obj)
        final = job.wait_final(timeout=120)
    finally:
        pipe.frames.close()
        pool.close()
    assert final is not None
    assert canon(final.card) == canon(world.base.card)
    assert canon(final.params) == canon(world.base.params)
    snap = job.snapshot()
    assert snap["frames_done"] == snap["frames_total"] == world.n_frames


def test_partial_answer_from_the_first_batch(world: World, fake: FakeIrsa) -> None:
    """With more frames than the first batch, a partial answer measured from the first batch
    (the frames the old per-request cap took, in time order) comes before the final one."""
    fake.gate.clear()
    ctx = live_ctx(world, live_cutouts_per_request=1, cutout_concurrency=1, first_answer_wait_s=0.0)
    pipe, pool = pipeline_for(ctx)
    seen: list[tuple[str | None, tuple[str, ...]]] = []
    try:
        job = pipe.ensure_job(world.obj)
        fake.gate.set()
        last = -1
        while True:
            snap = job.wait_change(last, 30)
            last = snap["seq"]
            if job.latest is not None and (not seen or seen[-1][0] != job.latest_kind):
                seen.append((job.latest_kind, job.latest.measuring))
            if snap["state"] != "running":
                break
        final = job.wait_final(5)
    finally:
        fake.gate.set()
        pipe.frames.close()
        pool.close()
    kinds = [k for k, _ in seen]
    assert "partial" in kinds
    partial = dict(seen)["partial"]
    assert "measuring:frames" in partial and "measuring:spectrum" not in partial
    assert final is not None and final.measuring == ()
    assert canon(final.card) == canon(world.base.card)
    assert canon(final.params) == canon(world.base.params)
    assert len(fake.calls) == world.n_frames  # nothing downloaded twice


def test_offline_has_no_first_stage(world: World) -> None:
    ctx = make_context(make_settings(world.live_cache, first_answer_wait_s=0.0))
    pipe, pool = pipeline_for(ctx)
    try:
        result = pipe.run(world.obj)
    finally:
        pool.close()
    assert result.measuring == ()
    assert not any(m.startswith("measuring:") for m in result.params["missing"])


# --- job registry -------------------------------------------------------------------------


def test_one_job_per_object(world: World, fake: FakeIrsa) -> None:
    fake.gate.clear()
    ctx = live_ctx(world, first_answer_wait_s=0.0)
    pipe, pool = pipeline_for(ctx)
    try:
        jobs: list[Any] = []
        threads = [
            threading.Thread(target=lambda: jobs.append(pipe.ensure_job(world.obj)))
            for _ in range(8)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len({id(j) for j in jobs}) == 1
        fake.gate.set()
        jobs[0].wait_final(timeout=60)
    finally:
        fake.gate.set()
        pipe.frames.close()
        pool.close()
    assert sorted(fake.calls) == sorted(set(fake.calls))  # each cutout downloaded once
    assert len(fake.calls) == world.n_frames


def test_failed_job_is_not_reused() -> None:
    reg: JobRegistry[int] = JobRegistry(ttl_s=60)
    calls = {"n": 0}

    def boom(job: Any) -> int:
        calls["n"] += 1
        raise RuntimeError("upstream broke")

    with pytest.raises(RuntimeError):
        reg.ensure("x", boom).answer(0)
    job = reg.ensure("x", lambda job: 7)
    assert job.wait_final(5) == 7 and calls["n"] == 1
    assert reg.ensure("x", lambda job: 8).wait_final(5) == 7  # fresh: reused
    reg.ttl_s = 0.0
    assert reg.ensure("x", lambda job: 9).wait_final(5) == 9  # stale: a new run


def test_answer_prefers_the_refined_result_within_the_wait() -> None:
    reg: JobRegistry[str] = JobRegistry(ttl_s=60)

    def run(job: Any) -> str:
        job.publish("first", "first")
        time.sleep(0.2)
        return "final"

    assert reg.ensure("a", run).answer(5.0) == "final"
    assert reg.ensure("b", run).answer(0.0) == "first"


# --- API ----------------------------------------------------------------------------------


def live_app(world: World, **kw: Any) -> TestClient:
    settings = make_settings(world.live_cache, offline=False, **kw)
    return TestClient(create_app(settings, transport=httpx.MockTransport(no_network)))


def test_api_first_stage_headers_job_and_events(world: World, fake: FakeIrsa) -> None:
    fake.gate.clear()
    with live_app(world, first_answer_wait_s=0.2) as client:
        oid = client.get("/v1/resolve", params={"q": QUERY}).json()["id"]
        assert oid == world.obj.id
        assert client.get(f"/v1/objects/{oid}/job").json() == {"id": oid, "state": "idle"}
        card = client.get(f"/v1/objects/{oid}/card")
        assert card.status_code == 200
        assert "measuring:spectrum" in card.headers["X-SX-Measuring"].split(",")
        assert card.headers["X-SX-Progress"].startswith("frames ")
        assert card.headers["X-SX-Asset-Status"] == "generated"
        # /frames joins the job: it answers at once, listing what is still to come.
        frames = client.get(f"/v1/objects/{oid}/frames").json()
        assert any(m.startswith("cutouts:deferred:") for m in frames["missing"])
        snap = client.get(f"/v1/objects/{oid}/job").json()
        assert snap["state"] == "running" and snap["answer"] == "first"
        fake.gate.set()
        job = client.app.state.pipeline.jobs.get(oid)  # type: ignore[attr-defined]
        job.wait_final(timeout=60)
        card = client.get(f"/v1/objects/{oid}/card")
        assert "X-SX-Measuring" not in card.headers and "X-SX-Progress" not in card.headers
        assert canon(card.json()) == canon(world.base.card)
        frames = client.get(f"/v1/objects/{oid}/frames").json()
        assert len(frames["frames"]) == world.n_frames
        assert not any(m.startswith("cutouts:deferred:") for m in frames["missing"])
        with client.stream("GET", f"/v1/objects/{oid}/job/events") as r:
            assert r.headers["content-type"].startswith("text/event-stream")
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
        assert events[-1]["state"] == "done" and events[-1]["answer"] == "final"
    assert fake.max_active <= 6


def test_job_events_stream_progress_until_done(world: World, fake: FakeIrsa) -> None:
    fake.gate.clear()
    with live_app(world, first_answer_wait_s=0.0, cutout_concurrency=1) as client:
        oid = client.get("/v1/resolve", params={"q": QUERY}).json()["id"]
        client.get(f"/v1/objects/{oid}/card")
        threading.Timer(0.3, fake.gate.set).start()
        with client.stream("GET", f"/v1/objects/{oid}/job/events") as r:
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs) and len(events) >= 2
    assert events[-1]["state"] == "done"
    assert events[-1]["frames_done"] == events[-1]["frames_total"] == world.n_frames
    assert any(e["frames_done"] < world.n_frames for e in events)


def test_job_events_for_an_object_with_no_job(client: TestClient) -> None:
    oid = client.get("/v1/resolve", params={"q": "R Dra"}).json()["id"]
    with client.stream("GET", f"/v1/objects/{oid}/job/events") as r:
        lines = [line for line in r.iter_lines() if line.startswith("data: ")]
    assert [json.loads(line[6:]) for line in lines] == [{"id": oid, "state": "idle"}]


# --- texture bake off the request path ----------------------------------------------------


def test_bake_runs_in_the_background_for_both_sizes(
    world: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(background, "SIZES", ((64, 32), (32, 16)))
    baker = TextureBaker(tmp_path / "tex", workers=0)
    try:
        futs = baker.submit(world.base.card, world.base.params)
        again = baker.submit(world.base.card, world.base.params)
        assert len(futs) == 2
        paths = [f.result(timeout=60) for f in futs]
        for f in again:
            f.result(timeout=60)
    finally:
        baker.close()
    seed = int(world.base.params["seed"])
    version = str(world.base.params["generator_version"])
    for (w, h), p in zip(((64, 32), (32, 16)), paths, strict=True):
        assert p == bake_dir(tmp_path / "tex", world.obj.id, version, seed, w, h)
        assert (p / "albedo.webp").is_file() and (p / "normal.png").is_file()


def test_no_bake_without_textures(tmp_path: Path) -> None:
    baker = TextureBaker(tmp_path, workers=0)
    try:
        assert (
            baker.submit({"id": "x", "type": "star"}, {"seed": 1, "generator_version": "1"}) == []
        )
    finally:
        baker.close()


def test_textures_are_served(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(background, "SIZES", ((64, 32),))
    settings = make_settings(world.live_cache, bake_textures=True, bake_workers=0)
    with TestClient(create_app(settings)) as client:
        oid = client.get("/v1/resolve", params={"q": QUERY}).json()["id"]
        params = client.get(f"/v1/objects/{oid}/render-params").json()
        assert "textures" in params
        baker = client.app.state.baker  # type: ignore[attr-defined]
        deadline = time.monotonic() + 60
        while baker._inflight and time.monotonic() < deadline:
            time.sleep(0.05)
        seed, version = params["seed"], params["generator_version"]
        d = bake_dir(Path("."), oid, version, seed, 64, 32)
        url = "/data/textures/" + "/".join(d.parts) + "/albedo.webp"
        r = client.get(url)
        assert r.status_code == 200 and r.content[:4] == b"RIFF"


# --- warm cache at start-up ---------------------------------------------------------------


def test_warm_cache_runs_demo_targets_at_startup(fixture_cache: Path, tmp_path: Path) -> None:
    targets = tmp_path / "targets.toml"
    targets.write_text(
        '[[target]]\nname = "WISE 0855"\nquery = "WISE J085510.83-071442.5"\ngroup = "demo"\n'
        '[[target]]\nname = "R Draconis"\nquery = "R Dra"\ngroup = "test"\n',
        encoding="utf-8",
    )
    settings = make_settings(fixture_cache, prefetch_on_start=True, targets_file=targets)
    with TestClient(create_app(settings)) as client:
        warm = client.app.state.warm  # type: ignore[attr-defined]
        warm.join(timeout=60)
        assert warm.done == ["simbad-wisea-j085510-74-071442-5"]  # demo group only
        job = client.app.state.pipeline.jobs.get(warm.done[0])  # type: ignore[attr-defined]
        assert job is not None and job.snapshot()["state"] == "done"


def test_no_warm_cache_by_default(client: TestClient) -> None:
    assert client.app.state.warm is None  # type: ignore[attr-defined]


# --- review fixes -------------------------------------------------------------------------


def test_a_saved_asset_still_gets_its_cutouts(world: World, fake: FakeIrsa) -> None:
    """A saved or pre-baked card answers at once, but /frames still needs the cutouts."""
    from app.core.card.assets import Asset

    ctx = live_ctx(world)
    pipe, pool = pipeline_for(ctx)
    pipe.assets.put(
        Asset(
            card=world.base.card,
            render_params=world.base.params,
            textures=world.base.params.get("textures"),
            generator_version=str(world.base.params["generator_version"]),
            seed=int(world.base.params["seed"]),
            created_at="2026-11-08T00:00:00Z",
        )
    )
    try:
        assert pipe.run(world.obj).status == "saved"
        fr = pipe.frames.get_frames(world.obj)  # a web request: hands off to the job
        assert any(m.startswith("cutouts:deferred:") for m in fr.missing)
        job = pipe.jobs.get(world.obj.id)
        assert job is not None
        assert job.wait_final(60).status == "saved"
        assert len(fake.calls) == world.n_frames
        fr = pipe.frames.get_frames(world.obj)
        assert len(fr.frames) == world.n_frames
    finally:
        pipe.frames.close()
        pool.close()


def test_closed_services_start_no_new_work(world: World, fake: FakeIrsa) -> None:
    from app.cache.store import UpstreamUnavailable

    fs = FrameService(live_ctx(world))
    fs.close()
    with pytest.raises(UpstreamUnavailable):
        fs.get_frames(world.obj, unlimited_live=True)
    assert fake.calls == [] and fs._pool is None
    pool = MeasurePool(2)
    pool.close()
    body = next(iter(world.bodies.values()))[0]
    fut = pool.submit(body, 29.0, 29.0)
    assert fut.done() and pool._executor is None  # measured in-thread, no new process


def test_a_frames_request_restarts_a_finished_job(world: World) -> None:
    ctx = make_context(make_settings(world.live_cache))
    pipe, pool = pipeline_for(ctx)
    try:
        first = pipe.ensure_job(world.obj)
        first.wait_final(60)
        assert pipe.ensure_job(world.obj) is first  # /card reuses it
        pipe.request_frames(world.obj)  # /frames found cutouts still to download
        again = pipe.jobs.get(world.obj.id)
        assert again is not None and again is not first
        again.wait_final(60)
    finally:
        pool.close()


def test_event_streams_do_not_use_request_threads(world: World, fake: FakeIrsa) -> None:
    """Many open /job/events streams must not starve plain routes."""
    fake.gate.clear()
    with live_app(world, first_answer_wait_s=0.0) as client:
        oid = client.get("/v1/resolve", params={"q": QUERY}).json()["id"]
        client.get(f"/v1/objects/{oid}/card")
        streams = [client.stream("GET", f"/v1/objects/{oid}/job/events") for _ in range(12)]
        opened = [s.__enter__() for s in streams]
        try:
            t0 = time.monotonic()
            assert client.get("/v1/health").status_code == 200
            assert client.get(f"/v1/objects/{oid}/job").status_code == 200
            assert time.monotonic() - t0 < 5
        finally:
            fake.gate.set()
            for s, r in zip(streams, opened, strict=True):
                r.read()
                s.__exit__(None, None, None)


# --- second review: shutdown, fairness, job cap, batch-only final ------------------------


def strip_cutouts(world: World, fake: FakeIrsa, query: str) -> ResolvedObject:
    """Remove a second object's cutouts from the live cache and serve them from the fake."""
    ctx = make_context(make_settings(world.live_cache))
    obj = resolve(ctx, query, {}).obj
    for f in FrameService(ctx).get_frames(obj).frames:
        key = irsa_cutout.key_for(ctx, f.sia_row(), f.ra, f.dec)
        entry = ctx.cache.get(key)
        assert entry is not None
        fake.bodies[key.digest] = (entry.body, entry.meta)
        ctx.cache.delete(key)
    ctx.cache.delete(frames_mod_key(ctx, obj.id))
    return obj


def frames_mod_key(ctx: Context, object_id: str) -> Any:
    from app.core.find.frames import frames_key

    return frames_key(ctx, object_id)


def test_close_while_downloads_are_queued_never_hangs(world: World, fake: FakeIrsa) -> None:
    """Review finding: shutdown(cancel_futures=True) must not strand a waiting frame list."""
    other = strip_cutouts(world, fake, "eps Ind B")
    fake.gate.clear()
    fs = FrameService(live_ctx(world, cutout_concurrency=2))
    results: dict[str, Any] = {}

    def build(obj: ResolvedObject) -> None:
        try:
            results[obj.id] = fs.get_frames(obj, unlimited_live=True)
        except Exception as exc:
            results[obj.id] = exc

    threads = [threading.Thread(target=build, args=(o,)) for o in (world.obj, other)]
    for t in threads:
        t.start()
    deadline = time.monotonic() + 10
    while fake.active < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    fs.close()  # one download running, the other object's queued behind it in the pool
    fake.gate.set()
    for t in threads:
        t.join(10)
        assert not t.is_alive(), "a frame list waited for ever after close()"
    refused = [
        m
        for r in results.values()
        if not isinstance(r, Exception)
        for m in r.missing
        if m.startswith("cutout:")
    ]
    assert refused, "downloads dropped at shutdown are listed as refused"


def test_objects_take_turns_in_the_shared_pool(world: World, fake: FakeIrsa) -> None:
    """Review finding: one object's queue must not hold back another object's frames."""
    other = strip_cutouts(world, fake, "eps Ind B")
    other_ids: set[str] = set()
    ctx = live_ctx(world, cutout_concurrency=2)
    for f in (
        FrameService(make_context(make_settings(world.live_cache.parent / "base")))
        .get_frames(
            resolve(
                make_context(make_settings(world.live_cache.parent / "base")), "eps Ind B", {}
            ).obj
        )
        .frames
    ):
        other_ids.add(f.frame_id)
    fake.gate.clear()
    fs = FrameService(ctx)
    try:
        ta = threading.Thread(
            target=fs.get_frames, args=(world.obj,), kwargs={"unlimited_live": True}
        )
        ta.start()
        while fake.active < 2:
            time.sleep(0.01)
        tb = threading.Thread(target=fs.get_frames, args=(other,), kwargs={"unlimited_live": True})
        tb.start()
        time.sleep(0.2)
        fake.gate.set()
        ta.join(30)
        tb.join(30)
    finally:
        fs.close()
    a_calls = [i for i, c in enumerate(fake.calls) if c not in other_ids]
    b_calls = [i for i, c in enumerate(fake.calls) if c in other_ids]
    assert len(a_calls) == world.n_frames and b_calls
    assert b_calls[0] < a_calls[-1], f"object B waited for all of A: {fake.calls}"


def test_running_jobs_are_capped() -> None:
    reg: JobRegistry[str] = JobRegistry(ttl_s=60, max_running=1)
    release = threading.Event()

    def slow(job: Any) -> str:
        job.update(stage="frames")
        release.wait(10)
        return "a"

    a = reg.ensure("a", slow)
    b = reg.ensure("b", lambda job: "b")
    time.sleep(0.2)
    assert a.snapshot()["stage"] == "frames"
    assert b.snapshot()["stage"] == "queued" and b.snapshot()["state"] == "running"
    release.set()
    assert a.wait_final(5) == "a" and b.wait_final(5) == "b"


def test_a_batch_only_final_still_says_measuring_frames(
    world: World, fake: FakeIrsa, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = live_ctx(world, live_cutouts_per_request=1, cutout_concurrency=1, first_answer_wait_s=0)
    pipe, pool = pipeline_for(ctx)
    monkeypatch.setattr(pipe, "_join_frames_now", lambda *a, **k: None)  # the full run fails
    try:
        final = pipe.ensure_job(world.obj).wait_final(60)
    finally:
        pipe.frames.close()
        pool.close()
    assert final is not None and "measuring:frames" in final.measuring
