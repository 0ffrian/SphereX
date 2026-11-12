"""A17.4 (P5): the parallax-aware pair test, the possible reasons, and the Eros gate (A16.7).

The gate: on the recorded Eros area, Discovery must find exactly one ``track`` holding Eros's
dots without being given Eros's position, and the known-object check must name it 433 Eros
(``found_blind``). The pipeline never reads Eros's position before the known check; the test
finds Eros's dots independently from Track's recorded Horizons TLISTs (PR #53), only to check
the answer. Network blocked.
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import pytest

from app.adapters import horizons
from app.context import make_context
from app.core.area import clean, join
from app.core.area.config import DEFAULT_AREA_CONFIG
from app.core.area.join import Leg, SkyVelocity
from app.core.area.match import sep_px
from app.core.area.service import AreaResult, run_area
from app.core.find.stars import StarList
from tests.area_recorded import recorded_dots, recorded_frames, recorded_star_cones
from tests.conftest import FIXTURE_CACHE, make_settings
from tests.helpers import entries

CFG = DEFAULT_AREA_CONFIG


@lru_cache(maxsize=1)
def recorded_lists() -> dict[int, StarList]:
    ctx = make_context(make_settings(FIXTURE_CACHE))  # read only: star cones are cache hits
    return clean.star_lists(ctx, recorded_star_cones()).lists


@lru_cache(maxsize=1)
def eros_dot_ids() -> frozenset[str]:
    """Dots within 1 px of Track's recorded Horizons positions (the 4 + 4 exposure TLISTs)."""
    at: dict[str, tuple[float, float]] = {}
    for meta, body in entries("horizons"):
        q = meta["key"]["query"]
        if (
            q.get("center") == horizons.OBSERVER_SPHEREX
            and q.get("command") == "DES=20000433;"
            and "quantities" not in q
            and "," in q.get("tlist", "")
        ):
            for t, ra, dec in horizons.parse(body):
                at[t[:19]] = (ra, dec)
    out = set()
    for fd in recorded_dots():
        for d in fd.dots:
            for ra, dec in at.values():
                if sep_px(d.ra, d.dec, ra, dec) <= 1.0:
                    out.add(d.dot_id)
    return frozenset(out)


def run_recorded(cache: Path) -> AreaResult:
    frames, bodies = recorded_frames()
    ctx = make_context(make_settings(cache))
    return run_area(
        ctx, frames, bodies, recorded_dots(), CFG, star_cones=recorded_star_cones(),
        inputs="recorded_eros_fixture",
    )  # fmt: skip


# --- the pair test ------------------------------------------------------------------------------


def _leg(visit: int, v: tuple[float, float], pos: tuple[float, float], t: float) -> Leg:
    tl = clean.Tracklet(visit, (), clean.LineFit(0, 0, 0, 0, t, 0.0, 0.0, 1.0))
    return Leg(tl, v, 0.001, pos, t)


W = {1: SkyVelocity(-0.035, -0.242), 2: SkyVelocity(-0.038, -0.247)}  # Eros area, deg/day per 1/au


def _pair(u: float, kick: float = 0.0) -> tuple[Leg, Leg]:
    v_ab = (0.918, -0.259)
    a_v = (v_ab[0] - W[1].east * u, v_ab[1] - W[1].north * u + 0.0)
    b_v = (v_ab[0] - W[2].east * u + kick, v_ab[1] - W[2].north * u)
    a = _leg(1, a_v, (0.0, 0.0), 0.0)
    b = _leg(2, b_v, (v_ab[0] * 1.017, v_ab[1] * 1.017), 1.017)
    return a, b


def test_project_velocity_east_and_north() -> None:
    w = join.project_velocity((0.0, 1.0, 0.0), 0.0, 0.0)  # +y at RA 0 is east
    assert w.east == pytest.approx(180.0 / math.pi) and w.north == pytest.approx(0.0)
    w = join.project_velocity((0.0, 0.0, 1.0), 0.0, 0.0)
    assert w.north == pytest.approx(180.0 / math.pi) and w.east == pytest.approx(0.0)


