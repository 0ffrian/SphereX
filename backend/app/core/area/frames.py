"""Area frames (A17.1): cone grid, frame selection, visits, cutouts and coverage.

Stages, each a plain function so the script can run and time them one by one (and a later
ticket can checkpoint them):

1. ``search_cones``: the grid of small SIA cones over the box, through the read-through cache
   and Track's process-wide ``Pacer`` (A17.1). Answers merged by ``frame_id`` (first row kept).
2. ``select_frames``: keep a frame when its midpoint is inside a window, **then** when its
   ``s_region`` overlaps the box (Q-400 (2): so ``no_footprint:`` lists only frames inside the
   windows; the kept set is the same in either order).
3. ``group_frames``: visits and exposures (``core/find/visits.py``).
4. ``plan_cutouts`` / ``fetch_cutouts``: one cutout per frame (D-25), centred on the box
   clipped to the frame, side = the clipped box's larger side + 2 * margin (Q-400 (3)).
5. ``build_coverage``: per visit, a 30 arcsec cell mask (Q-400 (5), (6)).

Refusal codes (``AreaMissingCode``): ``area:visits``, ``frames:cone_maxrec:<n>``,
``no_footprint:<frame_id>``, ``cutout:<frame_id>``. ``frames:cone_failed:<n>`` marks the result
incomplete; it is never stored or served (A17.1).
"""

from __future__ import annotations

import hashlib
import logging
import math
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import datetime

import numpy as np

from app.adapters import irsa_cutout, irsa_sia
from app.adapters.http import UpstreamError
from app.adapters.irsa_sia import SiaRow, frame_time
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, AreaSpec
from app.core.area.geometry import (
    AreaBox,
    CellGrid,
    clipped_bbox,
    cone_grid,
    count_holes,
    edge_distance,
    largest_piece,
    outline,
    overlaps_box,
    points_in_polygon,
)
from app.core.area.records import AreaFrame, AreaFrames, ConeLog, Coverage
from app.core.find import moving, wcs
from app.core.find.visits import group_visits
from app.timefmt import iso_utc_z, mjd_to_utc

log = logging.getLogger("shift_spectrum")

AREA_VISITS = "area:visits"
CONE_MAXREC = "frames:cone_maxrec"
CONE_FAILED = "frames:cone_failed"
# A cutout download that failed (not cached offline, or upstream down): like a failed cone, the
# result is incomplete and never stored (Q-400 (12)). A body that arrived but is unusable stays
# ``cutout:<frame_id>`` (a refusal of that frame, stored).
CUTOUT_FAILED = "frames:cutout_failed"
NO_FOOTPRINT = "no_footprint"
CUTOUT = "cutout"
REQUIRED_HDUS = ("IMAGE", "FLAGS", "VARIANCE", "WCS-WAVE")


# --- 1. cones ------------------------------------------------------------------------------


@dataclass
class ConeSearch:
    rows: list[SiaRow]  # merged by frame_id, first row kept, in grid order
    logs: list[ConeLog]
    digests: list[str]  # SHA-256 of every SIA body used
    maxrec_hits: int
    failed: int


def search_cones(
    ctx: Context,
    spec: AreaSpec,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    refresh: bool = False,
    gate: moving.Gate | None = None,
    pacer: moving.Pacer = moving.PACER,
) -> ConeSearch:
    gate = gate or moving.Gate()
    box = AreaBox.of(spec)
    found: dict[str, SiaRow] = {}
    logs: list[ConeLog] = []
    digests: list[str] = []
    maxrec_hits = failed = 0
    for ra, dec in cone_grid(box, cfg.grid_step_deg):
        key = irsa_sia.sia_key(spec.data_release, ra, dec, cfg.cone_radius_deg)
        verdict = gate.decide(ctx, key, refresh)
        t0 = time.perf_counter()
        if verdict in ("defer", "fail"):
            failed += 1
            logs.append(ConeLog(ra, dec, verdict, 0, False, 0.0))
            continue
        if verdict == "live":
            pacer.wait(ctx.settings.moving_cone_pace_s)
        try:
            sia = irsa_sia.search(
                ctx,
                ra,
                dec,
                refresh=refresh,
                maxrec=cfg.cone_maxrec,
                radius_deg=cfg.cone_radius_deg,
            )
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            if verdict == "live":
                gate.mark_failed(key.digest)
            log.warning("area %s: cone %.5f %.5f failed: %s", spec.id, ra, dec, exc)
            failed += 1
            logs.append(ConeLog(ra, dec, "failed", 0, False, time.perf_counter() - t0))
            continue
        maxrec_hits += sia.truncated
        digests.append(hashlib.sha256(sia.served.entry.body).hexdigest())
        logs.append(
            ConeLog(
                ra,
                dec,
                "cached" if sia.served.from_cache else "live",
                len(sia.rows),
                sia.truncated,
                time.perf_counter() - t0,
            )
        )
        for row in sia.rows:
            found.setdefault(row.frame_id, row)
    return ConeSearch(list(found.values()), logs, digests, maxrec_hits, failed)


