"""Star list for movers (issue #95, A19.6, Q-143, Q-403): adapter keys, the library and its
refusals, offline. ``/overlays`` for movers is tested in ``test_overlays.py``."""

from __future__ import annotations

import csv
import math
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.adapters import gaia, wise
from app.api.deps import require_object
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import make_context
from app.core.find import stars
from app.core.find.catalogs import CatalogTable, nan_array
from app.core.find.frames import FrameRecord
from app.core.find.propagate import propagate
from tests.conftest import FIXTURE_CUTOUT_SIZE_ARCSEC, make_settings

# Every Gaia and CatWISE cone recorded before issue #95, with its stored digest. The default keys
# must not change, or the recorded fixed-target cones stop hitting (plan v2, row 24).
RECORDED_GAIA = {
    (
        76.95659,
        30.40129,
        0.07917,
    ): "0674379845000f07853ea66d32a43f91e91019ba50b30cf69f4720c7db2ba735",
    (
        331.09664,
        -56.80066,
        0.07944,
    ): "61570637c15dcbc91253d85a4965f7e07fac2262277a98ced2a571cbfc108573",
    (
        248.16723,
        66.75502,
        0.07917,
    ): "6caa00ac8590a2be644d271d58f755940ca9432a2cd5c9d49c31da485a036960",
    (
        269.44627,
        4.76820,
        0.07972,
    ): "9679915e6485d2306e9947a659a640414a9f2e578dbf6fa0784c291a9e15c0db",
    (
        133.75976,
        -7.24219,
        0.08000,
    ): "9f48ed0d8bfc55e28723dd2b98ccd0d29bd17497e555a4ee32a542f75982eaf7",
}
RECORDED_WISE = {
    (
        269.44627,
        4.76820,
        0.07972,
    ): "8457628f8de19c1dd7ca29432f18f09000cbdd6548e5940799692b3b2c49e1dd",
    (
        133.75976,
        -7.24219,
        0.08000,
    ): "a609602caee188b531e42e173771dd6255481df5c286e9d0db97c35d23f1f72e",
    (
        331.09664,
        -56.80066,
        0.07944,
    ): "abc02f394a52ef5d8533c77095fdf768ce05b42817a0597ffc4aaa2e79a9d19a",
    (
        248.16723,
        66.75502,
        0.07917,
    ): "ba464a0c936f42e57f761204b9958bd97e84c3850a49af49d6c9e771a2aa082c",
    (
        76.95659,
        30.40129,
        0.07917,
    ): "c7c89344fb722f40f6f22218023ef125671892d01307cecabbcc2de756614676",
}


# --- Adapter keys and queries ------------------------------------------------------------------


@pytest.mark.parametrize(("cone", "digest"), sorted(RECORDED_GAIA.items()))
def test_gaia_default_key_is_unchanged(cone: tuple[float, float, float], digest: str) -> None:
    assert gaia.gaia_key(*cone).digest == digest
    assert gaia.gaia_key(*cone, max_rows=gaia.MAX_ROWS).digest == digest


@pytest.mark.parametrize(("cone", "digest"), sorted(RECORDED_WISE.items()))
def test_wise_default_key_is_unchanged(cone: tuple[float, float, float], digest: str) -> None:
    assert wise.wise_key(*cone).digest == digest
    assert wise.wise_key(*cone, w1_lt=None, max_rows=wise.MAX_ROWS).digest == digest


def test_options_change_the_keys() -> None:
    cone = (90.75032, 13.55949, 0.08361)
    assert wise.wise_key(*cone, w1_lt=16.5).canonical() == (
        '{"query":{"dec":"13.55949","ra":"90.75032","radius":"0.08361","top":"5000",'
        '"w1_lt":"16.50"},"release":"catwise2020","source":"wise"}'
    )
    assert wise.wise_key(*cone, w1_lt=16.5).digest != wise.wise_key(*cone).digest
    assert dict(gaia.gaia_key(*cone, max_rows=50000).query)["top"] == "50000"
    assert dict(wise.wise_key(*cone, max_rows=50000).query)["top"] == "50000"


