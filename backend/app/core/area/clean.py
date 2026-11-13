"""A17.3 (P4): glitches, stars and fixed dots, and the per-visit tracklets the join reuses.

Order (A17.3, Q-402 (5)): glitch, then star (per tracklet), then fixed (per dot). Each label stays
on the dot so the UI can replay the steps. What is left are the movers-to-be.

- **Glitch:** a dot needs counterparts in at least ``k_visit - 1`` other frames of its visit
  (both detectors count) within ``r_match + rate_max * |dt|``; ``k_visit = min(k_visit_max,
  frames of the visit whose cutout holds the dot)``, so the test applies only where the frames it
  needs cover the dot (A17.1 coverage note).
- **Tracklets:** per visit, the non-glitch dots chained into straight lines in time
  (``TRACKLET_FORMULA``). A dot that joins no line is a one-dot tracklet.
- **Star:** a tracklet whose every dot lies within ``max(r_match, r_px)`` of the **same** star of
  its visit's list (Gaia DR3 + CatWISE2020, A19.6, Q-143); a dot with a bright-star artefact
  flag is ``star`` too. A visit whose star cone failed for one catalogue uses the other; the
  code ``stars:<cat>:<visit>`` goes to ``missing`` (A17.3).
- **Fixed:** a dot that is not ``star`` with a non-glitch dot of another visit within
  ``r_match`` at the same place, where that visit's coverage holds it.

Pure apart from ``star_lists`` (the cache-backed star cones). Every float that reaches a reply is
rounded at the edge (``join.py``, ``service.py``), so the same records give the same bytes.
"""

from __future__ import annotations

import heapq
import itertools
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, TypeVar

import numpy as np

from app.context import Context
from app.core.area.config import DEFAULT_AREA_CONFIG, PIXEL_ARCSEC, AreaConfig
from app.core.area.geometry import AreaBox, CellGrid, cell_grid
from app.core.area.records import AreaFrames, Coverage, Dot, FrameDots
from app.core.find import stars as star_lib
from app.core.find import wcs
from app.core.find.stars import StarCone, StarList
from app.timefmt import parse_utc

PIXEL_DEG = PIXEL_ARCSEC / 3600.0
GLITCH, STAR, FIXED, MOVER = "glitch", "star", "fixed", "mover"
# Stars this far outside the box are not placed (a dot is inside the box; 0.05 deg is far more
# than the largest star radius, 10 px). Not a physical value.
STAR_BOX_PAD_DEG = 0.05


# --- area geometry shared by the steps -------------------------------------------------------


@dataclass(frozen=True)
class AreaGeometry:
    """Times, the plane and the rate limits of one area (A17.1 size rule, A17.4 step 2)."""

    box: AreaBox
    t0: datetime  # reference time: the first frame's time
    visit_mid_d: dict[int, float]  # visit -> mid-time in days after t0 (first and last exposure)
    visit_span_d: dict[int, float]  # visit -> last minus first exposure time, days
    rate_max_deg_day: float  # min(rate_max, size rule) with the shortest visit gap
    # What ``area_geometry`` built this from (``_geometry_key``): checked by ``require`` in every
    # step that takes both the frames and the geometry. None for a geometry built by hand (tests).
    built_from: tuple[object, ...] | None = None

    def require(self, frames: AreaFrames, cfg: AreaConfig | None = None) -> None:
        """Raise ``ValueError`` unless this is ``area_geometry(frames, cfg)``: built for these
        frames' area, frame times and visits (not the same area's frames before a filter, so
        another ``t0``, visit times or rate limit) and, when ``cfg`` is given, its settings. A
        comparison of keys, with no pass over the times; skipped for a hand-built geometry."""
        if self.built_from is None:
            return
        f_key, c_key = _geometry_key(frames, cfg)
        if self.box != AreaBox.of(frames.spec) or self.built_from[0] != f_key:
            raise ValueError("geo was not built from these frames and settings")
        if c_key is not None and self.built_from[1] != c_key:
            raise ValueError("geo was not built from these frames and settings")

    def days(self, iso: str) -> float:
        return (parse_utc(iso) - self.t0).total_seconds() / 86400.0

    def rate_max_for(self, dt_d: float, cfg: AreaConfig) -> float:
        """``min(rate_max, (diagonal - 2 margin) / dt_v)`` (A17.1 size rule, A17.4 step 2)."""
        diag = math.hypot(2.0 * self.box.half_w, 2.0 * self.box.half_h) - 2.0 * cfg.margin_deg
        if dt_d <= 0.0:
            return cfg.rate_max_deg_day
        return min(cfg.rate_max_deg_day, max(diag, 0.0) / dt_d)