def test_the_pair_test_recovers_u_and_passes() -> None:
    a, b = _pair(1.7)
    got = join.pair_fit(a, b, W, 0.0034, 1.16, CFG)
    assert got is not None
    _, rate, u, res, passed = got
    assert u == pytest.approx(1.7, abs=1e-9) and res < 1e-9 and passed
    assert rate == pytest.approx(math.hypot(0.918, -0.259))


def test_a_direction_off_the_parallax_line_fails() -> None:
    """A fixed 20 deg tolerance rejects Eros's own pair (Q-179); the perpendicular one does not
    accept a pair that no distance explains."""
    a, b = _pair(1.7, kick=0.3)
    got = join.pair_fit(a, b, W, 0.0034, 1.16, CFG)
    assert got is not None and not got[4]


def test_too_close_and_outside_the_rate_window() -> None:
    a, b = _pair(1.0 / 0.04)  # u = 25 /au: closer than delta_min = 0.05 au
    got = join.pair_fit(a, b, W, 0.0034, 1.16, CFG)
    assert got is not None and not got[4]
    a, b = _pair(1.0)
    assert join.pair_fit(a, b, W, 0.0034, 0.5, CFG) is None


def test_without_w_the_rate_window_alone_decides() -> None:
    a, b = _pair(1.7)
    got = join.pair_fit(a, b, {}, 0.0034, 1.16, CFG)
    assert got is not None and got[2] is None and got[4]


# --- the Eros gate ------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def eros(tmp_path_factory: pytest.TempPathFactory) -> AreaResult:
    import shutil

    from tests.conftest import purge_derived

    dst = tmp_path_factory.mktemp("eros") / "cache"
    shutil.copytree(FIXTURE_CACHE, dst)
    purge_derived(dst)
    return run_recorded(dst)


def test_eros_gate_one_track_found_blind(eros: AreaResult) -> None:
    tracks = [
        (t, v)
        for t, v in zip(eros.joined.tracks, eros.verdicts, strict=True)
        if t.status == "track"
    ]
    assert len(tracks) == 1, [t.status for t, _ in tracks]
    t, v = tracks[0]
    ids = {m.dot.dot_id for lg in t.legs for m in lg.tracklet.members}
    assert ids == eros_dot_ids()
    assert [lg.visit for lg in t.legs] == [1, 2]
    assert v.verdict == "found_blind" and v.match is not None
    assert v.match.designation == "433 Eros" and v.match.number == 433
    assert v.match.median_sep_px < 0.1
    assert eros.joined.pair_test == "parallax"
    # A16.6's measured motion: 0.954 deg/day between visits, about 1 deg/day inside one.
    assert t.v_ab is not None and math.hypot(*t.v_ab) == pytest.approx(0.954, abs=0.002)
    assert all(abs(math.hypot(*lg.v) - 0.99) < 0.03 for lg in t.legs)
    # 1/u is Eros's distance from the geocentre: between 0.05 au and a few au.
    assert t.u is not None and 0.3 < t.u < 5.0


def test_eros_gate_no_unexplained_and_possibles_have_reasons(eros: AreaResult) -> None:
    others = [
        (t, v)
        for t, v in zip(eros.joined.tracks, eros.verdicts, strict=True)
        if t.status != "track"
    ]
    assert all(v.verdict == "possible" and v.match is None for _, v in others)
    assert {t.reason for t, _ in others} <= {"ambiguous", "no_partner", "one_visit"}
    assert all(t.v_ab is None and t.u is None for t, _ in others)
    assert all(len(t.legs) == 1 for t, _ in others)


def test_reachable_ring_decides_no_partner_or_one_visit(eros: AreaResult) -> None:
    frames, _ = recorded_frames()
    geo = clean.area_geometry(frames, CFG)
    cov = {c.visit: c for c in frames.coverage}
    grid = clean.CellGrid.of(geo.box, CFG.coverage_cell_arcsec)
    lg = next(t.legs[0] for t in eros.joined.tracks if t.status == "track")
    assert join._reachable(lg, 2, geo, cov, grid, 0.0034, 1.16)
    # Visit 2 lies about 0.39 deg east: a 0.1 deg/day limit cannot reach it.
    assert not join._reachable(lg, 2, geo, cov, grid, 0.0034, 0.1)
