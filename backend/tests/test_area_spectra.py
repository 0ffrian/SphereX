"""The spectrum check (A17.13, Q-474, Q-475): the Eros pack, synthetic movers, the physics, the
``spectra`` stage and ``GET /v1/areas/{area_id}/spectra``. Network blocked; nothing is fetched.
"""

from __future__ import annotations

import json
import math
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.cache.store import ReadThroughCache
from app.core.area import spectrum
from app.core.area.config import (
    AREA_SOURCE,
    DEFAULT_AREA_CONFIG,
    DEFAULT_SPECTRUM_CONFIG,
    SPECTRA_STAGE,
    area_key,
    method_settings,
    spectra_key,
    spectra_settings_sha,
    spectrum_settings,
)
from app.core.area.store import AreaStore, canonical, head_key, settings_sha
from app.core.card.validate import errors
from app.main import create_app
from app.settings import BACKEND_DIR
from app.timefmt import iso_utc_z
from scripts import area_spectra
from tests.conftest import make_settings

PACK = BACKEND_DIR / "assets" / "areas"
EROS = "eros-2026-03"
RELEASE = "spherex_qr2"
CFG = DEFAULT_SPECTRUM_CONFIG


def _pack_bodies(root: Path = PACK) -> tuple[dict[str, bytes], str]:
    cache = ReadThroughCache(root, offline=True)
    head_entry = cache.get(head_key(RELEASE, EROS))
    assert head_entry is not None
    p = json.loads(head_entry.body)["params_hash"]
    bodies = {}
    for stage in ("summary", "dots", "tracks"):
        got = cache.get(area_key(RELEASE, EROS, stage, p))
        assert got is not None
        bodies[stage] = got.body
    return bodies, p


@pytest.fixture(scope="module")
def eros() -> dict[str, Any]:
    bodies, _ = _pack_bodies()
    return spectrum.spectra_from_bodies(bodies["summary"], bodies["dots"], bodies["tracks"])


# --- the recorded Eros area: the expected table of the ticket ----------------------------


def test_eros_verdicts(eros: dict[str, Any]) -> None:
    by = {t["track_id"]: t for t in eros["tracks"]}
    t3 = by["T3"]  # 433 Eros, found blind, u = 1.705
    assert (t3["verdict"], t3["heat_glow"], t3["r_source"]) == ("rock", True, "parallax")
    assert abs(t3["r_au"] - 1.157) < 0.05  # Horizons: r = 1.157 au on 2026-03-20 08:50
    assert all(p["limit"] is None for p in t3["pairs"])
    assert min(p["rho"] for p in t3["pairs"]) > 1.2 and max(p["rho"] for p in t3["pairs"]) > 3.0
    assert (by["T1"]["verdict"], by["T1"]["heat_glow"]) == ("rock", None)
    assert by["T4"]["verdict"] == "rock"
    assert by["T8"]["verdict"] == "very_red"
    assert by["T8"]["pairs"] and all(p["limit"] == "lower" for p in by["T8"]["pairs"])
    for tid in ("T2", "T5", "T6", "T7", "T9"):
        assert by[tid]["verdict"] == "one_colour" and by[tid]["pairs"] == []


def test_eros_is_one_entry_per_track_in_order_and_never_changes_a_track(
    eros: dict[str, Any],
) -> None:
    bodies, _ = _pack_bodies()
    tracks = json.loads(bodies["tracks"])["tracks"]
    assert [t["track_id"] for t in eros["tracks"]] == [t["track_id"] for t in tracks]
    # Every dot of a track appears once among its points (dot ids of every tracklet).
    for t, s in zip(tracks, eros["tracks"], strict=True):
        ids = sorted({i for tl in t["tracklets"] for i in tl["dot_ids"]})
        assert sorted(p["dot_id"] for p in s["points"]) == ids
    assert json.loads(bodies["tracks"])["tracks"] == tracks  # inputs untouched


def test_eros_calibration_is_measured_from_stars(eros: dict[str, Any]) -> None:
    assert eros["missing"] == []
    cal = {(c["visit"], c["detector"]): c for c in eros["calibration"]}
    assert set(cal) == {(1, 1), (1, 4), (2, 1), (2, 4)}  # only D1 and D4 in the pack
    for c in cal.values():
        assert c["source"] == "stars" and c["n_pairs"] >= 10
        assert 0.02 < c["sigma_sys"] < 0.08  # median star steps 2.7 to 6.4 % (A17.13)


