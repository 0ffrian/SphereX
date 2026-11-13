"""Frames for moving objects: an ephemeris-driven SIA search along the path (A4.1 step 2, Q-21).

One cone cannot find a body that moves, so (issue #26):

1. One Horizons ephemeris per search window (A3.4), seen from the SPHEREx spacecraft, through
   the cache (D-25). A target in ``targets.toml`` may list its own ``moving_windows`` (the spans
   where SPHEREx saw it), matched by its ``spkid`` so every spelling of the name gets the same
   windows; any other object uses the whole release window. Track on demand (issue #142,
   Q-468) narrows either to one window around a time, given by the caller (``track``); nothing
   is stored, so no other caller sees it. Each window is split into several requests when it
   would pass the Horizons line limit. Windows are never joined, so no position is ever
   interpolated across the gap between two of them.
2. A small SIA cone (radius R) at the ephemeris position along the path. The step between cones
   follows the ephemeris rate, ``dt <= R / rate`` (so a frame taken between two cones still
   overlaps one of them), clamped to ``[moving_min_step_h, moving_max_step_h]``. The answers are
   merged and deduplicated by ``frame_id``. The path is sampled every ``moving_ephem_step_min``
   minutes (10 by default), well inside the ~95 min SPHEREx orbit, so the parallax wobble of a
   near-Earth object is in the track and in the rate rather than aliased away.
3. A frame is a candidate when the object's interpolated position at the frame time (the SIA
   exposure midpoint) lies inside the frame's footprint (``s_region``), or within
   ``moving_footprint_margin_arcsec`` of its edge (the interpolation error).
4. The candidates' exact positions come from more Horizons calls: a SPHEREx-centred ``TLIST``
   of the frame midpoints, one per planned cone (the candidates whose midpoint is nearest that
   cone's time). The planned cone times follow from the path and the settings only, so a
   request's cache key does not depend on which other cones answered. A candidate is kept only
   when that exact position is inside the footprint. Stage 1 places the object pixel there
   (A4.1 step 3).

Downloads (Q-111): a web request answers from the cache only (``live=False``); every Horizons or
SIA call it would need is counted in ``frames:search_deferred:<n>`` and the caller starts the
object's job, which runs the search live. A call that failed live recently is not retried until
``SX_LIVE_FAILURE_TTL_S`` has passed (the caller's failure memo), so a permanent failure does not
restart the job on every request. Live cones are spaced by one process-wide pacer.

Nothing is dropped silently. Codes this module adds to ``missing``:

- ``frames:ephemeris``: no ephemeris for the path, or for one of its windows (no SPK id,
  Horizons unavailable, empty); the windows that did answer are still searched.
- ``frames:moving_window``: a configured window is shorter than one ephemeris step.
- ``frames:cone_cap:<n>``: the path needs more than ``moving_max_cones`` cones; the cap is
  spread evenly over the whole path and ``n`` cones were left out, so frames between the kept
  cones can be missed. Deterministic for the settings (in the key), so the list is stored.
- ``frames:cone_maxrec:<n>``: ``n`` cone answers hit MAXREC (deterministic for the cached
  answers, so the list is stored; a fixed object's own MAXREC code stays ``frames:truncated``).
- ``frames:sparse_path:<n>``: at ``n`` cones the rate asked for a step below the minimum, so
  the cones there are further apart than ``R / rate`` and a frame between them can be missed.
- ``frames:cone_failed:<n>``: ``n`` cones could not be fetched (not cached offline, or failed).
- ``frames:search_deferred:<n>``: ``n`` Horizons or SIA calls are left to the object's job.
- ``frames:outside_window:<n>``: ``n`` frames found by the cones have a midpoint outside the
  ephemeris windows, so the object's position there is unknown.
- ``no_footprint:<frame_id>``: the frame has no usable ``s_region``, so it could not be checked.
- ``ephemeris:<frame_id>``: the exact position at that frame time could not be fetched.

Every setting is a ``[verify]`` placeholder (A3.1).
"""