class _Captured(Exception):
    pass


def _capture_adql(monkeypatch: pytest.MonkeyPatch, module: Any) -> list[str]:
    """Run ``module.cone`` until its live call and keep the ADQL it would send (no network)."""
    seen: list[str] = []

    def fake_query_csv(ctx: Any, mirrors: Any, adql: Any, *a: Any, **kw: Any) -> Any:
        seen.append(adql(mirrors[0][1]))
        raise _Captured

    monkeypatch.setattr(module.tap, "query_csv", fake_query_csv)
    return seen


def _ctx() -> Any:
    """A context whose cache always calls ``live`` (the patched TAP call above)."""

    class _Cache:
        def fetch(self, key: Any, live: Any, refresh: bool = False) -> Any:
            return live()

    settings = SimpleNamespace(
        gaia_mirrors=[("u", "gaia_dr3_source")], wise_tap_url="u", catalog_read_timeout_s=1.0
    )
    return SimpleNamespace(settings=settings, cache=_Cache())


def test_wise_adql_adds_the_w1_cut_only_when_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_adql(monkeypatch, wise)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.08361, w1_lt=16.5)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.08361)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.62083, w1_lt=16.5, max_rows=50000)
    assert "AND w1mpro_pm < 16.50 ORDER BY w1mpro_pm, source_name" in seen[0]
    assert seen[0].startswith("SELECT TOP 5000 ")
    assert "w1mpro_pm <" not in seen[1]
    assert seen[2].startswith("SELECT TOP 50000 ")


def test_gaia_adql_row_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_adql(monkeypatch, gaia)
    with pytest.raises(_Captured):
        gaia.cone(_ctx(), 90.75032, 13.55949, 0.62083, max_rows=50000)
    assert seen[0].startswith("SELECT TOP 50000 ")
    assert "AND phot_g_mean_mag < 20.00 ORDER BY" in seen[0]


# --- Library: visits and cones -----------------------------------------------------------------


def _frame(fid: str, mjd: float, ra: float, dec: float, detector: int = 1) -> FrameRecord:
    """A frame record with a 1-minute exposure centred on ``mjd`` (only the fields the star list
    reads are meaningful)."""
    half = 0.5 / 1440.0
    return FrameRecord(
        frame_id=fid,
        time="2026-03-20T00:00:00Z",
        wavelength_um=1.0,
        bandwidth_um=0.01,
        x=31.0,
        y=31.0,
        x_fits0=31.0,
        y_fits0=31.0,
        width=63,
        height=63,
        ra=ra,
        dec=dec,
        flags=[],
        detector=detector,
        north_angle_deg=0.0,
        mirrored=False,
        em_min_um=0.99,
        em_max_um=1.01,
        access_url="https://example.invalid/cutout",
        t_min_mjd=mjd - half,
        t_max_mjd=mjd + half,
    )


def test_track_visits_gap_rule() -> None:
    t0 = 61119.0
    one = [_frame("a", t0, 10, 0), _frame("b", t0 + 59 / 1440, 10, 0)]
    assert [len(v) for v in stars.track_visits(one)] == [2]
    two = [_frame("a", t0, 10, 0), _frame("b", t0 + 60 / 1440, 10, 0)]
    assert [[f.frame_id for f in v] for v in stars.track_visits(two)] == [["a"], ["b"]]
    # Both detectors of one exposure share the midpoint and the visit; input order is irrelevant.
    dets = [
        _frame("x_D4", t0 + 1, 10, 0, 4),
        _frame("x_D1", t0 + 1, 10, 0, 1),
        _frame("y", t0, 1, 0),
    ]
    assert [[f.frame_id for f in v] for v in stars.track_visits(dets)] == [["y"], ["x_D1", "x_D4"]]
    assert [len(v) for v in stars.track_visits([_frame("solo", t0, 10, 0)])] == [1]
    assert stars.track_visits([]) == []


