"""Regression tests for the code-review findings on issue #1."""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import irsa_cutout, irsa_sia
from app.api.objects import _provenance
from app.cache import store as store_mod
from app.cache.keys import CacheKey
from app.cache.store import LOCK_STRIPES, LiveResponse, ReadThroughCache
from app.context import make_context
from app.core.find import frames as frames_mod
from app.core.find.frames import MEMO_SIZE, FrameService, frames_key
from app.core.find.ids import looks_like_small_body
from app.core.find.resolver import ResolvedObject, registry_key, resolve
from app.main import create_app
from tests.conftest import FIXTURE_CACHE, make_settings
from tests.helpers import entries, entry

# 1. Fixture bodies must stay byte-exact (autocrlf would rewrite LF text bodies to CRLF).


def test_fixture_bodies_match_their_meta() -> None:
    metas = list(FIXTURE_CACHE.glob("v1/*/*/*/*.json"))
    assert metas
    for meta_path in metas:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        body = meta_path.with_suffix(".body").read_bytes()
        assert hashlib.sha256(body).hexdigest() == meta["body_sha256"], meta_path


def test_gitattributes_keeps_fixtures_binary() -> None:
    attrs = Path(__file__).resolve().parents[2] / ".gitattributes"
    assert "backend/tests/fixtures/** -text" in attrs.read_text(encoding="utf-8")


# 2. No rewrite of an unchanged registry entry; os.replace retried on PermissionError.


