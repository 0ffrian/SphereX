"""Area geometry on the gnomonic plane about the area centre (A17.1, Q-400 (1)).

The area box is the rectangle ``|xi| <= width/2``, ``|eta| <= height/2`` on the tangent plane at
``(ra, dec)``, north up, ``xi`` towards east (growing RA). Great circles are straight on this
plane, so a SPHEREx footprint (a convex quadrilateral with great-circle edges) is a straight-edged
polygon there and can be clipped exactly (Sutherland-Hodgman).

Plane coordinates are in degrees (tangent-plane units times 180/pi).
"""

from __future__ import annotations

import collections
import functools
import math
import threading
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from app.core.area.config import AreaSpec

Point = tuple[float, float]
FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class AreaBox:
    ra0: float
    dec0: float
    half_w: float  # deg on the plane, along xi
    half_h: float  # along eta

    @classmethod
    def of(cls, spec: AreaSpec) -> AreaBox:
        return cls(spec.ra, spec.dec, spec.width_deg / 2.0, spec.height_deg / 2.0)

    def project(self, ra: float, dec: float) -> Point | None:
        """``(xi, eta)`` in degrees, or ``None`` on the far hemisphere."""
        x, y, ok = self.project_many(np.array([ra]), np.array([dec]))
        return (float(x[0]), float(y[0])) if bool(ok[0]) else None

    def project_many(
        self, ra: NDArray[np.float64], dec: NDArray[np.float64]
    ) -> tuple[FloatArray, FloatArray, NDArray[np.bool_]]:
        r = np.radians(np.asarray(ra, dtype=np.float64))
        d = np.radians(np.asarray(dec, dtype=np.float64))
        r0, d0 = math.radians(self.ra0), math.radians(self.dec0)
        dr = r - r0
        cosc = math.sin(d0) * np.sin(d) + math.cos(d0) * np.cos(d) * np.cos(dr)
        ok = cosc > 1e-9
        safe = np.where(ok, cosc, 1.0)
        xi = np.cos(d) * np.sin(dr) / safe
        eta = (math.cos(d0) * np.sin(d) - math.sin(d0) * np.cos(d) * np.cos(dr)) / safe
        return np.degrees(xi), np.degrees(eta), np.asarray(ok, dtype=np.bool_)

    def deproject(self, xi: float, eta: float) -> Point:
        ra, dec = self.deproject_many(np.array([xi]), np.array([eta]))
        return float(ra[0]), float(dec[0])

    def deproject_many(
        self, xi: NDArray[np.float64], eta: NDArray[np.float64]
    ) -> tuple[FloatArray, FloatArray]:
        """Inverse gnomonic projection; RA in [0, 360)."""
        x = np.radians(np.asarray(xi, dtype=np.float64))
        y = np.radians(np.asarray(eta, dtype=np.float64))
        r0, d0 = math.radians(self.ra0), math.radians(self.dec0)
        rho = np.hypot(x, y)
        c = np.arctan(rho)
        sinc, cosc = np.sin(c), np.cos(c)
        with np.errstate(invalid="ignore", divide="ignore"):
            frac = np.where(rho > 0, y * sinc * math.cos(d0) / np.where(rho > 0, rho, 1.0), 0.0)
        dec = np.arcsin(cosc * math.sin(d0) + frac)
        ra = r0 + np.arctan2(x * sinc, rho * math.cos(d0) * cosc - y * math.sin(d0) * sinc)
        return np.degrees(ra) % 360.0, np.degrees(dec)

    def inside_many(self, xi: NDArray[np.float64], eta: NDArray[np.float64]) -> NDArray[np.bool_]:
        return np.asarray(
            (np.abs(xi) <= self.half_w) & (np.abs(eta) <= self.half_h), dtype=np.bool_
        )

    def project_polygon(self, polygon: Sequence[Point]) -> list[Point] | None:
        ra = np.array([p[0] for p in polygon], dtype=np.float64)
        dec = np.array([p[1] for p in polygon], dtype=np.float64)
        x, y, ok = self.project_many(ra, dec)
        if not bool(ok.all()):
            return None
        return [(float(a), float(b)) for a, b in zip(x, y, strict=True)]


