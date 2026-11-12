"""Issue #129: ``track_available`` from the cache (A17.5 step 4, A19.12) and the Track pre-fetch
of the area precompute (A16.4 step 2).

Offline on the recorded 433 Eros answers (PR #53); the autouse guard blocks the network.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.adapters import horizons
from app.cache.store import LiveResponse
from app.context import Context, make_context
from app.core.area import service, track
from app.core.area.match import Candidate
from app.core.find import moving
from app.core.find.frames import FrameService, object_frames_key
from app.core.find.resolver import is_comet, load_object
from app.core.measure.config import DEFAULT_CONFIG
from app.core.measure.spectrum import SpectrumService, cached_spectrum_key
from app.main import create_app
from scripts import area_discovery, prefetch
from tests.area_recorded import recorded_dots, recorded_frames, recorded_star_cones
from tests.conftest import make_settings
from tests.test_area_join import CFG

EROS = "sbdb-20000433"
EROS_NAME = "433 Eros"


def _eros_track(cache: Path) -> Context:
    """Resolve Eros, then store its frame list and spectrum from the recorded answers (what the
    pre-fetch does online); the path's Horizons range answers are recorded fixtures."""
    with TestClient(create_app(make_settings(cache))) as c:
        assert c.get("/v1/resolve", params={"q": EROS_NAME}).json()["id"] == EROS
    ctx = make_context(make_settings(cache))
    obj = load_object(ctx, EROS)
    assert obj is not None and obj.moving
    fs = FrameService(ctx)
    try:
        fr = fs.get_frames(obj)
        SpectrumService(fs).get_spectrum(obj, frames=fr)
    finally:
        fs.close()
    return ctx


