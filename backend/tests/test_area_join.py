"""A17.4 (P5): the parallax-aware pair test, the possible reasons, and the Eros gate (A16.7).

The gate: on the recorded Eros area, Discovery must find exactly one ``track`` holding Eros's
dots without being given Eros's position, and the known-object check must name it 433 Eros
(``found_blind``). The pipeline never reads Eros's position before the known check; the test
finds Eros's dots independently from Track's recorded Horizons TLISTs (PR #53), only to check
the answer. Network blocked.
"""

from __future__ import annotations

import math
from dataclasses import replace
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.adapters import horizons
from app.context import make_context
from app.core.area import clean, join
from app.core.area.clean import PIXEL_DEG, AreaGeometry, DotPoint, Labels, Tracklet, fit_line
from app.core.area.config import DEFAULT_AREA_CONFIG
from app.core.area.geometry import AreaBox, CellGrid
from app.core.area.join import Leg, SkyVelocity
from app.core.area.match import sep_px
from app.core.area.service import AreaResult, run_area
from app.core.find.stars import StarList
from app.timefmt import parse_utc
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


def test_three_visits_chain_into_one_track() -> None:
    """A middle visit's leg ranks its next-visit and previous-visit partners separately, so a
    mover seen in three visits is one track of three legs (PR #110 review)."""
    v = (0.9, -0.25)
    legs = [_leg(k + 1, v, (v[0] * k, v[1] * k), float(k)) for k in range(3)]
    windows = {(1, 2): (0.0034, 1.16), (2, 3): (0.0034, 1.16)}
    got = join.link_legs(legs, windows, {}, CFG)
    assert got.links == {0: 1, 1: 2}
    assert got.has_candidate == {0, 1, 2}


def test_three_visits_with_a_decoy_keep_the_true_chain() -> None:
    """A decoy in the last visit that fits worse does not break the chain."""
    v = (0.9, -0.25)
    legs = [_leg(k + 1, v, (v[0] * k, v[1] * k), float(k)) for k in range(3)]
    legs.append(_leg(3, (0.0, 0.5), (1.0, 0.2), 2.0))  # moves the other way
    windows = {(1, 2): (0.0034, 1.16), (2, 3): (0.0034, 1.16)}
    got = join.link_legs(legs, windows, {}, CFG)
    assert got.links == {0: 1, 1: 2}


def test_a_two_leg_chain_fit_is_the_pair_fit_exactly() -> None:
    """The Eros gate's track keeps its exact ``v_AB`` and ``u`` (issue #128 (4))."""
    a, b = _pair(1.7)
    got = join.pair_fit(a, b, W, 0.0034, 1.16, CFG)
    assert got is not None
    assert join.chain_fit((a, b), W, 0.0034, 1.16, CFG) == (got[0], got[2])
    assert join.chain_fit((a, b), {}, 0.0034, 1.16, CFG) == (got[0], None)
    # w for one visit only: pair_fit's rate-window fallback, so the track stays "chain" (PR #140).
    one = join.pair_fit(a, b, {1: W[1]}, 0.0034, 1.16, CFG)
    assert one is not None and one[2] is None
    assert join.chain_fit((a, b), {1: W[1]}, 0.0034, 1.16, CFG) == (one[0], None)


# Three visits, one day apart, of a mover that speeds up: 0.45 deg/day from visit 1 to 2 and
# 0.55 from 2 to 3, so its best straight line is 0.5 deg/day east. ``w`` points east, and each
# in-visit velocity is ``v_chain - w u`` with ``u = 1.7 /au`` for the whole chain; the first
# pair alone would give 0.45 deg/day and u = 2.60 /au.
W3 = {1: SkyVelocity(-0.05, 0.0), 2: SkyVelocity(-0.06, 0.0), 3: SkyVelocity(-0.07, 0.0)}
POS3 = (0.0, 0.45, 1.0)  # deg east of the centre at each visit's mid-time


def _three_visit_legs() -> list[Leg]:
    return [
        _leg(k + 1, (0.5 - W3[k + 1].east * 1.7, 0.0), (POS3[k], 0.0), float(k)) for k in range(3)
    ]


def test_a_three_visit_chain_is_fitted_over_all_its_legs() -> None:
    legs = _three_visit_legs()
    first = join.pair_fit(legs[0], legs[1], W3, 0.0034, 1.16, CFG)
    assert (
        first is not None
        and first[1] == pytest.approx(0.45)
        and first[2] == pytest.approx(2.6016, abs=1e-4)
    )
    got = join.chain_fit(legs, W3, 0.0034, 1.16, CFG)
    assert got is not None
    v_ab, u = got
    assert v_ab == pytest.approx((0.5, 0.0), abs=1e-12)
    assert u == pytest.approx(1.7, abs=1e-9)
    # w for only some legs would mix the parallax and rate-window tests: refused.
    assert join.chain_fit(legs, {1: W3[1], 2: W3[2]}, 0.0034, 1.16, CFG) is None
    assert join.chain_fit(legs, {2: W3[2], 3: W3[3]}, 0.0034, 1.16, CFG) is None
    # w for no leg: the rate-window fallback, the chain's line and no u.
    none = join.chain_fit(legs, {}, 0.0034, 1.16, CFG)
    assert none is not None and none[1] is None


