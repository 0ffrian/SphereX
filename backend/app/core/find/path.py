"""The path of a moving object seen from SPHEREx: ``GET /v1/objects/{id}/path`` (A19.5, Q-141).

Issue #74, Q-141 option (b): the reply serves the ephemeris samples that the path search
(``moving.search_path``) already fetched and cached, every ``SX_MOVING_EPHEM_STEP_MIN`` minutes
over the target's windows, with the same cache keys (``horizons.range_key`` of
``moving.range_chunks``). It never asks Horizons itself:

- **Cache only.** Every range answer of a served span must be cached. When one is not, an
  online backend starts or joins the object's job (``FrameService.on_request``, Q-111), whose
  path search fetches it, and answers ``points: []`` and ``windows: []`` with ``path:deferred``
  (poll), keeping any other code found so far. Offline, that window is left out with
  ``path:not_cached``.
- **Verified bodies only.** Each range answer is read with ``cache.get``, which checks the body's
  SHA-256; a torn entry counts as not cached, so a request can never fall through to a live
  Horizons call. Only the chunks that overlap the span asked for are read.
- **Span.** ``start``/``end`` are clipped to the windows; more than ``SX_PATH_MAX_SPAN_DAYS`` in
  total is refused (400 ``path_span_too_long``). With one of them only, the open side reaches at
  most the cap from the given side. Without them: every window when the total is under the cap,
  else the first window (its first ``SX_PATH_MAX_SPAN_DAYS``).
- **Observer.** A time past the end of Horizons' SPHEREx ephemeris is clipped and listed as
  ``path:observer``; the path never falls back to the geocentre (A19.4).
- **Frame points.** The exact Horizons TLIST position at each frame midpoint, as the frame list
  holds it (``/frames``), inside the served span. The 3-sigma columns stay ``null``: the code
  asks Horizons for quantity 1 only (``QUANTITIES='1'``); quantity 36 is cut for the event.
  While the frame list is not final (cutouts or path-search calls still with the job), the
  frame points hold only the frames listed so far and ``path:frames_incomplete`` says so; poll.
- ``interp_error_arcsec``: the largest separation, over the frame points, between the linear
  interpolation of the samples (``moving.INTERP_FORMULA``) and the exact TLIST position: the
  marker's error between exposures, measured on this reply's own frames (A19.4, Q-185).

Nothing is stored: each request rebuilds the reply from the cached answers.
Not built (cut for the event, issue #74): the process-wide Horizons gate (A19.5 "JPL terms").
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.adapters import horizons
from app.cache.store import CacheEntry, Served, earliest_cached_at
from app.context import Context
from app.core.find import moving
from app.core.find.frames import FrameService, FramesResult, is_complete
from app.core.find.overlays import wrap_ra
from app.core.find.resolver import ResolvedObject, is_comet
from app.timefmt import iso_utc_z, parse_utc

DEFERRED = "path:deferred"
NOT_CACHED = "path:not_cached"
OBSERVER = "path:observer"
EPHEMERIS = "path:ephemeris"
WINDOW = "path:window"
FRAMES_INCOMPLETE = "path:frames_incomplete"
CODES = (DEFERRED, NOT_CACHED, OBSERVER, EPHEMERIS, WINDOW, FRAMES_INCOMPLETE)

# [verify] Q-62: Horizons' SPHEREx ephemeris (CENTER=500@-163182) ends on this day; no position
# seen from SPHEREx exists after it. The cached QR2 frames end on 2026-05-14 (A3.1).
SPHEREX_EPHEMERIS_END = datetime(2026, 12, 7, tzinfo=UTC)

INTERP_ERROR_FORMULA = (
    "interp_error_arcsec = the largest separation, over the frame points of this reply, between "
    "that interpolation at the frame midpoint and the exact Horizons TLIST position there"
)

Span = tuple[datetime, datetime]


class PathRangeError(ValueError):
    """``start``/``end`` cannot be served: ``code`` is the API error code (400)."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def assumption(step_min: int) -> str:
    return (
        f"{horizons.SPHEREX_BASIS}; samples every {step_min} min, linear between samples "
        "(a prediction, not a measurement)"
    )