def test_mean_position_across_ra_zero() -> None:
    ra, dec = stars.mean_position([359.99, 0.01], [0.0, 0.0])
    assert 0.0 <= ra < 360.0 and min(ra, 360.0 - ra) < 1e-9
    assert dec == pytest.approx(0.0, abs=1e-12)
    ra, _ = stars.mean_position([359.0, 1.0, 0.0], [10.0, 10.0, 10.0])
    assert min(ra, 360.0 - ra) < 1e-9


def test_track_cone_radius_and_centre() -> None:
    sep = 15.0  # arcsec between the two predicted positions
    frames = [_frame("a", 61119.0, 120.0, 0.0), _frame("b", 61119.003, 120.0, sep / 3600)]
    cone = stars.track_cone(3, frames, 360.0)
    half_diag = 360.0 * math.sqrt(2) / 2  # 254.558", not a hard-coded 254.6
    assert cone.radius_deg * 3600 == math.ceil(half_diag + sep + 30.0) == 300
    assert cone.ra == pytest.approx(120.0, abs=1e-9)
    assert cone.dec == pytest.approx(sep / 7200, abs=1e-9)
    assert (cone.visit, cone.kind) == (3, "track")
    # Across RA 0 the centre stays near 0, not 180.
    wrap = stars.track_cone(1, [_frame("a", 1.0, 359.995, 5), _frame("b", 1.001, 0.005, 5)], 360)
    assert min(wrap.ra, 360.0 - wrap.ra) < 0.001


def test_area_cone_radius() -> None:
    cone = stars.area_cone(91.23046, 13.42787, 1.05, 0.63, visit=2)
    assert cone.radius_deg * 3600 == 2235.0
    assert (cone.ra, cone.dec, cone.visit, cone.kind) == (91.23046, 13.42787, 2, "area")
    assert stars.fetch_options("gaia", cone) == {"max_rows": stars.STAR_LIST_MAX_ROWS}
    assert stars.fetch_options("wise", cone) == {"w1_lt": 16.5, "max_rows": 50000}
    assert dict(stars.cone_key("gaia", cone).query)["top"] == "50000"
    # Every visit of an area shares one key.
    other = stars.area_cone(91.23046, 13.42787, 1.05, 0.63, visit=1)
    assert stars.cone_key("wise", other) == stars.cone_key("wise", cone)


def test_track_cone_keys_keep_the_default_gaia_key() -> None:
    cone = stars.StarCone(1, "track", 90.75032, 13.55949, 0.08361, "")
    assert stars.fetch_options("gaia", cone) == {}
    assert stars.cone_key("gaia", cone) == gaia.gaia_key(90.75032, 13.55949, 0.08361)
    assert stars.cone_key("wise", cone) == wise.wise_key(90.75032, 13.55949, 0.08361, w1_lt=16.5)


# --- Library: mask radius, de-duplication, propagation -------------------------------------------


@pytest.mark.parametrize(
    ("g", "w1", "r"),
    [
        (3.0, None, 10.0),
        (12.0, None, 4.0),
        (14.0, None, 2.0),
        (16.0, None, 2.0),
        (25.0, None, 2.0),
        (None, 0.0, 10.0),
        (None, 9.0, 4.0),
        (None, 11.0, 2.0),
        (None, 13.0, 2.0),
        (None, None, 2.0),
        (15.0, 8.0, 5.0),  # a pair takes the larger radius (Q-403 (4))
        (12.5, 10.0, 3.5),
        (12.333, None, 3.67),  # rounded to 0.01 px
    ],
)
def test_mask_radius(g: float | None, w1: float | None, r: float) -> None:
    assert stars.mask_radius_px(g, w1) == r


Row = tuple[str, float, float, float | None, float | None, float | None]


