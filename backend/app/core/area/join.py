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
4. **Tracks:** mutual best (smallest residual) with ``best <= ambiguity_ratio * next``, ranked
   per direction: a middle visit's leg ranks its next-visit and its previous-visit partners
   separately, so chains of three or more visits form. Else a
   **possible**: ``ambiguous`` (a candidate passed), ``no_partner`` (a neighbour visit covers the
   reachable ring) or ``one_visit`` (none does). A possible without a partner that moves less than
   ``min_motion_px`` is dropped and counted as ``static_one_visit``.
5. **Track fit:** a track's ``v_AB`` is the least-squares straight line through its legs'
   positions (equal weights) and ``u`` the least-squares value over all its legs, clamped at 0
   (``chain_fit``); for two legs this is the pair test's own ``v_AB`` and ``u``. A chain fit
   that fails the pair test's limits (rate window, ``u <= 1/delta_min``, ``v_tol`` with the
   largest ``sigma_v`` of the chain's legs) is not served: the track keeps the ``v_AB`` of its
   first pair whose rate also lies in the chain's window, never that pair's ``u`` (fitted on two
   of the legs only), or no rate at all when no pair does. ``u`` is fitted only when every leg
   has ``w``. A 2-leg track is always fitted as a ``"chain"``.

Pure: ``w`` comes in as a mapping; ``spherex_w`` fetches it through the cache.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

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
from app.core.area.geometry import CellGrid, cell_grid
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
    geo.require(frames)
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


def chain_fit(
    legs: Sequence[Leg],
    w: Mapping[int, SkyVelocity],
    rate_min: float,
    rate_max: float,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> tuple[Vec, float | None] | None:
    """``(v_AB, u)`` of a track over all its legs (issue #128 (4)), or ``None`` when that fit fails
    the pair test's own limits. ``join`` then serves the ``v_AB`` of the first consecutive pair
    whose rate lies in the chain's window, with no ``u`` (a pair's ``u`` is fitted on two of the
    legs), or no rate at all when no pair does (``TrackFit``).

    ``v_AB`` is the slope of the least-squares line through the legs' positions at their
    ``t_ref``, equal weights, and must lie in ``[rate_min, rate_max]`` (the caller passes the
    window that every pair of the chain, and its whole span, allow). With ``w`` for every leg,
    ``u`` minimises ``sum |v_in_k - v_AB + w_k u|^2``, clamped at 0, as ``pair_fit`` does for
    two, and must pass ``u <= 1/delta_min`` and every leg's perpendicular residual ``<= v_tol``.
    ``v_tol = max(v_tol_min, v_tol_sigma * sigma_v)`` with the largest ``sigma_v`` of all the
    chain's legs (for two legs, the pair test's own ``v_tol``; for three or more it is looser
    than any single pair's). Unless every leg has ``w``, ``u`` is ``None`` (the rate-window
    fallback, as in ``pair_fit`` for a pair missing either visit's ``w``): a ``u`` fitted on a
    subset of the legs would mean something else than on the other tracks of the run. For two
    legs this is the pair test's own ``v_AB`` and ``u``, so a 2-leg track is always
    ``"chain"``."""
    if len(legs) < 2:
        raise ValueError("a track has two or more legs")
    if len(legs) == 2:
        a, b = legs  # the pair test's own expression, so a 2-visit track keeps its exact value
        dt = b.t - a.t
        v_ab = ((b.pos[0] - a.pos[0]) / dt, (b.pos[1] - a.pos[1]) / dt)
    else:
        tm = sum(lg.t for lg in legs) / len(legs)
        xm = sum(lg.pos[0] for lg in legs) / len(legs)
        ym = sum(lg.pos[1] for lg in legs) / len(legs)
        stt = sum((lg.t - tm) ** 2 for lg in legs)
        v_ab = (
            sum((lg.t - tm) * (lg.pos[0] - xm) for lg in legs) / stt,
            sum((lg.t - tm) * (lg.pos[1] - ym) for lg in legs) / stt,
        )
    if not rate_min <= math.hypot(*v_ab) <= rate_max:
        return None
    if any(lg.visit not in w for lg in legs):
        return v_ab, None  # rate window only, as pair_fit for a pair missing either visit's w
    with_w = [(lg, w[lg.visit]) for lg in legs]
    num = den = 0.0
    for lg, wx in with_w:
        num += wx.east * (v_ab[0] - lg.v[0]) + wx.north * (v_ab[1] - lg.v[1])
        den += wx.east**2 + wx.north**2
    u = max(0.0, num / den) if den > 0.0 else 0.0
    if u > 1.0 / cfg.delta_min_au:
        return None
    v_tol = max(cfg.v_tol_min_deg_day, cfg.v_tol_sigma * max(lg.sigma_v for lg in legs))
    for lg, wx in with_w:
        r = (lg.v[0] - v_ab[0] + wx.east * u, lg.v[1] - v_ab[1] + wx.north * u)
        if _perp(r, wx) > v_tol:
            return None
    return v_ab, u


# "chain": chain_fit over all legs. "pair": the chain fit failed the limits, so the v_AB of the
# first consecutive pair whose rate lies in the chain's own window, with u None (a pair's u is
# fitted on two of the legs). "none": no pair does either, so the track is served without a
# rate, PA or u (refused, not guessed): v_ab and u are None, and every reader must allow that.
TrackFit = Literal["chain", "pair", "none"]


@dataclass(frozen=True)
class JoinedTrack:
    """One entry of ``/tracks`` before the known check: a track (2 or more legs) or a possible
    (one leg)."""

    legs: tuple[Leg, ...]
    status: str  # track | possible
    reason: str | None  # ambiguous | no_partner | one_visit
    v_ab: Vec | None
    u: float | None
    # How a track's v_ab and u were fitted (``TrackFit``). Internal: the /tracks reply has no
    # field for it (Q-420 (5)). None for a possible.
    fit: TrackFit | None = None

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
    centres: Callable[[int], tuple[np.ndarray, np.ndarray]],
) -> bool:
    """True when a covered cell of ``visit`` lies in the ring the tracklet could reach.
    ``centres(visit)`` gives that visit's masked cell centres; ``join`` builds each one only when
    a possible first needs it, then reuses it (issue #128 (2))."""
    cov = coverage.get(visit)
    if cov is None or not cov.mask.any():
        return False
    dt = abs(geo.visit_mid_d[visit] - a.t)
    gx, gy = centres(visit)
    d = np.hypot(gx - a.pos[0], gy - a.pos[1])
    half_cell = grid.cell_deg * math.sqrt(0.5)
    return bool(np.any((d >= rate_min * dt - half_cell) & (d <= rate_max * dt + half_cell)))


