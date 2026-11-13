"""Area frames (A17.1, Q-400): loader, settings, visits, geometry, cones, cutouts, coverage, and
the recorded Eros frames. Network blocked (conftest)."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from dataclasses import fields
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import jsonschema
import numpy as np
import pytest

from app.adapters import irsa_cutout, irsa_sia
from app.adapters.irsa_sia import SiaRow, frame_time
from app.cache.keys import CacheKey
from app.cache.store import CacheMissOffline, LiveResponse
from app.context import make_context
from app.core.area import config as area_config
from app.core.area import frames as area_frames
from app.core.area.config import (
    DEFAULT_AREA_CONFIG,
    AreaConfig,
    AreaSpec,
    load_areas,
    method_settings,
)
from app.core.area.geometry import (
    AreaBox,
    CellGrid,
    cone_grid,
    fill_holes,
    largest_piece,
    outline,
    overlaps_box,
    points_in_polygon,
    radec_inside,
)
from app.core.find.visits import group_visits, visit_gaps_s, visit_spans
from app.settings import BACKEND_DIR
from tests.area_consistency import inside as served_inside
from tests.area_recorded import (
    EROS_AREA,
    recorded_fetch,
    recorded_frames,
    recorded_sia,
)
from tests.conftest import make_settings
from tests.helpers import entries

SCHEMAS = BACKEND_DIR.parent / "shared" / "schemas"
MISSING_CODE = json.loads((SCHEMAS / "area-index.schema.json").read_text("utf-8"))["definitions"][
    "AreaMissingCode"
]
T0 = datetime(2026, 3, 20, 8, 0, 0, tzinfo=UTC)


def _spec(**kw: object) -> AreaSpec:
    base = {
        "id": "t",
        "ra": 150.0,
        "dec": 2.0,
        "width_deg": 1.0,
        "height_deg": 0.5,
        "data_release": "spherex_qr2",
        "windows": ((T0 - timedelta(days=1), T0 + timedelta(days=2)),),
    }
    base.update(kw)
    return AreaSpec(**base)  # type: ignore[arg-type]


def _row(fid: str, mjd: float, poly: tuple[tuple[float, float], ...] | None) -> SiaRow:
    return SiaRow(
        fid, fid[:-3], int(fid[-1]), "https://irsa.ipac.caltech.edu/x", mjd, mjd, 1, 2, poly
    )


# ------------------------------------------------------------------- loader and settings


def test_eros_area_entry_matches_the_recorded_builder(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))
    assert load_areas(ctx)["eros-2026-03"] == EROS_AREA


def test_loader_skips_bad_entries_and_keeps_the_first_duplicate(tmp_path: Path) -> None:
    good = 'data_release = "r"\nwindows = [["2026-03-20T00:00:00Z", "2026-03-21T00:00:00Z"]]\n'
    toml = "\n".join(
        [
            f'[[area]]\nid = "a"\nra = 10.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n{good}',
            f'[[area]]\nid = "a"\nra = 20.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n{good}',
            f'[[area]]\nid = "bad id"\nra = 1.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n{good}',
            f'[[area]]\nid = "wide"\nra = 1.0\ndec = 0.0\nwidth_deg = 105\nheight_deg = 1\n{good}',
            '[[area]]\nid = "nowin"\nra = 1.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n'
            'data_release = "r"\nwindows = []\n',
            '[[area]]\nid = "rev"\nra = 1.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n'
            'data_release = "r"\nwindows = [["2026-03-21T00:00:00Z", "2026-03-20T00:00:00Z"]]\n',
            '[[area]]\nid = "noband"\nra = 1.0\ndec = 0.0\nwidth_deg = 1\nheight_deg = 1\n',
        ]
    )
    f = tmp_path / "targets.toml"
    f.write_text(toml, encoding="utf-8")
    ctx = make_context(make_settings(tmp_path, targets_file=f))
    areas = load_areas(ctx)
    assert list(areas) == ["a"] and areas["a"].ra == 10.0
    missing = make_context(make_settings(tmp_path, targets_file=tmp_path / "none.toml"))
    assert load_areas(missing) == {}


def test_every_starting_value_reaches_method_settings() -> None:
    settings = method_settings()
    renamed = {"measure": "measure_method_sha"}
    for f in fields(AreaConfig):
        assert renamed.get(f.name, f.name) in settings, f.name
    assert settings["area_version"] == area_config.AREA_VERSION
    assert "OUTLIER" not in str(settings["hardware_flags"]).split(",")
    assert all(isinstance(v, int | float | str) for v in settings.values())
    # A changed value changes the settings (and so params_hash, A17.10).
    other = method_settings(AreaConfig(k_detect=4.0))
    assert area_config.params_hash(settings, []) != area_config.params_hash(other, [])


# ------------------------------------------------------------------- visits


def test_visits_split_at_the_gap_and_chain() -> None:
    m = timedelta(minutes=1)
    times = [T0, T0 + 59 * m, T0 + 120 * m, T0 + 181 * m]  # 59 min: same; 61 min: new
    assert [s.visit for s in group_visits(times, 1.0, 1.0)] == [1, 1, 2, 3]
    chained = [T0 + 50 * m * i for i in range(4)]  # 3 x 50 min: one visit
    assert {s.visit for s in group_visits(chained, 1.0, 1.0)} == {1}


def test_exposures_within_one_second_and_time_is_the_earliest() -> None:
    s = timedelta(seconds=1)
    times = [T0 + s, T0, T0 + 130 * s, T0 + timedelta(seconds=131.5)]
    slots = group_visits(times, 1.0, 1.0)
    assert [x.exposure for x in slots] == [1, 1, 2, 3]
    assert slots[0].time == T0 and slots[1].time == T0


# ------------------------------------------------------------------- geometry


def test_eros_grid_is_15_cones_row_by_row() -> None:
    box = AreaBox.of(EROS_AREA)
    pts = cone_grid(box, DEFAULT_AREA_CONFIG.grid_step_deg)
    assert len(pts) == 15
    plane = [box.project(ra, dec) for ra, dec in pts]
    assert plane[0] is not None and plane[0][0] == pytest.approx(-0.42, abs=1e-9)
    assert plane[0][1] == pytest.approx(-0.21, abs=1e-9)
    assert plane[4] is not None and plane[4][0] == pytest.approx(0.42, abs=1e-9)
    assert plane[5] is not None and plane[5][1] == pytest.approx(0.0, abs=1e-9)


def _square(box: AreaBox, cx: float, cy: float, h: float) -> tuple[tuple[float, float], ...]:
    xs = np.array([cx - h, cx + h, cx + h, cx - h])
    ys = np.array([cy - h, cy - h, cy + h, cy + h])
    ra, dec = box.deproject_many(xs, ys)
    return tuple((float(a), float(d)) for a, d in zip(ra, dec, strict=True))


def test_footprint_overlap_cases() -> None:
    box = AreaBox(150.0, 2.0, 0.5, 0.25)
    eps = DEFAULT_AREA_CONFIG.overlap_eps_deg2
    assert overlaps_box(box, _square(box, 0.0, 0.0, 0.1), eps)  # inside
    assert overlaps_box(box, _square(box, 0.0, 0.0, 3.0), eps)  # holds the box
    assert overlaps_box(box, _square(box, 0.55, 0.0, 0.1), eps)  # partial
    assert not overlaps_box(box, _square(box, 2.0, 0.0, 0.1), eps)  # outside
    assert not overlaps_box(box, _square(box, 0.6, 0.35, 0.1), eps)  # corner touch
    assert not overlaps_box(box, _square(box, 0.6, 0.0, 0.1), eps)  # edge touch
    wrap = AreaBox(0.05, 0.0, 0.2, 0.2)  # RA 359.95 to 0.15
    poly = ((359.9, -0.05), (0.02, -0.05), (0.02, 0.05), (359.9, 0.05))
    assert overlaps_box(wrap, poly, eps)
    far = ((180.0, 0.0), (181.0, 0.0), (181.0, 1.0))  # beyond the projection
    assert not overlaps_box(wrap, far, eps)


def test_radec_inside_is_the_served_rule() -> None:
    rng = np.random.default_rng(7)
    poly = [[359.8, -0.3], [0.4, -0.2], [0.5, 0.3], [359.7, 0.25]]
    for _ in range(1000):
        ra, dec = float(rng.uniform(-0.5, 0.7) % 360.0), float(rng.uniform(-0.4, 0.4))
        assert radec_inside(poly, ra, dec) == served_inside(poly, ra, dec)


def test_window_first_then_footprint() -> None:
    box = AreaBox(150.0, 2.0, 0.5, 0.25)
    spec = _spec()
    mjd_in = 61119.5  # 2026-03-20 12:00
    mjd_out = mjd_in + 10.0
    rows = [
        _row("A_D1", mjd_in, _square(box, 0.0, 0.0, 0.1)),
        _row("B_D1", mjd_in, None),
        _row("C_D1", mjd_out, None),  # outside the windows: never listed
        _row("D_D1", mjd_out, _square(box, 0.0, 0.0, 0.1)),
        _row("E_D1", mjd_in, _square(box, 3.0, 0.0, 0.1)),
    ]
    kept, missing = area_frames.select_frames(rows, spec)
    assert [r.frame_id for r in kept] == ["A_D1"]
    assert missing == ["no_footprint:B_D1"]


def test_one_cutout_rule() -> None:
    box = AreaBox(150.0, 2.0, 0.525, 0.315)
    whole = _row("A_D1", 61119.5, _square(box, 0.0, 0.0, 3.0))
    plan = area_frames.plan_cutout(box, whole)
    assert plan is not None and plan.size_arcsec == pytest.approx(3924.0)
    assert (plan.ra, plan.dec) == pytest.approx((150.0, 2.0), abs=1e-9)
    edge = _row("B_D1", 61119.5, _square(box, 0.6, 0.0, 0.2))  # xi 0.4..0.525 inside the box
    plan = area_frames.plan_cutout(box, edge)
    assert plan is not None
    assert plan.size_arcsec == pytest.approx(round((0.4 + 0.04) * 3600, 1), abs=0.11)
    xy = box.project(plan.ra, plan.dec)
    assert xy is not None and xy[0] == pytest.approx(0.4625, abs=1e-9)


# ------------------------------------------------------------------- coverage geometry


def _random_mask(rng: np.random.Generator, ny: int, nx: int) -> np.ndarray:  # type: ignore[type-arg]
    return rng.random((ny, nx)) < 0.55


def test_outline_ray_cast_equals_the_filled_piece_on_every_cell() -> None:
    rng = np.random.default_rng(3)
    for trial in range(60):
        mask = _random_mask(rng, 9 + trial % 5, 11 + trial % 3)
        piece, _ = largest_piece(mask)
        if not piece.any():
            continue
        verts = outline(piece)
        ny, nx = piece.shape
        gx, gy = np.meshgrid(np.arange(nx) + 0.5, np.arange(ny) + 0.5)
        got = points_in_polygon([(float(c), float(r)) for c, r in verts], gx, gy)
        assert np.array_equal(got, fill_holes(piece)), trial


def test_pinch_and_pieces() -> None:
    mask = np.zeros((6, 8), dtype=bool)
    mask[1:3, 1:3] = True  # 4 cells
    mask[3:5, 3:5] = True  # 4 cells, touches the first only at a corner: another piece
    mask[0, 7] = True
    piece, n = largest_piece(mask)
    assert n == 3 and piece.sum() == 4 and piece[1, 1]  # tie: the lowest cell index wins
    ring = np.ones((5, 5), dtype=bool)
    ring[2, 2] = False
    ring[3, 3] = False
    ring[4, 4] = False  # a hole and a notch
    piece, n = largest_piece(ring)
    assert n == 1
    gx, gy = np.meshgrid(np.arange(5) + 0.5, np.arange(5) + 0.5)
    got = points_in_polygon([(float(c), float(r)) for c, r in outline(piece)], gx, gy)
    assert np.array_equal(got, fill_holes(piece))


# ------------------------------------------------------------------- cutouts adapter


def test_cutout_size_override_and_default_keys(tmp_path: Path) -> None:
    meta, body = next(
        (m, b)
        for m, b in entries("irsa_cutout")
        if m["key"]["query"].get("frame_id") == "2026W12_2A_0158_3_D1"
    )
    q = meta["key"]["query"]
    recorded = CacheKey.make(meta["key"]["source"], meta["key"]["release"], **q)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["size"])
        return httpx.Response(200, content=body)

    ctx = make_context(
        make_settings(tmp_path, offline=False), transport=httpx.MockTransport(handler)
    )
    row = SiaRow(
        q["frame_id"], "O", 1, "https://irsa.ipac.caltech.edu/ibe/x.fits", 1.0, 1.0, 1.0, 2.0
    )
    ra, dec = float(q["ra"]), float(q["dec"])
    assert irsa_cutout.key_for(ctx, row, ra, dec).digest == recorded.digest  # unchanged
    irsa_cutout.fetch_cutout(ctx, row, ra, dec)
    irsa_cutout.fetch_cutout(ctx, row, ra, dec, size_arcsec=3924.0)
    assert seen == ["0.100000", "1.090000"]
    big = irsa_cutout.key_for(ctx, row, ra, dec, 3924.0)
    assert big.digest != recorded.digest and dict(big.query)["size_arcsec"] == "3924.0"


# ------------------------------------------------------------------- cones and find_frames


def _cone_cache(tmp_path: Path, maxrecs: dict[int, int]) -> tuple[object, list[str]]:
    """A cache whose 15 grid cones all answer with the recorded Eros cone 1 body; cone ``i``
    stored with MAXREC ``maxrecs[i]`` (default 500)."""
    ctx = make_context(make_settings(tmp_path, offline=True))
    _, body = next((m, b) for m, b in entries("irsa_sia") if m["key"]["query"]["ra"] == "90.40961")
    keys = []
    for i, (ra, dec) in enumerate(cone_grid(AreaBox.of(EROS_AREA), 0.25)):
        key = irsa_sia.sia_key("spherex_qr2", ra, dec, 0.001)
        live = LiveResponse(body, "https://x", 200, "text/xml", {"maxrec": maxrecs.get(i, 500)})
        ctx.cache.put(key, live)
        keys.append(key.digest)
    return ctx, keys


def test_find_frames_counts_truncated_cones_and_keeps_their_rows(tmp_path: Path) -> None:
    rows = irsa_sia.parse_rows(
        next(b for m, b in entries("irsa_sia") if m["key"]["query"]["ra"] == "90.40961")
    )
    ctx, _ = _cone_cache(tmp_path, {0: len(rows) - 1, 7: 1})

    def fetch(row: SiaRow, plan: area_frames.CutoutPlan) -> tuple[str, bytes]:
        try:
            return recorded_fetch(row, plan)
        except CacheMissOffline:
            return "k", b"not FITS"  # arrived but unusable: cutout:<id>, still complete

    result, bodies = area_frames.find_frames(ctx, EROS_AREA, fetch=fetch)  # type: ignore[arg-type]
    assert result.complete and result.n_cones == 15
    assert "frames:cone_maxrec:2" in result.missing
    assert len(result.frames) > 0 and len(bodies) > 0
    for code in result.missing:
        jsonschema.validate(code, MISSING_CODE)


def test_failed_cutout_downloads_make_the_result_incomplete(tmp_path: Path) -> None:
    """Q-400 (12): a cutout that could not be downloaded is not a refusal of that frame; the run
    is incomplete and never stored (an unusable body stays ``cutout:<frame_id>``)."""
    ctx, _ = _cone_cache(tmp_path, {})
    result, bodies = area_frames.find_frames(ctx, EROS_AREA, fetch=recorded_fetch)  # type: ignore[arg-type]
    assert not result.complete
    assert "frames:cutout_failed:2" in result.missing and len(bodies) > 0
    assert result.stats["cutout_fetch_failed"] == 2


def test_failed_cones_make_the_result_incomplete_before_any_cutout(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path, offline=True))  # empty cache, offline

    def no_fetch(row: SiaRow, plan: object) -> tuple[str, bytes]:
        raise AssertionError("no cutout after a failed cone")

    result, bodies = area_frames.find_frames(ctx, EROS_AREA, fetch=no_fetch)  # type: ignore[arg-type]
    assert not result.complete and result.missing == ("frames:cone_failed:15",)
    assert result.frames == () and bodies == {}


def test_find_frames_refuses_another_release(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path, data_release="other"))
    with pytest.raises(ValueError, match="spherex_qr2"):
        area_frames.find_frames(ctx, EROS_AREA)


# The read side the API may import (A17.8, issue #108); everything else in app.core.area computes.
# Q-462: the live-area plan and job queue are light too; the worker imports the pipeline lazily.
AREA_READ_SIDE = [
    "app.core.area",
    "app.core.area.config",
    "app.core.area.live",
    "app.core.area.live_jobs",
    # Issue #156: run records and the scan split, plain JSON and math (no numpy, no pipeline).
    "app.core.area.runs",
    "app.core.area.scan",
    "app.core.area.store",
]


def test_app_api_never_imports_the_area_pipeline() -> None:
    """A16.2: no computing in a web request. The API serves ``derived.area`` entries through
    ``store`` (stamps are made at prepare time and stored); no pipeline module (frames, dots,
    labels, join, known check, service, stamps) is ever loaded by ``app.main``."""
    code = (
        "import sys, app.main; "
        "print(sorted(m for m in sys.modules if m.startswith('app.core.area')))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, check=True
    )
    loaded = ast.literal_eval(out.stdout.strip())
    assert loaded == AREA_READ_SIDE


# ------------------------------------------------------------------- recorded Eros frames


def test_recorded_eros_frames_two_visits() -> None:
    """The two recorded path cones, selected and grouped with the Eros box (Q-402: the live
    grid can find more; the counts here are of these cones only)."""
    rows, _ = recorded_sia()
    kept, missing = area_frames.select_frames(rows, EROS_AREA)
    assert missing == []
    grouped = area_frames.group_frames(kept)
    assert len(grouped) == 18
    assert {g.row.detector for g in grouped} == {1, 4}
    per_visit = {v: sorted({g.exposure for g in grouped if g.visit == v}) for v in (1, 2)}
    assert per_visit == {1: [1, 2, 3, 4], 2: [1, 2, 3, 4, 5]}
    # One exposure = one obs_id (both detectors), and the reverse.
    pairs = {(g.visit, g.exposure): set() for g in grouped}  # type: dict[tuple[int, int], set[str]]
    for g in grouped:
        pairs[(g.visit, g.exposure)].add(g.row.obs_id)
    assert all(len(v) == 1 for v in pairs.values()) and len(pairs) == 9
    mids = [frame_time(g.row) for g in grouped]
    slots = group_visits(mids, 1.0, 1.0)
    spans = visit_spans(mids, slots)
    secs = [(b - a).total_seconds() for a, b in spans.values()]
    assert secs == pytest.approx([386.770, 543.370], abs=1e-3)  # 6.45 and 9.06 min
    # Mid-time to mid-time (A17 dt_v): 1.0162 d.
    assert visit_gaps_s(spans) == pytest.approx([87803.417], abs=1e-3)
    keys = [(g.time, g.row.detector, g.row.frame_id) for g in grouped]
    assert keys == sorted(keys)


def test_grid_hits_every_recorded_frame_and_a_minimal_box_misses_one() -> None:
    from app.core.find import moving

    rows, _ = recorded_sia()
    kept, _ = area_frames.select_frames(rows, EROS_AREA)
    cones = cone_grid(AreaBox.of(EROS_AREA), 0.25)
    for r in kept:
        assert r.s_region and any(moving.inside_footprint(a, d, r.s_region) for a, d in cones)
    small = AreaBox(EROS_AREA.ra, EROS_AREA.dec, 0.4895, 0.152)  # positions + 0.02 deg
    small_cones = cone_grid(small, 0.25)
    assert len(small_cones) == 8
    missed = {
        r.frame_id
        for r in kept
        if r.s_region and not any(moving.inside_footprint(a, d, r.s_region) for a, d in small_cones)
    }
    assert missed == {"2026W12_2A_0340_1_D1", "2026W12_2A_0340_1_D4"}


def test_recorded_area_frames_record() -> None:
    result, bodies = recorded_frames()
    assert result.complete and len(result.frames) == 18 and len(bodies) == 16
    assert result.missing == ("cutout:2026W12_2A_0340_1_D1", "cutout:2026W12_2A_0340_1_D4")
    no_cut = [f for f in result.frames if f.cutout_sha256 is None]
    assert {f.frame_id for f in no_cut} == {"2026W12_2A_0340_1_D1", "2026W12_2A_0340_1_D4"}
    assert [c.visit for c in result.coverage] == [1, 2]
    for c in result.coverage:
        assert c.pieces == 1 and c.cells_lost == 0 and len(c.polygon) >= 3
        assert c.mask.sum() == c.cells_covered
    for f in result.frames:
        assert f.wavelength_min_um < f.wavelength_max_um
        assert f.time.endswith("Z") and f.s_region.startswith("POLYGON ICRS ")


def test_coverage_needs_a_cutout_and_the_eroded_footprint() -> None:
    result, bodies = recorded_frames()
    box = AreaBox.of(EROS_AREA)
    grid = CellGrid.of(box, 30.0)
    visit1 = next(f for f in result.frames if f.visit == 1 and f.detector == 1)
    body = bodies[visit1.frame_id]
    radec = area_frames.grid_radec(box, grid)
    loose = area_frames.cutout_cells(grid, body, 0.0, radec)
    tight = area_frames.cutout_cells(grid, body, 10.0, radec)
    assert tight.sum() < loose.sum() and not (tight & ~loose).any()
    cov = result.coverage[0].mask
    assert not (cov & ~loose).any()  # nothing outside the cutout counts as covered


def test_the_cached_grid_shares_read_only_centres_and_keeps_one_area() -> None:
    """Issue #128 (2): every step of a run shares one grid; its centres cannot be changed in
    place, and only the latest area's grid stays alive."""
    from app.core.area.geometry import cell_grid

    box = AreaBox.of(EROS_AREA)
    grid = cell_grid(box, 30.0)
    assert cell_grid(box, 30.0) is grid
    gx, gy = grid.centres()
    assert gx is grid.centres()[0]
    with pytest.raises(ValueError):
        gx += 1.0
    assert not gy.flags.writeable
    moved = AreaBox(box.ra0 + 5.0, box.dec0, box.half_w, box.half_h)
    assert cell_grid(moved, 30.0) is grid  # same size, other centre: the same grid
    cell_grid(box, 60.0)
    assert cell_grid(box, 30.0) is not grid  # only the latest grid is kept
