"""Moving-object frame search (issue #26, Q-21): path cones, footprint filter, caps, refusals.

The recorded fixtures (433 Eros, 20-21 Mar 2026, two cones) were fetched live on 7 Nov 2026 by
``scripts/record_fixtures.py``; every test here runs with the network blocked (conftest). The
fixture path is deliberately sparse (a 0.001 deg cone every 24 h), so ``frames:sparse_path:1``
is reported.
"""

from __future__ import annotations

import itertools
import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import horizons, irsa_sia
from app.adapters.horizons import EphemPoint
from app.cache.store import ReadThroughCache
from app.context import make_context
from app.core.find import moving
from app.core.find.frames import FrameService, is_complete
from app.core.find.resolver import ResolvedObject, load_object
from app.main import create_app
from app.settings import Settings
from app.timefmt import parse_utc, utc_to_jd
from scripts.record_fixtures import FIXTURE_MOVING
from tests.conftest import FIXTURE_CUTOUT_SIZE_ARCSEC, TARGETS_FILE, make_settings
from tests.helpers import entries, entry

EROS = "sbdb-20000433"
FIXTURE_MISSING = ["frames:sparse_path:1", "frames:outside_window:291"]


def eros(client: TestClient) -> str:
    r = client.get("/v1/resolve", params={"q": "433 Eros"})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def eros_obj(cache_dir: Path, **overrides: Any) -> tuple[FrameService, ResolvedObject]:
    with TestClient(create_app(make_settings(cache_dir))) as c:
        eros(c)  # writes the registry entry
    ctx = make_context(make_settings(cache_dir, **overrides))
    obj = load_object(ctx, EROS)
    assert obj is not None and obj.moving and obj.spkid == "20000433"
    return FrameService(ctx), obj


# --- Done when: frames, object pixels and a spectrum from cache with SX_OFFLINE=1 ---------