def _table(cat: Any, rows: list[Row]) -> CatalogTable:
    """rows: (id, ra, dec, pmra, pmdec, mag) at the catalogue's own epoch."""
    epoch = gaia.DR3_EPOCH_JYEAR if cat == "gaia" else wise.EPOCH_JYEAR
    return CatalogTable(
        cat,
        [r[0] for r in rows],
        np.array([r[1] for r in rows], dtype=np.float64),
        np.array([r[2] for r in rows], dtype=np.float64),
        nan_array([r[3] for r in rows]),
        nan_array([r[4] for r in rows]),
        np.full(len(rows), epoch, dtype=np.float64),
        [r[5] for r in rows],
    )


AS = 1.0 / 3600.0


def test_dedupe_merges_close_pairs_one_to_one() -> None:
    g = _table("gaia", [("G1", 10.0, 20.0, None, None, 12.0), ("G2", 10.1, 20.0, None, None, 15.0)])
    w = _table(
        "wise",
        [
            ("W_near", 10.0, 20.0 + 2 * AS, None, None, 8.0),  # 2" from G1: same star
            ("W_far", 10.0, 20.0 - 2.5 * AS, None, None, 9.5),  # also within 3" but further
            ("W_4as", 10.1, 20.0 + 4 * AS, None, None, 10.0),  # 4" from G2: two stars
        ],
    )
    out = stars.stars_from_tables(g, w)
    assert [(s.catalog, s.id, s.wise_id) for s in out] == [
        ("gaia", "G1", "W_near"),
        ("gaia", "G2", None),
        ("wise", "W_far", None),
        ("wise", "W_4as", None),
    ]
    g1 = out[0]
    assert g1.w1_mag == 8.0 and g1.r_px == 5.0  # max(r_G 4, r_W1 5)
    assert (g1.ra0, g1.dec0) == (10.0, 20.0)  # the Gaia position
    assert stars.stars_from_tables(g, w) == out  # deterministic


def test_dedupe_compares_at_the_catwise_epoch() -> None:
    # A Gaia star moving 10"/yr north is ~6" north of its 2015.4 position by J2016.0. The CatWISE
    # source sits where the star was at MJD 57170, with a wrong motion that must not matter.
    dt = gaia.DR3_EPOCH_JYEAR - wise.EPOCH_JYEAR
    assert 10.0 * dt > 3.0  # compared at J2016.0 the two would not match
    g = _table("gaia", [("G", 50.0, 0.0, 0.0, 10000.0, 13.0)])
    w = _table("wise", [("W", 50.0, -10.0 * dt * AS, 300.0, -300.0, 9.0)])
    (s,) = stars.stars_from_tables(g, w)
    assert s.id == "G" and s.wise_id == "W"


def test_star_list_without_one_catalogue() -> None:
    w = _table("wise", [("W2", 1.0, 1.0, None, None, 12.0), ("W1", 1.0, 1.1, None, None, 9.0)])
    assert [s.id for s in stars.stars_from_tables(None, w)] == ["W1", "W2"]
    assert stars.stars_from_tables(None, None) == []
    g = _table("gaia", [("B", 1.0, 1.0, None, None, None), ("A", 1.0, 1.1, None, None, 19.0)])
    assert [s.id for s in stars.stars_from_tables(g, None)] == ["A", "B"]  # no magnitude last


def test_positions_at_propagates_from_each_epoch() -> None:
    when = datetime(2026, 3, 20, tzinfo=UTC)
    star_g = stars.Star("gaia", "g", 10.0, 20.0, 0.0, 1000.0, 2016.0, 12.0, None, None, 4.0)
    star_w = stars.Star("wise", "w", 10.0, 20.0, 0.0, 1000.0, wise.EPOCH_JYEAR, None, 9, None, 4.0)
    still = stars.Star("gaia", "s", 10.0, 20.0, None, None, 2016.0, 12.0, None, None, 4.0)
    ra, dec = stars.positions_at([star_g, star_w, still], when)
    exp_g = propagate(10.0, 20.0, 0.0, 1000.0, when, epoch_jyear=2016.0)
    exp_w = propagate(10.0, 20.0, 0.0, 1000.0, when, epoch_jyear=wise.EPOCH_JYEAR)
    assert (ra[0], dec[0]) == pytest.approx(exp_g, abs=1e-12)
    assert (ra[1], dec[1]) == pytest.approx(exp_w, abs=1e-12)
    assert (dec[0] - 20.0) * 3600 == pytest.approx(10.21, abs=0.01)  # 10.21 yr at 1"/yr
    assert (ra[2], dec[2]) == (10.0, 20.0)