def _days(span: Span) -> float:
    return (span[1] - span[0]).total_seconds() / 86400.0


def select_spans(
    windows: tuple[moving.Window, ...],
    start: datetime | None,
    end: datetime | None,
    cap_days: float,
) -> list[tuple[int, Span]]:
    """``(window index, span)`` to serve, each span inside its window, in time order. Raises
    ``PathRangeError`` for ``start > end`` or a clipped total over ``cap_days``."""
    cap = timedelta(days=cap_days)
    if start is None and end is None:
        if sum(_days(w) for w in windows) <= cap_days:
            return list(enumerate(windows))
        # ASSUMPTION (A19.5 names the first window only): a first window longer than the cap
        # (the release window of an object without `moving_windows`) is served for its first
        # `cap_days`; `windows` in the reply states the span actually served.
        first = windows[0]
        return [(0, (first[0], min(first[1], first[0] + cap)))]
    if start is not None and end is not None and start > end:
        raise PathRangeError("bad_request", "start is after end.")
    # One side given: the open side reaches at most the cap from it, so "from this time on" on
    # a long window is served rather than refused; the windows clip it further.
    if start is None:
        assert end is not None
        lo, hi = max(windows[0][0], end - cap), end
    elif end is None:
        lo, hi = start, min(windows[-1][1], start + cap)
    else:
        lo, hi = start, end
    out = [(i, (max(a, lo), min(b, hi))) for i, (a, b) in enumerate(windows) if a <= hi and b >= lo]
    total = sum(_days(s) for _, s in out)
    if total > cap_days:
        raise PathRangeError(
            "path_span_too_long",
            f"The span asked for covers {total:.1f} days of the windows; at most "
            f"{cap_days:g} days per request.",
        )
    return out


def _sep_arcsec(a: tuple[float, float], b: tuple[float, float]) -> float:
    return moving._sep_deg(moving._unit(*a), moving._unit(*b)) * 3600.0


def _inside(when: datetime, spans: list[Span]) -> bool:
    return any(a <= when <= b for a, b in spans)


def _overlaps(chunk: Span, span: Span) -> bool:
    return chunk[0] <= span[1] and chunk[1] >= span[0]


def _frames(frames: FrameService, obj: ResolvedObject) -> FramesResult:
    """The frame list: this process's last one when final, else a fresh read (the stored list,
    or a cache-only rebuild that hands the rest to the job), since a memoised partial list may
    be stale."""
    fr = frames.get_frames(obj, use_memo=True)
    return fr if is_complete(fr.missing) else frames.get_frames(obj)