def cone_grid(box: AreaBox, step_deg: float) -> list[Point]:
    """Cone centres (ra, dec): ``ceil(side / step)`` cells per side, cones at the cell centres,
    row by row from the lowest ``eta``, then by ``xi`` (A17.1; Eros box 5 x 3 = 15)."""
    nx = max(1, math.ceil(round(2.0 * box.half_w / step_deg, 9)))
    ny = max(1, math.ceil(round(2.0 * box.half_h / step_deg, 9)))
    xs = [-box.half_w + (i + 0.5) * 2.0 * box.half_w / nx for i in range(nx)]
    ys = [-box.half_h + (j + 0.5) * 2.0 * box.half_h / ny for j in range(ny)]
    pts = [(x, y) for y in ys for x in xs]
    ra, dec = box.deproject_many(np.array([p[0] for p in pts]), np.array([p[1] for p in pts]))
    return [(float(a), float(b)) for a, b in zip(ra, dec, strict=True)]


def clip_to_box(poly: Sequence[Point], half_w: float, half_h: float) -> list[Point]:
    """Sutherland-Hodgman clip of a polygon to ``|x| <= half_w``, ``|y| <= half_h``."""
    pts = list(poly)
    for axis, lim, sign in (
        (0, half_w, 1.0),
        (0, -half_w, -1.0),
        (1, half_h, 1.0),
        (1, -half_h, -1.0),
    ):
        if not pts:
            return []
        out: list[Point] = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia = sign * a[axis] <= sign * lim
            ib = sign * b[axis] <= sign * lim
            if ib:
                if not ia:
                    out.append(_cross(a, b, axis, lim))
                out.append(b)
            elif ia:
                out.append(_cross(a, b, axis, lim))
        pts = out
    return pts


def _cross(a: Point, b: Point, axis: int, lim: float) -> Point:
    t = (lim - a[axis]) / (b[axis] - a[axis])
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


def polygon_area(poly: Sequence[Point]) -> float:
    """Unsigned shoelace area."""
    n = len(poly)
    if n < 3:
        return 0.0
    s = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(n))
    return abs(s) / 2.0


def overlaps_box(box: AreaBox, polygon: Sequence[Point], eps_deg2: float) -> bool:
    """A footprint overlaps the area when its clipped area exceeds ``eps_deg2`` (a corner or an
    edge touch is no overlap)."""
    plane = box.project_polygon(polygon)
    if plane is None:
        return False
    return polygon_area(clip_to_box(plane, box.half_w, box.half_h)) > eps_deg2


def clipped_bbox(
    box: AreaBox, polygon: Sequence[Point]
) -> tuple[float, float, float, float] | None:
    """``(xmin, xmax, ymin, ymax)`` of the footprint clipped to the box, or ``None``."""
    plane = box.project_polygon(polygon)
    if plane is None:
        return None
    clipped = clip_to_box(plane, box.half_w, box.half_h)
    if len(clipped) < 3:
        return None
    xs = [p[0] for p in clipped]
    ys = [p[1] for p in clipped]
    return min(xs), max(xs), min(ys), max(ys)


def points_in_polygon(
    poly: Sequence[Point], x: NDArray[np.float64], y: NDArray[np.float64]
) -> NDArray[np.bool_]:
    """Even-odd ray cast, vectorised over the points."""
    inside = np.zeros(np.shape(x), dtype=np.bool_)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if y1 == y2:
            continue
        cond = (y1 > y) != (y2 > y)
        x_cross = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= cond & (x < x_cross)
    return inside


