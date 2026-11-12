"""A17.4 (P5): join movers-to-be across visits with the parallax-aware pair test (Q-179).

1. **Tracklets** are the star step's (A17.3), without their ``star``, ``fixed`` and ``glitch``
   dots (refitted when a dot was dropped). A tracklet whose dots span one time has no velocity.
2. **Candidates:** for consecutive visits, every pair whose between-visit rate ``|v_AB|`` is in
   ``[rate_min, rate_max]``.
3. **Parallax-aware test:** ``v_in = v_AB - w u``; ``w`` is SPHEREx's velocity about the
   geocentre (Horizons VECTORS, one per visit) projected on the sky at the area centre, in deg/day
   per 1/au; ``u >= 0`` is fitted on both tracklets. The pair passes when the largest residual
   perpendicular to ``w`` is at most ``max(v_tol_min, v_tol_sigma * sigma_v)`` and
   ``u <= 1 / delta_min``. Without ``w`` (a failed or uncached vector) the test is the rate
   window only and the ranking uses ``|v_in - v_AB|`` (A17.4 fallback).
4. **Tracks:** mutual best (smallest residual) with ``best <= ambiguity_ratio * next``. Else a
   **possible**: ``ambiguous`` (a candidate passed), ``no_partner`` (a neighbour visit covers the
   reachable ring) or ``one_visit`` (none does). A possible without a partner that moves less than
   ``min_motion_px`` is dropped and counted as ``static_one_visit``.

Pure: ``w`` comes in as a mapping; ``spherex_w`` fetches it through the cache.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta

import numpy as np

from app.adapters import horizons
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.area.clean import (
    MOVER,
    PIXEL_DEG,
    AreaGeometry,
    Labels,
    Tracklet,
    fit_line,
)
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig
from app.core.area.geometry import CellGrid
from app.core.area.records import AreaFrames, Coverage

DEG_PER_RAD = 180.0 / math.pi
Vec = tuple[float, float]


@dataclass(frozen=True)
class SkyVelocity:
    """``w`` of one visit, east and north, in deg/day per 1/au (multiply by ``u``)."""

    east: float
    north: float


def project_velocity(v: tuple[float, float, float], ra: float, dec: float) -> SkyVelocity:
    """The tangential part of an ICRF velocity (au/day) at ``(ra, dec)``, east and north, as an
    angular rate per unit inverse distance (deg/day per 1/au)."""
    a, d = math.radians(ra), math.radians(dec)
    e = (-math.sin(a), math.cos(a), 0.0)
    n = (-math.sin(d) * math.cos(a), -math.sin(d) * math.sin(a), math.cos(d))
    we = sum(x * y for x, y in zip(v, e, strict=True))
    wn = sum(x * y for x, y in zip(v, n, strict=True))
    return SkyVelocity(we * DEG_PER_RAD, wn * DEG_PER_RAD)


def spherex_w(
    ctx: Context, frames: AreaFrames, geo: AreaGeometry, *, refresh: bool = False
) -> tuple[dict[int, SkyVelocity], list[Served]]:
    """One Horizons vector per visit at its mid-time (A17.4 step 3). A visit whose vector fails
    is absent; the join then falls back to the rate window for its pairs."""
    out: dict[int, SkyVelocity] = {}
    served: list[Served] = []
    for visit, mid in sorted(geo.visit_mid_d.items()):
        when = geo.t0 + timedelta(days=mid)
        try:
            v, srv = horizons.spherex_velocity(ctx, when, refresh=refresh)
        except (CacheMissOffline, UpstreamUnavailable, ValueError):
            continue
        served.append(srv)
        out[visit] = project_velocity(v, frames.spec.ra, frames.spec.dec)
    return out, served


@dataclass(frozen=True)
class Leg:
    """A tracklet ready for pairing: its velocity on the sky (deg/day) and its error."""

    tracklet: Tracklet
    v: Vec  # east, north, deg/day
    sigma_v: float  # deg/day
    pos: Vec  # deg on the area plane at t_ref
    t: float  # t_ref, days

    @property
    def visit(self) -> int:
        return self.tracklet.visit


def leg(tl: Tracklet) -> Leg:
    f = tl.fit
    return Leg(
        tl,
        (f.vx * PIXEL_DEG, f.vy * PIXEL_DEG),
        f.sigma_v * PIXEL_DEG,
        (f.x0 * PIXEL_DEG, f.y0 * PIXEL_DEG),
        f.t_ref,
    )


@dataclass(frozen=True)
class PairFit:
    a: int  # leg index
    b: int
    v_ab: Vec
    rate: float
    u: float | None  # None: no w (rate window only)
    residual: float
    passed: bool


def _perp(r: Vec, w: SkyVelocity) -> float:
    n = math.hypot(w.east, w.north)
    if n == 0.0:
        return math.hypot(*r)
    return abs(r[0] * w.north - r[1] * w.east) / n


def pair_fit(
    a: Leg,
    b: Leg,
    w: Mapping[int, SkyVelocity],
    rate_min: float,
    rate_max: float,
    cfg: AreaConfig,
) -> tuple[Vec, float, float | None, float, bool] | None:
    """``(v_AB, |v_AB|, u, residual, passed)``, or ``None`` outside the rate window."""
    dt = b.t - a.t
    if dt <= 0.0:
        return None
    v_ab = ((b.pos[0] - a.pos[0]) / dt, (b.pos[1] - a.pos[1]) / dt)
    rate = math.hypot(*v_ab)
    if not rate_min <= rate <= rate_max:
        return None
    wa, wb = w.get(a.visit), w.get(b.visit)
    if wa is None or wb is None:
        # A17.4 fallback: rate window only; rank by |v_in - v_AB|.
        res = max(math.hypot(x.v[0] - v_ab[0], x.v[1] - v_ab[1]) for x in (a, b))
        return v_ab, rate, None, res, True
    num = den = 0.0
    for x, wx in ((a, wa), (b, wb)):
        num += wx.east * (v_ab[0] - x.v[0]) + wx.north * (v_ab[1] - x.v[1])
        den += wx.east**2 + wx.north**2
    u = max(0.0, num / den) if den > 0.0 else 0.0
    res = 0.0
    for x, wx in ((a, wa), (b, wb)):
        r = (x.v[0] - v_ab[0] + wx.east * u, x.v[1] - v_ab[1] + wx.north * u)
        res = max(res, _perp(r, wx))
    v_tol = max(cfg.v_tol_min_deg_day, cfg.v_tol_sigma * max(a.sigma_v, b.sigma_v))
    passed = res <= v_tol and u <= 1.0 / cfg.delta_min_au
    return v_ab, rate, u, res, passed


@dataclass(frozen=True)
class JoinedTrack:
    """One entry of ``/tracks`` before the known check: a track (2 or more legs) or a possible
    (one leg)."""

    legs: tuple[Leg, ...]
    status: str  # track | possible
    reason: str | None  # ambiguous | no_partner | one_visit
    v_ab: Vec | None
    u: float | None

    @property
    def first(self) -> int:
        return min(m.index for lg in self.legs for m in lg.tracklet.members)


@dataclass
class Join:
    tracks: list[JoinedTrack]  # ordered by first dot (A17.4 ids T1...)
    n_static_one_visit: int
    pair_test: str  # parallax | rate_window (per area; a mix reports rate_window)


def _mover_legs(labels: Labels) -> tuple[list[Leg], int]:
    """Tracklets without their non-mover dots, refitted; one-time ones are static (counted)."""
    legs: list[Leg] = []
    static = 0
    for tl in labels.tracklets:
        members = tuple(m for m in tl.members if labels.label[m.index] == MOVER)
        if not members:
            continue
        if len({m.t for m in members}) < 2:
            static += 1
            continue
        kept = (
            tl
            if len(members) == len(tl.members)
            else Tracklet(tl.visit, members, fit_line(members))
        )
        legs.append(leg(kept))
    return legs, static


def _reachable(
    a: Leg,
    visit: int,
    geo: AreaGeometry,
    coverage: Mapping[int, Coverage],
    grid: CellGrid,
    rate_min: float,
    rate_max: float,
) -> bool:
    """True when a covered cell of ``visit`` lies in the ring the tracklet could reach."""
    cov = coverage.get(visit)
    if cov is None or not cov.mask.any():
        return False
    dt = abs(geo.visit_mid_d[visit] - a.t)
    gx, gy = grid.centres()
    d = np.hypot(gx - a.pos[0], gy - a.pos[1])[cov.mask]
    half_cell = grid.cell_deg * math.sqrt(0.5)
    return bool(np.any((d >= rate_min * dt - half_cell) & (d <= rate_max * dt + half_cell)))


def join(
    labels: Labels,
    frames: AreaFrames,
    geo: AreaGeometry,
    w: Mapping[int, SkyVelocity],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> Join:
    legs, static = _mover_legs(labels)
    visits = sorted(geo.visit_mid_d)
    coverage = {c.visit: c for c in frames.coverage}
    grid = CellGrid.of(geo.box, cfg.coverage_cell_arcsec)
    by_visit: dict[int, list[int]] = {}
    for i, lg in enumerate(legs):
        by_visit.setdefault(lg.visit, []).append(i)

    rates: dict[tuple[int, int], tuple[float, float]] = {}
    fits: dict[tuple[int, int], tuple[Vec, float, float | None, float, bool]] = {}
    passing: dict[int, list[tuple[float, int]]] = {i: [] for i in range(len(legs))}
    for v1, v2 in itertools.pairwise(visits):
        dt_v = geo.visit_mid_d[v2] - geo.visit_mid_d[v1]
        rate_min = cfg.r_match_min_px * PIXEL_DEG / dt_v
        rate_max = geo.rate_max_for(dt_v, cfg)
        rates[(v1, v2)] = (rate_min, rate_max)
        for i in by_visit.get(v1, []):
            for j in by_visit.get(v2, []):
                got = pair_fit(legs[i], legs[j], w, rate_min, rate_max, cfg)
                if got is None:
                    continue
                fits[(i, j)] = got
                if got[4]:
                    passing[i].append((got[3], j))
                    passing[j].append((got[3], i))
    for cands in passing.values():
        cands.sort()

    def best(i: int) -> int | None:
        c = passing[i]
        if not c:
            return None
        if len(c) > 1 and c[0][0] > cfg.ambiguity_ratio * c[1][0]:
            return None
        return c[0][1]

    links: dict[int, int] = {}  # earlier leg -> later leg (consecutive visits)
    for (i, j), f in sorted(fits.items()):
        if f[4] and best(i) == j and best(j) == i:
            links[i] = j
    linked_to = set(links.values())
    out: list[JoinedTrack] = []
    for i in sorted(range(len(legs)), key=lambda k: legs[k].tracklet.first):
        if i in linked_to:
            continue  # part of a chain started earlier
        if i in links:
            chain = [i]
            while chain[-1] in links:
                chain.append(links[chain[-1]])
            f = fits[(chain[0], chain[1])]
            out.append(JoinedTrack(tuple(legs[k] for k in chain), "track", None, f[0], f[2]))
            continue
        a = legs[i]
        if passing[i]:
            reason = "ambiguous"
        else:
            neighbours = [
                v
                for v in visits
                if v != a.visit and abs(visits.index(v) - visits.index(a.visit)) == 1
            ]
            covered = False
            for v in neighbours:
                key = (min(v, a.visit), max(v, a.visit))
                rmin, rmax = rates.get(key, (0.0, geo.rate_max_deg_day))
                covered = covered or _reachable(a, v, geo, coverage, grid, rmin, rmax)
            reason = "no_partner" if covered else "one_visit"
            if a.tracklet.fit.span_px < cfg.min_motion_px:
                static += 1
                continue
        out.append(JoinedTrack((a,), "possible", reason, None, None))
    out.sort(key=lambda t: t.first)
    full_w = all(v in w for v in visits)
    return Join(out, static, "parallax" if full_w else "rate_window")