from __future__ import annotations

import bisect
import logging
import math
import threading
import time
import tomllib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Literal

from app.adapters import horizons, irsa_sia
from app.adapters.horizons import EphemPoint
from app.adapters.irsa_sia import SiaRow, frame_time
from app.cache.keys import CacheKey, norm_float
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.timefmt import iso_utc_z, parse_utc

log = logging.getLogger("shift_spectrum")

EPHEMERIS = "frames:ephemeris"
WINDOW = "frames:moving_window"
CONE_MAXREC = "frames:cone_maxrec"
CONE_CAP = "frames:cone_cap"
SPARSE_PATH = "frames:sparse_path"
CONE_FAILED = "frames:cone_failed"
SEARCH_DEFERRED = "frames:search_deferred"
OUTSIDE_WINDOW = "frames:outside_window"
NO_FOOTPRINT = "no_footprint"
FRAME_EPHEMERIS = "ephemeris"

# Codes that more data or a later run can change: a frame list with one of them is not stored.
# The cone cap, MAXREC (``frames:cone_maxrec``) and the sparse path are deterministic for the
# cached answers and the settings in the key, so they do not count (a retry gives the same list).
INCOMPLETE_PREFIXES = (
    EPHEMERIS,
    CONE_FAILED + ":",
    SEARCH_DEFERRED + ":",
    FRAME_EPHEMERIS + ":",
)

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

Window = tuple[datetime, datetime]

# Version of a moving object's stored frame record, in its frames key only (a fixed object's key
# is unchanged). 2: the record keeps the frame's ``s_region`` (issue #74), so a list stored
# before it is rebuilt from the cached answers rather than served without footprints.
RECORD_VERSION = "2"


# --- configuration -------------------------------------------------------------------------


@lru_cache(maxsize=8)
def _windows_in(path: str, mtime_ns: int) -> dict[str, tuple[Window, ...]]:
    """``moving_windows`` per ``spkid`` from ``targets.toml``. A target without an ``spkid`` or
    whose windows do not parse is logged and left out, so it uses the release window."""
    del mtime_ns  # part of the memo key only: an edited file is read again
    doc = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, tuple[Window, ...]] = {}
    for t in doc.get("target", []):
        raw = t.get("moving_windows")
        if not raw:
            continue
        spkid = str(t.get("spkid", "")).strip()
        try:
            if not spkid:
                raise ValueError("no spkid")
            wins = tuple(sorted((parse_utc(str(a)), parse_utc(str(b))) for a, b in raw))
        except (TypeError, ValueError):
            log.warning("targets.toml: ignoring bad moving_windows for %r", t.get("query"))
            continue
        out[spkid] = wins
    return out


def target_windows(ctx: Context, spkid: str | None) -> tuple[Window, ...] | None:
    """The target's own search windows, or ``None`` (use the release window)."""
    if not spkid:
        return None
    f = ctx.settings.targets_file
    try:
        mtime = f.stat().st_mtime_ns
    except OSError:
        return None
    return _windows_in(str(f), mtime).get(spkid.strip())


# --- Track on demand (issue #142, Q-468) -----------------------------------------------------
#
# Track for one object can be limited to a window around a given time (``POST
# /v1/objects/{id}/track`` and the ``around``/``days`` parameters of the Track readers) instead of
# the whole release. The window is a parameter of each call, never stored: a call without it
# (card builds, area hashes, the pre-fetch) gets the base windows, so no request changes what
# another caller reads. It is clipped to the base windows, and the clipped windows are part of
# the frames key (``MovingConfig.key_fields``), so each window has its own cache entries.