def test_done_when_eros_offline_from_env(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings from the environment, as the demo runs: SX_OFFLINE=1, network blocked."""
    monkeypatch.setenv("SX_OFFLINE", "1")
    monkeypatch.setenv("SX_CACHE_DIR", str(fixture_cache))
    monkeypatch.setenv("SX_TARGETS_FILE", str(TARGETS_FILE))
    monkeypatch.setenv("SX_CUTOUT_SIZE_ARCSEC", str(FIXTURE_CUTOUT_SIZE_ARCSEC))
    monkeypatch.setenv("SX_HTTP_RETRIES", "0")
    for name, value in FIXTURE_MOVING.items():
        monkeypatch.setenv(f"SX_{name.upper()}", value)
    settings = Settings()
    assert settings.offline
    with TestClient(create_app(settings)) as c:
        oid = eros(c)
        fr = c.get(f"/v1/objects/{oid}/frames")
        assert fr.status_code == 200, fr.text
        body = fr.json()
        assert len(body["frames"]) == 16
        assert body["missing"] == FIXTURE_MISSING
        assert is_complete(body["missing"])
        for f in body["frames"]:
            assert 0 <= f["x"] < f["width"] and 0 <= f["y"] < f["height"]
            png = c.get(f["cutout_url"])
            assert png.status_code == 200 and png.content.startswith(b"\x89PNG")
        sp = c.get(f"/v1/objects/{oid}/spectrum").json()
        assert sp["spectrum"], "at least one measured point"
        assert all(p["flux"] > 0 and p["error"] > 0 for p in sp["spectrum"])
        frame_ids = {f["frame_id"] for f in body["frames"]}
        points = {p["frame_id"] for p in sp["spectrum"]}
        refused = {m.split(":", 1)[1] for m in sp["missing"] if m.count(":") == 1}
        assert points | refused == frame_ids and not points & refused


def test_frames_are_in_their_footprint_and_time(client: TestClient) -> None:
    oid = eros(client)
    body = client.get(f"/v1/objects/{oid}/frames").json()
    rows = {
        r.frame_id: r
        for meta, b in entries("irsa_sia")
        if meta["maxrec"] == 500
        for r in irsa_sia.parse_rows(b)
    }
    for f in body["frames"]:
        row = rows[f["frame_id"]]
        t = datetime.fromisoformat(f["time"].replace("Z", "+00:00"))
        assert abs(irsa_sia.frame_time(row) - t) < timedelta(milliseconds=1)
        assert row.s_region is not None
        assert moving.inside_footprint(f["ra"], f["dec"], row.s_region)
    times = [(f["time"], f["wavelength_um"], f["frame_id"]) for f in body["frames"]]
    assert times == sorted(times)


def test_moving_provenance_is_model_dependent(client: TestClient) -> None:
    oid = eros(client)
    prov = client.get(f"/v1/objects/{oid}/frames").json()["provenance"]
    for k in ("ra", "dec", "x", "y"):
        assert prov[k]["tag"] == "model_dependent" and prov[k]["assumption"]
        assert horizons.OBSERVER_SPHEREX in prov[k]["assumption"]
    assert prov["x"]["formula"]
    assert prov["time"]["tag"] == "measured"


def test_positions_are_spherex_centred_horizons_at_each_midpoint(client: TestClient) -> None:
    oid = eros(client)
    frames = client.get(f"/v1/objects/{oid}/frames").json()["frames"]
    recorded = [
        (m, b)
        for m, b in entries("horizons")
        if m["key"]["query"]["center"] == horizons.OBSERVER_SPHEREX
        and "tlist" in m["key"]["query"]
        and "quantities" not in m["key"]["query"]  # not the phase-angle call (Q-62)
    ]
    assert len(recorded) == 2  # one TLIST per cone (the frames each cone found first)
    by_jd: dict[float, tuple[float, float]] = {}
    for meta, body in recorded:
        jds = meta["key"]["query"]["tlist"].split(",")
        for (_, ra, dec), jd in zip(horizons.parse(body), jds, strict=True):
            by_jd[float(jd)] = (ra, dec)
    for f in frames:
        t = datetime.fromisoformat(f["time"].replace("Z", "+00:00"))
        jd = min(by_jd, key=lambda j: abs(j - utc_to_jd(t)))
        assert abs(jd - utc_to_jd(t)) < 1e-5  # the frame time is rounded to 1 ms
        ra, dec = by_jd[jd]
        assert abs(f["ra"] - ra) < 1e-6 and abs(f["dec"] - dec) < 1e-6


def test_frames_are_deterministic(fixture_cache: Path) -> None:
    def run(root: Path) -> tuple[str, str]:
        with TestClient(create_app(make_settings(root))) as c:
            oid = eros(c)
            fr = c.get(f"/v1/objects/{oid}/frames").json()
            sp = c.get(f"/v1/objects/{oid}/spectrum").json()
        for d in (fr, sp):
            d.pop("cached_at")
        return json.dumps(fr, sort_keys=True), json.dumps(sp, sort_keys=True)

    other = fixture_cache.parent / "again"
    shutil.copytree(fixture_cache, other)
    assert run(fixture_cache) == run(other)


# --- caps and refusals ----------------------------------------------------------------------


def test_cone_cap_is_reported_spread_and_stored(fixture_cache: Path) -> None:
    """Past the cap the cones are spread over the path and counted; the cap is deterministic for
    the settings in the key, so the list is stored and not recomputed on every request."""
    svc, obj = eros_obj(fixture_cache, moving_max_cones=1)
    result = svc.get_frames(obj)
    assert "frames:cone_cap:1" in result.missing
    assert is_complete(result.missing)
    assert result.frames and all(f.time.startswith("2026-03-20") for f in result.frames)
    assert list((fixture_cache / "v1").glob("derived.frames/*/*/*.json"))


def test_spread_keeps_first_and_last_and_is_even() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    times = [t0 + timedelta(hours=h) for h in range(10)]
    assert moving.spread(times, 20) == times
    picked = moving.spread(times, 4)
    assert picked == [times[0], times[3], times[6], times[9]]
    assert moving.spread(times, 1) == [times[0]]


def test_uncached_ephemeris_offline_is_refused(fixture_cache: Path) -> None:
    svc, obj = eros_obj(fixture_cache, moving_window_end="2026-03-22T00:00:00Z")
    result = svc.get_frames(obj)
    assert result.frames == [] and result.missing == ["frames:ephemeris"]
    assert not is_complete(result.missing)


def test_empty_window_and_missing_spkid_are_refused(fixture_cache: Path) -> None:
    svc, obj = eros_obj(fixture_cache, moving_window_end=FIXTURE_MOVING["moving_window_start"])
    assert svc.get_frames(obj).missing == ["frames:moving_window"]
    ctx = make_context(make_settings(fixture_cache))
    no_spk = ResolvedObject("sbdb-x", None, 1.0, 2.0, True, "sbdb")
    assert FrameService(ctx).get_frames(no_spk).missing == ["frames:ephemeris"]


def _drop_moving_cones(root: Path) -> None:
    cache = ReadThroughCache(root, offline=True)
    for meta, _ in entries("irsa_sia", root):
        if meta["maxrec"] == 500:
            q = meta["key"]["query"]
            cache.delete(
                irsa_sia.sia_key("spherex_qr2", float(q["ra"]), float(q["dec"]), float(q["radius"]))
            )


def _online(root: Path, handler: Any, **overrides: Any) -> Any:
    settings = make_settings(root, offline=False, http_retries=0, **overrides)
    return make_context(settings, transport=httpx.MockTransport(handler))


def test_cone_failures_are_counted_and_not_stored(fixture_cache: Path) -> None:
    _drop_moving_cones(fixture_cache)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/SIA", request.url
        return httpx.Response(504, text="Gateway Timeout")

    ctx = _online(fixture_cache, handler)
    path = moving.search_path(ctx, "20000433")
    assert path.rows == [] and path.missing == ["frames:sparse_path:1", "frames:cone_failed:2"]
    assert not is_complete(path.missing)


def test_web_request_reads_the_cache_only_and_starts_the_job(fixture_cache: Path) -> None:
    """Q-111: under the handoff a web request makes no live call; the cones it would need are
    counted as ``frames:search_deferred`` and the object's job is started."""
    _drop_moving_cones(fixture_cache)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no live call expected: {request.url}")

    _, obj = eros_obj(fixture_cache)
    svc = FrameService(_online(fixture_cache, handler))
    started: list[str] = []
    svc.on_request = lambda o: started.append(o.id)
    result = svc.get_frames(obj)
    assert result.frames == [] and "frames:search_deferred:2" in result.missing
    assert not is_complete(result.missing)
    assert started == [EROS]


def test_web_request_with_nothing_cached_defers_the_ephemeris(fixture_cache: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no live call expected: {request.url}")

    _, obj = eros_obj(fixture_cache, moving_window_end="2026-03-22T00:00:00Z")
    svc = FrameService(_online(fixture_cache, handler, moving_window_end="2026-03-22T00:00:00Z"))
    started: list[str] = []
    svc.on_request = lambda o: started.append(o.id)
    result = svc.get_frames(obj)
    assert result.missing == ["frames:search_deferred:1"] and started == [EROS]


def test_a_recent_live_failure_is_not_retried_nor_deferred(fixture_cache: Path) -> None:
    """A cone that failed live is counted as failed until SX_LIVE_FAILURE_TTL_S passes, so a
    web request does not restart the job for it on every call."""
    _drop_moving_cones(fixture_cache)
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(504, text="Gateway Timeout")

    _, obj = eros_obj(fixture_cache)
    svc = FrameService(_online(fixture_cache, handler))
    first = svc.get_frames(obj, unlimited_live=True)  # the job: live
    assert "frames:cone_failed:2" in first.missing and len(calls) == 2
    started: list[str] = []
    svc.on_request = lambda o: started.append(o.id)
    again = svc.get_frames(obj)  # a web request within the TTL
    assert "frames:cone_failed:2" in again.missing and len(calls) == 2
    assert not any(m.startswith("frames:search_deferred") for m in again.missing)
    assert started == []


def test_live_cones_are_paced_and_merged(fixture_cache: Path) -> None:
    """Both cones go live (each answered with its own recorded body); the second waits
    ``moving_cone_pace_s``; the merge keeps each frame once."""
    bodies = {
        (m["key"]["query"]["ra"], m["key"]["query"]["dec"]): b
        for m, b in entries("irsa_sia")
        if m["maxrec"] == 500
    }
    _drop_moving_cones(fixture_cache)
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert request.url.params["MAXREC"] == "500"
        _, ra, dec, _ = request.url.params["POS"].split()
        return httpx.Response(200, content=bodies[(ra, dec)], headers={"content-type": "text/xml"})

    ctx = _online(fixture_cache, handler, moving_cone_pace_s=5.0)
    now = [100.0]
    waits: list[float] = []

    def sleep(s: float) -> None:
        waits.append(s)
        now[0] += s

    pacer = moving.Pacer(sleep=sleep, clock=lambda: now[0])
    path = moving.search_path(ctx, "20000433", pacer=pacer)
    assert len(calls) == 2 and path.cones == 2
    assert waits == [5.0]
    ids = [r.frame_id for r in path.rows]
    assert len(ids) == 16 and len(ids) == len(set(ids))
    all_rows = [r.frame_id for b in bodies.values() for r in irsa_sia.parse_rows(b)]
    assert len(set(all_rows)) < len(all_rows), "the two cones overlap, so dedupe is exercised"


def test_pacer_spaces_calls_across_searches() -> None:
    now = [0.0]
    waits: list[float] = []

    def sleep(s: float) -> None:
        waits.append(s)
        now[0] += s

    pacer = moving.Pacer(sleep=sleep, clock=lambda: now[0])
    pacer.wait(2.0)
    now[0] += 0.5
    pacer.wait(2.0)  # another search, same process: still spaced
    pacer.wait(0.0)  # pacing off: no wait
    assert waits == [1.5]


def test_target_windows_replace_the_release_window(tmp_path: Path) -> None:
    f = tmp_path / "targets.toml"
    f.write_text(
        '[[target]]\nname = "X"\nquery = "3I"\ngroup = "moving"\n'
        'moving_windows = [["2025-12-07T00:00:00Z", "2025-12-17T00:00:00Z"],'
        ' ["2025-07-31T00:00:00Z", "2025-08-18T00:00:00Z"]]\n'
        '[[target]]\nname = "Bad"\nquery = "bad"\nmoving_windows = [["x", "y"]]\n',
        encoding="utf-8",
    )
    ctx = make_context(make_settings(tmp_path / "c", targets_file=f))
    cfg = moving.MovingConfig.from_context(ctx, " 3i ")
    assert [w[0].month for w in cfg.windows] == [7, 12]  # sorted
    default = moving.MovingConfig.from_context(ctx, "433 Eros")
    assert default.windows == (
        (datetime(2026, 3, 20, tzinfo=UTC), datetime(2026, 3, 21, 12, tzinfo=UTC)),
    )
    assert moving.MovingConfig.from_context(ctx, "bad").windows == default.windows
    assert cfg.key_fields()["m_windows"] != default.key_fields()["m_windows"]


def test_repo_targets_give_3i_atlas_its_windows() -> None:
    ctx = make_context(make_settings(Path("unused"), targets_file=TARGETS_FILE))
    cfg = moving.MovingConfig.from_context(ctx, "3I")
    assert len(cfg.windows) == 2
    assert cfg.windows[0][0] <= datetime(2025, 8, 1, tzinfo=UTC)
    assert cfg.windows[1][1] >= datetime(2025, 12, 16, tzinfo=UTC)


# --- geometry and step policy ---------------------------------------------------------------


def _square(ra: float, dec: float, half: float) -> tuple[tuple[float, float], ...]:
    return (
        (ra - half, dec - half),
        (ra + half, dec - half),
        (ra + half, dec + half),
        (ra - half, dec + half),
    )


def test_inside_footprint_square_and_ra_wrap() -> None:
    sq = _square(0.0, 10.0, 1.75)  # vertices at RA -1.75 and +1.75, across RA 0
    assert moving.inside_footprint(359.5, 10.0, sq)
    assert moving.inside_footprint(0.5, 11.0, sq)
    assert not moving.inside_footprint(2.0, 10.0, sq)
    assert not moving.inside_footprint(0.0, 12.0, sq)
    assert not moving.inside_footprint(180.0, -10.0, sq)  # far side: refused, not a crash


def _track(rate_deg_per_h: float, hours: int) -> moving.Track:
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    return moving.Track(
        [EphemPoint(t0 + timedelta(hours=h), 10.0 + rate_deg_per_h * h, 0.0) for h in range(hours)]
    )


def test_track_interpolates_and_never_extrapolates() -> None:
    tr = _track(0.5, 5)
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    ra, dec = tr.at(t0 + timedelta(minutes=90)) or (0.0, 0.0)
    assert abs(ra - 10.75) < 1e-9 and abs(dec) < 1e-9
    assert tr.at(t0 - timedelta(seconds=1)) is None
    assert tr.at(t0 + timedelta(hours=4, seconds=1)) is None
    wrap = moving.Track([EphemPoint(t0, 359.9, 0.0), EphemPoint(t0 + timedelta(hours=1), 0.1, 0.0)])
    ra, _ = wrap.at(t0 + timedelta(minutes=30)) or (1.0, 1.0)
    assert min(ra, 360.0 - ra) < 1e-9


def _cfg(**kw: Any) -> moving.MovingConfig:
    start = kw.pop("start", datetime(2026, 1, 1, tzinfo=UTC))
    stop = kw.pop("stop", datetime(2026, 1, 3, tzinfo=UTC))
    base: dict[str, Any] = {
        "windows": ((start, stop),),
        "ephem_step_min": 60,
        "min_step_h": 1.0,
        "max_step_h": 24.0,
        "cone_radius_deg": 0.1,
        "max_cones": 450,
        "maxrec": 500,
        "pace_s": 0.0,
        "margin_arcsec": 0.0,
    }
    base.update(kw)
    return moving.MovingConfig(**base)


def test_step_follows_rate_and_is_clamped() -> None:
    # 0.05 deg/h with R = 0.1 deg -> 2 h between cones
    times, sparse = moving.cone_times(_cfg(), _track(0.05, 49))
    steps = [(b - a).total_seconds() / 3600 for a, b in itertools.pairwise(times)]
    assert all(abs(h - 2.0) < 1e-6 for h in steps) and len(times) == 25 and sparse == 0
    # fast mover: clamped to the 1 h minimum, and every clamped step is reported as sparse
    fast, sparse = moving.cone_times(_cfg(), _track(1.0, 49))
    assert len(fast) == 49 and sparse == 48
    # still: clamped to the 24 h maximum, which is not sparse (R / rate is larger)
    still, sparse = moving.cone_times(_cfg(), _track(0.0, 49))
    assert len(still) == 3 and sparse == 0


def test_range_is_split_under_the_horizons_line_limit() -> None:
    cfg = _cfg(stop=datetime(2027, 1, 1, tzinfo=UTC), ephem_step_min=1)
    (chunks,) = moving.range_chunks(cfg)
    start, stop = cfg.windows[0]
    assert chunks[0][0] == start and chunks[-1][1] == stop
    for (_, b), (c, _) in itertools.pairwise(chunks):
        assert b == c
    for a, b in chunks:
        assert (b - a).total_seconds() / 60 + 1 <= horizons.MAX_LINES
    assert [len(c) for c in moving.range_chunks(_cfg())] == [1]
    # the default 10 min step over the whole release window fits in one request
    d = Settings()
    span = parse_utc(d.moving_window_end) - parse_utc(d.moving_window_start)
    assert d.moving_ephem_step_min <= 10
    assert span.total_seconds() / (60 * d.moving_ephem_step_min) + 1 <= horizons.MAX_LINES


def test_windows_are_never_interpolated_across_their_gap() -> None:
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    a = moving.Track([EphemPoint(t0 + timedelta(hours=h), 10.0 + h, 0.0) for h in range(3)])
    b = moving.Track([EphemPoint(t0 + timedelta(hours=h), 50.0 + h, 0.0) for h in range(10, 13)])
    assert moving.track_at([a, b], t0 + timedelta(hours=1)) is not None
    assert moving.track_at([a, b], t0 + timedelta(hours=6)) is None  # in the gap
    ra, _ = moving.track_at([a, b], t0 + timedelta(hours=11)) or (0.0, 0.0)
    assert abs(ra - 61.0) < 1e-9


def test_footprint_margin_widens_only_the_candidate_test() -> None:
    sq = _square(10.0, 0.0, 0.5)
    outside = (10.0 + 0.5 + 20 / 3600, 0.0)  # 20 arcsec beyond the east edge
    assert not moving.inside_footprint(*outside, sq)
    assert moving.inside_footprint(*outside, sq, margin_deg=30 / 3600)
    assert not moving.inside_footprint(*outside, sq, margin_deg=10 / 3600)


def test_recorded_range_ephemeris_parses() -> None:
    meta, body = entry("horizons", step="60m")
    assert meta["key"]["query"]["center"] == horizons.OBSERVER_SPHEREX
    rows = horizons.parse(body)
    assert len(rows) == 37  # 2026-03-20 00:00 to 2026-03-21 12:00, hourly
    assert rows[0][0].startswith("2026-Mar-20 00:00:00")


def test_tlist_row_for_another_time_refuses_its_frames(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A TLIST answer is paired with the requested times only when each row is that time."""
    ctx = make_context(make_settings(fixture_cache))
    rows = [
        r for m, b in entries("irsa_sia") if m["maxrec"] == 500 for r in irsa_sia.parse_rows(b)
    ][:2]
    mids = sorted({irsa_sia.frame_time(r) for r in rows})

    def shifted(*_a: Any, **_k: Any) -> tuple[list[EphemPoint], Any]:
        return [EphemPoint(t + timedelta(minutes=1), 1.0, 2.0) for t in mids], None

    monkeypatch.setattr(horizons, "ephemeris", shifted)
    out, missing, _, deferred = moving.exact_positions(ctx, "20000433", rows)
    assert out == {} and deferred == 0
    assert missing == [
        f"ephemeris:{r.frame_id}" for t in mids for r in rows if irsa_sia.frame_time(r) == t
    ]


def test_prefetch_overlays_only_skips_the_path_search(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import argparse

    from scripts import prefetch

    def boom(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("no path search with --overlays-only")

    monkeypatch.setattr(prefetch.FrameService, "get_frames", boom)
    ctx = make_context(make_settings(fixture_cache))
    args = argparse.Namespace(refresh=False, overlays_only=True)
    rep = prefetch.prefetch_target(ctx, {"name": "433 Eros", "query": "433 Eros"}, {}, args)
    assert rep.error == "" and rep.frames_skipped
