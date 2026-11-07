"""Frames for moving objects: an ephemeris-driven SIA search along the path (A4.1 step 2, Q-21).

One cone cannot find a body that moves, so (issue #26):

1. One Horizons ephemeris over the data release window (A3.4), seen from the SPHEREx spacecraft,
   through the cache (D-25). Split into several requests when it would pass the Horizons line
   limit.
2. A small SIA cone (radius R) at the ephemeris position along the path. The step between cones
   follows the ephemeris rate, ``dt <= R / rate`` (so a frame taken between two cones still
   overlaps one of them), clamped to ``[moving_min_step_h, moving_max_step_h]``. The answers are
   merged and deduplicated by ``frame_id``.
3. A frame is kept only when the object's interpolated position at the frame time (the SIA
   exposure midpoint) lies inside the frame's footprint (``s_region``).
4. The kept frames' exact positions come from more Horizons calls: a SPHEREx-centred ``TLIST``
   of the frame midpoints, one per cone (the frames that cone found first), so each request's
   cache key depends only on that cone's answer and stays the same when the cone cap cuts the
   path short. Stage 1 places the object pixel there (A4.1 step 3).

Nothing is dropped silently: past the cone cap, or when a cone answer is cut off by MAXREC, the
result says ``frames:truncated``. Every setting is a ``[verify]`` placeholder (A3.1).

Codes this module adds to ``missing``:

- ``frames:ephemeris``: no ephemeris for the path (no SPK id, Horizons unavailable, empty).
- ``frames:moving_window``: the configured window is empty (end not after start).
- ``frames:truncated``: the cone cap was reached, or a cone answer hit MAXREC.
- ``frames:cone_failed:<n>``: ``n`` cones could not be fetched (not cached offline, or failed).
- ``cones:deferred:<n>``: ``n`` cones were not fetched live in this web request (live budget).
- ``frames:outside_window:<n>``: ``n`` frames found by the cones have a midpoint outside the
  ephemeris window, so the object's position there is unknown.
- ``footprint:<frame_id>``: the frame has no usable ``s_region``, so it could not be checked.
- ``ephemeris:<frame_id>``: the exact position at that frame time could not be fetched.
"""

from __future__ import annotations

import bisect
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.adapters import horizons, irsa_sia
from app.adapters.horizons import EphemPoint
from app.adapters.irsa_sia import SiaRow
from app.cache.keys import norm_float
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.timefmt import mjd_to_utc, parse_utc

EPHEMERIS = "frames:ephemeris"
WINDOW = "frames:moving_window"
TRUNCATED = "frames:truncated"
CONE_FAILED = "frames:cone_failed"
CONES_DEFERRED = "cones:deferred"
OUTSIDE_WINDOW = "frames:outside_window"
FOOTPRINT = "footprint"
FRAME_EPHEMERIS = "ephemeris"

# ASSUMPTION: unique frame midpoints per Horizons TLIST request (keeps the URL a few kB long).
TLIST_CHUNK = 100
# A TLIST answer row must be the requested time (JD sent to 6 decimals, about 0.09 s); a row for
# another time refuses the chunk rather than pairing a position with the wrong frame.
TLIST_TIME_TOLERANCE_S = 1.0

INTERP_FORMULA = (
    "linear interpolation of the unit vector between the two Horizons samples around the "
    "time, renormalised; ra, dec = atan2(y, x), asin(z)"
)
STEP_FORMULA = (
    "dt = clamp(R / rate_max, min_step, max_step), rate_max = the largest angular rate of the "
    "ephemeris over the next max_step, R = the cone radius"
)