def build_path(
    ctx: Context,
    frames: FrameService,
    obj: ResolvedObject,
    start: datetime | None = None,
    end: datetime | None = None,
) -> dict[str, Any]:
    """The ``/path`` reply for a moving object (``obj.moving`` is the caller's check). Raises
    ``PathRangeError`` for a range it cannot serve."""
    cfg = moving.MovingConfig.from_context(ctx, obj.spkid)
    chosen = select_spans(cfg.windows, start, end, ctx.settings.path_max_span_days)
    missing: set[str] = set()
    spans: list[tuple[int, Span]] = []
    for i, (a, b) in chosen:
        if b > SPHEREX_EPHEMERIS_END:
            missing.add(OBSERVER)
            b = SPHEREX_EPHEMERIS_END
        if a < b:
            spans.append((i, (a, b)))
    if not spans and not missing:
        missing.add(WINDOW)

    comet = is_comet(ctx, obj)
    plan = moving.range_chunks(cfg)
    tracks: list[tuple[Span, moving.Track]] = []
    served: list[Served] = []
    deferred = False
    if obj.spkid:
        for i, span in spans:
            keys = [
                horizons.range_key(obj.spkid, a, b, cfg.ephem_step_min, comet=comet)
                for a, b in plan[i]
                if _overlaps((a, b), span)
            ]
            got: list[CacheEntry] = []
            absent = []
            for k in keys:
                e = ctx.cache.get(k)  # body verified; a miss here is never a live call
                if e is None:
                    absent.append(k)
                else:
                    got.append(e)
            if absent:
                if ctx.cache.offline:
                    missing.add(NOT_CACHED)
                elif any(frames.recently_failed(k.digest) for k in absent):
                    missing.add(EPHEMERIS)  # the job's live try failed moments ago
                else:
                    deferred = True
                continue
            points: list[horizons.EphemPoint] = []
            try:
                for e in got:
                    points.extend(horizons.range_points(e.body))
            except ValueError:
                missing.add(EPHEMERIS)  # a cached answer with no ephemeris block
                continue
            track = moving.Track(points)
            if len(track) < 2:
                missing.add(EPHEMERIS)
                continue
            tracks.append((span, track))
            served.extend(Served(e, from_cache=True) for e in got)
    elif spans:
        missing.add(EPHEMERIS)  # no SPK id: Horizons cannot be asked (as frames:ephemeris)

    if deferred:
        if frames.on_request is not None:
            frames.on_request(obj)
        # Nothing is served until every span is in; the codes found so far are kept.
        return _reply(obj, cfg, [], [], [], None, missing | {DEFERRED}, [])

    served_spans = [s for s, _ in tracks]
    points_out = [
        {"time": iso_utc_z(t), "ra": wrap_ra(ra, 7), "dec": round(dec, 7)}
        for (a, b), tr in tracks
        for t, ra, dec in tr.samples
        if a <= t <= b
    ]
    frame_points: list[dict[str, Any]] = []
    worst: float | None = None
    if tracks:
        fr = _frames(frames, obj)
        if not is_complete(fr.missing):
            missing.add(FRAMES_INCOMPLETE)
        for f in fr.frames:
            when = parse_utc(f.time)
            if not _inside(when, served_spans):
                continue
            frame_points.append(
                {
                    "frame_id": f.frame_id,
                    "time": f.time,
                    "ra": wrap_ra(f.ra, 7),
                    "dec": round(f.dec, 7),
                    "ra_3sigma_arcsec": None,
                    "dec_3sigma_arcsec": None,
                }
            )
            at = moving.track_at([tr for _, tr in tracks], when)
            if at is not None:
                err = _sep_arcsec(at, (f.ra, f.dec))
                worst = err if worst is None else max(worst, err)
    return _reply(obj, cfg, served_spans, points_out, frame_points, worst, missing, served)


def _reply(
    obj: ResolvedObject,
    cfg: moving.MovingConfig,
    spans: list[Span],
    points: list[dict[str, Any]],
    frame_points: list[dict[str, Any]],
    worst: float | None,
    missing: set[str],
    served: list[Served],
) -> dict[str, Any]:
    cached = earliest_cached_at(served)
    fetched = max((s.entry.fetched_at for s in served), default=None)
    return {
        "id": obj.id,
        "observer": horizons.OBSERVER_SPHEREX,
        "step_min": cfg.ephem_step_min,
        "windows": [{"start": iso_utc_z(a), "end": iso_utc_z(b)} for a, b in spans],
        "points": points,
        "frame_points": frame_points,
        "tag": "model_dependent",
        "assumption": assumption(cfg.ephem_step_min),
        "formula": f"{moving.INTERP_FORMULA}; {INTERP_ERROR_FORMULA}",
        "interp_error_arcsec": None if worst is None else round(worst, 3),
        "missing": sorted(missing),
        "fetched_at": iso_utc_z(fetched) if fetched else None,
        "cached_at": iso_utc_z(cached) if cached else None,
    }