# Half-width of the window, in days: the ticket's +-3 days around the area visit (issue #142).
TRACK_WINDOW_DAYS = 3.0
# ASSUMPTION (PR #150 review): at least +-1 day, so a window always holds several SPHEREx visits
# of the sky around the object (a tiny window is refused, not served empty).
TRACK_WINDOW_MIN_DAYS = 1.0
# ASSUMPTION ("wider on request", bounded): at most +-15 days, so the whole window (30 days) stays
# under the /path span cap (SX_PATH_MAX_SPAN_DAYS, 31 days, A19.5) and one reply serves it.
TRACK_WINDOW_MAX_DAYS = 15.0


def clip_windows(base: tuple[Window, ...], asked: tuple[Window, ...]) -> tuple[Window, ...]:
    """The parts of ``asked`` inside ``base`` (each sorted, neither overlapping itself)."""
    out = [
        (max(a0, b0), min(a1, b1))
        for a0, a1 in asked
        for b0, b1 in base
        if max(a0, b0) < min(a1, b1)
    ]
    return tuple(sorted(out))


def base_windows(ctx: Context, spkid: str | None) -> tuple[Window, ...]:
    """The target's own ``moving_windows``, else the release window."""
    s = ctx.settings
    return target_windows(ctx, spkid) or (
        (parse_utc(s.moving_window_start), parse_utc(s.moving_window_end)),
    )


def track_window(around: datetime, days: float) -> Window:
    """``around`` +- ``days`` (the caller checks the bounds), truncated to whole milliseconds so
    equal requests give equal keys whatever sub-millisecond digits they carried. Raises
    ``OverflowError`` past year 1 or 9999."""
    half = timedelta(days=days)
    return _to_ms(around - half), _to_ms(around + half)