def test_resolve_does_not_rewrite_unchanged_registry(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    obj = resolve(ctx, "R Dra", {}).obj
    _, meta_path = ctx.cache._paths(registry_key(obj.id))
    before = os.stat(meta_path).st_mtime_ns, os.stat(meta_path.with_suffix(".body")).st_mtime_ns
    resolve(ctx, "R Dra", {})
    after = os.stat(meta_path).st_mtime_ns, os.stat(meta_path.with_suffix(".body")).st_mtime_ns
    assert before == after


def test_replace_is_retried_on_permission_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = os.replace
    failures = [PermissionError(13, "in use"), PermissionError(13, "in use")]

    def flaky(src: str, dst: object) -> None:
        if failures:
            raise failures.pop()
        real(src, dst)  # type: ignore[arg-type]

    monkeypatch.setattr(store_mod.os, "replace", flaky)
    monkeypatch.setattr(store_mod.time, "sleep", lambda s: None)
    cache = ReadThroughCache(tmp_path, offline=False)
    key = CacheKey.make("t", None, q="1")
    cache.put(key, LiveResponse(b"x", "u", 200, "text/plain"))
    assert cache.get(key) is not None and not failures


# 3. Unhandled errors become JSON 500 without the traceback.


def test_unhandled_error_is_json_500(
    offline_settings: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import resolve as resolve_route

    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("secret internals")

    monkeypatch.setattr(resolve_route, "resolve", boom)
    with TestClient(create_app(offline_settings), raise_server_exceptions=False) as c:  # type: ignore[arg-type]
        r = c.get("/v1/resolve", params={"q": "R Dra"})
    assert r.status_code == 500
    assert r.json() == {"error": "internal", "detail": "Something went wrong on the server."}
    assert "secret" not in r.text


# 4. --refresh rebuilds the frame list and refreshes resolve.


def test_rebuild_ignores_stored_frame_list(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    obj = resolve(ctx, "R Dra", {}).obj
    bogus = {"frames": [], "missing": [], "sources_earliest_fetched_at": None}
    ctx.cache.put(
        frames_key(ctx, obj.id), LiveResponse(json.dumps(bogus).encode(), "x", 200, "json")
    )
    svc = FrameService(ctx)
    assert svc.get_frames(obj).frames == []  # the stored list is served ...
    assert len(svc.get_frames(obj, rebuild=True).frames) == 3  # ... unless rebuilt


def test_prefetch_refresh_reaches_resolve_and_rebuilds(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from scripts import prefetch

    seen: list[bool] = []
    real_resolve = prefetch.resolve

    def spy(ctx, q, aliases, *, refresh=False):  # type: ignore[no-untyped-def]
        seen.append(refresh)
        return real_resolve(ctx, q, aliases, refresh=refresh)

    monkeypatch.setattr(prefetch, "resolve", spy)
    ctx = make_context(make_settings(fixture_cache))  # offline: refresh serves the old entries
    obj = resolve(ctx, "R Dra", {}).obj
    bogus = {"frames": [], "missing": [], "sources_earliest_fetched_at": None}
    ctx.cache.put(
        frames_key(ctx, obj.id), LiveResponse(json.dumps(bogus).encode(), "x", 200, "json")
    )
    args = argparse.Namespace(refresh=True, maxrec=3, min_maxrec=1, read_timeout=1.0, concurrency=1)
    rep = prefetch.prefetch_target(ctx, {"name": "R Draconis", "query": "R Dra"}, {}, args)
    assert seen == [True]
    assert rep.frames == 3


# 5. Truncation counts the raw answer, not the rows left after filtering.


def test_truncation_uses_raw_row_count(monkeypatch: pytest.MonkeyPatch) -> None:
    _, body = entries("irsa_sia")[0]
    body_ok = body.replace(b'value="OVERFLOW"', b'value="OK"')
    rows = irsa_sia.parse_rows(body_ok)
    assert len(rows) == 3
    monkeypatch.setattr(irsa_sia, "parse_rows", lambda b: rows[:2])  # 1 row filtered out
    key = CacheKey.make("irsa_sia", "spherex_qr2", q="t")
    served = store_mod.Served(store_mod.CacheEntry(key, body_ok, {"maxrec": 3}), True)
    result = irsa_sia._result(served.entry, served)
    assert len(result.rows) == 2 and result.truncated


# 6. keep_psf changes the cutout key (only when set); the frame-list key ignores it.


def test_keep_psf_in_cutout_key_only(tmp_path: Path) -> None:
    base = irsa_cutout.cutout_key("spherex_qr2", "F_D1", 1.0, 2.0, 360.0)
    assert irsa_cutout.cutout_key("spherex_qr2", "F_D1", 1.0, 2.0, 360.0, keep_psf=False) == base
    assert irsa_cutout.cutout_key("spherex_qr2", "F_D1", 1.0, 2.0, 360.0, keep_psf=True) != base
    a = make_context(make_settings(tmp_path, cutout_keep_psf=False))
    b = make_context(make_settings(tmp_path, cutout_keep_psf=True))
    assert frames_key(a, "x") == frames_key(b, "x")


# 7. Frame positions reuse the resolved tag; no `no_proper_motion` flag on typed coordinates.


def test_position_provenance_reuses_resolved_tag() -> None:
    coords = resolve(make_context(make_settings(Path("unused"))), "12.5, -30", {}).obj
    assert coords.provenance["ra"]["tag"] != "measured"
    assert _provenance(coords, has_pm=False)["ra"].tag == coords.provenance["ra"]["tag"]
    sbdb = ResolvedObject(
        "sbdb-1",
        "x",
        1.0,
        2.0,
        True,
        "sbdb",
        provenance={"ra": {"tag": "model_dependent", "assumption": "JPL orbit"}},
    )
    assert _provenance(sbdb, has_pm=False)["ra"].tag == "model_dependent"


def test_no_pm_flag_only_for_catalogue_stars(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = make_context(make_settings(fixture_cache))
    rdra = resolve(ctx, "R Dra", {}).obj
    real_position = frames_mod.position_at
    # Same positions as R Dra (so the recorded cutouts are found), but without a proper motion.
    monkeypatch.setattr(frames_mod, "position_at", lambda o, t: real_position(rdra, t))
    nopm = dict(pm_ra_mas_yr=None, pm_dec_mas_yr=None)
    as_coords = dataclasses.replace(rdra, id="radec-test", resolver="coords", **nopm)
    as_star = dataclasses.replace(rdra, id="simbad-test", **nopm)
    coord_frames = FrameService(ctx).get_frames(as_coords).frames
    star_frames = FrameService(ctx).get_frames(as_star).frames
    assert coord_frames and star_frames
    assert all("no_proper_motion" not in f.flags for f in coord_frames)
    assert all("no_proper_motion" in f.flags for f in star_frames)


# 8. A web request downloads at most SX_LIVE_CUTOUTS_PER_REQUEST cutouts.


def test_live_cutout_downloads_are_capped(fixture_cache: Path, tmp_path: Path) -> None:
    rdra = resolve(make_context(make_settings(fixture_cache)), "R Dra", {}).obj
    sia_body = next(b for _, b in entries("irsa_sia") if b"2025W52_2A_0161_2" in b)
    cutouts = {
        m["key"]["query"]["frame_id"]: b
        for m, b in entries("irsa_cutout")
        if m["key"]["query"]["frame_id"].startswith("2025W52_2A_0")
    }
    cutout_body = next(iter(cutouts.values()))
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/SIA"):
            return httpx.Response(200, content=sia_body)
        return httpx.Response(200, content=cutout_body)

    settings = make_settings(
        tmp_path / "empty", offline=False, live_cutouts_per_request=1, http_retries=0
    )
    ctx = make_context(settings, transport=httpx.MockTransport(handler))
    result = FrameService(ctx).get_frames(rdra)
    assert sum(1 for p in calls if "/ibe/" in p) == 1
    assert "cutouts:deferred:2" in result.missing
    assert not list((tmp_path / "empty" / "v1").glob("derived.frames"))
    # the pre-fetch path has no cap
    calls.clear()
    FrameService(ctx).get_frames(rdra, rebuild=True, unlimited_live=True)
    assert sum(1 for p in calls if "/ibe/" in p) == 2


# 11. Bounded memo and locks; one epoch format.


def test_memo_and_locks_are_bounded(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))
    svc = FrameService(ctx)
    for i in range(MEMO_SIZE + 50):
        moving = ResolvedObject(f"sbdb-{i}", None, 1.0, 2.0, True, "sbdb")
        svc.get_frames(moving)
    assert len(svc._memo) == MEMO_SIZE
    assert len(ctx.cache._locks) == LOCK_STRIPES


def test_epoch_is_iso_z_for_catalogue_positions(fixture_cache: Path) -> None:
    obj = resolve(make_context(make_settings(fixture_cache)), "R Dra", {}).obj
    assert obj.epoch == "2000-01-01T11:58:55.816Z"


# 12. Flamsteed names go to SIMBAD first; numbered asteroids to SBDB first.


@pytest.mark.parametrize(
    ("name", "small_body"),
    [
        ("61 Cyg", False),
        ("51 Peg", False),
        ("61 Cyg A", False),
        ("51 Pegasi", False),
        ("70 Ophiuchi", False),
        ("433 Eros", True),
        ("1 Ceres", True),
    ],
)
def test_flamsteed_routing(name: str, small_body: bool) -> None:
    assert looks_like_small_body(name) is small_body


def test_recorded_cutout_entry_is_found_by_key_for() -> None:
    """``key_for`` (used by the live cap) builds the same key as the recorded entries."""
    meta, _ = entry("irsa_cutout")
    q = meta["key"]["query"]
    key = irsa_cutout.cutout_key(
        "spherex_qr2", q["frame_id"], float(q["ra"]), float(q["dec"]), float(q["size_arcsec"])
    )
    assert json.loads(key.canonical()) == meta["key"]


# --- second review round ---------------------------------------------------------------------

# A. A 500 still carries CORS headers (catch-all runs inside CORSMiddleware).


def test_internal_error_keeps_cors_headers(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import resolve as resolve_route

    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("secret internals")

    monkeypatch.setattr(resolve_route, "resolve", boom)
    origin = "http://localhost:5173"
    settings = make_settings(fixture_cache, cors_origins=origin)
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        r = c.get("/v1/resolve", params={"q": "R Dra"}, headers={"Origin": origin})
        ok = c.get("/v1/objects/simbad-never-resolved/frames", headers={"Origin": origin})
    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == origin
    assert r.json() == {"error": "internal", "detail": "Something went wrong on the server."}
    assert "secret" not in r.text
    assert ok.status_code == 404 and ok.headers.get("access-control-allow-origin") == origin


# B. Capped live downloads make progress, and a cutout that always fails does not block it.


def _rdra_live_setup(fixture_cache: Path, tmp_path: Path, failing: set[str] | None = None):  # type: ignore[no-untyped-def]
    rdra = resolve(make_context(make_settings(fixture_cache)), "R Dra", {}).obj
    sia_body = next(b for _, b in entries("irsa_sia") if b"2025W52_2A_0161_2" in b)
    bodies = {
        m["key"]["query"]["frame_id"]: b
        for m, b in entries("irsa_cutout")
        if m["key"]["query"]["frame_id"].startswith("2025W52_2A_0")
    }
    order = [
        r.frame_id
        for r in sorted(irsa_sia.parse_rows(sia_body), key=lambda r: (r.t_min_mjd, r.frame_id))
    ]
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/SIA"):
            return httpx.Response(200, content=sia_body)
        fid = next(f for f in bodies if f.replace("_D", "D") in request.url.path)
        calls.append(fid)
        if failing and fid in failing:
            return httpx.Response(404)
        return httpx.Response(200, content=bodies[fid])

    settings = make_settings(
        tmp_path / "live", offline=False, live_cutouts_per_request=1, http_retries=0
    )
    ctx = make_context(settings, transport=httpx.MockTransport(handler))
    return rdra, FrameService(ctx), order, calls


def test_capped_requests_make_progress(fixture_cache: Path, tmp_path: Path) -> None:
    rdra, svc, order, _ = _rdra_live_setup(fixture_cache, tmp_path)
    assert len(order) == 3
    deferred = []
    for _ in range(3):
        missing = svc.get_frames(rdra).missing
        deferred.append([m for m in missing if m.startswith("cutouts:deferred")])
    assert deferred == [["cutouts:deferred:2"], ["cutouts:deferred:1"], []]
    assert len(svc.get_frames(rdra).frames) == 3


def test_failing_cutout_does_not_eat_the_budget(fixture_cache: Path, tmp_path: Path) -> None:
    order = _rdra_live_setup(fixture_cache, tmp_path)[2]
    first = order[0]
    # make the first frame fail permanently
    rdra, svc, order, calls = _rdra_live_setup(fixture_cache, tmp_path / "b", failing={first})
    results = [svc.get_frames(rdra) for _ in range(3)]
    assert f"cutout:{first}" in results[0].missing
    assert "cutouts:deferred:2" in results[0].missing
    assert "cutouts:deferred:1" in results[1].missing
    final = results[2]
    assert not [m for m in final.missing if m.startswith("cutouts:deferred")]
    assert {f.frame_id for f in final.frames} == set(order[1:])
    assert f"cutout:{first}" in final.missing  # still refused, never invented
    assert calls.count(first) == 1  # not retried within the TTL
    assert not list((tmp_path / "b" / "live" / "v1").glob("derived.frames"))


def test_failed_cutout_is_retried_after_the_ttl(fixture_cache: Path, tmp_path: Path) -> None:
    order = _rdra_live_setup(fixture_cache, tmp_path)[2]
    first = order[0]
    rdra, svc, order, calls = _rdra_live_setup(fixture_cache, tmp_path / "c", failing={first})
    now = [1000.0]
    svc._clock = lambda: now[0]
    svc.get_frames(rdra)
    now[0] += svc.ctx.settings.live_failure_ttl_s + 1
    svc.get_frames(rdra)
    assert calls.count(first) == 2


# C. A Flamsteed name never falls back to a numbered asteroid of the same number.


def _resolver_ctx(tmp_path: Path, simbad_fails: bool = False):  # type: ignore[no-untyped-def]
    _, horizons_body = entries("horizons")[0]
    sbdb_answers = {
        "61 Cyg": {
            "object": {
                "spkid": "20000061",
                "fullname": "61 Danae (A860 RA)",
                "shortname": "61 Danae",
                "kind": "an",
            }
        },
        "849 Ara": {
            "object": {
                "spkid": "20000849",
                "fullname": "849 Ara (1912 NY)",
                "shortname": "849 Ara",
                "kind": "an",
            }
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "simbad.example":
            if simbad_fails:
                raise httpx.ConnectError("unreachable", request=request)
            return httpx.Response(200, json={"data": []})
        if host == "sbdb.example":
            return httpx.Response(200, json=sbdb_answers[request.url.params["sstr"]])
        if host == "horizons.example":
            return httpx.Response(200, content=horizons_body)
        raise AssertionError(host)

    settings = make_settings(
        tmp_path,
        offline=False,
        http_retries=0,
        simbad_tap_urls="https://simbad.example/tap",
        sbdb_url="https://sbdb.example/sbdb.api",
        horizons_url="https://horizons.example/api",
    )
    return make_context(settings, transport=httpx.MockTransport(handler))


def test_flamsteed_name_does_not_fall_back_to_asteroid(tmp_path: Path) -> None:
    from app.core.find.resolver import NotFound

    with pytest.raises(NotFound):
        resolve(_resolver_ctx(tmp_path), "61 Cyg", {})


def test_flamsteed_shaped_asteroid_name_still_resolves(tmp_path: Path) -> None:
    obj = resolve(_resolver_ctx(tmp_path), "849 Ara", {}).obj
    assert obj.id == "sbdb-20000849" and obj.moving


def test_flamsteed_with_simbad_down_is_not_an_asteroid(tmp_path: Path) -> None:
    from app.cache.store import UpstreamUnavailable

    # SIMBAD unreachable: the star may exist, so this is 503 (upstream), never asteroid 61.
    with pytest.raises(UpstreamUnavailable):
        resolve(_resolver_ctx(tmp_path, simbad_fails=True), "61 Cyg", {})