# --- 2. selection --------------------------------------------------------------------------


def in_windows(when: datetime, windows: Sequence[tuple[datetime, datetime]]) -> bool:
    return any(a <= when <= b for a, b in windows)


def select_frames(
    rows: Sequence[SiaRow], spec: AreaSpec, cfg: AreaConfig = DEFAULT_AREA_CONFIG
) -> tuple[list[SiaRow], list[str]]:
    """Window first, then footprint (Q-400 (2)). Returns the kept rows (by frame_id) and the
    ``no_footprint:`` codes."""
    box = AreaBox.of(spec)
    kept: list[SiaRow] = []
    missing: list[str] = []
    for row in sorted(rows, key=lambda r: r.frame_id):
        if not in_windows(frame_time(row), spec.windows):
            continue
        if not row.s_region:
            missing.append(f"{NO_FOOTPRINT}:{row.frame_id}")
            continue
        if overlaps_box(box, row.s_region, cfg.overlap_eps_deg2):
            kept.append(row)
    return kept, missing


# --- 3. visits -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Grouped:
    row: SiaRow
    visit: int
    exposure: int
    time: datetime


def group_frames(rows: Sequence[SiaRow], cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> list[Grouped]:
    """Visits and exposures, sorted by ``(time, detector, frame_id)`` (A17.1)."""
    mids = [frame_time(r) for r in rows]
    slots = group_visits(mids, cfg.visit_gap_h, cfg.exposure_tol_s)
    out = [Grouped(r, s.visit, s.exposure, s.time) for r, s in zip(rows, slots, strict=True)]
    return sorted(out, key=lambda g: (g.time, g.row.detector, g.row.frame_id))


# --- 4. cutouts ----------------------------------------------------------------------------


@dataclass(frozen=True)
class CutoutPlan:
    ra: float
    dec: float
    size_arcsec: float


def plan_cutout(
    box: AreaBox, row: SiaRow, cfg: AreaConfig = DEFAULT_AREA_CONFIG
) -> CutoutPlan | None:
    """One rule for every frame (Q-400 (3)): the centre of the bounding box of (footprint and
    area) on the plane, deprojected; side = that bounding box's larger side + 2 * margin."""
    if not row.s_region:
        return None
    bb = clipped_bbox(box, row.s_region)
    if bb is None:
        return None
    xmin, xmax, ymin, ymax = bb
    ra, dec = box.deproject((xmin + xmax) / 2.0, (ymin + ymax) / 2.0)
    side = max(xmax - xmin, ymax - ymin) + 2.0 * cfg.margin_deg
    # The cache key keeps 0.1 arcsec; round up so the request never shrinks below the rule.
    return CutoutPlan(ra, dec, math.ceil(side * 3600.0 * 10.0) / 10.0)


CutoutFetch = Callable[[SiaRow, CutoutPlan], tuple[str, bytes]]


def live_fetch(ctx: Context, *, refresh: bool = False) -> CutoutFetch:
    """Fetch through the IRSA cutout adapter and the cache: ``(key digest, body)``."""

    def fetch(row: SiaRow, plan: CutoutPlan) -> tuple[str, bytes]:
        served = irsa_cutout.fetch_cutout(
            ctx, row, plan.ra, plan.dec, refresh=refresh, size_arcsec=plan.size_arcsec
        )
        return served.entry.key.digest, served.entry.body

    return fetch


@dataclass(frozen=True)
class CutoutResult:
    key: str | None
    body: bytes | None
    seconds: float
    error: str | None = None
    failed: bool = False  # the download itself failed (not an unusable body)


def usable_cutout(body: bytes) -> bool:
    try:
        hdul = wcs.open_fits(body)
    except (OSError, ValueError, TypeError):
        return False
    with hdul:
        return all(name in hdul for name in REQUIRED_HDUS)


def fetch_cutouts(
    rows: Sequence[SiaRow],
    plans: Sequence[CutoutPlan | None],
    fetch: CutoutFetch,
    workers: int,
) -> list[CutoutResult]:
    """Download on a thread pool (Q-112's limit), results in input order."""

    def one(i: int) -> CutoutResult:
        plan = plans[i]
        if plan is None:
            return CutoutResult(None, None, 0.0, "no plan")
        t0 = time.perf_counter()
        try:
            key, body = fetch(rows[i], plan)
        except (CacheMissOffline, UpstreamUnavailable, UpstreamError, OSError) as exc:
            return CutoutResult(None, None, time.perf_counter() - t0, str(exc), failed=True)
        if not usable_cutout(body):
            return CutoutResult(key, None, time.perf_counter() - t0, "unreadable or no IMAGE")
        return CutoutResult(key, body, time.perf_counter() - t0)

    if workers <= 1:
        return [one(i) for i in range(len(rows))]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(one, range(len(rows))))


