"""Track backend, issue #74 (A19.3, A19.5, A19.13): mover footprints in ``/overlays`` and
``GET /v1/objects/{id}/path`` from the path search's cached ephemeris (Q-141 option b).

Offline on the recorded 433 Eros answers (20-21 Mar 2026, the fixture path settings: a 60 min
ephemeris step); the autouse guard blocks the network.
"""

from __future__ import annotations

import itertools
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.adapters import horizons, irsa_sia
from app.context import make_context
from app.contract.track_path_schema import TrackPath
from app.core.card.validate import errors
from app.core.find import moving
from app.core.find import path as track_path
from app.core.find.frames import FrameRecord, FrameService, FramesResult, frames_key
from app.core.find.resolver import ResolvedObject, load_object
from app.main import create_app
from app.timefmt import parse_utc
from scripts import track_fixtures
from tests.conftest import make_settings
from tests.helpers import entries, entry

EROS = "sbdb-20000433"
SCHEMA = "track-path.schema.json"
FIXTURE = track_fixtures.OUT_DIR / "path.json"
WINDOW = (parse_utc("2026-03-20T00:00:00Z"), parse_utc("2026-03-21T12:00:00Z"))


def _eros(c: TestClient) -> str:
    r = c.get("/v1/resolve", params={"q": "433 Eros"})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def _path(c: TestClient, oid: str, **params: str) -> Any:
    return c.get(f"/v1/objects/{oid}/path", params=params)


def _service(cache: Path, **overrides: Any) -> tuple[FrameService, ResolvedObject]:
    with TestClient(create_app(make_settings(cache))) as c:
        _eros(c)  # writes the registry entry
    ctx = make_context(make_settings(cache, **overrides))
    obj = load_object(ctx, EROS)
    assert obj is not None and obj.moving
    return FrameService(ctx), obj


# --- Done when: /path returns the samples offline on the Eros cache -------------------------


