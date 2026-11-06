"""Catalogue overlays for one object (issue #12): Gaia and CatWISE markers, contamination of the
Stage 2 aperture, detector footprints and cutout boxes per frame.

- One cone per catalogue per object, centred on the SIA search position. Its radius covers every
  cutout: half the cutout diagonal + the largest offset of the object between the search
  position and any frame time + ``CONE_MARGIN_ARCSEC``, rounded up to a whole arcsecond.
- Each catalogue position is propagated from its own epoch to the frame time (``propagate``)
  and placed with the same WCS call and the same PNG flip as the frames reply ``x``, ``y``.
- Only cached cutouts are read (like Stage 2); a catalogue that cannot be served is refused and
  listed in ``missing``. Nothing is invented.
"""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import numpy as np

from app.adapters import gaia, irsa_cutout, irsa_sia, wise
from app.adapters.irsa_sia import SiaRow
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable, earliest_cached_at
from app.context import Context
from app.core.find import flagmask, wcs
from app.core.find.frames import FrameRecord, FrameService, frame_time, is_complete, position_at
from app.core.find.propagate import CATALOGUE_FORMULA, propagate_many
from app.core.find.resolver import ResolvedObject
from app.core.measure.config import DEFAULT_CONFIG, MeasureConfig
from app.timefmt import iso_utc_z, parse_utc

Catalog = Literal["gaia", "wise"]
CATALOGS: tuple[Catalog, ...] = ("gaia", "wise")

# ASSUMPTION: slack for field-star proper motions between the catalogue epoch and the frame time
# (30 arcsec = 3 arcsec/yr over 10 years) and for rounding. Not a physical value of any object.
CONE_MARGIN_ARCSEC = 30.0
# ASSUMPTION (Q-53): the catalogue source nearest the object, within this distance, is the
# target itself. It stays a marker but is left out of the contamination list.
TARGET_MATCH_PX = 2.0
MEMO_SIZE = 32

MARKER_FORMULA = (
    f"{CATALOGUE_FORMULA}; then astropy WCS world_to_pixel on the cutout IMAGE header, "
    "x = x_fits0, y = (height - 1) - y_fits0 (the frames reply convention); only sources with "
    "-0.5 <= x < width - 0.5 and -0.5 <= y < height - 0.5"
)
CUTOUT_BOX_FORMULA = (
    "astropy WCS pixel_to_world of the outer pixel corners of the cutout IMAGE, in PNG order "
    "top-left, top-right, bottom-right, bottom-left"
)


def contamination_formula(cfg: MeasureConfig) -> str:
    return (
        "sep_px = hypot(x_src - x, y_src - y) from the frame's object x, y; zone aperture if "
        f"sep_px <= {cfg.aperture_radius_px} px, annulus if {cfg.annulus_inner_px} <= sep_px <= "
        f"{cfg.annulus_outer_px} px (the Stage 2 method radii); the nearest source of each "
        f"catalogue within {TARGET_MATCH_PX} px of the object is taken as the target and left out"
    )


@dataclass(frozen=True)
class Cone:
    ra: float
    dec: float
    radius_deg: float
    rows: list[SiaRow]
    sia_served: Served


@dataclass(frozen=True)
class CatalogTable:
    """One catalogue's sources as arrays, in the catalogue's answer order (brightest first)."""

    catalog: Catalog
    ids: list[str]
    ra: np.ndarray
    dec: np.ndarray
    pmra: np.ndarray  # NaN when absent
    pmdec: np.ndarray
    epoch_jyear: np.ndarray
    mag: list[float | None]


@dataclass
class OverlaysResult:
    body: dict[str, Any]
    cached_at: datetime | None
    complete: bool = False
    served: list[Served] = field(default_factory=list)


def wrap_ra(ra: float, ndigits: int) -> float:
    """RA in degrees, rounded, in [0, 360). Rounding after ``% 360`` can give 360.0
    (``round(359.99999996, 7)``, or ``-1e-17 % 360.0``), and ``-0.0`` is folded to ``0.0``."""
    r = round(float(ra) % 360.0, ndigits)
    return 0.0 if r >= 360.0 or r == 0.0 else r