# --- 5. coverage ---------------------------------------------------------------------------


def cutout_cells(box: AreaBox, grid: CellGrid, body: bytes, erode_px: float) -> np.ndarray:
    """Cells whose centre lies ``erode_px`` or more inside the cutout's pixels."""
    gx, gy = grid.centres()
    ra, dec = box.deproject_many(gx.ravel(), gy.ravel())
    with wcs.open_fits(body) as hdul:
        ny, nx = np.asarray(hdul["IMAGE"].data).shape
        w = wcs.celestial_wcs(hdul["IMAGE"].header)
        x, y = w.world_to_pixel_values(ra, dec)
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    lo = erode_px - 0.5
    ok = (x >= lo) & (x <= nx - 0.5 - erode_px) & (y >= lo) & (y <= ny - 0.5 - erode_px)
    return np.asarray(ok, dtype=np.bool_).reshape(gx.shape)


def footprint_cells(box: AreaBox, grid: CellGrid, row: SiaRow, erode_deg: float) -> np.ndarray:
    """Cells whose centre is inside the box and ``erode_deg`` or more inside the footprint."""
    gx, gy = grid.centres()
    out = np.zeros(gx.shape, dtype=np.bool_)
    if not row.s_region:
        return out
    plane = box.project_polygon(row.s_region)
    if plane is None:
        return out
    inside = points_in_polygon(plane, gx, gy) & (edge_distance(plane, gx, gy) >= erode_deg)
    return np.asarray(inside & box.inside_many(gx, gy), dtype=np.bool_)