def _geometry_key(
    frames: AreaFrames, cfg: AreaConfig | None
) -> tuple[object, tuple[float, float] | None]:
    """The inputs ``area_geometry`` reads: the area, each frame's visit and time, and the two
    settings its rate limit uses."""
    f_key = (frames.spec, tuple((f.visit, f.time) for f in frames.frames))
    return f_key, None if cfg is None else (cfg.rate_max_deg_day, cfg.margin_deg)


def area_geometry(frames: AreaFrames, cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> AreaGeometry:
    box = AreaBox.of(frames.spec)
    times = sorted({f.time for f in frames.frames})
    t0 = parse_utc(times[0]) if times else parse_utc("2000-01-01T00:00:00Z")

    def days(iso: str) -> float:
        return (parse_utc(iso) - t0).total_seconds() / 86400.0

    by_visit: dict[int, list[float]] = {}
    for f in frames.frames:
        by_visit.setdefault(f.visit, []).append(days(f.time))
    mid = {v: (min(ts) + max(ts)) / 2.0 for v, ts in sorted(by_visit.items())}
    span = {v: max(ts) - min(ts) for v, ts in sorted(by_visit.items())}
    geo = AreaGeometry(box, t0, mid, span, cfg.rate_max_deg_day)
    mids = list(mid.values())
    gaps = [b - a for a, b in itertools.pairwise(mids)]
    rate = geo.rate_max_for(min(gaps), cfg) if gaps else cfg.rate_max_deg_day
    return AreaGeometry(box, t0, mid, span, rate, _geometry_key(frames, cfg))


@dataclass(frozen=True)
class DotPoint:
    """A dot on the area plane, in pixels (xi east, eta north) and days after ``t0``."""

    index: int  # position in the area's dot order (frame order, then n)
    dot: Dot
    x: float
    y: float
    t: float
    r_match: float  # px


def r_match_px(dot: Dot, cfg: AreaConfig) -> float:
    """A17.3: ``r_match = max(2 px, 3 sigma_c)``."""
    return max(cfg.r_match_min_px, cfg.r_match_sigma * dot.sigma_c_px)


def dot_points(
    per_frame: Sequence[FrameDots], frames: AreaFrames, geo: AreaGeometry, cfg: AreaConfig
) -> list[DotPoint]:
    """Every dot of the area, in frame order then ``n`` (Q-208 (14)), placed on the plane."""
    order = {f.frame_id: i for i, f in enumerate(frames.frames)}
    dots = sorted(
        (d for fd in per_frame for d in fd.dots),
        key=lambda d: (order[d.frame_id], int(d.dot_id.rsplit(":", 1)[1])),
    )
    if not dots:
        return []
    xi, eta, _ = geo.box.project_many(
        np.array([d.ra for d in dots], dtype=np.float64),
        np.array([d.dec for d in dots], dtype=np.float64),
    )
    return [
        DotPoint(
            i,
            d,
            float(xi[i]) / PIXEL_DEG,
            float(eta[i]) / PIXEL_DEG,
            geo.days(d.time),
            r_match_px(d, cfg),
        )
        for i, d in enumerate(dots)
    ]


class Planar(Protocol):
    @property
    def x(self) -> float: ...
    @property
    def y(self) -> float: ...


P = TypeVar("P", bound=Planar)


@dataclass(frozen=True)
class StarPoint:
    """A star of a visit's list on the plane at one dot time."""

    sid: str  # "<catalog>:<id>"
    x: float
    y: float
    r_px: float


class Grid[P: Planar]:
    """A uniform grid index of points on the plane (cell ``size`` px); ``near`` returns the
    points within ``r``, in insertion order per cell."""

    def __init__(self, pts: Sequence[P], size: float) -> None:
        self.size = max(size, 1e-6)
        self.cells: dict[tuple[int, int], list[P]] = {}
        for p in pts:
            self.cells.setdefault(self._cell(p.x, p.y), []).append(p)

    def _cell(self, x: float, y: float) -> tuple[int, int]:
        return (math.floor(x / self.size), math.floor(y / self.size))

    def near(self, x: float, y: float, r: float) -> list[P]:
        cx, cy = self._cell(x, y)
        reach = max(1, math.ceil(r / self.size))
        out: list[P] = []
        for i in range(cx - reach, cx + reach + 1):
            for j in range(cy - reach, cy + reach + 1):
                for p in self.cells.get((i, j), ()):
                    if math.hypot(p.x - x, p.y - y) <= r:
                        out.append(p)
        return out


# --- glitches ---------------------------------------------------------------------------------


def covering_frames(
    frames: AreaFrames, bodies: Mapping[str, bytes], pts: Sequence[DotPoint], cfg: AreaConfig
) -> dict[int, set[str]]:
    """Dot index -> ids of the frames of its visit whose cutout holds it at least
    ``coverage_erode_px`` inside its edge (the frames that could have seen it)."""
    by_visit: dict[int, list[DotPoint]] = {}
    for p in pts:
        by_visit.setdefault(p.dot.visit, []).append(p)
    out: dict[int, set[str]] = {p.index: set() for p in pts}
    e = cfg.coverage_erode_px
    for f in frames.frames:
        body = bodies.get(f.frame_id)
        group = by_visit.get(f.visit)
        if body is None or not group:
            continue
        with wcs.open_fits(body) as hdul:
            ny, nx = np.asarray(hdul["IMAGE"].data).shape
            xs, ys = wcs.png_xy_many(
                hdul,
                np.array([p.dot.ra for p in group], dtype=np.float64),
                np.array([p.dot.dec for p in group], dtype=np.float64),
            )
        ok = (
            np.isfinite(xs)
            & np.isfinite(ys)
            & (xs >= e - 0.5)
            & (xs <= nx - 0.5 - e)
            & (ys >= e - 0.5)
            & (ys <= ny - 0.5 - e)
        )
        for p, inside in zip(group, ok.tolist(), strict=True):
            if inside:
                out[p.index].add(f.frame_id)
    for p in pts:
        out[p.index].add(p.dot.frame_id)  # the frame that measured it holds it
    return out


def glitches(
    pts: Sequence[DotPoint],
    covering: Mapping[int, set[str]],
    geo: AreaGeometry,
    cfg: AreaConfig,
) -> set[int]:
    """Indices of the dots that fail the glitch rule of A17.3."""
    rate_px = geo.rate_max_deg_day / PIXEL_DEG  # px per day
    by_frame: dict[str, list[DotPoint]] = {}
    for p in pts:
        by_frame.setdefault(p.dot.frame_id, []).append(p)
    max_span = max(geo.visit_span_d.values(), default=0.0)
    r_big = max((p.r_match for p in pts), default=cfg.r_match_min_px)
    r_cap = r_big + rate_px * max_span
    grids = {fid: Grid(ps, r_cap) for fid, ps in by_frame.items()}
    frame_time = {fid: ps[0].t for fid, ps in by_frame.items()}
    visit_frames: dict[int, list[str]] = {}
    for fid, ps in by_frame.items():
        visit_frames.setdefault(ps[0].dot.visit, []).append(fid)
    out: set[int] = set()
    for p in pts:
        k = min(cfg.k_visit_max, len(covering[p.index]))
        found = 1
        for fid in visit_frames[p.dot.visit]:
            if fid == p.dot.frame_id or found >= k:
                continue
            # Query with the largest r_match: the test below uses the larger of the two dots'.
            reach = r_big + rate_px * abs(frame_time[fid] - p.t)
            for q in grids[fid].near(p.x, p.y, reach):
                if math.hypot(q.x - p.x, q.y - p.y) <= max(p.r_match, q.r_match) + rate_px * abs(
                    q.t - p.t
                ):
                    found += 1
                    break
        if found < k:
            out.add(p.index)
    return out


# --- tracklets --------------------------------------------------------------------------------


@dataclass(frozen=True)
class LineFit:
    x0: float  # px at t_ref
    y0: float
    vx: float  # px per day (east)
    vy: float  # north
    t_ref: float  # mean time of the dots, days
    rms: float  # px
    sigma_v: float  # px per day
    span_px: float  # motion over the tracklet's time span


def fit_line(members: Sequence[DotPoint]) -> LineFit:
    """Least-squares ``x(t), y(t)``. ``sigma_v`` per axis from ``SSR / (n - 2)`` over
    ``sum (t - t_ref)^2`` (the mean ``sigma_c`` squared when ``n <= 2``), averaged over the two
    axes; zero when the dots span one time."""
    t = np.array([m.t for m in members], dtype=np.float64)
    x = np.array([m.x for m in members], dtype=np.float64)
    y = np.array([m.y for m in members], dtype=np.float64)
    t_ref = float(t.mean())
    dt = t - t_ref
    sxx = float(np.sum(dt * dt))
    if sxx > 0.0:
        vx = float(np.sum(dt * (x - x.mean())) / sxx)
        vy = float(np.sum(dt * (y - y.mean())) / sxx)
    else:
        vx = vy = 0.0
    x0, y0 = float(x.mean()), float(y.mean())
    rx = x - (x0 + vx * dt)
    ry = y - (y0 + vy * dt)
    n = len(members)
    rms = float(math.sqrt(float(np.mean(rx * rx + ry * ry))))
    if sxx > 0.0:
        if n > 2:
            s2x = float(np.sum(rx * rx)) / (n - 2)
            s2y = float(np.sum(ry * ry)) / (n - 2)
        else:
            s2x = s2y = float(np.mean([m.dot.sigma_c_px**2 for m in members]))
        sigma_v = math.sqrt((s2x / sxx + s2y / sxx) / 2.0)
    else:
        sigma_v = 0.0
    span = math.hypot(vx, vy) * float(t.max() - t.min())
    return LineFit(x0, y0, vx, vy, t_ref, rms, sigma_v, span)


@dataclass(frozen=True)
class Tracklet:
    visit: int
    members: tuple[DotPoint, ...]  # in dot order
    fit: LineFit

    @property
    def first(self) -> int:
        return self.members[0].index

    @property
    def n_times(self) -> int:
        return len({m.t for m in self.members})


def _members(
    seed_a: DotPoint,
    seed_b: DotPoint,
    frames_of_visit: Sequence[str],
    grids: Mapping[str, Grid[DotPoint]],
    frame_time: Mapping[str, float],
    used: set[int],
) -> list[DotPoint]:
    vx = (seed_b.x - seed_a.x) / (seed_b.t - seed_a.t)
    vy = (seed_b.y - seed_a.y) / (seed_b.t - seed_a.t)
    out: list[DotPoint] = []
    for fid in frames_of_visit:
        dt = frame_time[fid] - seed_a.t
        px, py = seed_a.x + vx * dt, seed_a.y + vy * dt
        best: tuple[float, int, DotPoint] | None = None
        for q in grids[fid].near(px, py, grids[fid].size):
            if q.index in used:
                continue
            d = math.hypot(q.x - px, q.y - py)
            if d <= q.r_match and (best is None or (d, q.index) < best[:2]):
                best = (d, q.index, q)
        if best is not None:
            out.append(best[2])
    out.sort(key=lambda m: m.index)
    return out


def build_tracklets(pts: Sequence[DotPoint], geo: AreaGeometry, cfg: AreaConfig) -> list[Tracklet]:
    """``TRACKLET_FORMULA`` per visit (lazy greedy: a hypothesis is re-scored when popped, and
    accepted only when still the best, so the result is the plain greedy one). Dots in no line
    become one-dot tracklets. Returned in order of their first dot."""
    rate_px = geo.rate_max_deg_day / PIXEL_DEG
    by_visit: dict[int, list[DotPoint]] = {}
    for p in pts:
        by_visit.setdefault(p.dot.visit, []).append(p)
    r_big = max((p.r_match for p in pts), default=cfg.r_match_min_px)
    out: list[Tracklet] = []
    for visit, group in sorted(by_visit.items()):
        by_frame: dict[str, list[DotPoint]] = {}
        for p in group:
            by_frame.setdefault(p.dot.frame_id, []).append(p)
        frame_time = {fid: ps[0].t for fid, ps in by_frame.items()}
        fids = sorted(by_frame, key=lambda f: (frame_time[f], f))
        span = geo.visit_span_d.get(visit, 0.0)
        cap = r_big + rate_px * span
        seed_grids = {fid: Grid(ps, cap) for fid, ps in by_frame.items()}
        member_grids = {fid: Grid(ps, r_big) for fid, ps in by_frame.items()}
        # Heap entries: (-n, rms, first member, seed a, seed b, version). ``version`` is the
        # number of tracklets accepted when the entry was scored (-1: not scored yet, an
        # optimistic bound); an entry popped with the current version is accepted.
        heap: list[tuple[int, float, int, int, int, int]] = []
        for a in group:
            for fid in fids:
                if frame_time[fid] <= a.t:
                    continue
                for b in seed_grids[fid].near(a.x, a.y, cap):
                    reach = max(a.r_match, b.r_match) + rate_px * (b.t - a.t)
                    if math.hypot(b.x - a.x, b.y - a.y) <= reach:
                        heap.append((-len(fids), 0.0, -1, a.index, b.index, -1))
        lookup = {p.index: p for p in group}
        heapq.heapify(heap)
        used: set[int] = set()
        accepted = 0
        while heap:
            _neg_n, _rms, _first, a_i, b_i, version = heapq.heappop(heap)
            if a_i in used or b_i in used:
                continue
            mem = _members(lookup[a_i], lookup[b_i], fids, member_grids, frame_time, used)
            if version == accepted:
                used.update(m.index for m in mem)
                out.append(Tracklet(visit, tuple(mem), fit_line(mem)))
                accepted += 1
                continue
            if len(mem) < 2 or len({m.t for m in mem}) < 2:
                continue
            fit = fit_line(mem)
            if fit.rms > cfg.rms_max_px:
                continue
            heapq.heappush(heap, (-len(mem), round(fit.rms, 9), mem[0].index, a_i, b_i, accepted))
        for p in group:
            if p.index not in used:
                out.append(Tracklet(visit, (p,), fit_line([p])))
    out.sort(key=lambda t: t.first)
    return out


# --- stars and fixed --------------------------------------------------------------------------


@dataclass
class StarStep:
    lists: dict[int, StarList]  # visit -> star list
    missing: list[str] = field(default_factory=list)


def star_cones(frames: AreaFrames) -> dict[int, StarCone]:
    """One area cone per visit (A19.6 area mode, Q-403 (5)): the same key for every visit."""
    s = frames.spec
    return {
        c.visit: star_lib.area_cone(s.ra, s.dec, s.width_deg, s.height_deg, c.visit)
        for c in frames.coverage
    }


def star_lists(ctx: Context, cones: Mapping[int, StarCone], *, refresh: bool = False) -> StarStep:
    """The per-visit star lists through the cache (never raises; a failed catalogue is listed)."""
    out = StarStep({})
    for visit, cone in sorted(cones.items()):
        lst = star_lib.star_list(ctx, cone, refresh=refresh)
        out.lists[visit] = lst
        out.missing.extend(lst.missing_codes())
    out.missing.sort()
    return out


StarIds = Callable[[DotPoint], set[str]]


def star_matcher(
    pts: Sequence[DotPoint], lists: Mapping[int, StarList], geo: AreaGeometry
) -> StarIds:
    """Dot -> ids of the stars of its visit within ``max(r_match, r_px)`` at the dot time."""
    per_time: dict[tuple[int, float], tuple[Grid[StarPoint], float]] = {}
    times: dict[tuple[int, float], str] = {}
    for p in pts:
        times.setdefault((p.dot.visit, p.t), p.dot.time)
    for (visit, t), iso in sorted(times.items()):
        lst = lists.get(visit)
        if lst is None or not lst.stars:
            continue
        ra, dec = star_lib.positions_at(lst.stars, parse_utc(iso))
        xi, eta, ok = geo.box.project_many(ra, dec)
        near_box = (
            ok
            & np.isfinite(xi)
            & np.isfinite(eta)
            & (np.abs(xi) <= geo.box.half_w + STAR_BOX_PAD_DEG)
            & (np.abs(eta) <= geo.box.half_h + STAR_BOX_PAD_DEG)
        )
        sp = [
            StarPoint(
                f"{s.catalog}:{s.id}", float(xi[i]) / PIXEL_DEG, float(eta[i]) / PIXEL_DEG, s.r_px
            )
            for i, s in enumerate(lst.stars)
            if bool(near_box[i])
        ]
        r_max = max((s.r_px for s in sp), default=star_lib.MASK_R_MAX_PX)
        per_time[(visit, t)] = (Grid(sp, r_max), r_max)

    def ids(p: DotPoint) -> set[str]:
        got = per_time.get((p.dot.visit, p.t))
        if got is None:
            return set()
        grid, r_max = got
        return {
            s.sid
            for s in grid.near(p.x, p.y, max(p.r_match, r_max))
            if math.hypot(s.x - p.x, s.y - p.y) <= max(p.r_match, s.r_px)
        }

    return ids


def covered_by(coverage: Coverage, grid: CellGrid, box: AreaBox, ra: float, dec: float) -> bool:
    """True when the visit's kept coverage cells hold ``(ra, dec)`` (Q-400 (5): the mask, never
    the polygon alone)."""
    xi, eta, ok = box.project_many(np.array([ra]), np.array([dec]))
    if not bool(ok[0]):
        return False
    row, col, valid = grid.cell_of(xi, eta)
    return bool(valid[0]) and bool(coverage.mask[int(row[0]), int(col[0])])


@dataclass
class Labels:
    """The outcome of A17.3: a label per dot (by index), the tracklets (all of them, before the
    join drops star and fixed ones) and the counts."""

    points: list[DotPoint]
    label: dict[int, str]
    tracklets: list[Tracklet]
    missing: list[str]

    def count(self, which: str) -> int:
        return sum(1 for v in self.label.values() if v == which)


def label_dots(
    frames: AreaFrames,
    bodies: Mapping[str, bytes],
    per_frame: Sequence[FrameDots],
    lists: Mapping[int, StarList],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    star_missing: Sequence[str] = (),
    geo: AreaGeometry,
) -> Labels:
    """A17.3 on one area. ``geo`` is the run's ``area_geometry(frames, cfg)``, built once by the
    caller (issue #128 (2)); a ``geo`` built from other frames or settings raises ``ValueError``
    (``AreaGeometry.require``)."""
    geo.require(frames, cfg)
    pts = dot_points(per_frame, frames, geo, cfg)
    label: dict[int, str] = {}
    cover = covering_frames(frames, bodies, pts, cfg)
    bad = glitches(pts, cover, geo, cfg)
    for i in bad:
        label[i] = GLITCH
    clean = [p for p in pts if p.index not in bad]
    tracklets = build_tracklets(clean, geo, cfg)
    match = star_matcher(clean, lists, geo)
    artefact = set(cfg.artefact_flags)
    for tl in tracklets:
        common: set[str] | None = None
        for m in tl.members:
            got = match(m)
            common = got if common is None else common & got
            if not common:
                break
        if common:
            for m in tl.members:
                label[m.index] = STAR
        for m in tl.members:
            if artefact & set(m.dot.flags):
                label[m.index] = STAR
    box = geo.box
    cells = cell_grid(box, cfg.coverage_cell_arcsec)
    cover_of = {c.visit: c for c in frames.coverage}
    non_glitch = Grid(clean, max((p.r_match for p in clean), default=cfg.r_match_min_px))
    for p in clean:
        if p.index in label:
            continue
        for q in non_glitch.near(p.x, p.y, non_glitch.size):
            if q.dot.visit == p.dot.visit:
                continue
            other = cover_of.get(q.dot.visit)
            if other is None or not covered_by(other, cells, box, p.dot.ra, p.dot.dec):
                continue
            if math.hypot(q.x - p.x, q.y - p.y) <= max(p.r_match, q.r_match):
                label[p.index] = FIXED
                break
    for p in pts:
        label.setdefault(p.index, MOVER)
    return Labels(pts, label, tracklets, sorted(set(star_missing)))