@dataclass(frozen=True)
class MovingConfig:
    start: datetime
    stop: datetime
    ephem_step_min: int
    min_step_h: float
    max_step_h: float
    cone_radius_deg: float
    max_cones: int
    maxrec: int
    pace_s: float

    @classmethod
    def from_context(cls, ctx: Context) -> MovingConfig:
        s = ctx.settings
        return cls(
            start=parse_utc(s.moving_window_start),
            stop=parse_utc(s.moving_window_end),
            ephem_step_min=s.moving_ephem_step_min,
            min_step_h=min(s.moving_min_step_h, s.moving_max_step_h),
            max_step_h=s.moving_max_step_h,
            cone_radius_deg=s.moving_cone_radius_deg,
            max_cones=s.moving_max_cones,
            maxrec=s.moving_sia_maxrec,
            pace_s=s.moving_cone_pace_s,
        )

    def key_fields(self) -> dict[str, str]:
        """Every setting that changes the frame list (for the derived frames cache key)."""
        return {
            "m_start": self.start.isoformat(),
            "m_stop": self.stop.isoformat(),
            "m_ephem_step_min": str(self.ephem_step_min),
            "m_min_step_h": norm_float(self.min_step_h, 4),
            "m_max_step_h": norm_float(self.max_step_h, 4),
            "m_cone_radius": norm_float(self.cone_radius_deg, 6),
            "m_max_cones": str(self.max_cones),
            "m_maxrec": str(self.maxrec),
            "m_center": horizons.SPHEREX_CENTER,
        }


@dataclass
class PathSearch:
    rows: list[SiaRow]  # kept frames, sorted by (t_min, frame_id)
    positions: dict[str, tuple[float, float]]  # frame_id -> exact (ra, dec) at the midpoint
    missing: list[str] = field(default_factory=list)
    served: list[Served] = field(default_factory=list)
    cones: int = 0  # cones searched (cached or live)


# --- geometry ------------------------------------------------------------------------------


def _unit(ra: float, dec: float) -> tuple[float, float, float]:
    r, d = math.radians(ra), math.radians(dec)
    return math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d)


def _radec(x: float, y: float, z: float) -> tuple[float, float]:
    n = math.sqrt(x * x + y * y + z * z)
    ra = math.degrees(math.atan2(y, x)) % 360.0
    dec = math.degrees(math.asin(max(-1.0, min(1.0, z / n))))
    return ra, dec


def _sep_deg(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    dot = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    return math.degrees(math.acos(dot))


class Track:
    """The ephemeris as a time-ordered list, interpolated between samples."""

    def __init__(self, points: list[EphemPoint]) -> None:
        by_time = {p.time.timestamp(): p for p in points}  # chunk joins repeat one sample
        pts = [by_time[t] for t in sorted(by_time)]
        self.times = [p.time.timestamp() for p in pts]
        self.vecs = [_unit(p.ra, p.dec) for p in pts]
        # Angular rate of each segment, degrees per hour.
        self.rates = [
            _sep_deg(self.vecs[i], self.vecs[i + 1]) / ((self.times[i + 1] - self.times[i]) / 3600)
            for i in range(len(pts) - 1)
        ]

    def __len__(self) -> int:
        return len(self.times)

    def covers(self, when: datetime) -> bool:
        return bool(self.times) and self.times[0] <= when.timestamp() <= self.times[-1]

    def at(self, when: datetime) -> tuple[float, float] | None:
        """(ra, dec) at ``when``, or ``None`` outside the sampled span (never extrapolated)."""
        if not self.covers(when):
            return None
        t = when.timestamp()
        i = bisect.bisect_left(self.times, t)
        if self.times[i] == t:
            return _radec(*self.vecs[i])
        t0, t1 = self.times[i - 1], self.times[i]
        f = (t - t0) / (t1 - t0)
        a, b = self.vecs[i - 1], self.vecs[i]
        return _radec(*(a[k] + f * (b[k] - a[k]) for k in range(3)))

    def max_rate(self, t0: datetime, t1: datetime) -> float:
        """Largest segment rate (deg/h) of the segments that overlap ``[t0, t1]``."""
        if not self.rates:
            return 0.0
        lo = max(0, bisect.bisect_right(self.times, t0.timestamp()) - 1)
        hi = min(len(self.rates), bisect.bisect_left(self.times, t1.timestamp()) + 1)
        return max(self.rates[lo:hi], default=self.rates[min(lo, len(self.rates) - 1)])


def inside_footprint(ra: float, dec: float, polygon: tuple[tuple[float, float], ...]) -> bool:
    """Point in a spherical polygon with great-circle edges.

    Gnomonic projection about the point keeps great circles straight, so an even-odd ray cast
    from the origin in the tangent plane is exact. A vertex 90 degrees or more away cannot be
    projected; such a polygon is far larger than a SPHEREx frame, and the point is refused.
    """
    r0, d0 = math.radians(ra), math.radians(dec)
    sd0, cd0 = math.sin(d0), math.cos(d0)
    pts: list[tuple[float, float]] = []
    for vra, vdec in polygon:
        r, d = math.radians(vra), math.radians(vdec)
        cosc = sd0 * math.sin(d) + cd0 * math.cos(d) * math.cos(r - r0)
        if cosc <= 0.0:
            return False
        xi = math.cos(d) * math.sin(r - r0) / cosc
        eta = (cd0 * math.sin(d) - sd0 * math.cos(d) * math.cos(r - r0)) / cosc
        pts.append((xi, eta))
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > 0.0) != (y2 > 0.0):
            x_cross = x1 + (0.0 - y1) * (x2 - x1) / (y2 - y1)
            if x_cross > 0.0:
                inside = not inside
    return inside