def build_coverage(
    box: AreaBox,
    grouped: Sequence[Grouped],
    bodies: dict[str, bytes],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> list[Coverage]:
    """One ``Coverage`` per visit; only frames with a usable cutout count (Q-400 (4))."""
    grid = CellGrid.of(box, cfg.coverage_cell_arcsec)
    visits = sorted({g.visit for g in grouped})
    out: list[Coverage] = []
    for v in visits:
        mask = np.zeros((grid.ny, grid.nx), dtype=np.bool_)
        for g in grouped:
            body = bodies.get(g.row.frame_id)
            if g.visit != v or body is None:
                continue
            fp = footprint_cells(box, grid, g.row, cfg.coverage_erode_deg)
            if fp.any():
                mask |= fp & cutout_cells(box, grid, body, cfg.coverage_erode_px)
        piece, pieces = largest_piece(mask)
        polygon: tuple[tuple[float, float], ...] = ()
        if piece.any():
            verts = outline(piece)
            xs = np.array([grid.vertex(c, r)[0] for c, r in verts])
            ys = np.array([grid.vertex(c, r)[1] for c, r in verts])
            ra, dec = box.deproject_many(xs, ys)
            polygon = tuple(
                (round(float(a), 7) % 360.0, round(float(d), 7))
                for a, d in zip(ra, dec, strict=True)
            )
        out.append(
            Coverage(
                visit=v,
                mask=piece,
                polygon=polygon,
                cells_covered=int(mask.sum()),
                pieces=pieces,
                cells_lost=int(mask.sum() - piece.sum()),
                holes=count_holes(piece) if piece.any() else 0,
            )
        )
    return out


# --- the whole step ------------------------------------------------------------------------


def s_region_text(row: SiaRow) -> str:
    assert row.s_region
    return "POLYGON ICRS " + " ".join(f"{a:.7f} {d:.7f}" for a, d in row.s_region)


def _floor5(v: float) -> float:
    return math.floor(v * 1e5) / 1e5


def _ceil5(v: float) -> float:
    return math.ceil(v * 1e5) / 1e5


def to_frame(g: Grouped, plan: CutoutPlan | None, cut: CutoutResult | None) -> AreaFrame:
    r = g.row
    return AreaFrame(
        frame_id=r.frame_id,
        obs_id=r.obs_id,
        detector=r.detector,
        visit=g.visit,
        exposure=g.exposure,
        time=iso_utc_z(g.time),
        t_min=iso_utc_z(mjd_to_utc(r.t_min_mjd)),
        t_max=iso_utc_z(mjd_to_utc(r.t_max_mjd)),
        wavelength_min_um=_floor5(r.em_min_um),
        wavelength_max_um=_ceil5(r.em_max_um),
        s_region=s_region_text(r),
        cutout_ra=round(plan.ra, 7) if plan else 0.0,
        cutout_dec=round(plan.dec, 7) if plan else 0.0,
        cutout_size_arcsec=plan.size_arcsec if plan else 0.0,
        cutout_key=cut.key if cut else None,
        cutout_sha256=hashlib.sha256(cut.body).hexdigest() if cut and cut.body else None,
        access_url=r.access_url,
    )


def assemble(
    spec: AreaSpec,
    rows: Sequence[SiaRow],
    fetch: CutoutFetch,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    workers: int = 1,
    head_missing: Sequence[str] = (),
    sia_digests: Sequence[str] = (),
    n_cones: int = 0,
    cones: Sequence[ConeLog] = (),
) -> tuple[AreaFrames, dict[str, bytes]]:
    """Stages 2 to 5 on merged SIA rows; returns the record and the usable cutout bodies by
    frame id (the dots step reads them). Used by ``find_frames`` and by the recorded-fixture
    area builder of the tests."""
    box = AreaBox.of(spec)
    kept, missing = select_frames(rows, spec, cfg)
    missing = [*head_missing, *missing]
    grouped = group_frames(kept, cfg)
    if len({g.visit for g in grouped}) < 2:
        missing.append(AREA_VISITS)
    plans = [plan_cutout(box, g.row, cfg) for g in grouped]
    t0 = time.perf_counter()
    cuts = fetch_cutouts([g.row for g in grouped], plans, fetch, workers)
    cut_s = time.perf_counter() - t0
    bodies: dict[str, bytes] = {}
    for g, c in zip(grouped, cuts, strict=True):
        if c.body is None:
            missing.append(f"{CUTOUT}:{g.row.frame_id}")
            if c.error:
                log.warning("area %s: cutout %s: %s", spec.id, g.row.frame_id, c.error)
        else:
            bodies[g.row.frame_id] = c.body
    t1 = time.perf_counter()
    coverage = build_coverage(box, grouped, bodies, cfg)
    frames = tuple(to_frame(g, p, c) for g, p, c in zip(grouped, plans, cuts, strict=True))
    digests = [*sia_digests, *(hashlib.sha256(b).hexdigest() for b in bodies.values())]
    stats = {
        "cutout_seconds": cut_s,
        "cutout_seconds_each": [c.seconds for c in cuts],
        "cutout_fetch_failed": sum(c.failed for c in cuts),
        "cutout_bytes": sum(len(b) for b in bodies.values()),
        "coverage_seconds": time.perf_counter() - t1,
    }
    result = AreaFrames(
        spec=spec,
        frames=frames,
        coverage=tuple(coverage),
        missing=tuple(sorted(set(missing))),
        complete=True,
        n_cones=n_cones,
        input_digests=tuple(sorted(digests)),
        cones=tuple(cones),
        stats=stats,
    )
    return result, bodies


def find_frames(
    ctx: Context,
    spec: AreaSpec,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    refresh: bool = False,
    gate: moving.Gate | None = None,
    pacer: moving.Pacer = moving.PACER,
    fetch: CutoutFetch | None = None,
) -> tuple[AreaFrames, dict[str, bytes]]:
    """A17.1 end to end. A failed cone stops the step before any cutout: the result is
    incomplete (``complete=False``, ``frames:cone_failed:<n>``) and is never stored. A failed
    cutout download makes it incomplete too (``frames:cutout_failed:<n>``, Q-400 (12)); an
    unusable body is only ``cutout:<frame_id>``."""
    if spec.data_release != ctx.settings.data_release:
        raise ValueError(
            f"area {spec.id} is for {spec.data_release}, "
            f"the settings use {ctx.settings.data_release}"
        )
    t0 = time.perf_counter()
    cones = search_cones(ctx, spec, cfg, refresh=refresh, gate=gate, pacer=pacer)
    cone_s = time.perf_counter() - t0
    head = [f"{CONE_MAXREC}:{cones.maxrec_hits}"] if cones.maxrec_hits else []
    if cones.failed:
        return (
            AreaFrames(
                spec=spec,
                frames=(),
                coverage=(),
                missing=tuple(sorted({*head, f"{CONE_FAILED}:{cones.failed}"})),
                complete=False,
                n_cones=len(cones.logs),
                input_digests=tuple(sorted(cones.digests)),
                cones=tuple(cones.logs),
                stats={"cone_seconds": cone_s},
            ),
            {},
        )
    result, bodies = assemble(
        spec,
        cones.rows,
        fetch or live_fetch(ctx, refresh=refresh),
        cfg,
        workers=ctx.settings.cutout_concurrency,
        head_missing=head,
        sia_digests=cones.digests,
        n_cones=len(cones.logs),
        cones=cones.logs,
    )
    result.stats["cone_seconds"] = cone_s
    failed = int(result.stats["cutout_fetch_failed"])
    if failed:
        result = replace(
            result,
            complete=False,
            missing=tuple(sorted({*result.missing, f"{CUTOUT_FAILED}:{failed}"})),
        )
    return result, bodies