def _to_ms(t: datetime) -> datetime:
    return t.replace(microsecond=t.microsecond // 1000 * 1000)


def track_windows(ctx: Context, spkid: str | None, window: Window) -> tuple[Window, ...]:
    """The windows a Track search for ``window`` uses: ``window`` clipped to the base windows;
    empty when it misses all of them (the API refuses that as ``track_window_outside``)."""
    return clip_windows(base_windows(ctx, spkid), (window,))


def window_label(window: Window) -> str:
    """``<start>/<end>`` (ISO-8601 UTC, milliseconds): the job key part and the reply field."""
    return f"{iso_utc_z(window[0])}/{iso_utc_z(window[1])}"


@dataclass(frozen=True)
class MovingConfig:
    windows: tuple[Window, ...]
    ephem_step_min: int
    min_step_h: float
    max_step_h: float
    cone_radius_deg: float
    max_cones: int
    maxrec: int
    pace_s: float
    margin_arcsec: float

    @classmethod
    def from_context(
        cls, ctx: Context, spkid: str | None = None, track: Window | None = None
    ) -> MovingConfig:
        """The path-search settings. ``track``: Track on demand's window (Q-468), clipped to the
        base windows; ``None`` (every caller but the Track readers) keeps the base windows."""
        s = ctx.settings
        windows = base_windows(ctx, spkid)
        if track is not None:
            windows = track_windows(ctx, spkid, track)  # may be empty: search_path refuses it
        return cls(
            windows=windows,
            ephem_step_min=s.moving_ephem_step_min,
            min_step_h=min(s.moving_min_step_h, s.moving_max_step_h),
            max_step_h=s.moving_max_step_h,
            cone_radius_deg=s.moving_cone_radius_deg,
            max_cones=s.moving_max_cones,
            maxrec=s.moving_sia_maxrec,
            pace_s=s.moving_cone_pace_s,
            margin_arcsec=s.moving_footprint_margin_arcsec,
        )

    def key_fields(self) -> dict[str, str]:
        """Every setting that changes the frame list (for the derived frames cache key)."""
        return {
            "m_windows": ";".join(f"{a.isoformat()}/{b.isoformat()}" for a, b in self.windows),
            "m_ephem_step_min": str(self.ephem_step_min),
            "m_min_step_h": norm_float(self.min_step_h, 4),
            "m_max_step_h": norm_float(self.max_step_h, 4),
            "m_cone_radius": norm_float(self.cone_radius_deg, 6),
            "m_max_cones": str(self.max_cones),
            "m_maxrec": str(self.maxrec),
            "m_margin_arcsec": norm_float(self.margin_arcsec, 3),
            "m_center": horizons.OBSERVER_SPHEREX,
            "m_record": RECORD_VERSION,
        }


@dataclass
class PathSearch:
    rows: list[SiaRow]  # kept frames, sorted by (t_min, frame_id)
    positions: dict[str, tuple[float, float]]  # frame_id -> exact (ra, dec) at the midpoint
    missing: list[str] = field(default_factory=list)
    served: list[Served] = field(default_factory=list)
    cones: int = 0  # cones searched (cached or live)
    deferred: int = 0  # upstream calls left to the object's job


class Pacer:
    """Spaces live cones by ``pace_s`` across every search in the process (start to start), so
    parallel pre-fetch workers or jobs do not send cones side by side."""

    def __init__(
        self,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._sleep, self._clock = sleep, clock
        self._lock = threading.Lock()
        self._last: float | None = None

    def wait(self, pace_s: float) -> None:
        if pace_s <= 0:
            return
        with self._lock:
            if self._last is not None:
                gap = self._last + pace_s - self._clock()
                if gap > 0:
                    self._sleep(gap)
            self._last = self._clock()


PACER = Pacer()


@dataclass(frozen=True)
class Gate:
    """Download policy of one search: ``live`` (job, pre-fetch) or cache only (web request),
    plus the caller's memo of recent live failures, by cache key digest."""

    live: bool = True
    failed: Callable[[str], bool] = lambda _digest: False
    mark_failed: Callable[[str], None] = lambda _digest: None

    def decide(
        self, ctx: Context, key: CacheKey, refresh: bool
    ) -> Literal["cached", "live", "defer", "fail"]:
        """One metadata read. ``cached``: served from the cache (always offline, where a miss
        raises); ``live``: download it; ``defer``: leave it to the job; ``fail``: a live try
        failed recently, count it as failed without trying again."""
        if ctx.cache.offline or (not refresh and ctx.cache.get_meta(key) is not None):
            return "cached"
        if self.failed(key.digest):
            return "fail"
        return "live" if self.live else "defer"


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
    """The ephemeris of one window as a time-ordered list, interpolated between samples."""

    def __init__(self, points: list[EphemPoint]) -> None:
        by_time = {p.time.timestamp(): p for p in points}  # chunk joins repeat one sample
        pts = [by_time[t] for t in sorted(by_time)]
        self.times = [p.time.timestamp() for p in pts]
        self.vecs = [_unit(p.ra, p.dec) for p in pts]
        # The samples as Horizons gave them (issue #74: the /path reply serves these).
        self.samples = [(p.time, p.ra, p.dec) for p in pts]
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


def track_at(tracks: list[Track], when: datetime) -> tuple[float, float] | None:
    for tr in tracks:
        if tr.covers(when):
            return tr.at(when)
    return None


def _segment_distance(p: tuple[float, float], q: tuple[float, float]) -> float:
    """Distance from the origin to the segment p-q in the plane."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    n2 = dx * dx + dy * dy
    f = 0.0 if n2 == 0.0 else max(0.0, min(1.0, -(p[0] * dx + p[1] * dy) / n2))
    return math.hypot(p[0] + f * dx, p[1] + f * dy)


def inside_footprint(
    ra: float, dec: float, polygon: tuple[tuple[float, float], ...], margin_deg: float = 0.0
) -> bool:
    """Point in a spherical polygon with great-circle edges, or within ``margin_deg`` of an edge.

    Gnomonic projection about the point keeps great circles straight, so an even-odd ray cast
    from the origin in the tangent plane is exact, and the distance from the origin to an edge
    is tan(angle) to first order (fine for a margin of arcseconds). A vertex 90 degrees or more
    away cannot be projected; such a polygon is far larger than a SPHEREx frame, and the point is
    refused.
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
    if inside or margin_deg <= 0.0:
        return inside
    tol = math.tan(math.radians(margin_deg))
    return any(_segment_distance(pts[i], pts[(i + 1) % n]) <= tol for i in range(n))


# --- search --------------------------------------------------------------------------------


def range_chunks(cfg: MovingConfig) -> list[list[tuple[datetime, datetime]]]:
    """Per window, the Horizons requests: none passes ``horizons.MAX_LINES`` samples. Chunks
    of one window share their boundary sample, so its track has no gap."""
    span = timedelta(minutes=cfg.ephem_step_min * (horizons.MAX_LINES - 1))
    out: list[list[tuple[datetime, datetime]]] = []
    for start, stop in cfg.windows:
        chunks: list[tuple[datetime, datetime]] = []
        t = start
        while t < stop:
            end = min(stop, t + span)
            chunks.append((t, end))
            t = end
        out.append(chunks)
    return out


def cone_times(cfg: MovingConfig, track: Track) -> tuple[list[datetime], int]:
    """Cone epochs from the first ephemeris sample to the last, ``STEP_FORMULA`` apart, and the
    number of steps where the minimum step overrode ``R / rate`` (a sparse path).

    Horizons samples on its own grid, so the last sample can fall up to one ephemeris step before
    the window end; a cone there would need extrapolation, which is never done."""
    if len(track) < 2:
        return [], 0
    t = datetime.fromtimestamp(track.times[0], UTC)
    end = datetime.fromtimestamp(track.times[-1], UTC)
    max_step = timedelta(hours=cfg.max_step_h)
    out: list[datetime] = []
    sparse = 0
    while t <= end:
        out.append(t)
        rate = track.max_rate(t, t + max_step)
        hours = cfg.max_step_h if rate <= 0 else cfg.cone_radius_deg / rate
        if hours < cfg.min_step_h and t + timedelta(hours=cfg.min_step_h) <= end:
            sparse += 1
        t = t + timedelta(hours=min(cfg.max_step_h, max(cfg.min_step_h, hours)))
    return out, sparse


def spread(times: list[datetime], cap: int) -> list[datetime]:
    """At most ``cap`` of ``times``, evenly spaced over the whole list (first and last kept), so
    a capped search samples the whole path rather than only its start."""
    if len(times) <= cap:
        return times
    if cap <= 1:
        return times[:cap]
    n = len(times)
    picks = sorted({round(i * (n - 1) / (cap - 1)) for i in range(cap)})
    return [times[i] for i in picks]


def _ephemeris_tracks(
    ctx: Context, cfg: MovingConfig, spkid: str, refresh: bool, gate: Gate, comet: bool = False
) -> tuple[list[Track], list[Served], int, int]:
    """One track per window that answered, the served entries, the number of requests deferred
    to the job, and the number of windows with no usable ephemeris. A window is skipped (and
    counted) when one of its chunks fails; the other windows are still searched."""
    plan = [
        [
            (start, stop, horizons.range_key(spkid, start, stop, cfg.ephem_step_min, comet=comet))
            for start, stop in chunks
        ]
        for chunks in range_chunks(cfg)
    ]
    verdicts = [[gate.decide(ctx, key, refresh) for _, _, key in chunks] for chunks in plan]
    deferred = sum(v == "defer" for vs in verdicts for v in vs)
    if deferred:
        return [], [], deferred, 0
    tracks: list[Track] = []
    served: list[Served] = []
    bad = 0
    for chunks, vs in zip(plan, verdicts, strict=True):
        if "fail" in vs:
            bad += 1
            continue
        points: list[EphemPoint] = []
        window_served: list[Served] = []
        ok = True
        for (start, stop, key), verdict in zip(chunks, vs, strict=True):
            try:
                pts, srv = horizons.ephemeris_range(
                    ctx, spkid, start, stop, cfg.ephem_step_min, comet=comet, refresh=refresh
                )
            except (CacheMissOffline, UpstreamUnavailable, ValueError):
                if verdict == "live":
                    gate.mark_failed(key.digest)
                ok = False
                break
            points.extend(pts)
            window_served.append(srv)
        track = Track(points) if ok else None
        if track is None or len(track) < 2:
            bad += 1
            continue
        tracks.append(track)
        served.extend(window_served)
    return tracks, served, 0, bad


def exact_positions(
    ctx: Context,
    spkid: str,
    rows: list[SiaRow],
    *,
    comet: bool = False,
    refresh: bool = False,
    gate: Gate | None = None,
) -> tuple[dict[str, tuple[float, float]], list[str], list[Served], int]:
    """SPHEREx-centred Horizons position at each frame midpoint: one ``TLIST`` of the unique
    midpoints (sorted), ``TLIST_CHUNK`` per call. Detectors of one exposure share a midpoint. A
    chunk that fails or answers with the wrong rows refuses its frames; a chunk the gate defers
    leaves them out and is counted (the last value)."""
    gate = gate or Gate()
    by_time: dict[datetime, list[SiaRow]] = {}
    for r in rows:
        by_time.setdefault(frame_time(r), []).append(r)
    times = sorted(by_time)
    out: dict[str, tuple[float, float]] = {}
    missing: list[str] = []
    served: list[Served] = []
    deferred = 0
    for i in range(0, len(times), TLIST_CHUNK):
        chunk = times[i : i + TLIST_CHUNK]
        key = horizons.horizons_key(
            spkid, horizons.jd_list(chunk), comet=comet, center=horizons.OBSERVER_SPHEREX
        )
        verdict = gate.decide(ctx, key, refresh)
        if verdict == "defer":
            deferred += 1
            continue
        pts: list[EphemPoint] = []
        if verdict != "fail":
            try:
                pts, srv = horizons.ephemeris(
                    ctx,
                    spkid,
                    chunk,
                    comet=comet,
                    refresh=refresh,
                    center=horizons.OBSERVER_SPHEREX,
                )
                served.append(srv)
            except (CacheMissOffline, UpstreamUnavailable, ValueError):
                if verdict == "live":
                    gate.mark_failed(key.digest)
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
    return out, missing, served, deferred


def nearest_cone(times: list[datetime], when: datetime) -> int:
    """Index of the planned cone time nearest ``when`` (the earlier one on a tie)."""
    i = bisect.bisect_left(times, when)
    if i == 0:
        return 0
    if i == len(times):
        return len(times) - 1
    return i - 1 if when - times[i - 1] <= times[i] - when else i


def search_path(
    ctx: Context,
    spkid: str | None,
    *,
    comet: bool = False,
    cfg: MovingConfig | None = None,
    refresh: bool = False,
    gate: Gate | None = None,
    pacer: Pacer = PACER,
) -> PathSearch:
    """The path search. ``cfg`` is the configuration the caller keyed its result with (built
    from the settings and the target's windows when not given); ``gate`` sets what may be
    downloaded (default: everything, the pre-fetch and the job)."""
    gate = gate or Gate()
    cfg = cfg or MovingConfig.from_context(ctx, spkid)
    step = timedelta(minutes=cfg.ephem_step_min)
    if not cfg.windows or any(stop - start < step for start, stop in cfg.windows):
        return PathSearch([], {}, [WINDOW])
    if not spkid:
        return PathSearch([], {}, [EPHEMERIS])
    tracks, served, deferred, bad_windows = _ephemeris_tracks(ctx, cfg, spkid, refresh, gate, comet)
    if deferred:
        return PathSearch([], {}, [f"{SEARCH_DEFERRED}:{deferred}"], deferred=deferred)
    if not tracks:
        return PathSearch([], {}, [EPHEMERIS])

    missing: list[str] = []
    all_times: list[datetime] = []
    sparse = 0
    for tr in tracks:
        ts, sp = cone_times(cfg, tr)
        all_times.extend(ts)
        sparse += sp
    times = spread(all_times, cfg.max_cones)
    capped = len(all_times) - len(times)

    found: dict[str, SiaRow] = {}
    failed = searched = maxrec_hits = 0
    release = ctx.settings.data_release
    for t in times:
        pos = track_at(tracks, t)
        if pos is None:  # not reached: cone_times stays inside its track
            continue
        ra, dec = pos
        key = irsa_sia.sia_key(release, ra, dec, cfg.cone_radius_deg)
        verdict = gate.decide(ctx, key, refresh)
        if verdict == "defer":
            deferred += 1
            continue
        if verdict == "fail":
            failed += 1
            continue
        if verdict == "live":
            pacer.wait(cfg.pace_s)
        try:
            sia = irsa_sia.search(
                ctx, ra, dec, refresh=refresh, maxrec=cfg.maxrec, radius_deg=cfg.cone_radius_deg
            )
        except (CacheMissOffline, UpstreamUnavailable):
            if verdict == "live":
                gate.mark_failed(key.digest)
            failed += 1
            continue
        searched += 1
        served.append(sia.served)
        maxrec_hits += sia.truncated
        for row in sia.rows:
            found.setdefault(row.frame_id, row)

    margin_deg = cfg.margin_arcsec / 3600.0
    candidates: list[SiaRow] = []
    outside = 0
    for row in sorted(found.values(), key=lambda r: (r.t_min_mjd, r.frame_id)):
        at = track_at(tracks, frame_time(row))
        if at is None:
            outside += 1
            continue
        if not row.s_region:
            missing.append(f"{NO_FOOTPRINT}:{row.frame_id}")
            continue
        if inside_footprint(at[0], at[1], row.s_region, margin_deg):
            candidates.append(row)

    # One TLIST group per planned cone, by the nearest cone time: built in one pass, and the
    # grouping depends only on the planned times, never on which cones answered.
    groups: dict[int, list[SiaRow]] = {}
    for r in candidates:
        groups.setdefault(nearest_cone(times, frame_time(r)), []).append(r)
    positions: dict[str, tuple[float, float]] = {}
    for index in sorted(groups):
        exact, pos_missing, pos_served, pos_deferred = exact_positions(
            ctx, spkid, groups[index], comet=comet, refresh=refresh, gate=gate
        )
        positions.update(exact)
        served.extend(pos_served)
        missing.extend(pos_missing)
        deferred += pos_deferred
    # The final test uses the exact position: the margin only widened the candidate set.
    kept = [
        r
        for r in candidates
        if r.frame_id in positions
        and r.s_region
        and inside_footprint(*positions[r.frame_id], r.s_region)
    ]
    positions = {r.frame_id: positions[r.frame_id] for r in kept}

    head: list[str] = []
    if bad_windows:
        head.append(EPHEMERIS)
    if maxrec_hits:
        head.append(f"{CONE_MAXREC}:{maxrec_hits}")
    if capped:
        head.append(f"{CONE_CAP}:{capped}")
    if sparse:
        head.append(f"{SPARSE_PATH}:{sparse}")
    missing = head + missing
    if failed:
        missing.append(f"{CONE_FAILED}:{failed}")
    if deferred:
        missing.append(f"{SEARCH_DEFERRED}:{deferred}")
    if outside:
        missing.append(f"{OUTSIDE_WINDOW}:{outside}")
    return PathSearch(kept, positions, missing, served, searched, deferred)


def position_basis() -> str:
    """The stated assumption behind a moving object's per-frame position (``model_dependent``)."""
    return f"{horizons.SPHEREX_BASIS}, at the frame midpoint (a prediction, not a measurement)"