# --- search --------------------------------------------------------------------------------


def frame_mid(row: SiaRow) -> datetime:
    """The one time per frame (A4.1): midpoint of the SIA exposure bounds."""
    return mjd_to_utc((row.t_min_mjd + row.t_max_mjd) / 2.0)


def range_chunks(cfg: MovingConfig) -> list[tuple[datetime, datetime]]:
    """Split the window so no Horizons request passes ``horizons.MAX_LINES`` samples. Chunks
    share their boundary sample, so the track has no gap."""
    span = timedelta(minutes=cfg.ephem_step_min * (horizons.MAX_LINES - 1))
    out: list[tuple[datetime, datetime]] = []
    t = cfg.start
    while t < cfg.stop:
        end = min(cfg.stop, t + span)
        out.append((t, end))
        t = end
    return out


def cone_times(cfg: MovingConfig, track: Track) -> list[datetime]:
    """Cone epochs from the first ephemeris sample to the last, ``STEP_FORMULA`` apart.

    Horizons samples on its own grid, so the last sample can fall up to one ephemeris step before
    the window end; a cone there would need extrapolation, which is never done."""
    if len(track) < 2:
        return []
    t = max(cfg.start, datetime.fromtimestamp(track.times[0], cfg.start.tzinfo))
    end = datetime.fromtimestamp(track.times[-1], cfg.start.tzinfo)
    max_step = timedelta(hours=cfg.max_step_h)
    out: list[datetime] = []
    while t <= end:
        out.append(t)
        rate = track.max_rate(t, t + max_step)
        hours = cfg.max_step_h if rate <= 0 else cfg.cone_radius_deg / rate
        t = t + timedelta(hours=min(cfg.max_step_h, max(cfg.min_step_h, hours)))
    return out


def _ephemeris_track(
    ctx: Context, cfg: MovingConfig, spkid: str, refresh: bool
) -> tuple[Track, list[Served]] | None:
    points: list[EphemPoint] = []
    served: list[Served] = []
    for start, stop in range_chunks(cfg):
        try:
            pts, srv = horizons.ephemeris_range(
                ctx, spkid, start, stop, cfg.ephem_step_min, refresh=refresh
            )
        except (CacheMissOffline, UpstreamUnavailable, ValueError):
            return None
        points.extend(pts)
        served.append(srv)
    track = Track(points)
    return (track, served) if len(track) >= 2 else None


def exact_positions(
    ctx: Context, spkid: str, rows: list[SiaRow], *, refresh: bool = False
) -> tuple[dict[str, tuple[float, float]], list[str], list[Served]]:
    """SPHEREx-centred Horizons position at each frame midpoint: one ``TLIST`` of the unique
    midpoints (sorted), ``TLIST_CHUNK`` per call. Detectors of one exposure share a midpoint. A
    chunk that fails or answers with the wrong number of rows refuses its frames."""
    by_time: dict[datetime, list[SiaRow]] = {}
    for r in rows:
        by_time.setdefault(frame_mid(r), []).append(r)
    times = sorted(by_time)
    out: dict[str, tuple[float, float]] = {}
    missing: list[str] = []
    served: list[Served] = []
    for i in range(0, len(times), TLIST_CHUNK):
        chunk = times[i : i + TLIST_CHUNK]
        pts: list[EphemPoint] = []
        try:
            pts, srv = horizons.ephemeris(
                ctx, spkid, chunk, refresh=refresh, center=horizons.SPHEREX_CENTER
            )
            served.append(srv)
        except (CacheMissOffline, UpstreamUnavailable, ValueError):
            pts = []
        if len(pts) != len(chunk) or any(
            abs((p.time - t).total_seconds()) > TLIST_TIME_TOLERANCE_S
            for t, p in zip(chunk, pts, strict=False)
        ):
            missing.extend(f"{FRAME_EPHEMERIS}:{r.frame_id}" for t in chunk for r in by_time[t])
            continue
        for t, p in zip(chunk, pts, strict=True):
            for r in by_time[t]:
                out[r.frame_id] = (p.ra, p.dec)
    return out, missing, served


