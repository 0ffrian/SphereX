"""Stage 1 output: the frame list for one object (A4.1, D-16).

For each SPHEREx frame from the SIA search: the object's position at the frame time, a small
cutout centred there (through the cache), and from the cutout the pixel position, wavelength
and flags. Anything that cannot be computed is left out and named in ``missing``.
"""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
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
from app.core.find import moving, png, wcs
from app.core.find.propagate import propagate
from app.core.find.resolver import ResolvedObject
from app.core.find.version import DERIVATION_VERSION
from app.timefmt import iso_utc_z, mjd_to_utc, parse_utc

FRAMES_SOURCE = "derived.frames"
TRUNCATED = "frames:truncated"
DEFERRED = "cutouts:deferred"
# Moving-object path search (issue #26): codes that more data or another request can change.
INCOMPLETE_PREFIXES = (
    moving.EPHEMERIS,
    moving.CONE_FAILED + ":",
    moving.CONES_DEFERRED + ":",
    moving.FRAME_EPHEMERIS + ":",
)
MEMO_SIZE = 128
FAILED_SIZE = 4096


def is_complete(missing: list[str]) -> bool:
    """True when more data could not change the list: the search was not truncated, no cutout
    failed and none was deferred. Geometric refusals (``outside_cutout``, ``wavelength``,
    ``cutout_stretch``) are deterministic for the cached data and do not count."""
    return not any(
        m == TRUNCATED
        or m.startswith("cutout:")
        or m.startswith(DEFERRED + ":")
        or m.startswith(INCOMPLETE_PREFIXES)
        for m in missing
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


def frames_key(ctx: Context, object_id: str, *, is_moving: bool = False) -> CacheKey:
    """Derived frame list. Every setting that changes the result is part of the key. A moving
    object adds the path-search settings (issue #26); a fixed object's key is unchanged."""
    s = ctx.settings
    extra = moving.MovingConfig.from_context(ctx).key_fields() if is_moving else {}
    return CacheKey.make(
        FRAMES_SOURCE,
        s.data_release,
        id=object_id,
        size_arcsec=norm_float(s.cutout_size_arcsec, 1),
        radius=norm_float(s.sia_radius_deg, 6),
        search_epoch=s.search_epoch,
        v=DERIVATION_VERSION,
        **extra,
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

    def get_frames(
        self,
        obj: ResolvedObject,
        *,
        refresh: bool = False,
        rebuild: bool = False,
        use_memo: bool = False,
        unlimited_live: bool = False,
    ) -> FramesResult:
        """Frame list for one object.

        - ``refresh``: re-download the SIA answer and the cutouts (older entries kept on failure).
        - ``rebuild``: ignore a stored frame list and rebuild it from the cached sources.
        - ``use_memo``: reuse this process's last result (cutout requests).
        - ``unlimited_live``: no cap on live cutout downloads (the pre-fetch). A web request
          downloads at most ``SX_LIVE_CUTOUTS_PER_REQUEST`` cutouts; the rest are deferred.
        """
        if use_memo and not (refresh or rebuild):
            with self._memo_lock:
                memo = self._memo.get(obj.id)
                if memo is not None:
                    self._memo.move_to_end(obj.id)
            if memo is not None:
                return memo
        result = self._get_frames(
            obj, refresh=refresh, rebuild=rebuild, unlimited_live=unlimited_live
        )
        with self._memo_lock:
            self._memo[obj.id] = result
            self._memo.move_to_end(obj.id)
            while len(self._memo) > MEMO_SIZE:
                self._memo.popitem(last=False)
        return result

    def _get_frames(
        self, obj: ResolvedObject, *, refresh: bool, rebuild: bool, unlimited_live: bool
    ) -> FramesResult:
        s = self.ctx.settings
        has_pm = obj.pm_ra_mas_yr is not None and obj.pm_dec_mas_yr is not None
        key = frames_key(self.ctx, obj.id, is_moving=obj.moving)
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
        served: list[Served]
        missing: list[str]
        rows: list[SiaRow]
        if obj.moving:
            # Q-21, issue #26: ephemeris-driven cones along the path; the object position at each
            # frame time comes from the interpolated ephemeris, never from a guess.
            path = moving.search_path(
                self.ctx,
                obj.spkid,
                refresh=refresh,
                live_cones=None if unlimited_live else max(0, s.moving_live_cones_per_request),
            )
            served, missing, rows = list(path.served), list(path.missing), path.rows
            path_pos = path.positions

            def pos_of(row: SiaRow) -> tuple[float, float]:
                return path_pos[row.frame_id]
        else:
            search_ra, search_dec = position_at(obj, parse_utc(s.search_epoch))
            sia = irsa_sia.search(self.ctx, search_ra, search_dec, refresh=refresh)
            served, missing = [sia.served], ([TRUNCATED] if sia.truncated else [])
            rows = sorted(sia.rows, key=lambda r: (r.t_min_mjd, r.frame_id))

            def pos_of(row: SiaRow) -> tuple[float, float]:
                return position_at(obj, frame_time(row))

        frames: list[FrameRecord] = []
        live_budget = None if unlimited_live else max(0, s.live_cutouts_per_request)
        deferred = 0
        online = not self.ctx.cache.offline
        for row in rows:
            ra, dec = pos_of(row)
            ckey = irsa_cutout.key_for(self.ctx, row, ra, dec)
            needs_live = refresh or self.ctx.cache.get(ckey) is None
            if needs_live and online and live_budget is not None:
                if self._recently_failed(ckey.digest):
                    missing.append(f"cutout:{row.frame_id}")
                    continue
                if live_budget == 0:
                    deferred += 1
                    continue
                live_budget -= 1
            rec, why, srv = self._build_frame(obj, row, ra, dec, refresh=refresh)
            if needs_live and online and why == "cutout" and srv is None:
                self._mark_failed(ckey.digest)
            if srv is not None:
                served.append(srv)
            if rec is None:
                missing.append(f"{why}:{row.frame_id}")
            else:
                frames.append(rec)
        if deferred:
            missing.append(f"{DEFERRED}:{deferred}")
        frames.sort(key=lambda f: (f.time, f.wavelength_um, f.frame_id))
        result = FramesResult(obj.id, frames, missing, earliest_cached_at(served), has_pm)
        if is_complete(missing):
            self._store(key, result, served)
        return result

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
        self, obj: ResolvedObject, row: SiaRow, ra: float, dec: float, *, refresh: bool
    ) -> tuple[FrameRecord | None, str, Served | None]:
        """One frame at the object's position (ra, dec) at the frame time."""
        when = frame_time(row)
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