def test_eros_rel_puts_each_visit_short_arm_at_one(eros: dict[str, Any]) -> None:
    for t in eros["tracks"]:
        for visit in {p["visit"] for p in t["points"]}:
            short = [p["rel"] for p in t["points"] if p["visit"] == visit and p["arm"] == "short"]
            pts = [
                p["rel"]
                for p in t["points"]
                if p["visit"] == visit and p["arm"] == "short" and p["point"]
            ]
            if pts:
                assert float(np.median(pts)) == pytest.approx(1.0, abs=2e-4)
            else:
                assert all(r is None for r in short)


def test_eros_is_byte_identical_and_matches_the_committed_entry(eros: dict[str, Any]) -> None:
    bodies, p = _pack_bodies()
    again = spectrum.spectra_from_bodies(bodies["summary"], bodies["dots"], bodies["tracks"])
    assert canonical(again) == canonical(eros)
    committed = ReadThroughCache(PACK, offline=True).get(
        spectra_key(RELEASE, EROS, p, spectra_settings_sha())
    )
    assert committed is not None, "run: uv run python -m scripts.area_spectra"
    assert committed.body == canonical(eros)


def test_eros_reply_validates_and_tags_follow_the_ticket(eros: dict[str, Any]) -> None:
    assert errors(eros, "area-spectra.schema.json") == []
    prov = eros["provenance"]
    assert prov["points"]["tag"] == "measured"
    assert prov["rel"]["tag"] == prov["calibration"]["tag"] == "derived"
    assert prov["distance"]["tag"] == "derived"
    for k in ("colour", "distance_worst_case", "verdict", "sun"):
        assert prov[k]["tag"] == "model_dependent"
    assert eros["method"]["settings"] == spectrum_settings()
    assert eros["method"]["spectrum_version"] == "spectrum-1"


# --- synthetic movers -------------------------------------------------------------------

T0 = datetime(2026, 3, 20, 8, 30, tzinfo=UTC)
LAMBDA_S = (0.98, 1.00, 1.02, 1.04)
LAMBDA_L = (3.30, 3.39, 3.48, 3.57)


def _dot(
    fid: str,
    n: int,
    det: int,
    exp: int,
    t: datetime,
    lam: float,
    flux: float,
    snr: float,
    label: str,
    ra: float,
    dec: float,
) -> dict[str, Any]:
    return {
        "dot_id": f"{fid}:{n}",
        "frame_id": fid,
        "detector": det,
        "exposure": exp,
        "time": iso_utc_z(t),
        "wavelength_um": lam,
        "bandwidth_um": lam / 41.0,
        "flux_uJy": flux,
        "flux_err": abs(flux) / snr if flux else 10.0,
        "snr": snr,
        "label": label,
        "ra": ra,
        "dec": dec,
        "x": 10.0,
        "y": 10.0,
        "flags": [],
    }