def search_path(
    ctx: Context,
    spkid: str | None,
    *,
    refresh: bool = False,
    live_cones: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> PathSearch:
    """The path search. ``live_cones`` caps live SIA calls (``None`` = no cap, the pre-fetch);
    live calls are spaced by ``moving_cone_pace_s``. Cached cones cost no budget and no wait."""
    cfg = MovingConfig.from_context(ctx)
    if cfg.stop <= cfg.start:
        return PathSearch([], {}, [WINDOW])
    if not spkid:
        return PathSearch([], {}, [EPHEMERIS])
    got = _ephemeris_track(ctx, cfg, spkid, refresh)
    if got is None:
        return PathSearch([], {}, [EPHEMERIS])
    track, served = got

    missing: list[str] = []
    times = cone_times(cfg, track)
    truncated = len(times) > cfg.max_cones
    times = times[: cfg.max_cones]

    found: dict[str, SiaRow] = {}
    first_cone: dict[str, int] = {}  # frame_id -> index of the cone that found it first
    failed = deferred = searched = 0
    online = not ctx.cache.offline
    release = ctx.settings.data_release
    last_live: float | None = None
    for index, t in enumerate(times):
        pos = track.at(t)
        if pos is None:  # not reached: cone_times stays inside the track
            continue
        ra, dec = pos
        cached = ctx.cache.get_meta(irsa_sia.sia_key(release, ra, dec, cfg.cone_radius_deg))
        goes_live = online and (refresh or cached is None)
        if goes_live:
            if live_cones is not None and live_cones <= 0:
                deferred += 1
                continue
            if live_cones is not None:
                live_cones -= 1
            if last_live is not None and cfg.pace_s > 0:
                wait = last_live + cfg.pace_s - clock()
                if wait > 0:
                    sleep(wait)
        try:
            sia = irsa_sia.search(
                ctx, ra, dec, refresh=refresh, maxrec=cfg.maxrec, radius_deg=cfg.cone_radius_deg
            )
        except (CacheMissOffline, UpstreamUnavailable):
            failed += 1
            continue
        finally:
            if goes_live:
                last_live = clock()
        searched += 1
        served.append(sia.served)
        truncated = truncated or sia.truncated
        for row in sia.rows:
            if row.frame_id not in found:
                found[row.frame_id] = row
                first_cone[row.frame_id] = index

    candidates: list[SiaRow] = []
    outside = 0
    for row in sorted(found.values(), key=lambda r: (r.t_min_mjd, r.frame_id)):
        at = track.at(frame_mid(row))
        if at is None:
            outside += 1
            continue
        if not row.s_region:
            missing.append(f"{FOOTPRINT}:{row.frame_id}")
            continue
        if inside_footprint(at[0], at[1], row.s_region):
            candidates.append(row)

    positions: dict[str, tuple[float, float]] = {}
    for index in sorted({first_cone[r.frame_id] for r in candidates}):
        group = [r for r in candidates if first_cone[r.frame_id] == index]
        exact, pos_missing, pos_served = exact_positions(ctx, spkid, group, refresh=refresh)
        positions.update(exact)
        served.extend(pos_served)
        missing.extend(pos_missing)
    kept = [r for r in candidates if r.frame_id in positions]

    if truncated:
        missing.insert(0, TRUNCATED)
    if failed:
        missing.append(f"{CONE_FAILED}:{failed}")
    if deferred:
        missing.append(f"{CONES_DEFERRED}:{deferred}")
    if outside:
        missing.append(f"{OUTSIDE_WINDOW}:{outside}")
    return PathSearch(kept, positions, missing, served, searched)


def position_basis() -> str:
    """The stated assumption behind a moving object's per-frame position (``model_dependent``)."""
    return f"{horizons.SPHEREX_BASIS}, at the frame midpoint (a prediction, not a measurement)"