def test_path_serves_the_cached_samples_and_the_frame_positions(client: TestClient) -> None:
    oid = _eros(client)
    r = _path(client, oid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert errors(body, SCHEMA) == []
    assert body["observer"] == horizons.OBSERVER_SPHEREX and body["tag"] == "model_dependent"
    assert horizons.OBSERVER_SPHEREX in body["assumption"] and body["formula"]
    assert body["missing"] == [] and body["cached_at"] and body["fetched_at"]
    assert body["step_min"] == 60
    assert body["windows"] == [
        {"start": "2026-03-20T00:00:00.000Z", "end": "2026-03-21T12:00:00.000Z"}
    ]
    # The samples are Horizons' own, every step, in time order, inside the window.
    times = [parse_utc(p["time"]) for p in body["points"]]
    assert times == sorted(times) and len(times) == 37
    assert all(b - a == timedelta(minutes=60) for a, b in itertools.pairwise(times))
    assert WINDOW[0] <= times[0] and times[-1] <= WINDOW[1]
    _, raw = entry("horizons", step="60m")
    recorded = {horizons._parse_horizons_time(t): (ra, dec) for t, ra, dec in horizons.parse(raw)}
    for p in body["points"]:
        ra, dec = recorded[parse_utc(p["time"])]
        assert p["ra"] == pytest.approx(ra % 360.0, abs=1e-7)
        assert p["dec"] == pytest.approx(dec, abs=1e-7)
    # Frame points are the /frames positions (the exact TLIST at each midpoint).
    frames = client.get(f"/v1/objects/{oid}/frames").json()["frames"]
    assert len(body["frame_points"]) == len(frames) == 16
    by_id = {f["frame_id"]: f for f in frames}
    for fp in body["frame_points"]:
        f = by_id[fp["frame_id"]]
        assert fp["time"] == f["time"]
        assert (fp["ra"], fp["dec"]) == (f["ra"], f["dec"])
        assert fp["ra_3sigma_arcsec"] is None and fp["dec_3sigma_arcsec"] is None  # cut


def test_interp_error_is_measured_against_the_tlist_positions(client: TestClient) -> None:
    """A19.14: the interpolated marker against the TLIST positions. The reply's bound is the
    largest separation, so every frame is within it, and one frame reaches it."""
    body = _path(client, _eros(client)).json()
    pts = body["points"]
    track = moving.Track(
        [horizons.EphemPoint(parse_utc(p["time"]), p["ra"], p["dec"]) for p in pts]
    )
    seps = []
    for fp in body["frame_points"]:
        at = track.at(parse_utc(fp["time"]))
        assert at is not None
        seps.append(track_path._sep_arcsec(at, (fp["ra"], fp["dec"])))
    bound = body["interp_error_arcsec"]
    assert bound is not None and all(s <= bound + 1e-3 for s in seps)
    assert max(seps) == pytest.approx(bound, abs=2e-3)
    # A 60 min step on Eros: several arcseconds, as A19.4 warns for an hourly table.
    assert 1.0 < bound < 10.0


def test_the_shared_fixture_is_the_live_reply() -> None:
    """A19.13: shared/fixtures/track/eros-2026-03/path.json is this backend's own reply."""
    committed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert errors(committed, SCHEMA) == []
    model = TrackPath.model_validate(committed)  # the generated model reads it back unchanged
    assert model.model_dump(mode="json") == committed
    assert track_fixtures.main(["--check"]) == 0


def test_path_is_deterministic(fixture_cache: Path) -> None:
    def once() -> str:
        with TestClient(create_app(make_settings(fixture_cache))) as c:
            return json.dumps(_path(c, _eros(c)).json(), sort_keys=True)

    assert once() == once()


# --- Span: clipping, the cap, outside every window ------------------------------------------


def test_start_and_end_are_clipped_to_the_window(client: TestClient) -> None:
    oid = _eros(client)
    body = _path(client, oid, start="2026-03-21T00:00:00Z", end="2026-03-30T00:00:00Z").json()
    assert body["windows"] == [
        {"start": "2026-03-21T00:00:00.000Z", "end": "2026-03-21T12:00:00.000Z"}
    ]
    t = [parse_utc(p["time"]) for p in body["points"]]
    assert len(t) == 13 and t[0] == parse_utc("2026-03-21T00:00:00Z")
    lo, hi = parse_utc("2026-03-21T00:00:00Z"), parse_utc("2026-03-21T12:00:00Z")
    assert all(lo <= parse_utc(fp["time"]) <= hi for fp in body["frame_points"])
    assert body["missing"] == []


def test_outside_every_window_is_path_window(client: TestClient) -> None:
    oid = _eros(client)
    for params in ({"start": "2026-04-01T00:00:00Z"}, {"end": "2026-03-01T00:00:00Z"}):
        body = _path(client, oid, **params).json()
        assert errors(body, SCHEMA) == []
        assert body["missing"] == ["path:window"]
        assert body["points"] == [] and body["frame_points"] == [] and body["windows"] == []


def test_bad_ranges_are_400(client: TestClient) -> None:
    oid = _eros(client)
    r = _path(client, oid, start="2026-03-21T00:00:00Z", end="2026-03-20T00:00:00Z")
    assert r.status_code == 400 and r.json()["error"] == "bad_request"
    r = _path(client, oid, start="yesterday")
    assert r.status_code == 400 and r.json()["error"] == "bad_request"


def test_a_span_over_the_cap_is_refused_and_no_params_serve_the_first_days(
    fixture_cache: Path,
) -> None:
    with TestClient(create_app(make_settings(fixture_cache, path_max_span_days=0.5))) as c:
        oid = _eros(c)
        r = _path(c, oid, start="2026-03-20T00:00:00Z", end="2026-03-21T00:00:00Z")
        assert r.status_code == 400 and r.json()["error"] == "path_span_too_long"
        body = _path(c, oid).json()
    assert body["windows"] == [
        {"start": "2026-03-20T00:00:00.000Z", "end": "2026-03-20T12:00:00.000Z"}
    ]
    assert parse_utc(body["points"][-1]["time"]) <= parse_utc("2026-03-20T12:00:00Z")


def test_select_spans_never_joins_windows() -> None:
    a = (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC))
    b = (datetime(2026, 1, 5, tzinfo=UTC), datetime(2026, 1, 6, tzinfo=UTC))
    assert track_path.select_spans((a, b), None, None, 31) == [(0, a), (1, b)]
    mid = datetime(2026, 1, 1, 12, tzinfo=UTC)
    late = datetime(2026, 1, 5, 6, tzinfo=UTC)
    assert track_path.select_spans((a, b), mid, late, 31) == [(0, (mid, a[1])), (1, (b[0], late))]
    assert track_path.select_spans((a, b), a[1] + timedelta(hours=1), b[0], 31) == [
        (1, (b[0], b[0]))
    ]