# --- Library: near the track ------------------------------------------------------------------


def test_near_track_edges() -> None:
    path = np.array([[0.0, 0.0], [10.0, 0.0]])
    xs = np.array([5.0, 5.0, 18.0, 18.1, -8.0, np.nan])
    ys = np.array([7.9, 8.1, 0.0, 0.0, 0.0, 0.0])
    want = [True, False, True, False, True, False]
    assert stars.near_track(xs, ys, path).tolist() == want
    assert stars.near_track(np.array([5.0]), np.array([8.0]), path).tolist() == [True]
    one = np.array([[3.0, 4.0]])  # a one-point track: the distance to that point
    got = stars.near_track(np.array([3.0, 3.0]), np.array([12.0, 12.1]), one)
    assert got.tolist() == [True, False]
    repeated = np.array([[0.0, 0.0], [0.0, 0.0], [10.0, 0.0], [10.0, 0.0]])
    assert stars.near_track(xs, ys, repeated).tolist() == want
    assert stars.near_track(xs, ys, np.zeros((0, 2))).tolist() == [False] * 6


# --- Library: star_list and its refusals --------------------------------------------------------


def _fake_fetch(fail: dict[str, Exception], truncated: set[str]) -> Any:
    def fetch(ctx: Any, cat: Any, cone: Any, **kw: Any) -> Any:
        if cat in fail:
            raise fail[cat]
        tbl = _table(
            cat, [(f"{cat}-1", cone.ra, cone.dec + 0.01 * (cat == "wise"), None, None, 12)]
        )
        return tbl, "t", cat in truncated, SimpleNamespace(kw=kw)

    return fetch


NO_CTX: Any = None


def test_star_list_one_catalogue_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    cone = stars.StarCone(2, "track", 10.0, 20.0, 0.08, "")
    fail: dict[str, Exception] = {"gaia": UpstreamUnavailable("down")}
    monkeypatch.setattr(stars, "fetch_catalog", _fake_fetch(fail, set()))
    sl = stars.star_list(NO_CTX, cone)
    assert sl.failed == {"gaia"} and [s.id for s in sl.stars] == ["wise-1"]
    assert sl.missing_codes() == ["stars:gaia:2"]
    assert sl.served[0].kw["w1_lt"] == 16.5  # type: ignore[attr-defined]
    assert "max_rows" not in sl.served[0].kw  # type: ignore[attr-defined]


def test_star_list_truncation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stars, "fetch_catalog", _fake_fetch({}, {"gaia"}))
    track = stars.star_list(NO_CTX, stars.StarCone(1, "track", 10, 20, 0.08, ""))
    assert track.failed == set() and track.truncated == {"gaia"}
    assert [s.id for s in track.stars] == ["gaia-1", "wise-1"]
    area = stars.star_list(NO_CTX, stars.area_cone(10, 20, 1.0, 0.6, 1))
    # Q-403 (5): a capped area answer is refused, never used as a partial list.
    assert area.failed == {"gaia"} and area.missing_codes() == ["stars:gaia:1"]
    assert [s.id for s in area.stars] == ["wise-1"]


def test_star_list_offline_miss_never_calls_the_network(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path / "empty"))

    class _NoHttp:
        def __getattr__(self, name: str) -> Any:
            raise AssertionError(f"live call {name} while offline")

    ctx.http = _NoHttp()  # type: ignore[assignment]
    sl = stars.star_list(ctx, stars.StarCone(1, "track", 90.75032, 13.55949, 0.08361, ""))
    assert sl.failed == {"gaia", "wise"} and sl.stars == []
    assert sl.missing_codes() == ["stars:gaia:1", "stars:wise:1"]