def angular_sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Haversine separation in arcsec."""
    p1, p2 = math.radians(dec1), math.radians(dec2)
    dp, dl = p2 - p1, math.radians(ra2 - ra1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h)))) * 3600.0


def cone_radius_arcsec(cutout_size_arcsec: float, max_offset_arcsec: float) -> float:
    half_diagonal = cutout_size_arcsec * math.sqrt(2.0) / 2.0
    return float(math.ceil(half_diagonal + max_offset_arcsec + CONE_MARGIN_ARCSEC))


def overlay_cone(ctx: Context, obj: ResolvedObject, *, refresh: bool = False) -> Cone:
    """The catalogue cone for an object (also used by the pre-fetch, so the keys match).

    Raises ``CacheMissOffline`` / ``UpstreamUnavailable`` when the SIA answer is unavailable."""
    s = ctx.settings
    ra_c, dec_c = position_at(obj, parse_utc(s.search_epoch))
    sia = irsa_sia.search(ctx, ra_c, dec_c, refresh=refresh)
    offset = 0.0
    for row in sia.rows:
        ra, dec = position_at(obj, frame_time(row))
        offset = max(offset, angular_sep_arcsec(ra_c, dec_c, ra, dec))
    radius = cone_radius_arcsec(s.cutout_size_arcsec, offset)
    return Cone(ra_c, dec_c, radius / 3600.0, sia.rows, sia.served)


def fetch_catalog(
    ctx: Context, catalog: Catalog, cone: Cone, *, refresh: bool = False
) -> tuple[CatalogTable, str, bool, Served]:
    """(table, table name, truncated, served). Raises ``CacheMissOffline``,
    ``UpstreamUnavailable`` or ``ValueError`` (unreadable cached body)."""
    if catalog == "gaia":
        g = gaia.cone(ctx, cone.ra, cone.dec, cone.radius_deg, refresh=refresh)
        tbl = CatalogTable(
            "gaia",
            [s.source_id for s in g.sources],
            np.array([s.ra for s in g.sources], dtype=np.float64),
            np.array([s.dec for s in g.sources], dtype=np.float64),
            _nan_array([s.pmra_mas_yr for s in g.sources]),
            _nan_array([s.pmdec_mas_yr for s in g.sources]),
            np.array([s.ref_epoch for s in g.sources], dtype=np.float64),
            [s.g_mag for s in g.sources],
        )
        return tbl, g.table, g.truncated, g.served
    w = wise.cone(ctx, cone.ra, cone.dec, cone.radius_deg, refresh=refresh)
    tbl = CatalogTable(
        "wise",
        [s.source_name for s in w.sources],
        np.array([s.ra for s in w.sources], dtype=np.float64),
        np.array([s.dec for s in w.sources], dtype=np.float64),
        _nan_array([s.pmra_mas_yr for s in w.sources]),
        _nan_array([s.pmdec_mas_yr for s in w.sources]),
        np.full(len(w.sources), wise.EPOCH_JYEAR, dtype=np.float64),
        [s.w1_mag for s in w.sources],
    )
    return tbl, w.table, w.truncated, w.served


def _nan_array(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=np.float64)


CATALOG_META: dict[Catalog, dict[str, Any]] = {
    "gaia": {"mag_band": "G", "mag_limit": gaia.MAG_LIMIT_G, "table": gaia.DEFAULT_TABLE},
    "wise": {"mag_band": "W1", "mag_limit": None, "table": wise.TABLE},
}


def _epoch_text(jyear: float) -> str:
    text = f"{jyear:.3f}".rstrip("0")
    return f"J{text}0" if text.endswith(".") else f"J{text}"


def frame_markers(
    hdul: Any, frame: FrameRecord, when: datetime, tables: list[CatalogTable], cfg: MeasureConfig
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Markers inside the cutout and contamination of the aperture/annulus, for one frame."""
    ny, nx = np.asarray(hdul["IMAGE"].data).shape
    markers: list[dict[str, Any]] = []
    contamination: list[dict[str, Any]] = []
    for t in tables:
        if not t.ids:
            continue
        ra, dec = propagate_many(t.ra, t.dec, t.pmra, t.pmdec, when, t.epoch_jyear)
        xs, ys = wcs.png_xy_many(hdul, ra, dec)
        finite = np.isfinite(xs) & np.isfinite(ys)
        inside = finite & (xs >= -0.5) & (xs < nx - 0.5) & (ys >= -0.5) & (ys < ny - 0.5)
        idx = np.flatnonzero(inside)
        if idx.size == 0:
            continue
        sep = np.hypot(xs[idx] - frame.x, ys[idx] - frame.y)
        nearest = int(np.argmin(sep))
        target = int(idx[nearest]) if sep[nearest] <= TARGET_MATCH_PX else -1
        for k, i in enumerate(idx.tolist()):
            markers.append(
                {
                    "catalog": t.catalog,
                    "id": t.ids[i],
                    "x": round(float(xs[i]), 3),
                    "y": round(float(ys[i]), 3),
                }
            )
            if i == target:
                continue
            d = float(sep[k])
            if d <= cfg.aperture_radius_px:
                zone = "aperture"
            elif cfg.annulus_inner_px <= d <= cfg.annulus_outer_px:
                zone = "annulus"
            else:
                continue
            contamination.append(
                {
                    "catalog": t.catalog,
                    "id": t.ids[i],
                    "mag": t.mag[i],
                    "zone": zone,
                    "sep_px": round(d, 3),
                }
            )
    contamination.sort(key=lambda c: (c["sep_px"], c["catalog"], c["id"]))
    return markers, contamination