def test_a_chain_fit_outside_the_pair_test_limits_is_refused() -> None:
    legs = _three_visit_legs()
    assert join.chain_fit(legs, W3, 0.0034, 0.4, CFG) is None  # 0.5 deg/day > rate_max
    assert join.chain_fit(legs, W3, 0.6, 1.16, CFG) is None  # below rate_min
    tight_u = replace(CFG, delta_min_au=1.0)  # u <= 1 /au; the chain's u is 1.7
    assert join.chain_fit(legs, W3, 0.0034, 1.16, tight_u) is None
    kicked = [*legs[:2], _leg(3, (legs[2].v[0] + 0.0, 0.3), legs[2].pos, legs[2].t)]
    assert join.chain_fit(kicked, W3, 0.0034, 1.16, CFG) is None  # residual > v_tol


def _three_visit_join_inputs() -> tuple[Labels, AreaGeometry, Any]:
    """Three tracklets of three dots each, one per visit, from ``_three_visit_legs``."""
    step = 0.002  # days between the exposures of a visit
    points: list[DotPoint] = []
    tracklets: list[Tracklet] = []
    for k, lg in enumerate(_three_visit_legs()):
        members: list[DotPoint] = []
        for j in (-1, 0, 1):
            x = (lg.pos[0] + lg.v[0] * j * step) / PIXEL_DEG
            p = DotPoint(len(points), cast(Any, None), x, 0.0, lg.t + j * step, 2.0)
            points.append(p)
            members.append(p)
        tracklets.append(Tracklet(k + 1, tuple(members), fit_line(members)))
    labels = Labels(points, {p.index: clean.MOVER for p in points}, tracklets, [])
    box = AreaBox(91.0, 0.0, 1.5, 1.5)
    t0 = parse_utc("2026-03-20T00:00:00Z")
    geo = AreaGeometry(box, t0, {1: 0.0, 2: 1.0, 3: 2.0}, {v: 2 * step for v in (1, 2, 3)}, 1.2)
    frames = cast(Any, SimpleNamespace(coverage=()))
    return labels, geo, frames


def test_join_reports_the_whole_chain_rate_for_three_visits() -> None:
    """Through ``join``: three tracklets of three dots each become one track whose rate, PA and
    ``u`` come from all three visits, not from the first pair."""
    labels, geo, frames = _three_visit_join_inputs()
    got = join.join(labels, frames, geo, W3, CFG)
    assert [t.status for t in got.tracks] == ["track"]
    t = got.tracks[0]
    assert [lg.visit for lg in t.legs] == [1, 2, 3]
    assert t.v_ab is not None and math.hypot(*t.v_ab) == pytest.approx(0.5, abs=1e-9)
    assert t.u == pytest.approx(1.7, abs=1e-6)
    assert t.fit == "chain"
    assert got.pair_test == "parallax"


def test_join_keeps_the_first_pair_fit_when_the_chain_fit_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    labels, geo, frames = _three_visit_join_inputs()
    monkeypatch.setattr(join, "chain_fit", lambda *_a, **_k: None)
    t = join.join(labels, frames, geo, W3, CFG).tracks[0]
    assert t.status == "track" and len(t.legs) == 3
    assert t.v_ab is not None and math.hypot(*t.v_ab) == pytest.approx(0.45, abs=1e-9)
    assert t.u == pytest.approx(2.6016, abs=1e-4)
    assert t.fit == "first_pair"


def test_a_chain_with_w_for_only_some_visits_keeps_the_first_pair_fit() -> None:
    """Visit 3 lost its Horizons vector: the 2-3 link uses the rate window, so the track keeps
    the 1-2 pair's parallax fit instead of a u from a subset of its legs."""
    labels, geo, frames = _three_visit_join_inputs()
    t = join.join(labels, frames, geo, {1: W3[1], 2: W3[2]}, CFG).tracks[0]
    assert t.status == "track" and len(t.legs) == 3 and t.fit == "first_pair"
    assert t.u == pytest.approx(2.6016, abs=1e-4)


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
    grid = CellGrid.of(geo.box, CFG.coverage_cell_arcsec)
    lg = next(t.legs[0] for t in eros.joined.tracks if t.status == "track")

    def centres(v: int) -> tuple[Any, Any]:
        return grid.masked_centres(cov[v].mask)

    assert join._reachable(lg, 2, geo, cov, grid, 0.0034, 1.16, centres)
    # Visit 2 lies about 0.39 deg east: a 0.1 deg/day limit cannot reach it.
    assert not join._reachable(lg, 2, geo, cov, grid, 0.0034, 0.1, centres)