def test_a_time_past_the_spherex_ephemeris_is_path_observer(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A19.4: no position seen from SPHEREx after its ephemeris ends; never the geocentre."""
    end = parse_utc("2026-03-21T00:00:00Z")
    monkeypatch.setattr(track_path, "SPHEREX_EPHEMERIS_END", end)
    body = _path(client, _eros(client)).json()
    assert body["missing"] == ["path:observer"]
    assert body["windows"][0]["end"] == "2026-03-21T00:00:00.000Z"
    assert all(parse_utc(p["time"]) <= end for p in body["points"])


# --- Cache only: not cached offline, deferred online, then final ----------------------------


def test_offline_and_not_cached_is_path_not_cached(fixture_cache: Path) -> None:
    """A 30 min step has no recorded range answer: offline, nothing is invented."""
    service, obj = _service(fixture_cache, moving_ephem_step_min=30)
    body = track_path.build_path(service.ctx, service, obj)
    assert errors(body, SCHEMA) == []
    assert body["missing"] == ["path:not_cached"] and body["points"] == []
    assert body["cached_at"] is None and body["interp_error_arcsec"] is None


def test_online_and_not_cached_defers_to_the_job_then_serves_the_final_path(
    fixture_cache: Path,
) -> None:
    """Online, the request starts the object's job (it never asks Horizons itself) and answers
    path:deferred; once the answers are in the cache the same request gives the final path."""
    service, obj = _service(fixture_cache, offline=False, moving_ephem_step_min=30)
    started: list[str] = []
    service.on_request = lambda o: started.append(o.id)
    result = track_path.build_path(service.ctx, service, obj)
    assert result["missing"] == ["path:deferred"]
    assert result["points"] == [] and result["windows"] == []  # nothing served yet
    assert started == [EROS]
    assert errors(result, SCHEMA) == []

    # The job's path search has filled the cache (here: the recorded 60 min answers).
    service, obj = _service(fixture_cache, offline=False)
    service.on_request = lambda o: started.append(o.id)
    final = track_path.build_path(service.ctx, service, obj)
    assert final["missing"] == [] and len(final["points"]) == 37
    assert started == [EROS]  # nothing left to fetch: no second job


def test_a_recent_live_failure_is_path_ephemeris(fixture_cache: Path) -> None:
    service, obj = _service(fixture_cache, offline=False, moving_ephem_step_min=30)
    cfg = moving.MovingConfig.from_context(service.ctx, obj.spkid)
    for a, b in moving.range_chunks(cfg)[0]:
        service._mark_failed(horizons.range_key("20000433", a, b, 30).digest)
    service.on_request = lambda o: pytest.fail("a recent failure must not restart the job")
    body = track_path.build_path(service.ctx, service, obj)
    assert body["missing"] == ["path:ephemeris"] and body["points"] == []


# --- Errors ---------------------------------------------------------------------------------


def test_unknown_and_fixed_objects_are_404(client: TestClient) -> None:
    r = client.get("/v1/objects/sbdb-99999999/path")
    assert r.status_code == 404 and r.json()["error"] == "not_found"
    sid = client.get("/v1/resolve", params={"q": "SIMP J013656.5+093347.3"}).json()["id"]
    r = client.get(f"/v1/objects/{sid}/path")
    assert r.status_code == 404 and r.json()["error"] == "not_moving"


# --- Mover footprints (A19.3) ---------------------------------------------------------------


def test_mover_overlays_serve_each_frames_sia_footprint(client: TestClient) -> None:
    """Done when: /overlays gives the 16 Eros frames their footprints (and stars, #95)."""
    oid = _eros(client)
    body = client.get(f"/v1/objects/{oid}/overlays").json()
    rows = {
        r.frame_id: r
        for meta, b in entries("irsa_sia")
        if meta["maxrec"] == 500
        for r in irsa_sia.parse_rows(b)
    }
    assert len(body["frames"]) == 16
    assert not any(m.startswith(("footprint:", "overlay:")) for m in body["missing"])
    assert all(c["available"] and c["sources"] for c in body["catalogs"])
    for fo in body["frames"]:
        region = rows[fo["frame_id"]].s_region
        assert region is not None and fo["footprint"] is not None
        assert len(fo["footprint"]) == len(region)
        for (ra, dec), (r_ra, r_dec) in zip(fo["footprint"], region, strict=True):
            assert ra == pytest.approx(r_ra % 360.0, abs=1e-7) and dec == pytest.approx(r_dec)
        assert fo["masks"]


def test_a_stored_frame_list_keeps_the_footprint(fixture_cache: Path) -> None:
    service, obj = _service(fixture_cache)
    built = service.get_frames(obj)
    assert all(f.s_region for f in built.frames)
    # A second service reads the stored derived entry, not the cones.
    again = FrameService(service.ctx).get_frames(obj)
    assert [f.s_region for f in again.frames] == [f.s_region for f in built.frames]
    assert all(isinstance(f.s_region, tuple) for f in again.frames)
    assert FrameRecord.from_stored({**_as_doc(built.frames[0]), "s_region": None}).s_region is None


def _as_doc(f: FrameRecord) -> dict[str, Any]:
    from dataclasses import asdict

    return json.loads(json.dumps(asdict(f)))


def test_only_a_movers_frames_key_carries_the_record_version(fixture_cache: Path) -> None:
    service, obj = _service(fixture_cache)
    cfg = moving.MovingConfig.from_context(service.ctx, obj.spkid)
    assert dict(frames_key(service.ctx, obj.id, moving_cfg=cfg).query)["m_record"] == "2"
    assert "m_record" not in dict(frames_key(service.ctx, "simbad-x").query)


# --- Review fixes (code review of issue #74) ------------------------------------------------


def test_a_partial_frame_list_is_reported_and_reread(fixture_cache: Path) -> None:
    """A memoised partial list is not trusted: /path reads again, and while the list is still
    not final it says so (path:frames_incomplete) instead of passing a subset as final."""
    service, obj = _service(fixture_cache)
    full = service.get_frames(obj)
    partial = FramesResult(obj.id, full.frames[:3], ["cutouts:deferred:13"], full.cached_at)
    calls: list[bool] = []

    def fake(o: ResolvedObject, *, use_memo: bool = False, **_: Any) -> FramesResult:
        calls.append(use_memo)
        return partial

    service.get_frames = fake  # type: ignore[method-assign]
    body = track_path.build_path(service.ctx, service, obj)
    assert calls == [True, False]  # the memo, then a fresh read
    assert body["missing"] == ["path:frames_incomplete"]
    assert len(body["frame_points"]) == 3 and len(body["points"]) == 37
    assert errors(body, SCHEMA) == []


def test_a_deferred_reply_keeps_the_codes_found_so_far(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service, obj = _service(fixture_cache, offline=False, moving_ephem_step_min=30)
    service.on_request = lambda o: None
    monkeypatch.setattr(track_path, "SPHEREX_EPHEMERIS_END", parse_utc("2026-03-21T00:00:00Z"))
    body = track_path.build_path(service.ctx, service, obj)
    assert body["missing"] == ["path:deferred", "path:observer"]
    assert body["windows"] == [] and body["points"] == []


def test_a_torn_cache_entry_is_not_cached_never_a_live_call(fixture_cache: Path) -> None:
    """A range entry whose body fails its SHA-256 is a miss: offline path:not_cached, online
    the job is asked; the request itself never reaches Horizons (the network is blocked)."""
    service, obj = _service(fixture_cache)
    cfg = moving.MovingConfig.from_context(service.ctx, obj.spkid)
    (a, b), *_ = moving.range_chunks(cfg)[0]
    key = horizons.range_key("20000433", a, b, cfg.ephem_step_min)
    body_path, _ = service.ctx.cache._paths(key)
    body_path.write_bytes(body_path.read_bytes() + b" ")
    assert track_path.build_path(service.ctx, service, obj)["missing"] == ["path:not_cached"]
    online, obj = _service(fixture_cache, offline=False)
    started: list[str] = []
    online.on_request = lambda o: started.append(o.id)
    assert track_path.build_path(online.ctx, online, obj)["missing"] == ["path:deferred"]
    assert started == [EROS]


def test_one_sided_ranges_are_clipped_to_the_cap_not_refused() -> None:
    long = (datetime(2025, 4, 1, tzinfo=UTC), datetime(2026, 6, 1, tzinfo=UTC))
    t = datetime(2026, 3, 20, tzinfo=UTC)
    assert track_path.select_spans((long,), t, None, 31) == [(0, (t, t + timedelta(days=31)))]
    assert track_path.select_spans((long,), None, t, 31) == [(0, (t - timedelta(days=31), t))]
    end = datetime(2026, 5, 20, tzinfo=UTC)  # the window ends before the cap
    assert track_path.select_spans((long,), end, None, 31) == [(0, (end, long[1]))]


def test_keys_do_not_depend_on_the_footprint(fixture_cache: Path) -> None:
    """A list stored before issue #74 (no s_region) and the same list rebuilt give the same
    spectrum key, so nothing is measured twice for the same inputs."""
    from dataclasses import replace

    from app.core.measure.spectrum import frames_digest

    service, obj = _service(fixture_cache)
    fr = service.get_frames(obj)
    bare = FramesResult(
        fr.object_id, [replace(f, s_region=None) for f in fr.frames], fr.missing, fr.cached_at
    )
    assert frames_digest(fr, {}) == frames_digest(bare, {})
    assert "s_region" not in fr.frames[0].key_doc()