def provenance(cfg: MeasureConfig) -> dict[str, dict[str, str]]:
    return {
        "catalog_positions": {
            "tag": "measured",
            "source": "Gaia DR3 (ra, dec at ref_epoch J2016.0) and CatWISE2020 (ra_pm, dec_pm at "
            "MJD 57170), through IRSA TAP",
        },
        "catalog_mags": {
            "tag": "measured",
            "source": "Gaia DR3 phot_g_mean_mag; CatWISE2020 w1mpro_pm",
        },
        "markers": {"tag": "derived", "formula": MARKER_FORMULA},
        "contamination": {"tag": "derived", "formula": contamination_formula(cfg)},
        "footprint": {
            "tag": "measured",
            "source": "IRSA SIA s_region (POLYGON ICRS) of the frame, closing vertex removed",
        },
        "cutout_box": {"tag": "derived", "formula": CUTOUT_BOX_FORMULA},
        "flags_mask": {
            "tag": "measured",
            "source": f"SPHEREx FLAGS extension of the cutout; {flagmask.FORMULA}",
        },
        "flag_colours": {
            "tag": "artistic",
            "assumption": "Okabe-Ito colour-blind-safe palette, alpha 160 (display choice)",
        },
    }


CatalogFetch = tuple[CatalogTable, str, bool, Served]
FetchKey = tuple[Catalog, float, float, float]