def test_star_list_unreadable_cache_is_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    fail: dict[str, Exception] = {"wise": csv.Error("NUL"), "gaia": CacheMissOffline("x")}
    monkeypatch.setattr(stars, "fetch_catalog", _fake_fetch(fail, set()))
    sl = stars.star_list(NO_CTX, stars.StarCone(1, "track", 1, 2, 0.1, ""))
    assert sl.failed == {"gaia", "wise"} and sl.stars == []


# --- Eros (the recorded mover): visits and cone keys ------------------------------------------

EROS_CONES = [
    (
        1,
        90.750324,
        13.559489,
        "b230563fe0838595bd5d9955edb7861b2e3097648c967c0ae5783a3082054507",
        "0029108daeabace1d302c688b0a419216af128ca34a6b9c0de80952f8ed8406a",
    ),
    (
        2,
        91.710591,
        13.296263,
        "41d24df1f5dd0360d19492f5e841ef843fec85b0d8554e0dd11258c15bb1c35d",
        "d999cc01a04d0546025c6fa4517ad597bdefb968d9465736127f4b1485736f71",
    ),
]


def eros_frames(client: TestClient) -> list[FrameRecord]:
    oid = client.get("/v1/resolve", params={"q": "433 Eros"}).json()["id"]
    ctx = client.app.state.ctx  # type: ignore[attr-defined]
    obj = require_object(ctx, oid)
    return list(client.app.state.frames.get_frames(obj, use_memo=True).frames)  # type: ignore[attr-defined]


def test_eros_visits_and_cone_keys(client: TestClient) -> None:
    visits = stars.mover_visits(eros_frames(client), FIXTURE_CUTOUT_SIZE_ARCSEC)
    assert [len(v.frames) for v in visits] == [8, 8]
    for v, (n, ra, dec, g_digest, w_digest) in zip(visits, EROS_CONES, strict=True):
        assert v.visit == n and v.cone.kind == "track"
        assert v.cone.ra == pytest.approx(ra, abs=1e-6)
        assert v.cone.dec == pytest.approx(dec, abs=1e-6)
        assert v.cone.radius_deg * 3600 == 301.0
        assert dict(stars.cone_key("gaia", v.cone).query)["radius"] == "0.08361"
        assert stars.cone_key("gaia", v.cone).digest == g_digest
        assert stars.cone_key("wise", v.cone).digest == w_digest
        assert len(v.track_radec()[0]) == 4  # two detectors per exposure
    assert [c.ra for c in stars.mover_star_cones(eros_frames(client), 360.0)] == [
        v.cone.ra for v in visits
    ]


def test_prefetch_asks_for_the_overlays_keys(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-fetch and /overlays build the cones with the same ``stars.mover_visits``, so the
    pre-fetch fills exactly the keys /overlays reads (plan v2, row 8)."""
    from scripts import prefetch

    seen: list[tuple[str, str]] = []

    def fetch(ctx: Any, cat: Any, cone: Any, **kw: Any) -> Any:
        assert {k: v for k, v in kw.items() if k != "refresh"} == stars.fetch_options(cat, cone)
        seen.append((cat, stars.cone_key(cat, cone).digest))
        raise UpstreamUnavailable("recorded only")

    monkeypatch.setattr(prefetch, "fetch_catalog", fetch)
    ctx = client.app.state.ctx  # type: ignore[attr-defined]
    out = prefetch.prefetch_mover_overlays(ctx, eros_frames(client), refresh=False)
    assert sorted(seen) == sorted(
        [("gaia", c[3]) for c in EROS_CONES] + [("wise", c[4]) for c in EROS_CONES]
    )
    assert out["gaia"].startswith("visit 1 FAILED") and "visit 2 FAILED" in out["wise"]