def edge_distance(
    poly: Sequence[Point], x: NDArray[np.float64], y: NDArray[np.float64]
) -> FloatArray:
    """Distance from each point to the nearest edge of the polygon."""
    best = np.full(np.shape(x), np.inf, dtype=np.float64)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = np.clip(((x - x1) * dx + (y - y1) * dy) / L2, 0.0, 1.0) if L2 > 0 else 0.0
        best = np.minimum(best, np.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def radec_inside(polygon: Sequence[Sequence[float]], ra: float, dec: float) -> bool:
    """Point in polygon on the (ra, dec) plane, RA unwrapped about the first vertex. The same
    rule as ``tests/area_consistency.inside`` (the served check), kept here so the pipeline drops
    exactly the dots that check would refuse (Q-400 (7))."""
    ref = polygon[0][0]

    def unwrap(a: float) -> float:
        return ref + (a - ref + 180.0) % 360.0 - 180.0

    pts = [(unwrap(p[0]), p[1]) for p in polygon]
    x, y = unwrap(ra), dec
    hit = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


# --- cell masks ----------------------------------------------------------------------------


@dataclass(frozen=True)
class CellGrid:
    """Square cells on the plane, centred on the box: ``nx`` columns along xi, ``ny`` rows along
    eta (row 0 lowest). A cell counts only when its centre is inside the box."""

    half_w: float
    half_h: float
    cell_deg: float
    nx: int
    ny: int

    @classmethod
    def of(cls, box: AreaBox, cell_arcsec: float) -> CellGrid:
        return cls.sized(box.half_w, box.half_h, cell_arcsec)

    @classmethod
    def sized(cls, half_w: float, half_h: float, cell_arcsec: float) -> CellGrid:
        """The grid depends only on the box's half sizes and the cell size, not its centre."""
        c = cell_arcsec / 3600.0
        nx = max(1, math.ceil(round(2.0 * half_w / c, 9)))
        ny = max(1, math.ceil(round(2.0 * half_h / c, 9)))
        return cls(half_w, half_h, c, nx, ny)

    @property
    def x0(self) -> float:
        return -self.nx * self.cell_deg / 2.0

    @property
    def y0(self) -> float:
        return -self.ny * self.cell_deg / 2.0

    def centres(self) -> tuple[FloatArray, FloatArray]:
        """Cell centres ``(gx, gy)``, shape ``(ny, nx)``, built once per grid. The arrays are
        shared by every caller of the cached grid (``cell_grid``), so they are read-only: an
        in-place update raises ``ValueError``; work on a copy (``gx - x0``, not ``gx -= x0``)."""
        return self._centres

    @functools.cached_property
    def _centres(self) -> tuple[FloatArray, FloatArray]:
        xs = self.x0 + (np.arange(self.nx, dtype=np.float64) + 0.5) * self.cell_deg
        ys = self.y0 + (np.arange(self.ny, dtype=np.float64) + 0.5) * self.cell_deg
        gx, gy = np.meshgrid(xs, ys)
        gx.flags.writeable = False
        gy.flags.writeable = False
        return gx, gy

    def masked_centres(self, mask: NDArray[np.bool_]) -> tuple[FloatArray, FloatArray]:
        """The centres of the cells ``mask`` keeps, flattened in row order."""
        gx, gy = self._centres
        return gx[mask], gy[mask]

    def cell_of(
        self, xi: NDArray[np.float64], eta: NDArray[np.float64]
    ) -> tuple[NDArray[np.int64], NDArray[np.int64], NDArray[np.bool_]]:
        """``(row, col, valid)`` of the cell holding each point."""
        col = np.floor((np.asarray(xi) - self.x0) / self.cell_deg).astype(np.int64)
        row = np.floor((np.asarray(eta) - self.y0) / self.cell_deg).astype(np.int64)
        ok = (col >= 0) & (col < self.nx) & (row >= 0) & (row < self.ny)
        return np.where(ok, row, 0), np.where(ok, col, 0), np.asarray(ok, dtype=np.bool_)

    def vertex(self, col: int, row: int) -> Point:
        return (self.x0 + col * self.cell_deg, self.y0 + row * self.cell_deg)


# Grids by (half_w, half_h, cell_arcsec), least recently used first, each with the lock that
# guards the first build of its centres. A 10 x 10 deg box at 30" holds about 23 MB of centres,
# so a few sizes at once (two areas served side by side) stay cached without growing unbounded.
_GRID_MAX = 4
_GRIDS: collections.OrderedDict[tuple[float, float, float], tuple[CellGrid, threading.Lock]] = (
    collections.OrderedDict()
)
_GRID_LOCK = threading.Lock()  # guards _GRIDS only; never held while centres are built


def cell_grid(box: AreaBox, cell_arcsec: float) -> CellGrid:
    """``CellGrid.of`` built once per box size and cell size, so every step of a run shares one
    grid and its centres (issue #128 (2)). The key is the box's half sizes, not its centre (the
    plane is centred on the box), so two areas of the same size share one grid. The latest
    ``_GRID_MAX`` sizes are kept, so areas of different sizes run in turn or at once do not
    evict each other. The global lock covers only the lookup; each grid's own lock makes its
    centres build once, so a large grid being built never holds up a run on another size."""
    key = (box.half_w, box.half_h, cell_arcsec)
    with _GRID_LOCK:
        got = _GRIDS.get(key)
        if got is None:
            got = (CellGrid.sized(*key), threading.Lock())
            _GRIDS[key] = got
            while len(_GRIDS) > _GRID_MAX:
                _GRIDS.popitem(last=False)
        else:
            _GRIDS.move_to_end(key)
    grid, build = got
    with build:
        grid.centres()
    return grid


def label_pieces(mask: NDArray[np.bool_]) -> tuple[NDArray[np.int64], int]:
    """4-connected labels (1..n) in order of each piece's lowest cell index (row-major)."""
    ny, nx = mask.shape
    labels = np.zeros((ny, nx), dtype=np.int64)
    n = 0
    flat = mask.ravel()
    for start in np.flatnonzero(flat):
        r0, c0 = divmod(int(start), nx)
        if labels[r0, c0]:
            continue
        n += 1
        labels[r0, c0] = n
        stack = [(r0, c0)]
        while stack:
            r, c = stack.pop()
            for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= rr < ny and 0 <= cc < nx and mask[rr, cc] and not labels[rr, cc]:
                    labels[rr, cc] = n
                    stack.append((rr, cc))
    return labels, n


def largest_piece(mask: NDArray[np.bool_]) -> tuple[NDArray[np.bool_], int]:
    """The largest 4-connected piece (ties: the piece with the lowest cell index) and the number
    of pieces (Q-400 (5): never abort on several pieces)."""
    labels, n = label_pieces(mask)
    if n == 0:
        return np.zeros_like(mask, dtype=np.bool_), 0
    sizes = np.bincount(labels.ravel(), minlength=n + 1)[1:]
    best = int(np.argmax(sizes)) + 1  # argmax takes the first maximum = lowest label
    return np.asarray(labels == best, dtype=np.bool_), n


def count_holes(piece: NDArray[np.bool_]) -> int:
    """Uncovered 4-connected regions enclosed by the piece (not touching the grid border)."""
    padded = np.pad(~piece, 1, constant_values=True)
    _, n = label_pieces(padded)
    return max(0, n - 1)


def outline(piece: NDArray[np.bool_]) -> list[tuple[int, int]]:
    """Outer boundary of a piece as cell-corner vertices ``(col, row)``, counter-clockwise,
    collinear vertices removed. At a corner where two cells touch diagonally the trace turns
    right (towards the outside), so the polygon holds the piece and its holes and is at most
    weakly simple; even-odd ray casting then gives exactly ``fill_holes(piece)`` at cell centres
    (tested)."""
    ny, nx = piece.shape
    if not piece.any():
        return []

    def on(r: int, c: int) -> bool:
        return 0 <= r < ny and 0 <= c < nx and bool(piece[r, c])

    out: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for r, c in zip(*np.nonzero(piece), strict=True):
        r, c = int(r), int(c)
        if not on(r - 1, c):
            out.setdefault((c, r), []).append((c + 1, r))
        if not on(r, c + 1):
            out.setdefault((c + 1, r), []).append((c + 1, r + 1))
        if not on(r + 1, c):
            out.setdefault((c + 1, r + 1), []).append((c, r + 1))
        if not on(r, c - 1):
            out.setdefault((c, r + 1), []).append((c, r))

    loops: list[list[tuple[int, int]]] = []
    while out:
        start = min(out)
        loop = [start]
        prev = start
        cur = _take(out, start, None)
        while cur != start:
            loop.append(cur)
            nxt = _take(out, cur, (cur[0] - prev[0], cur[1] - prev[1]))
            prev, cur = cur, nxt
        loops.append(loop)
    outer = max(loops, key=_signed_area)
    return _drop_collinear(outer)


def _take(
    out: dict[tuple[int, int], list[tuple[int, int]]],
    at: tuple[int, int],
    heading: tuple[int, int] | None,
) -> tuple[int, int]:
    cands = out[at]
    if heading is None or len(cands) == 1:
        nxt = cands[0]
    else:
        hx, hy = heading

        def turn(v: tuple[int, int]) -> int:
            dx, dy = v[0] - at[0], v[1] - at[1]
            cross = hx * dy - hy * dx  # > 0: left turn
            return 0 if cross < 0 else (1 if cross == 0 else 2)  # right first

        nxt = min(cands, key=turn)
    cands.remove(nxt)
    if not cands:
        del out[at]
    return nxt


def _signed_area(loop: list[tuple[int, int]]) -> float:
    n = len(loop)
    return sum(loop[i - 1][0] * loop[i][1] - loop[i][0] * loop[i - 1][1] for i in range(n)) / 2.0


def _drop_collinear(loop: list[tuple[int, int]]) -> list[tuple[int, int]]:
    n = len(loop)
    keep = []
    for i in range(n):
        a, b, c = loop[i - 1], loop[i], loop[(i + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            keep.append(b)
    return keep


def fill_holes(piece: NDArray[np.bool_]) -> NDArray[np.bool_]:
    """The piece plus every uncovered region it encloses (4-connected background)."""
    padded = np.pad(~piece, 1, constant_values=True)
    labels, _ = label_pieces(padded)
    outside = labels == labels[0, 0]
    return np.asarray(~outside[1:-1, 1:-1], dtype=np.bool_)
