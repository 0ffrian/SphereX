"""Stage 1 output: the frame list for one object (A4.1, D-16).

For each SPHEREx frame from the SIA search: the object's position at the frame time, a small
cutout centred there (through the cache), and from the cutout the pixel position, wavelength
and flags. Anything that cannot be computed is left out and named in ``missing``.

Issue #41: live cutout downloads run in one bounded pool shared by every object
(``SX_CUTOUT_CONCURRENCY`` at a time). Each frame's outcome is kept by its row, and the list is
assembled in row order afterwards, so the result is the same whatever order the downloads finish
in. When ``on_request`` is set (the API), a web request downloads nothing itself: it starts or
joins the object's background job and lists the cutouts still to come as deferred.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from app.adapters import irsa_cutout, irsa_sia
from app.adapters.irsa_sia import SiaRow
from app.cache.keys import CacheKey, norm_float
from app.cache.store import (
    CacheMissOffline,
    LiveResponse,
    Served,
    UpstreamUnavailable,
    earliest_cached_at,
)
from app.context import Context
from app.core.find import png, wcs
from app.core.find.propagate import propagate
from app.core.find.resolver import ResolvedObject
from app.core.find.version import DERIVATION_VERSION
from app.timefmt import iso_utc_z, mjd_to_utc, parse_utc

FRAMES_SOURCE = "derived.frames"
MOVING_REFUSAL = "frames:moving_object_search"
TRUNCATED = "frames:truncated"
DEFERRED = "cutouts:deferred"
MEMO_SIZE = 128
FAILED_SIZE = 4096

log = logging.getLogger("shift_spectrum")


def is_complete(missing: list[str]) -> bool:
    """True when more data could not change the list: the search was not truncated, no cutout
    failed and none was deferred. Geometric refusals (``outside_cutout``, ``wavelength``,
    ``cutout_stretch``) are deterministic for the cached data and do not count."""
    return not any(
        m == TRUNCATED or m.startswith("cutout:") or m.startswith(DEFERRED + ":") for m in missing
    )


@dataclass(frozen=True)
class FrameGeometry:
    x_fits0: float
    y_fits0: float
    x: float  # PNG as served
    y: float
    nx: int
    ny: int


@dataclass(frozen=True)
class FrameRecord:
    frame_id: str
    time: str  # ISO-8601 UTC with Z
    wavelength_um: float
    bandwidth_um: float
    x: float
    y: float
    x_fits0: float
    y_fits0: float
    width: int
    height: int
    ra: float
    dec: float
    flags: list[str]
    detector: int
    north_angle_deg: float
    mirrored: bool
    em_min_um: float
    em_max_um: float
    access_url: str
    t_min_mjd: float
    t_max_mjd: float

    def sia_row(self) -> SiaRow:
        return SiaRow(
            frame_id=self.frame_id,
            obs_id=self.frame_id.rsplit("_D", 1)[0],
            detector=self.detector,
            access_url=self.access_url,
            t_min_mjd=self.t_min_mjd,
            t_max_mjd=self.t_max_mjd,
            em_min_um=self.em_min_um,
            em_max_um=self.em_max_um,
        )


@dataclass
class FramesResult:
    object_id: str
    frames: list[FrameRecord]
    missing: list[str] = field(default_factory=list)
    cached_at: datetime | None = None
    has_proper_motion: bool = False


@dataclass(frozen=True)
class FrameEvent:
    """One frame of a list being built: ``record`` and ``served`` are None when it was refused.
    ``done`` of ``total`` SIA rows are finished (cached, live and refused together); deferred
    rows are not done."""

    frame_id: str
    record: FrameRecord | None
    served: Served | None
    done: int
    total: int


OnFrame = Callable[[FrameEvent], None]
BuiltFrame = tuple[FrameRecord | None, str, Served | None]


def frame_time(row: SiaRow) -> datetime:
    """The one time per frame: midpoint of the SIA exposure bounds (MJD, UTC like the FITS
    ``TIMESYS``). Used for the position, the cutout centre, ``x``/``y`` and ``time``."""
    return mjd_to_utc((row.t_min_mjd + row.t_max_mjd) / 2.0)


def has_proper_motion(obj: ResolvedObject) -> bool:
    return obj.pm_ra_mas_yr is not None and obj.pm_dec_mas_yr is not None


def position_at(obj: ResolvedObject, when: datetime) -> tuple[float, float]:
    return propagate(obj.ra, obj.dec, obj.pm_ra_mas_yr, obj.pm_dec_mas_yr, when)


def frame_geometry(hdul: Any, ra: float, dec: float) -> FrameGeometry:
    x0, y0 = wcs.object_pixel(hdul, ra, dec)
    ny, nx = np.asarray(hdul["IMAGE"].data).shape
    x, y = wcs.to_png_xy(x0, y0, ny)
    return FrameGeometry(x0, y0, x, y, int(nx), int(ny))


def frames_key(ctx: Context, object_id: str) -> CacheKey:
    """Derived frame list. Every setting that changes the result is part of the key."""
    s = ctx.settings
    return CacheKey.make(
        FRAMES_SOURCE,
        s.data_release,
        id=object_id,
        size_arcsec=norm_float(s.cutout_size_arcsec, 1),
        radius=norm_float(s.sia_radius_deg, 6),
        search_epoch=s.search_epoch,
        v=DERIVATION_VERSION,
    )


class FrameService:
    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        # Bounded LRU: object ids come from user input (coordinate ids).
        self._memo: OrderedDict[str, FramesResult] = OrderedDict()
        self._memo_lock = threading.Lock()
        # Cutouts whose live download failed recently (cache key digest -> monotonic time). They
        # are skipped for SX_LIVE_FAILURE_TTL_S so the live budget goes to frames not yet tried.
        self._failed: OrderedDict[str, float] = OrderedDict()
        self._failed_lock = threading.Lock()
        self._clock = time.monotonic
        # Issue #41: one download pool for every object, so the limit holds across jobs.
        self._pool: ThreadPoolExecutor | None = None
        self._pool_lock = threading.Lock()
        self._closed = False
        # Set by the API: called with the object when a capped (web) request finds cutouts still
        # to download. It starts or joins the object's background job; the request itself then
        # downloads nothing and lists them as deferred.
        self.on_request: Callable[[ResolvedObject], object] | None = None

    def _download_pool(self) -> ThreadPoolExecutor | None:
        n = self.ctx.settings.cutout_concurrency
        if n <= 1:
            return None  # one at a time, in the calling thread
        with self._pool_lock:
            if self._closed:
                raise UpstreamUnavailable("shutting down: no new cutout downloads")
            if self._pool is None:
                self._pool = ThreadPoolExecutor(max_workers=n, thread_name_prefix="sx-cutout")
            return self._pool

    def close(self) -> None:
        """Stop the download pool; queued downloads are dropped and no pool is started again,
        so a job still running at shutdown cannot queue new downloads that delay the exit."""
        with self._pool_lock:
            self._closed = True
            pool, self._pool = self._pool, None
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)

    def get_frames(
        self,
        obj: ResolvedObject,
        *,
        refresh: bool = False,
        rebuild: bool = False,
        use_memo: bool = False,
        unlimited_live: bool = False,
        live_cap: int | None = None,
        on_frame: OnFrame | None = None,
    ) -> FramesResult:
        """Frame list for one object.

        - ``refresh``: re-download the SIA answer and the cutouts (older entries kept on failure).
        - ``rebuild``: ignore a stored frame list and rebuild it from the cached sources.
        - ``use_memo``: reuse this process's last result (cutout requests).
        - ``unlimited_live``: no cap on live cutout downloads (the pre-fetch and the object job).
          A web request downloads at most ``SX_LIVE_CUTOUTS_PER_REQUEST`` cutouts and defers
          the rest; with ``on_request`` set it downloads none and starts the job instead.
        - ``live_cap``: download at most this many cutouts and defer the rest, without starting
          a job (the object job's first batch, issue #41).
        - ``on_frame``: called in this thread as each frame of a list being built is finished
          (not for a stored or memoised list). Its errors are logged, never raised.
        """
        if use_memo and not (refresh or rebuild):
            with self._memo_lock:
                memo = self._memo.get(obj.id)
                if memo is not None:
                    self._memo.move_to_end(obj.id)
            if memo is not None:
                return memo
        result = self._get_frames(
            obj,
            refresh=refresh,
            rebuild=rebuild,
            unlimited_live=unlimited_live,
            live_cap=live_cap,
            on_frame=on_frame,
        )
        with self._memo_lock:
            self._memo[obj.id] = result
            self._memo.move_to_end(obj.id)
            while len(self._memo) > MEMO_SIZE:
                self._memo.popitem(last=False)
        return result

    def _get_frames(
        self,
        obj: ResolvedObject,
        *,
        refresh: bool,
        rebuild: bool,
        unlimited_live: bool,
        live_cap: int | None = None,
        on_frame: OnFrame | None = None,
    ) -> FramesResult:
        s = self.ctx.settings
        has_pm = obj.pm_ra_mas_yr is not None and obj.pm_dec_mas_yr is not None
        key = frames_key(self.ctx, obj.id)
        if not (refresh or rebuild):
            entry = self.ctx.cache.get(key)
            if entry is not None:
                doc = json.loads(entry.body)
                cached = doc.get("sources_earliest_fetched_at")
                return FramesResult(
                    object_id=obj.id,
                    frames=[FrameRecord(**f) for f in doc["frames"]],
                    missing=list(doc["missing"]),
                    cached_at=parse_utc(cached) if cached else None,
                    has_proper_motion=has_pm,
                )
        if obj.moving:
            # Q-21: an ephemeris-driven SIA search is not built in M1. Refuse, never guess.
            return FramesResult(obj.id, [], [MOVING_REFUSAL], None, has_pm)

        search_ra, search_dec = position_at(obj, parse_utc(s.search_epoch))
        sia = irsa_sia.search(self.ctx, search_ra, search_dec, refresh=refresh)
        served: list[Served] = [sia.served]
        missing: list[str] = [TRUNCATED] if sia.truncated else []
        frames: list[FrameRecord] = []
        handoff = not unlimited_live and live_cap is None and self.on_request is not None
        live_budget: int | None
        if unlimited_live:
            live_budget = None
        elif live_cap is not None:
            live_budget = max(0, live_cap)
        elif handoff:
            live_budget = 0  # the object's job downloads; this request answers from the cache
        else:
            live_budget = max(0, s.live_cutouts_per_request)
        deferred = 0
        online = not self.ctx.cache.offline
        rows = sorted(sia.rows, key=lambda r: (r.t_min_mjd, r.frame_id))
        # Pass 1: decide per row. `skipped` rows get their code now; `todo` rows are built.
        skipped: dict[int, str] = {}
        todo: list[tuple[int, SiaRow, bool, str]] = []  # (row index, row, live, cutout digest)
        for i, row in enumerate(rows):
            ra, dec = position_at(obj, frame_time(row))
            ckey = irsa_cutout.key_for(self.ctx, row, ra, dec)
            needs_live = refresh or self.ctx.cache.get(ckey) is None
            if needs_live and online and live_budget is not None:
                if self._recently_failed(ckey.digest):
                    skipped[i] = f"cutout:{row.frame_id}"
                    continue
                if live_budget == 0:
                    deferred += 1
                    continue
                live_budget -= 1
            todo.append((i, row, needs_live and online, ckey.digest))
        # Pass 2: build. Live rows go to the shared pool first, cached rows are built here
        # meanwhile; each outcome is stored under its row index.
        built = self._build_all(
            obj, todo, refresh=refresh, on_frame=on_frame, total=len(rows), already=len(skipped)
        )
        # Pass 3: assemble in row order, so the result does not depend on finishing order.
        for i, row in enumerate(rows):
            if i in skipped:
                missing.append(skipped[i])
                continue
            if i not in built:
                continue  # deferred
            rec, why, srv = built[i]
            if srv is not None:
                served.append(srv)
            if rec is None:
                missing.append(f"{why}:{row.frame_id}")
            else:
                frames.append(rec)
        if deferred:
            missing.append(f"{DEFERRED}:{deferred}")
            if handoff and self.on_request is not None:
                self.on_request(obj)
        frames.sort(key=lambda f: (f.time, f.wavelength_um, f.frame_id))
        result = FramesResult(obj.id, frames, missing, earliest_cached_at(served), has_pm)
        if is_complete(missing):
            self._store(key, result, served)
        return result

    def _build_one(
        self, obj: ResolvedObject, row: SiaRow, live: bool, digest: str, refresh: bool
    ) -> BuiltFrame:
        rec, why, srv = self._build_frame(obj, row, refresh=refresh)
        if live and why == "cutout" and srv is None:
            self._mark_failed(digest)
        return rec, why, srv

    def _build_all(
        self,
        obj: ResolvedObject,
        todo: list[tuple[int, SiaRow, bool, str]],
        *,
        refresh: bool,
        on_frame: OnFrame | None,
        total: int,
        already: int = 0,
    ) -> dict[int, BuiltFrame]:
        """Build ``todo``. Events count ``done`` of ``total`` SIA rows; ``already`` rows were
        refused before building (recent failures), so deferred rows are the only ones left."""
        built: dict[int, BuiltFrame] = {}

        def landed(i: int, row: SiaRow, out: BuiltFrame) -> None:
            built[i] = out
            if on_frame is None:
                return
            try:
                on_frame(FrameEvent(row.frame_id, out[0], out[2], already + len(built), total))
            except Exception:  # a progress listener must never break the frame list
                log.exception("frame listener failed for %s", row.frame_id)

        pool = self._download_pool()
        if pool is None:
            for i, row, is_live, digest in todo:
                landed(i, row, self._build_one(obj, row, is_live, digest, refresh))
            return built
        # Live rows go to the shared pool, at most `cutout_concurrency` of this call's at a time,
        # so every object's work takes turns in the pool instead of queueing behind one large
        # object (issue #41). Results come back through done-callbacks, which also fire when
        # close() cancels a queued download, so this call can never wait for ever.
        live = [t for t in todo if t[2]]
        done_q: queue.Queue[tuple[int, SiaRow, Future[BuiltFrame]]] = queue.Queue()
        width = max(1, self.ctx.settings.cutout_concurrency)
        nxt = 0
        in_flight = 0

        def submit_next() -> bool:
            nonlocal nxt
            i, row, is_live, digest = live[nxt]
            nxt += 1
            try:
                fut = pool.submit(self._build_one, obj, row, is_live, digest, refresh)
            except RuntimeError:  # the pool was shut down: refuse this cutout
                landed(i, row, (None, "cutout", None))
                return False

            def back(f: Future[BuiltFrame], i: int = i, row: SiaRow = row) -> None:
                done_q.put((i, row, f))

            fut.add_done_callback(back)
            return True

        while nxt < len(live) and in_flight < width:
            in_flight += submit_next()
        for i, row, is_live, digest in todo:
            if not is_live:
                landed(i, row, self._build_one(obj, row, is_live, digest, refresh))
        while in_flight:
            i, row, fut = done_q.get()
            in_flight -= 1
            if fut.cancelled():
                landed(i, row, (None, "cutout", None))  # dropped at shutdown: not downloaded
            else:
                landed(i, row, fut.result())
            while nxt < len(live) and in_flight < width:
                in_flight += submit_next()
        return built

    def _recently_failed(self, digest: str) -> bool:
        ttl = self.ctx.settings.live_failure_ttl_s
        with self._failed_lock:
            when = self._failed.get(digest)
            if when is None:
                return False
            if self._clock() - when < ttl:
                return True
            del self._failed[digest]
            return False

    def _mark_failed(self, digest: str) -> None:
        with self._failed_lock:
            self._failed[digest] = self._clock()
            self._failed.move_to_end(digest)
            while len(self._failed) > FAILED_SIZE:
                self._failed.popitem(last=False)

    def _build_frame(
        self, obj: ResolvedObject, row: SiaRow, *, refresh: bool
    ) -> tuple[FrameRecord | None, str, Served | None]:
        when = frame_time(row)
        ra, dec = position_at(obj, when)
        try:
            srv = irsa_cutout.fetch_cutout(self.ctx, row, ra, dec, refresh=refresh)
        except (CacheMissOffline, UpstreamUnavailable):
            return None, "cutout", None
        try:
            hdul = wcs.open_fits(srv.entry.body)
        except (OSError, ValueError):
            return None, "cutout", srv
        with hdul:
            if "IMAGE" not in hdul:
                return None, "cutout", srv
            geo = frame_geometry(hdul, ra, dec)
            if not wcs.inside(geo.x, geo.y, geo.nx, geo.ny):
                return None, "outside_cutout", srv
            wave = wcs.wavelength_at(hdul, geo.x_fits0, geo.y_fits0)
            if wave is None:
                return None, "wavelength", srv
            if png.stretch(np.asarray(hdul["IMAGE"].data)) is None:
                return None, "cutout_stretch", srv
            flags = wcs.flags_at(hdul, geo.x_fits0, geo.y_fits0) or []
            angle, mirrored = wcs.north_angle(hdul, geo.x_fits0, geo.y_fits0)
        if obj.resolver == "simbad" and not has_proper_motion(obj):
            flags = [*flags, "no_proper_motion"]
        rec = FrameRecord(
            frame_id=row.frame_id,
            time=iso_utc_z(when),
            wavelength_um=round(wave[0], 6),
            bandwidth_um=round(wave[1], 6),
            x=round(geo.x, 3),
            y=round(geo.y, 3),
            x_fits0=round(geo.x_fits0, 3),
            y_fits0=round(geo.y_fits0, 3),
            width=geo.nx,
            height=geo.ny,
            ra=ra,  # full precision: it is also the cutout cache key centre
            dec=dec,
            flags=flags,
            detector=row.detector,
            north_angle_deg=angle,
            mirrored=mirrored,
            em_min_um=row.em_min_um,
            em_max_um=row.em_max_um,
            access_url=row.access_url,
            t_min_mjd=row.t_min_mjd,
            t_max_mjd=row.t_max_mjd,
        )
        return rec, "", srv

    def _store(self, key: CacheKey, result: FramesResult, served: list[Served]) -> None:
        earliest = min((s.entry.fetched_at for s in served), default=None)
        doc = {
            "frames": [asdict(f) for f in result.frames],
            "missing": result.missing,
            "sources_earliest_fetched_at": iso_utc_z(earliest) if earliest else None,
        }
        data = json.dumps(doc, sort_keys=True).encode("utf-8")
        self.ctx.cache.put(
            key, LiveResponse(data, "derived:frames", 200, "application/json"), if_changed=True
        )

    def find(self, obj: ResolvedObject, frame_id: str) -> FrameRecord | None:
        for f in self.get_frames(obj, use_memo=True).frames:
            if f.frame_id == frame_id:
                return f
        return None
