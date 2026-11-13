"""A17.3 (P4): glitch, tracklets, star and fixed labels. Synthetic points for the rules, the
recorded Eros area for the real outcome. Network blocked."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np

from app.core.area import clean
from app.core.area.clean import AreaGeometry, DotPoint
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig
from app.core.area.geometry import AreaBox
from app.core.area.records import Dot
from app.core.find.stars import Star, StarCone, StarList
from app.timefmt import iso_utc_z

T0 = datetime(2026, 3, 20, 8, 33, 43, tzinfo=UTC)
EXPOSURE_S = 129.0  # about the Eros spacing (A16.6)
BOX = AreaBox(91.0, 13.4, 0.5, 0.3)
CFG = DEFAULT_AREA_CONFIG


def _geo(span_d: float = 3 * EXPOSURE_S / 86400.0) -> AreaGeometry:
    return AreaGeometry(BOX, T0, {1: span_d / 2, 2: 1.0 + span_d / 2}, {1: span_d, 2: span_d}, 1.16)


def _dot(frame_id: str, visit: int, exposure: int, detector: int, t_s: float) -> Dot:
    return Dot(
        f"{frame_id}:1", frame_id, detector, visit, exposure,
        iso_utc_z(T0 + timedelta(seconds=t_s)), 0.0, 0.0, 0.003, 91.0, 13.4,
        100.0, 1.0, 100.0, 1.0, 0.02, (),
    )  # fmt: skip


def _pt(i: int, visit: int, exposure: int, detector: int, x: float, y: float) -> DotPoint:
    t_s = (exposure - 1) * EXPOSURE_S + (visit - 1) * 86400.0
    fid = f"V{visit}E{exposure}D{detector}"
    return DotPoint(i, _dot(fid, visit, exposure, detector, t_s), x, y, t_s / 86400.0, 2.0)


def _visit(
    start: int, visit: int, x0: float, y0: float, vx_px_per_exp: float = 0.0
) -> list[DotPoint]:
    """A source seen on both detectors in 4 exposures."""
    out = []
    i = start
    for e in range(1, 5):
        for det in (1, 4):
            out.append(_pt(i, visit, e, det, x0 + vx_px_per_exp * (e - 1), y0))
            i += 1
    return out


def _all_cover(pts: list[DotPoint]) -> dict[int, set[str]]:
    frames = {p.dot.frame_id for p in pts}
    return {p.index: set(frames) for p in pts}


def test_a_one_frame_hit_is_a_glitch_and_a_repeated_source_is_not() -> None:
    star = _visit(0, 1, 10.0, 10.0)
    ray = [_pt(100, 1, 2, 1, 40.0, 40.0)]  # one exposure, one detector: a cosmic ray
    pts = star + ray
    bad = clean.glitches(pts, _all_cover(pts), _geo(), CFG)
    assert bad == {100}


def test_the_glitch_test_needs_the_frames_that_cover_the_dot() -> None:
    """k_visit = min(3, frames that hold the dot): a dot only one frame covers cannot fail."""
    ray = [_pt(0, 1, 2, 1, 40.0, 40.0)]
    assert clean.glitches(ray, {0: {"V1E2D1"}}, _geo(), CFG) == set()
    assert clean.glitches(ray, {0: {"V1E2D1", "V1E1D1", "V1E3D1"}}, _geo(), CFG) == {0}


def test_the_glitch_radius_is_the_larger_r_match_of_the_two_dots() -> None:
    """GLITCH_FORMULA: r_match of the larger of the two dots, so the test is symmetric."""
    from dataclasses import replace

    a = _pt(0, 1, 1, 1, 10.0, 10.0)  # r_match 2 px
    b = replace(_pt(1, 1, 1, 4, 13.0, 10.0), r_match=4.0)  # same exposure, 3 px away
    pts = [a, b]
    cover = {0: {"V1E1D1", "V1E1D4"}, 1: {"V1E1D1", "V1E1D4"}}
    assert clean.glitches(pts, cover, _geo(), CFG) == set()


def test_a_mover_inside_the_glitch_radius_passes() -> None:
    """Eros moves 2.6 px in a visit: inside r_match + rate_max * dt (A17.3)."""
    mover = _visit(0, 1, 20.0, 20.0, vx_px_per_exp=0.9)
    assert clean.glitches(mover, _all_cover(mover), _geo(), CFG) == set()


def test_tracklets_split_a_mover_from_a_star() -> None:
    star = _visit(0, 1, 10.0, 10.0)
    mover = _visit(50, 1, 16.0, 10.0, vx_px_per_exp=0.9)
    tls = clean.build_tracklets(star + mover, _geo(), CFG)
    sets = sorted(sorted(m.index for m in t.members) for t in tls)
    assert sets == [list(range(0, 8)), list(range(50, 58))]
    by_first = {t.first: t for t in tls}
    assert by_first[0].fit.span_px < 0.01
    assert abs(by_first[50].fit.span_px - 2.7) < 1e-6
    assert by_first[50].fit.rms < 1e-9 and by_first[50].n_times == 4


def test_tracklets_are_deterministic() -> None:
    pts = _visit(0, 1, 10.0, 10.0) + _visit(50, 1, 16.0, 10.0, 0.9) + _visit(80, 1, 13.0, 11.0)
    a = clean.build_tracklets(pts, _geo(), CFG)
    b = clean.build_tracklets(list(reversed(pts)), _geo(), CFG)
    assert [[m.index for m in t.members] for t in a] == [[m.index for m in t.members] for t in b]


def _star_list(visit: int, ra: float, dec: float, r_px: float = 3.0) -> StarList:
    s = Star("gaia", "42", ra, dec, None, None, 2016.0, 15.0, None, None, r_px)
    cone = StarCone(visit, "area", ra, dec, 0.1, "test")
    return StarList(visit, cone, [s])


def _on_plane(ra: float, dec: float) -> tuple[float, float]:
    p = BOX.project(ra, dec)
    assert p is not None
    return p[0] / clean.PIXEL_DEG, p[1] / clean.PIXEL_DEG


def test_star_needs_every_dot_of_the_tracklet_on_the_same_source() -> None:
    sx, sy = _on_plane(91.01, 13.41)
    lists = {1: _star_list(1, 91.01, 13.41)}
    on_star = _visit(0, 1, sx + 0.5, sy)
    passing = _visit(50, 1, sx - 4.0, sy, vx_px_per_exp=2.5)  # crosses the star once or twice
    match = clean.star_matcher(on_star + passing, lists, _geo())
    assert all(match(p) == {"gaia:42"} for p in on_star)
    hits = [bool(match(p)) for p in passing]
    assert any(hits) and not all(hits)


def test_label_rules_on_the_recorded_eros_area() -> None:
    """The real outcome (A16.6, issue #108): Eros's 14 dots stay movers; most dots are stars."""
    from tests.area_recorded import recorded_dots, recorded_frames
    from tests.test_area_join import eros_dot_ids, recorded_lists

    frames, bodies = recorded_frames()
    geo = clean.area_geometry(frames)
    lab = clean.label_dots(frames, bodies, recorded_dots(), recorded_lists(), geo=geo)
    label = {p.dot.dot_id: lab.label[p.index] for p in lab.points}
    assert len(eros_dot_ids()) == 14
    assert {label[i] for i in eros_dot_ids()} == {clean.MOVER}
    assert lab.count(clean.STAR) > 0.8 * len(lab.points)
    assert lab.count(clean.FIXED) == 0  # the two visits' cutouts do not overlap
    assert lab.count(clean.GLITCH) > 0
    assert sum(lab.count(k) for k in (clean.GLITCH, clean.STAR, clean.FIXED, clean.MOVER)) == len(
        lab.points
    )


def test_a_failed_star_cone_is_listed_and_the_step_still_runs(tmp_path: object) -> None:
    from pathlib import Path

    from app.context import make_context
    from tests.area_recorded import recorded_star_cones
    from tests.conftest import make_settings

    ctx = make_context(make_settings(Path(str(tmp_path)) / "empty"))
    st = clean.star_lists(ctx, recorded_star_cones())
    assert st.missing == ["stars:gaia:1", "stars:gaia:2", "stars:wise:1", "stars:wise:2"]
    assert all(not lst.stars for lst in st.lists.values())


def test_fixed_needs_the_other_visit_to_cover_the_dot() -> None:
    cfg = AreaConfig()
    assert cfg.r_match_min_px == 2.0  # A17.3 floor
    # covered_by reads the mask, never the polygon alone (Q-400 (5)).
    from app.core.area.geometry import CellGrid
    from app.core.area.records import Coverage

    grid = CellGrid.of(BOX, cfg.coverage_cell_arcsec)
    mask = np.zeros((grid.ny, grid.nx), dtype=bool)
    cov = Coverage(2, mask, (), 0, 0, 0, 0)
    assert not clean.covered_by(cov, grid, BOX, 91.0, 13.4)
    mask[grid.ny // 2, grid.nx // 2] = True
    assert clean.covered_by(cov, grid, BOX, 91.0, 13.4)