class OverlayService:
    """Overlays per object.

    - Concurrent requests for one object share a single computation (``_inflight``).
    - The Gaia and CatWISE cones run in parallel on a small pool; a cone already being fetched
      is joined, not started again (``_fetches``). A request waits at most
      ``overlay_wait_s`` for them; a cone still running is reported as
      ``overlay:<catalog>:pending`` and lands in the cache for the next request.
    - A cone that failed live is not retried for ``catalog_failure_ttl_s`` (``_failed``).
    """

    def __init__(self, frames: FrameService, cfg: MeasureConfig = DEFAULT_CONFIG) -> None:
        self.frames = frames
        self.ctx = frames.ctx
        self.cfg = cfg
        self._memo: OrderedDict[str, OverlaysResult] = OrderedDict()
        # Re-entrant: a done-callback can run at once in the thread that holds the lock.
        self._lock = threading.RLock()
        self._inflight: dict[str, Future[OverlaysResult]] = {}
        self._fetches: dict[FetchKey, Future[CatalogFetch]] = {}
        self._failed: dict[FetchKey, float] = {}
        self._pool = ThreadPoolExecutor(max_workers=2 * len(CATALOGS), thread_name_prefix="sx-cat")

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def get_overlays(self, obj: ResolvedObject) -> OverlaysResult:
        with self._lock:
            hit = self._memo.get(obj.id)
            if hit is not None:
                self._memo.move_to_end(obj.id)
                return hit
            shared = self._inflight.get(obj.id)
            if shared is None:
                mine: Future[OverlaysResult] = Future()
                self._inflight[obj.id] = mine
        if shared is not None:
            return shared.result()
        try:
            result = self._compute(obj)
        except BaseException as exc:
            with self._lock:
                self._inflight.pop(obj.id, None)
            mine.set_exception(exc)
            raise
        with self._lock:
            if result.complete:
                # In-process memo only (no derived cache entry): the reply is cheap to rebuild
                # from cached inputs, and only a reply that more data could not change is kept.
                self._memo[obj.id] = result
                while len(self._memo) > MEMO_SIZE:
                    self._memo.popitem(last=False)
            self._inflight.pop(obj.id, None)
        mine.set_result(result)
        return result

    def _catalog_future(self, cat: Catalog, cone: Cone) -> Future[CatalogFetch] | None:
        """The running or new fetch of one cone; ``None`` while a recent live failure holds."""
        key: FetchKey = (cat, cone.ra, cone.dec, cone.radius_deg)
        ttl = self.ctx.settings.catalog_failure_ttl_s
        with self._lock:
            now = time.monotonic()
            for k in [k for k, t in self._failed.items() if now - t >= ttl]:
                del self._failed[k]
            if key in self._failed:
                return None
            fut = self._fetches.get(key)
            if fut is None:
                fut = self._pool.submit(fetch_catalog, self.ctx, cat, cone)
                self._fetches[key] = fut
                fut.add_done_callback(lambda f: self._fetch_done(key, f))
            return fut

    def _fetch_done(self, key: FetchKey, fut: Future[CatalogFetch]) -> None:
        with self._lock:
            self._fetches.pop(key, None)
            if not fut.cancelled() and isinstance(fut.exception(), UpstreamUnavailable):
                self._failed[key] = time.monotonic()

    def _compute(self, obj: ResolvedObject) -> OverlaysResult:
        ctx, cfg = self.ctx, self.cfg
        fr = self.frames.get_frames(obj, use_memo=True)
        # Overlay codes only: the frames reply already reports its own refusals (saturated,
        # frames:truncated, ...) and the UI shows them with the flipbook.
        missing: set[str] = set()
        served: list[Served] = []
        catalogs: list[dict[str, Any]] = []
        tables: list[CatalogTable] = []
        rows: dict[str, SiaRow] = {}

        futures: dict[Catalog, Future[CatalogFetch] | None] = {}
        deadline = 0.0
        cone: Cone | None = None
        if not obj.moving:
            try:
                cone = overlay_cone(ctx, obj)
            except (CacheMissOffline, UpstreamUnavailable):
                cone = None
        if cone is not None:
            served.append(cone.sia_served)
            rows = {r.frame_id: r for r in cone.rows}
            # Both cones start before either is awaited, so the wait is the slower of the two.
            futures = {cat: self._catalog_future(cat, cone) for cat in CATALOGS}
            deadline = time.monotonic() + ctx.settings.overlay_wait_s

        for cat in CATALOGS:
            meta = CATALOG_META[cat]
            entry: dict[str, Any] = {
                "catalog": cat,
                "available": False,
                "table": meta["table"],
                "epoch": None,
                "mag_band": meta["mag_band"],
                "mag_limit": meta["mag_limit"],
                "sources": [],
            }
            if cone is None:
                missing.add(f"overlay:{cat}")
                catalogs.append(entry)
                continue
            fut = futures[cat]
            if fut is None:  # failed live moments ago (catalog_failure_ttl_s)
                missing.add(f"overlay:{cat}")
                catalogs.append(entry)
                continue
            try:
                tbl, table_name, truncated, srv = fut.result(
                    timeout=max(0.0, deadline - time.monotonic())
                )
            except TimeoutError:
                missing.add(f"overlay:{cat}:pending")
                catalogs.append(entry)
                continue
            except (CacheMissOffline, UpstreamUnavailable, ValueError, KeyError):
                missing.add(f"overlay:{cat}")
                catalogs.append(entry)
                continue
            served.append(srv)
            tables.append(tbl)
            if truncated:
                missing.add(f"overlay:{cat}:truncated")
            epochs = sorted({float(e) for e in tbl.epoch_jyear.tolist()})
            if cat == "wise":
                epochs = [wise.EPOCH_JYEAR]
            elif not epochs:
                epochs = [gaia.DR3_EPOCH_JYEAR]
            entry.update(
                available=True,
                table=table_name,
                epoch=", ".join(_epoch_text(e) for e in epochs),
                sources=[
                    {
                        "id": tbl.ids[i],
                        "ra": wrap_ra(tbl.ra[i], 8),
                        "dec": round(float(tbl.dec[i]), 8),
                        "mag": tbl.mag[i],
                        "pmra_mas_yr": _opt(tbl.pmra[i]),
                        "pmdec_mas_yr": _opt(tbl.pmdec[i]),
                    }
                    for i in range(len(tbl.ids))
                ],
            )
            catalogs.append(entry)

        frames_out: list[dict[str, Any]] = []
        for f in fr.frames:
            entry_c = ctx.cache.get(irsa_cutout.key_for(ctx, f.sia_row(), f.ra, f.dec))
            if entry_c is None:
                missing.add(f"cutout:{f.frame_id}")
                continue
            try:
                hdul = wcs.open_fits(entry_c.body)
            except (OSError, ValueError):
                missing.add(f"cutout:{f.frame_id}")
                continue
            with hdul:
                if "IMAGE" not in hdul:
                    missing.add(f"cutout:{f.frame_id}")
                    continue
                when = frame_time(f.sia_row())
                markers, contamination = frame_markers(hdul, f, when, tables, cfg)
                box = [[wrap_ra(r, 7), round(d, 7)] for r, d in wcs.png_corners_world(hdul)]
                if not flagmask.available(hdul):
                    missing.add(f"flags_mask:{f.frame_id}")
            row = rows.get(f.frame_id)
            # s_region RAs are passed through by IRSA as written; a polygon across RA 0 can hold
            # -0.1 or 360.2, so they are wrapped like every other RA in the reply.
            footprint = (
                [[wrap_ra(r, 7), round(d, 7)] for r, d in row.s_region]
                if row is not None and row.s_region
                else None
            )
            if footprint is None:
                missing.add(f"footprint:{f.frame_id}")
            frames_out.append(
                {
                    "frame_id": f.frame_id,
                    "flags_url": f"/v1/objects/{obj.id}/flags/{f.frame_id}.png",
                    "markers": markers,
                    "contamination": contamination,
                    "footprint": footprint,
                    "cutout_box": box,
                }
            )

        times = [t for t in (earliest_cached_at(served), fr.cached_at) if t is not None]
        cached_at = min(times) if times else None
        body: dict[str, Any] = {
            "id": obj.id,
            "data_release": ctx.settings.data_release,
            "cached_at": iso_utc_z(cached_at) if cached_at else None,
            "catalogs": catalogs,
            "aperture": {
                "radius_px": cfg.aperture_radius_px,
                "annulus_inner_px": cfg.annulus_inner_px,
                "annulus_outer_px": cfg.annulus_outer_px,
            },
            "flag_groups": [
                {"group": g.group, "rgba": list(g.rgba), "names": list(g.names)}
                for g in flagmask.FLAG_GROUPS
            ],
            "frames": frames_out,
            "missing": sorted(missing),
            "provenance": provenance(cfg),
        }
        complete = (
            is_complete(fr.missing)
            and all(c["available"] for c in catalogs)
            and not any(m.startswith("cutout:") for m in missing)
        )
        return OverlaysResult(body, cached_at, complete, served)


def _opt(v: float) -> float | None:
    return None if not math.isfinite(float(v)) else round(float(v), 4)