def _area(
    *,
    rho: float = 1.0,
    snr_s: float = 50.0,
    snr_l: float = 50.0,
    detectors: tuple[int, ...] = (1, 4),
    lambda_l: tuple[float, ...] = LAMBDA_L,
    steps: dict[int, float] | None = None,
    u: float | None = None,
    n_stars: int = 12,
    star_jitter: float = 0.02,
    ra: float = 90.0,
    dec: float = 13.0,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """One visit, four exposures, a mover on D1 (short) and D4 (long), and ``n_stars`` stars
    per detector with alternating +/- ``star_jitter`` steps. ``steps`` scales the short-arm
    flux of an exposure (index from 0) to make a jump."""
    sun = spectrum.load_sun()
    dots = []
    ids: list[str] = []
    for e in range(4):
        t = T0 + timedelta(seconds=129 * e)
        for det in detectors:
            fid = f"syn_{e + 1}_D{det}"
            short = det < 4
            lam = LAMBDA_S[e] if short else lambda_l[e]
            base = 10000.0 * (steps or {}).get(e, 1.0)
            flux = base * (1.0 if short else rho * sun.fnu(lam) / sun.fnu(LAMBDA_S[e]))
            snr = snr_s if short else snr_l
            d = _dot(fid, 1, det, e + 1, t, lam, flux, snr, "mover", ra + 0.001 * e, dec)
            dots.append(d)
            ids.append(d["dot_id"])
            for k in range(n_stars):
                f = 50000.0 * (1.0 + star_jitter * (1 if (e + k) % 2 else -1))
                dots.append(
                    _dot(
                        fid,
                        k + 2,
                        det,
                        e + 1,
                        t,
                        lam,
                        f,
                        200.0,
                        "star",
                        ra + 0.01 * (k + 1),
                        dec + 0.01,
                    )
                )
    summary = {
        "area_id": "syn",
        "cached_at": "2026-03-21T00:00:00Z",
        "computed_at": "2026-03-21T00:00:00Z",
    }
    dots_reply = {"visits": [{"visit": 1, "dots": dots}]}
    track = {
        "track_id": "T1",
        "tracklets": [{"visit": 1, "dot_ids": ids}],
        "u_inv_au": u,
    }
    return summary, dots_reply, {"tracks": [track]}


def _one(**kw: Any) -> dict[str, Any]:
    reply = spectrum.compute_spectra(*_area(**kw))
    t: dict[str, Any] = reply["tracks"][0]
    t["_missing"] = reply["missing"]
    return t


def test_a_solar_coloured_mover_is_a_rock() -> None:
    t = _one(rho=1.0)
    assert t["verdict"] == "rock"
    assert t["r_source"] == "worst_case" and t["heat_glow"] is None
    assert [p["rho"] for p in t["pairs"]] == pytest.approx([1.0] * 4, abs=1e-3)
    assert all(s["ok"] for s in t["steps"])


def test_a_blue_mover_is_too_blue() -> None:
    assert _one(rho=0.3)["verdict"] == "too_blue"


def test_a_70_percent_jump_at_snr_30_flickers() -> None:
    t = _one(snr_s=30.0, snr_l=30.0, steps={2: 1.7, 3: 1.7})
    assert t["verdict"] == "flickers"
    bad = [s for s in t["steps"] if not s["ok"]]
    assert bad and all(abs(s["change"]) > s["allowed"] for s in bad)


def test_a_red_far_mover_with_parallax_is_too_red() -> None:
    # u = 0.33 (Delta about 3 au) at quadrature: r about 3.2 au, where heat glow at 2.6 um is
    # negligible, so rho = 6 is beyond rho_max = r_max (1 + G).
    lam = (2.60, 2.62, 2.64, 2.66)
    t = _one(rho=6.0, u=0.33, lambda_l=lam)
    assert t["r_source"] == "parallax" and 2.5 < t["r_au"] < 3.6
    assert all(p["rho_max"] < 3.1 for p in t["pairs"])
    assert t["verdict"] == "too_red" and t["heat_glow"] is False


def test_one_arm_only_is_one_colour() -> None:
    t = _one(detectors=(1,))
    assert t["verdict"] == "one_colour" and t["pairs"] == []


def test_snr_4_on_both_arms_is_too_faint() -> None:
    t = _one(snr_s=4.0, snr_l=4.0)
    assert t["pairs"] and all(p["limit"] is None for p in t["pairs"])
    assert t["verdict"] == "too_faint"


def test_few_star_pairs_use_the_default_floor() -> None:
    t = _one(n_stars=2)
    assert t["_missing"] == [spectrum.CALIBRATION_DEFAULT]
    reply = spectrum.compute_spectra(*_area(n_stars=2))
    assert {c["source"] for c in reply["calibration"]} == {"default"}
    assert {c["sigma_sys"] for c in reply["calibration"]} == {CFG.sigma_sys_default}


def test_star_jitter_sets_sigma_sys() -> None:
    reply = spectrum.compute_spectra(*_area(star_jitter=0.02))
    for c in reply["calibration"]:
        assert c["source"] == "stars" and c["n_pairs"] == 36
        # Steps alternate between +4.1 % and -3.9 %: MAD about 0.04, times 1.4826.
        assert c["sigma_sys"] == pytest.approx(1.4826 * 0.04, rel=0.05)


def test_limits_lower_and_upper() -> None:
    lower = _one(snr_s=2.0, snr_l=50.0, rho=20.0)
    assert {p["limit"] for p in lower["pairs"]} == {"lower"}
    assert lower["verdict"] == "very_red"
    upper = _one(snr_s=50.0, snr_l=2.0, rho=0.05)
    assert {p["limit"] for p in upper["pairs"]} == {"upper"}
    assert upper["verdict"] == "too_blue"


# --- physics ----------------------------------------------------------------------------


def _fibonacci_thermal(
    lam: float, r: float, alpha: float, pv: float, eta: float, n: int = 400_000
) -> float:
    """An independent NEATM integral: a Fibonacci lattice over the whole sphere (equal areas),
    the Sun along +x and the observer in the x-y plane."""
    cfg = CFG
    k = np.arange(n) + 0.5
    z = 1.0 - 2.0 * k / n
    rho = np.sqrt(1.0 - z * z)
    phi = math.pi * (1.0 + 5.0**0.5) * k
    nvec = np.stack([rho * np.cos(phi), rho * np.sin(phi), z], axis=1)
    sun = np.array([1.0, 0.0, 0.0])
    a = math.radians(alpha)
    obs = np.array([math.cos(a), math.sin(a), 0.0])
    cos_i, cos_e = nvec @ sun, nvec @ obs
    m = (cos_i > 0) & (cos_e > 0)
    t_ss = (
        (1 - cfg.phase_integral * pv)
        * spectrum.S0
        / (eta * cfg.emissivity * spectrum.SIGMA_SB * r * r)
    ) ** 0.25
    b = spectrum.planck_nu(lam, t_ss * cos_i[m] ** 0.25)
    return float(cfg.emissivity * np.sum(b * cos_e[m]) * 4.0 * math.pi / n)


@pytest.mark.parametrize("alpha", [0.0, 59.3, 90.0])
def test_neatm_agrees_with_an_independent_integration(alpha: float) -> None:
    grid = spectrum.neatm_thermal(3.3, 1.2, alpha, 0.25, 1.4, CFG)
    fib = _fibonacci_thermal(3.3, 1.2, alpha, 0.25, 1.4)
    assert grid == pytest.approx(fib, rel=2e-3)


def test_heat_glow_sanity_values_of_the_ticket() -> None:
    """The prototype's thermal / reflected ratios at quadrature (A17.13, Q-475)."""
    hr = spectrum.heat_ratio
    assert hr(2.4, 1.0, 90.0, 0.03, 0.7, CFG) == pytest.approx(4.0, rel=0.1)
    assert hr(3.3, 1.0, 90.0, 0.03, 0.7, CFG) == pytest.approx(140.0, rel=0.1)
    assert hr(3.3, 1.2, 90.0, 0.25, 1.4, CFG) == pytest.approx(0.7, rel=0.1)
    # The prototype: under 0.4 below 4.6 um. Here it crosses 0.4 at about 4.47 um (0.44 at
    # 4.5 um): on the Wien tail a 1 % temperature difference moves the ratio by about 10 %.
    assert all(hr(lam, 2.8, 90.0, 0.25, 1.4, CFG) < 0.4 for lam in (3.0, 3.5, 4.0, 4.4))


def test_heat_allowance_is_the_hottest_corner() -> None:
    g = spectrum.heat_allowance(3.3, 1.2, 60.0, CFG)
    assert g == pytest.approx(spectrum.heat_ratio(3.3, 1.2, 60.0, CFG.pv_min, CFG.eta_min, CFG))


def test_heat_allowance_stays_finite_next_to_the_sun() -> None:
    # Near 180 deg the HG phase function underflows to 0; the cap keeps G finite and huge.
    g = spectrum.heat_allowance(3.3, 1.0, 179.999, CFG)
    assert math.isfinite(g) and g > 1e4
    assert g == spectrum.heat_allowance(3.3, 1.0, spectrum.HEAT_PHASE_MAX_DEG, CFG)


def test_a_track_whose_dots_are_not_in_dots_is_refused() -> None:
    summary, dots_reply, tracks_reply = _area()
    tracks_reply["tracks"][0]["tracklets"][0]["dot_ids"].append("nope")
    with pytest.raises(ValueError, match="not in /dots"):
        spectrum.compute_spectra(summary, dots_reply, tracks_reply)
    tracks_reply["tracks"][0]["tracklets"] = []
    with pytest.raises(ValueError, match="has no dots"):
        spectrum.compute_spectra(summary, dots_reply, tracks_reply)


@pytest.mark.parametrize(
    "when",
    [datetime(2026, 3, 20, 8, 50, tzinfo=UTC), datetime(2026, 11, 14, 0, 0, tzinfo=UTC)],
)
def test_solar_position_within_0_02_deg_of_astropy(when: datetime) -> None:
    """The Almanac formula against astropy's built-in Sun (no download), both of date."""
    from astropy.coordinates import GeocentricTrueEcliptic, get_sun
    from astropy.time import Time

    t = Time(when)
    ref = get_sun(t).transform_to(GeocentricTrueEcliptic(equinox=t))
    lam, dist, _ = spectrum.sun_ecliptic(when)
    assert abs((lam - float(ref.lon.deg) + 180.0) % 360.0 - 180.0) < 0.02
    assert abs(float(ref.lat.deg)) < 0.01  # the formula takes beta = 0
    assert dist == pytest.approx(float(ref.distance.au), abs=2e-4)


def test_solar_table_is_the_committed_bake() -> None:
    sun = spectrum.load_sun()
    assert sun.join_um == 2.5
    assert sun.fnu(1.0) == pytest.approx(1.0, rel=0.02)
    assert 0.2 < sun.fnu(3.3) / sun.fnu(1.0) < 0.35  # F_nu falls about as lambda^-1.3
    with pytest.raises(ValueError):
        sun.fnu(6.0)


# --- storage and API --------------------------------------------------------------------


def test_spectrum_settings_never_touch_the_area_settings_sha() -> None:
    area = method_settings(DEFAULT_AREA_CONFIG)
    assert not set(area) & set(spectrum_settings())
    head = ReadThroughCache(PACK, offline=True).get(head_key(RELEASE, EROS))
    assert head is not None
    assert json.loads(head.body)["settings_sha"] == settings_sha(area)


def _copy_pack(tmp_path: Path) -> Path:
    out = tmp_path / "pack"
    shutil.copytree(PACK, out)
    return out


def test_spectra_route_serves_the_pack_offline(tmp_path: Path) -> None:
    with TestClient(create_app(make_settings(tmp_path / "cache"))) as c:
        r = c.get(f"/v1/areas/{EROS}/spectra")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
        body = r.json()
        assert errors(body, "area-spectra.schema.json") == []
        tracks = c.get(f"/v1/areas/{EROS}/tracks").json()["tracks"]
        assert [t["track_id"] for t in body["tracks"]] == [t["track_id"] for t in tracks]
        missing = c.get("/v1/areas/no-such-area/spectra")
        assert missing.status_code == 404 and missing.json()["error"] == "area_not_found"


def _drop_spectra(pack: Path) -> None:
    cache = ReadThroughCache(pack, offline=True)
    for _, meta in list(cache.iter_meta(AREA_SOURCE)):
        if meta["key"]["query"].get("stage") == SPECTRA_STAGE:
            q = meta["key"]["query"]
            cache.delete(spectra_key(meta["key"]["release"], q["id"], q["p"], q["s"]))


def test_a_served_area_without_the_stage_is_spectra_not_prepared(tmp_path: Path) -> None:
    pack = _copy_pack(tmp_path)
    _drop_spectra(pack)
    settings = make_settings(tmp_path / "cache", area_pack_dir=pack)
    with TestClient(create_app(settings)) as c:
        assert c.get(f"/v1/areas/{EROS}").status_code == 200
        r = c.get(f"/v1/areas/{EROS}/spectra")
        assert r.status_code == 404 and r.json()["error"] == "spectra_not_prepared"


def test_new_spectrum_settings_make_the_stage_outdated(tmp_path: Path) -> None:
    pack = _copy_pack(tmp_path)
    store = AreaStore(make_settings_ctx(tmp_path, pack), pack)
    assert store.spectra_entry(EROS) is not None
    store.spectra_sha = "0" * 64  # as after a threshold change: the backfill writes a new key
    assert store.spectra_entry(EROS) is None
    assert store.entry(EROS, "summary") is not None  # the area itself is still served


def make_settings_ctx(tmp_path: Path, pack: Path) -> Any:
    from app.context import make_context

    return make_context(make_settings(tmp_path / "cache", area_pack_dir=pack))


def test_backfill_writes_the_missing_stage_once(tmp_path: Path) -> None:
    pack = _copy_pack(tmp_path)
    _drop_spectra(pack)
    assert area_spectra.main(["--root", str(pack), "--check"]) == 1
    assert area_spectra.backfill(pack) == (1, 0, 0, 0)
    assert area_spectra.backfill(pack) == (0, 1, 0, 0)  # idempotent
    assert area_spectra.main(["--root", str(pack), "--check"]) == 0
    _, p = _pack_bodies(pack)
    key = spectra_key(RELEASE, EROS, p, spectra_settings_sha())
    fresh = ReadThroughCache(pack, offline=True).get(key)
    committed = ReadThroughCache(PACK, offline=True).get(key)
    assert fresh is not None and committed is not None
    assert fresh.body == committed.body and fresh.meta == committed.meta


def test_backfill_reports_a_failing_area_and_exits_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pack = _copy_pack(tmp_path)
    _drop_spectra(pack)

    def boom(*_: Any, **__: Any) -> dict[str, Any]:
        raise ValueError("track T1: dots ['x'] are not in /dots")

    monkeypatch.setattr(spectrum, "spectra_from_bodies", boom)
    assert area_spectra.backfill(pack) == (0, 0, 0, 1)
    assert area_spectra.main(["--root", str(pack)]) == 1


def test_a_faint_arm_with_no_flux_and_no_error_gives_no_limit() -> None:
    t = datetime(2026, 3, 20, tzinfo=UTC)
    s = spectrum.DotRow("s", 1, 1, 1, t, 1.0, 0.0, 0.0, 0.0, "mover", 0.0, 0.0)
    lo = spectrum.DotRow("l", 1, 4, 1, t, 3.0, 50.0, 5.0, 10.0, "mover", 0.0, 0.0)
    sig = {(1, 1): 0.05, (1, 4): 0.05}
    assert spectrum._pair(s, lo, spectrum.load_sun(), sig, CFG) is None


def test_the_committed_pack_is_up_to_date() -> None:
    assert area_spectra.main(["--root", str(PACK), "--check"]) == 0


def test_starting_a_stored_area_again_fills_its_missing_spectra(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Issue #169 (4), Q-481: an area stored in the cache without its ``spectra`` stage serves
    ``/spectra`` after the same box is started again; the worker fills the stage from the stored
    replies (never the request, A16.2) and nothing else is recomputed. Offline, as a stored area
    needs no network."""
    from dataclasses import replace

    from app.api import areas as areas_api
    from app.core.area import live
    from app.core.area.live_jobs import LiveJobs

    cache_dir = tmp_path / "cache"
    shutil.copytree(PACK, cache_dir)  # the Eros area, stored in the app's own cache
    _drop_spectra(cache_dir)
    settings = make_settings(cache_dir, area_pack_dir=tmp_path / "no-pack")
    box = live.snap_box(180.0, 0.0, 0.5, 0.5)
    t0 = datetime(2026, 3, 20, tzinfo=UTC)
    times = [t0 + timedelta(minutes=2 * i) for i in range(4)]
    times += [t0 + timedelta(hours=2, minutes=2 * i) for i in range(4)]
    plan = replace(live.plan_from_times(RELEASE, box, times), area_id=EROS)
    monkeypatch.setattr(areas_api, "plan_area", lambda ctx, b, pair=None: plan)
    ran: list[str] = []
    app = create_app(settings)
    with TestClient(app) as c:
        store = AreaStore(app.state.ctx, settings.area_pack_dir)
        app.state.areas = store
        app.state.live_jobs = LiveJobs(
            app.state.ctx, lambda ctx, pl, p: ran.append(pl.area_id), store=store
        )
        assert c.get(f"/v1/areas/{EROS}/spectra").json()["error"] == "spectra_not_prepared"
        r = c.post("/v1/areas/live", json={**box.reply(), "start": True, "kind": "discovery"})
        assert r.status_code == 202, r.text
        assert app.state.live_jobs.wait(10)
        got = c.get(f"/v1/areas/{EROS}/spectra")
        assert got.status_code == 200, got.text
        assert errors(got.json(), "area-spectra.schema.json") == []
        assert ran == []  # the pipeline did not run
        run_id = r.json()["run_id"]
        assert c.get(f"/v1/runs/{run_id}").json()["state"] == "done"
        again = c.post("/v1/areas/live", json={**box.reply(), "start": True})
        assert again.status_code == 200 and again.json()["state"] == "done"  # nothing queued
    # The same bytes as the committed stage: the check ran on the same stored replies.
    _, p = _pack_bodies(PACK)
    key = spectra_key(RELEASE, EROS, p, spectra_settings_sha())
    filled = ReadThroughCache(cache_dir, offline=True).get(key)
    committed = ReadThroughCache(PACK, offline=True).get(key)
    assert filled is not None and committed is not None and filled.body == committed.body