def test_track_available_with_frames_path_and_spectrum_cached(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    assert track.check(ctx, EROS) == track.TrackCheck(False, track.NOT_RESOLVED)
    ctx = _eros_track(fixture_cache)
    got = track.check(ctx, EROS)
    assert got.available and got.reason == ""
    # The frame list, every path range answer and the spectrum: one digest each, sorted.
    assert len(got.digests) >= 3 and list(got.digests) == sorted(got.digests)


def _keys(ctx: Context) -> dict[str, list[Any]]:
    obj = load_object(ctx, EROS)
    assert obj is not None and obj.spkid
    frames_key = object_frames_key(ctx, obj)
    entry = ctx.cache.get(frames_key)
    assert entry is not None
    cfg = moving.MovingConfig.from_context(ctx, obj.spkid)
    comet = is_comet(ctx, obj)
    path = [
        horizons.range_key(obj.spkid, a, b, cfg.ephem_step_min, comet=comet)
        for chunks in moving.range_chunks(cfg)
        for a, b in chunks
    ]
    fs = FrameService(ctx)
    try:
        fr = fs.get_frames(obj)
    finally:
        fs.close()
    spectrum = cached_spectrum_key(ctx, obj.id, fr, DEFAULT_CONFIG)
    assert spectrum is not None
    return {"frames": [frames_key], "path": path[:1], "spectrum": [spectrum]}


@pytest.mark.parametrize(
    ("part", "reason"),
    [
        ("frames", track.FRAMES_NOT_CACHED),
        ("path", track.PATH_NOT_CACHED),
        ("spectrum", track.SPECTRUM_NOT_CACHED),
    ],
)
def test_track_not_available_when_one_part_is_missing(
    fixture_cache: Path, part: str, reason: str
) -> None:
    ctx = _eros_track(fixture_cache)
    for key in _keys(ctx)[part]:
        ctx.cache.delete(key)
    assert track.check(ctx, EROS) == track.TrackCheck(False, reason)


def test_track_not_available_for_an_incomplete_frame_list(fixture_cache: Path) -> None:
    ctx = _eros_track(fixture_cache)
    key = _keys(ctx)["frames"][0]
    entry = ctx.cache.get(key)
    assert entry is not None
    doc = json.loads(entry.body)
    doc["missing"] = [*doc["missing"], "cutout:some_frame"]
    ctx.cache.put(key, LiveResponse(json.dumps(doc).encode(), "derived:frames", 200, "x"))
    assert track.check(ctx, EROS) == track.TrackCheck(False, track.FRAMES_INCOMPLETE)


def test_the_check_never_reaches_the_network(fixture_cache: Path) -> None:
    """Even on an online context, a miss is a miss: the check reads an offline view."""
    _eros_track(fixture_cache)
    online = make_context(make_settings(fixture_cache, offline=False))
    assert track.check(online, EROS).available
    assert track.check(online, "sbdb-99999999") == track.TrackCheck(False, track.NOT_RESOLVED)


# --- the known reply and params_hash ------------------------------------------------------------


def _ids(c: Candidate) -> str | None:
    return EROS if c.designation == EROS_NAME else None


def _run(ctx: Context) -> service.AreaResult:
    frames, bodies = recorded_frames()
    return service.run_area(
        ctx, frames, bodies, recorded_dots(), CFG, star_cones=recorded_star_cones(),
        object_ids=_ids, inputs="recorded_eros_fixture",
    )  # fmt: skip


def _known(result: service.AreaResult) -> dict[str, Any]:
    return {k["designation"]: k for k in service.build_replies(result)["known"]["known"]}


def test_known_reply_sets_track_available_from_the_cache(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    before = service.with_track(ctx, _run(ctx))
    assert _known(before)[EROS_NAME]["track_available"] is False
    assert all(k["track_available"] is False for k in _known(before).values())
    plain = _run(ctx)  # never checked: same hash as a run with no Track entries
    assert before.params_hash() == plain.params_hash()

    ctx = _eros_track(fixture_cache)
    after = service.with_track(ctx, _run(ctx))
    assert _known(after)[EROS_NAME]["track_available"] is True
    # The Track entries are inputs of /known (A17.10): the hash moves with them.
    assert after.params_hash() != before.params_hash()
    assert set(after.track[EROS_NAME].digests) <= set(after.input_digests())


# --- the pre-fetch step (A16.4 step 2) ----------------------------------------------------------


def _result_with_known(fixture_cache: Path) -> service.AreaResult:
    ctx = make_context(make_settings(fixture_cache))
    result = _run(ctx)
    assert EROS_NAME in {o.candidate.designation for o in result.known_objects}
    return result


def test_prefetch_lists_a_skipped_object_instead_of_failing(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _result_with_known(fixture_cache)
    ctx = make_context(make_settings(fixture_cache))

    def boom(*_: Any, **__: Any) -> prefetch.Report:
        raise RuntimeError("Horizons is down")

    monkeypatch.setattr(prefetch, "prefetch_target", boom)
    out = area_discovery.prefetch_track(ctx, result, refresh=False)
    eros = next(t for t in out if t.designation == EROS_NAME)
    assert eros.status == "skipped" and "Horizons is down" in eros.reason
    assert all(t.status == "skipped" for t in out)
    assert len(out) == len(result.known_objects)

    def failed(*_: Any, **__: Any) -> prefetch.Report:
        return prefetch.Report(EROS_NAME, object_id=EROS, error="SkyBoT failed: timeout")

    monkeypatch.setattr(prefetch, "prefetch_target", failed)
    out = area_discovery.prefetch_track(ctx, result, refresh=False)
    eros = next(t for t in out if t.designation == EROS_NAME)
    assert eros == area_discovery.TrackPrefetch(
        EROS_NAME, EROS, "skipped", "SkyBoT failed: timeout"
    )

    def ok(*_: Any, **__: Any) -> prefetch.Report:
        return prefetch.Report(EROS_NAME, object_id=EROS, frames=16)

    monkeypatch.setattr(prefetch, "prefetch_target", ok)
    out = area_discovery.prefetch_track(ctx, result, refresh=False)
    assert next(t for t in out if t.designation == EROS_NAME).status == "fetched"
    others = [t for t in out if t.designation != EROS_NAME]
    assert all(t.reason == "no object_id from the resolver" for t in others)


def test_the_offline_precompute_skips_the_prefetch_and_still_stores(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "pack"
    code = area_discovery.main(
        ["--area", "eros-2026-03", "--recorded", "--steps", "all", "--pack", str(out)],
        settings=make_settings(tmp_path / "unused"),
    )
    assert code == 0
    log = capsys.readouterr().out
    assert "[track] skipped 433 Eros" in log and "SX_OFFLINE=1" in log
    assert "433 Eros: track not available" in log


def test_the_prefetch_of_a_mover_leaves_its_track_final(fixture_cache: Path) -> None:
    """``scripts.prefetch`` (the step's worker) stores a mover's frame list and, now, its
    spectrum, so ``track_available`` turns true without a request to ``/spectrum``."""
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        assert c.get("/v1/resolve", params={"q": EROS_NAME}).json()["id"] == EROS
    ctx = make_context(make_settings(fixture_cache))
    assert track.check(ctx, EROS).reason == track.FRAMES_NOT_CACHED
    args = argparse.Namespace(refresh=False, overlays_only=False)
    rep = prefetch.prefetch_target(ctx, {"name": EROS_NAME, "query": EROS_NAME}, {}, args)
    assert rep.error == "" and rep.complete and rep.object_id == EROS
    assert rep.spectrum.split()[1:2] == ["points,"]
    assert track.check(ctx, EROS).available