Fit = tuple[Vec, float, float | None, float, bool]


@dataclass(frozen=True)
class Links:
    # (earlier leg, later leg) inside the rate window; ``join`` falls back to a chain's pair fit
    # when the whole-chain fit fails the limits (``chain_fit``)
    fits: dict[tuple[int, int], Fit]
    links: dict[int, int]  # earlier leg -> later leg (consecutive visits, mutual best)
    has_candidate: frozenset[int]  # legs with a passing pair in either direction


def link_legs(
    legs: Sequence[Leg],
    windows: Mapping[tuple[int, int], tuple[float, float]],
    w: Mapping[int, SkyVelocity],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> Links:
    """A17.4 steps 2 to 4 on legs: ``windows`` maps each consecutive visit pair to its
    ``(rate_min, rate_max)``. A leg of a middle visit has a forward list (partners in the next
    visit) and a backward list (partners in the previous one), so mutual best is decided per
    direction and chains of three or more visits form (PR #110 review)."""
    by_visit: dict[int, list[int]] = {}
    for i, lg in enumerate(legs):
        by_visit.setdefault(lg.visit, []).append(i)
    fits: dict[tuple[int, int], Fit] = {}
    fwd: dict[int, list[tuple[float, int]]] = {}
    bwd: dict[int, list[tuple[float, int]]] = {}
    for (v1, v2), (rate_min, rate_max) in sorted(windows.items()):
        for i in by_visit.get(v1, []):
            for j in by_visit.get(v2, []):
                got = pair_fit(legs[i], legs[j], w, rate_min, rate_max, cfg)
                if got is None:
                    continue
                fits[(i, j)] = got
                if got[4]:
                    fwd.setdefault(i, []).append((got[3], j))
                    bwd.setdefault(j, []).append((got[3], i))
    for cands in (*fwd.values(), *bwd.values()):
        cands.sort()

    def best(c: list[tuple[float, int]] | None) -> int | None:
        if not c:
            return None
        if len(c) > 1 and c[0][0] > cfg.ambiguity_ratio * c[1][0]:
            return None
        return c[0][1]

    links: dict[int, int] = {}
    for (i, j), f in sorted(fits.items()):
        if f[4] and best(fwd.get(i)) == j and best(bwd.get(j)) == i:
            links[i] = j
    return Links(fits, links, frozenset({*fwd, *bwd}))


def join(
    labels: Labels,
    frames: AreaFrames,
    geo: AreaGeometry,
    w: Mapping[int, SkyVelocity],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> Join:
    geo.require(frames, cfg)
    legs, static = _mover_legs(labels)
    visits = sorted(geo.visit_mid_d)
    coverage = {c.visit: c for c in frames.coverage}
    grid = cell_grid(geo.box, cfg.coverage_cell_arcsec)
    masked: dict[int, tuple[np.ndarray, np.ndarray]] = {}

    def centres(v: int) -> tuple[np.ndarray, np.ndarray]:
        if v not in masked:
            masked[v] = grid.masked_centres(coverage[v].mask)
        return masked[v]

    rates: dict[tuple[int, int], tuple[float, float]] = {}
    for v1, v2 in itertools.pairwise(visits):
        dt_v = geo.visit_mid_d[v2] - geo.visit_mid_d[v1]
        rates[(v1, v2)] = (cfg.r_match_min_px * PIXEL_DEG / dt_v, geo.rate_max_for(dt_v, cfg))
    linked = link_legs(legs, rates, w, cfg)
    fits, links = linked.fits, linked.links
    linked_to = set(links.values())
    out: list[JoinedTrack] = []
    for i in sorted(range(len(legs)), key=lambda k: legs[k].tracklet.first):
        if i in linked_to:
            continue  # part of a chain started earlier
        if i in links:
            chain = [i]
            while chain[-1] in links:
                chain.append(links[chain[-1]])
            members = tuple(legs[k] for k in chain)
            # The chain's rate must suit every pair's window and the whole span's.
            span = geo.visit_mid_d[members[-1].visit] - geo.visit_mid_d[members[0].visit]
            windows = [
                *(rates[(x.visit, y.visit)] for x, y in itertools.pairwise(members)),
                (cfg.r_match_min_px * PIXEL_DEG / span, geo.rate_max_for(span, cfg)),
            ]
            rmin, rmax = max(r[0] for r in windows), min(r[1] for r in windows)
            got = chain_fit(members, w, rmin, rmax, cfg)
            if got is not None:
                out.append(JoinedTrack(members, "track", None, got[0], got[1], "chain"))
                continue
            # The whole-chain fit fails the limits: the v_AB of the first pair whose own fit also
            # suits the chain's window (a pair can pass its window yet break the span's), never
            # its u, which is fitted on two of the legs. No such pair: no rate is served.
            pair = next(
                (f for f in (fits[k] for k in itertools.pairwise(chain)) if rmin <= f[1] <= rmax),
                None,
            )
            if pair is None:
                out.append(JoinedTrack(members, "track", None, None, None, "none"))
            else:
                out.append(JoinedTrack(members, "track", None, pair[0], None, "pair"))
            continue
        a = legs[i]
        if i in linked.has_candidate:
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
                covered = covered or _reachable(a, v, geo, coverage, grid, rmin, rmax, centres)
            reason = "no_partner" if covered else "one_visit"
            if a.tracklet.fit.span_px < cfg.min_motion_px:
                static += 1
                continue
        out.append(JoinedTrack((a,), "possible", reason, None, None))
    out.sort(key=lambda t: t.first)
    full_w = all(v in w for v in visits)
    return Join(out, static, "parallax" if full_w else "rate_window")
