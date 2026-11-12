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

import csv
import math
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from app.adapters import gaia, irsa_cutout, irsa_sia, wise
from app.adapters.irsa_sia import SiaRow
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable, earliest_cached_at
from app.context import Context
from app.core.find import flagmask, stars, wcs
from app.core.find import moving as moving_mod
from app.core.find.catalogs import (
    CATALOGS,
    CONE_MARGIN_ARCSEC,
    Catalog,
    CatalogFetch,
    CatalogTable,
    ConeLike,
    angular_sep_arcsec,
    cone_radius_arcsec,
    fetch_catalog,
)
from app.core.find.frames import (
    DEFERRED,
    FrameRecord,
    FrameService,
    FramesResult,
    frame_time,
    is_complete,
    position_at,
)
from app.core.find.propagate import CATALOGUE_FORMULA, propagate_many
from app.core.find.resolver import ResolvedObject
from app.core.measure.config import DEFAULT_CONFIG, MeasureConfig
from app.timefmt import iso_utc_z, parse_utc

# Moved to ``catalogs`` (issue #95) and re-exported for the pre-fetch and the tests.
__all__ = [
    "CATALOGS",
    "CONE_MARGIN_ARCSEC",
    "Catalog",
    "CatalogFetch",
    "CatalogTable",
    "Cone",
    "OverlayService",
    "OverlaysResult",
    "angular_sep_arcsec",
    "cone_radius_arcsec",
    "fetch_catalog",
    "frame_markers",
    "overlay_cone",
    "provenance",
    "wrap_ra",
]

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


def contamination_formula(cfg: MeasureConfig, moving: bool = False) -> str:
    base = (
        "sep_px = hypot(x_src - x, y_src - y) from the frame's object x, y; zone aperture if "
        f"sep_px <= {cfg.aperture_radius_px} px, annulus if {cfg.annulus_inner_px} <= sep_px <= "
        f"{cfg.annulus_outer_px} px (the Stage 2 method radii); "
    )
    if moving:
        # A19.6: a mover is never a catalogue source, so nothing is taken as the target (Q-53
        # does not apply); x, y is the predicted pixel (Horizons TLIST at the frame midpoint).
        return base + (
            "x, y is the predicted pixel; no self-match for movers (a mover is never a catalogue "
            "source), so every source in a zone is listed; each frame uses its own visit's cones"
        )
    return base + (
        f"the nearest source of each catalogue within {TARGET_MATCH_PX} px of the object is "
        "taken as the target and left out"
    )


@dataclass(frozen=True)
class Cone:
    ra: float
    dec: float
    radius_deg: float
    rows: list[SiaRow]
    sia_served: Served


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


CATALOG_META: dict[Catalog, dict[str, Any]] = {
    "gaia": {"mag_band": "G", "mag_limit": gaia.MAG_LIMIT_G, "table": gaia.DEFAULT_TABLE},
    "wise": {"mag_band": "W1", "mag_limit": None, "table": wise.TABLE},
}


def _epoch_text(jyear: float) -> str:
    text = f"{jyear:.3f}".rstrip("0")
    return f"J{text}0" if text.endswith(".") else f"J{text}"


def frame_markers(
    hdul: Any,
    frame: FrameRecord,
    when: datetime,
    tables: list[CatalogTable],
    cfg: MeasureConfig,
    *,
    self_match: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Markers inside the cutout and contamination of the aperture/annulus, for one frame.

    ``self_match`` (Q-53): the nearest source within ``TARGET_MATCH_PX`` is the target and left
    out of the contamination; ``False`` for movers (A19.6), which are never catalogue sources."""
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
        target = int(idx[nearest]) if self_match and sep[nearest] <= TARGET_MATCH_PX else -1
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


def provenance(cfg: MeasureConfig, moving: bool = False) -> dict[str, dict[str, str]]:
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
        "contamination": {"tag": "derived", "formula": contamination_formula(cfg, moving)},
        # Issue #95 (A19.6): star masks near a mover's track; always [] for fixed objects.
        "masks": {"tag": "derived", "formula": f"moving objects only; {stars.MASKS_FORMULA}"},
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


# (catalogue, ra, dec, radius_deg, adapter options): the options (W1 cut, row cap) change the key.
FetchKey = tuple[Catalog, float, float, float, tuple[tuple[str, Any], ...]]


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
        # Issue #95: a mover's visit cones run on their own pool (two workers, shared by both
        # catalogues; submitted visit by visit), so a fixed object's cones never queue behind
        # them.
        self._star_pool = ThreadPoolExecutor(
            max_workers=len(CATALOGS), thread_name_prefix="sx-star"
        )

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
        self._star_pool.shutdown(wait=False, cancel_futures=True)

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

    def _catalog_future(
        self,
        cat: Catalog,
        cone: ConeLike,
        opts: dict[str, Any] | None = None,
        *,
        pool: ThreadPoolExecutor | None = None,
    ) -> Future[CatalogFetch] | None:
        """The running or new fetch of one cone; ``None`` while a recent live failure holds.
        ``opts`` are the adapter options (W1 cut, row cap) of a star-list cone."""
        options = dict(opts or {})
        key = _fetch_key(cat, cone, options)
        ttl = self.ctx.settings.catalog_failure_ttl_s
        with self._lock:
            now = time.monotonic()
            for k in [k for k, t in self._failed.items() if now - t >= ttl]:
                del self._failed[k]
            if key in self._failed:
                return None
            fut = self._fetches.get(key)
            if fut is None:
                fut = (pool or self._pool).submit(fetch_catalog, self.ctx, cat, cone, **options)
                self._fetches[key] = fut
                fut.add_done_callback(lambda f: self._fetch_done(key, f))
            return fut

    def _is_fetching(self, cat: Catalog, cone: ConeLike, opts: dict[str, Any]) -> bool:
        with self._lock:
            return _fetch_key(cat, cone, opts) in self._fetches

    def _fetch_done(self, key: FetchKey, fut: Future[CatalogFetch]) -> None:
        with self._lock:
            self._fetches.pop(key, None)
            if not fut.cancelled() and isinstance(fut.exception(), UpstreamUnavailable):
                self._failed[key] = time.monotonic()

    def _fixed_catalogs(
        self, obj: ResolvedObject, missing: set[str], served: list[Served]
    ) -> tuple[list[dict[str, Any]], list[CatalogTable], dict[str, SiaRow]]:
        """One cone per catalogue at the SIA search position (issue #12)."""
        ctx = self.ctx
        catalogs: list[dict[str, Any]] = []
        tables: list[CatalogTable] = []
        rows: dict[str, SiaRow] = {}
        futures: dict[Catalog, Future[CatalogFetch] | None] = {}
        deadline = 0.0
        cone: Cone | None
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
            entry = _catalog_entry(cat, CATALOG_META[cat]["mag_limit"])
            catalogs.append(entry)
            if cone is None:
                missing.add(f"overlay:{cat}")
                continue
            got = _await(futures[cat], deadline)
            if isinstance(got, str):
                missing.add(f"overlay:{cat}{got}")
                continue
            tbl, table_name, truncated, srv = got
            served.append(srv)
            tables.append(tbl)
            if truncated:
                missing.add(f"overlay:{cat}:truncated")
            _fill_entry(entry, cat, table_name, [tbl])
        return catalogs, tables, rows

    def _mover_catalogs(
        self, fr: FramesResult, missing: set[str], served: list[Served]
    ) -> tuple[list[dict[str, Any]], dict[str, list[CatalogTable]], dict[str, _MoverFrame]]:
        """Issue #95 (A19.6, Q-403): one Gaia and one CatWISE cone per visit.

        - The cones are built only from a complete frame list (their centres and radii depend
          on it). Otherwise ``overlay:<cat>:pending`` while frames are still deferred to the
          object's job, else ``overlay:<cat>``; such a reply is never memoised.
        - All or nothing per catalogue: it is available only when every visit's cone is served.
          Each frame uses only its own visit's cones.
        - At most ``stars.MAX_LIVE_VISIT_CONES`` new live cones per catalogue per request; the
          rest are ``overlay:<cat>:pending`` until a later request starts them.
        """
        ctx = self.ctx
        catalogs: list[dict[str, Any]] = []
        per_frame_tables: dict[str, list[CatalogTable]] = {}
        per_frame: dict[str, _MoverFrame] = {}
        visits: list[stars.TrackVisit] = []
        refusal = ""  # no frames, or a frame list that will not change: overlay:<cat>
        if fr.frames and is_complete(fr.missing):
            visits = stars.mover_visits(fr.frames, ctx.settings.cutout_size_arcsec)
        elif any(m.startswith(_DEFERRED_PREFIXES) for m in fr.missing):
            refusal = ":pending"

        # Start every cone of every visit before awaiting any (one shared deadline). The
        # sx-star pool has two workers, shared by both catalogues; cones are submitted visit by
        # visit (Gaia, CatWISE, next visit), so neither catalogue waits behind all of the other's.
        futures: dict[tuple[Catalog, int], Future[CatalogFetch] | str | None] = {}
        started: dict[Catalog, int] = dict.fromkeys(CATALOGS, 0)
        for v in visits:
            for cat in CATALOGS:
                opts = stars.fetch_options(cat, v.cone)
                live = not (
                    ctx.cache.offline
                    or ctx.cache.get_meta(stars.cone_key(cat, v.cone)) is not None
                    or self._is_fetching(cat, v.cone, opts)
                )
                if live and started[cat] >= stars.MAX_LIVE_VISIT_CONES:
                    futures[(cat, v.visit)] = PENDING
                    continue
                new = self._catalog_future(cat, v.cone, opts, pool=self._star_pool)
                # A cone inside its failure TTL starts nothing, so it does not use the budget.
                started[cat] += int(live and new is not None)
                futures[(cat, v.visit)] = new
        deadline = time.monotonic() + ctx.settings.overlay_wait_s

        visit_tables: dict[int, dict[Catalog, CatalogTable]] = {v.visit: {} for v in visits}
        for cat in CATALOGS:
            limit = gaia.MAG_LIMIT_G if cat == "gaia" else stars.W1_LIMIT
            entry = _catalog_entry(cat, limit)
            catalogs.append(entry)
            if not visits:
                missing.add(f"overlay:{cat}{refusal}")
                continue
            got_all: list[CatalogFetch] = []
            codes: set[str] = set()
            for v in visits:
                fut = futures[(cat, v.visit)]
                got = fut if isinstance(fut, str) else _await(fut, deadline)
                if isinstance(got, str):
                    codes.add(got)
                    continue
                got_all.append(got)
                served.append(got[3])
            if codes:
                # A failed cone wins over a pending one: the catalogue is refused either way.
                missing.add(f"overlay:{cat}" if REFUSED in codes else f"overlay:{cat}{PENDING}")
                continue
            if any(g[2] for g in got_all):
                missing.add(f"overlay:{cat}:truncated")
            for v, g in zip(visits, got_all, strict=True):
                visit_tables[v.visit][cat] = g[0]
            table_name = ", ".join(sorted({g[1] for g in got_all}))
            _fill_entry(entry, cat, table_name, [g[0] for g in got_all])

        for v in visits:
            mine = visit_tables[v.visit]
            tables = [mine[c] for c in CATALOGS if c in mine]
            star_list = stars.stars_from_tables(mine.get("gaia"), mine.get("wise"))
            track = v.track_radec()
            for f in v.frames:
                per_frame_tables[f.frame_id] = tables
                per_frame[f.frame_id] = _MoverFrame(star_list, track)
        return catalogs, per_frame_tables, per_frame

    def _compute(self, obj: ResolvedObject) -> OverlaysResult:
        ctx, cfg = self.ctx, self.cfg
        fr = self.frames.get_frames(obj, use_memo=True)
        # Overlay codes only: the frames reply already reports its own refusals (saturated,
        # frames:truncated, ...) and the UI shows them with the flipbook.
        missing: set[str] = set()
        served: list[Served] = []
        rows: dict[str, SiaRow] = {}
        tables: list[CatalogTable] = []
        per_frame_tables: dict[str, list[CatalogTable]] = {}
        per_frame: dict[str, _MoverFrame] = {}
        if obj.moving:
            catalogs, per_frame_tables, per_frame = self._mover_catalogs(fr, missing, served)
        else:
            catalogs, tables, rows = self._fixed_catalogs(obj, missing, served)

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
            masks: list[dict[str, Any]] = []
            with hdul:
                if "IMAGE" not in hdul:
                    missing.add(f"cutout:{f.frame_id}")
                    continue
                when = frame_time(f.sia_row())
                if obj.moving:
                    markers, contamination = frame_markers(
                        hdul, f, when, per_frame_tables.get(f.frame_id, []), cfg, self_match=False
                    )
                    mf = per_frame.get(f.frame_id)
                    if mf is not None:
                        masks = stars.frame_masks(hdul, when, mf.stars, mf.track)
                else:
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
                    "masks": masks,
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
            "provenance": provenance(cfg, obj.moving),
        }
        complete = (
            is_complete(fr.missing)
            and all(c["available"] for c in catalogs)
            and not any(m.startswith("cutout:") for m in missing)
        )
        return OverlaysResult(body, cached_at, complete, served)


# Code suffixes of a catalogue that could not be used: refused, or still running.
REFUSED = ""
PENDING = ":pending"
# A mover's frame list still filling (cutouts or path-search calls left to the object's job).
_DEFERRED_PREFIXES = (DEFERRED + ":", moving_mod.SEARCH_DEFERRED + ":")


def _fetch_key(cat: Catalog, cone: ConeLike, opts: dict[str, Any]) -> FetchKey:
    return (cat, cone.ra, cone.dec, cone.radius_deg, tuple(sorted(opts.items())))


@dataclass(frozen=True)
class _MoverFrame:
    """A mover frame's visit star list and the visit's predicted track (ra, dec)."""

    stars: list[stars.Star]
    track: tuple[np.ndarray, np.ndarray]


def _catalog_entry(cat: Catalog, mag_limit: float | None) -> dict[str, Any]:
    meta = CATALOG_META[cat]
    return {
        "catalog": cat,
        "available": False,
        "table": meta["table"],
        "epoch": None,
        "mag_band": meta["mag_band"],
        "mag_limit": mag_limit,
        "sources": [],
    }


def _await(fut: Future[CatalogFetch] | None, deadline: float) -> CatalogFetch | str:
    """The fetch result, or the code suffix ``REFUSED`` / ``PENDING``."""
    if fut is None:  # failed live moments ago (catalog_failure_ttl_s)
        return REFUSED
    try:
        return fut.result(timeout=max(0.0, deadline - time.monotonic()))
    except TimeoutError:
        return PENDING
    except (CacheMissOffline, UpstreamUnavailable, ValueError, KeyError, csv.Error):
        # A cached body that no longer parses is refused, not a 500.
        return REFUSED


def _fill_entry(
    entry: dict[str, Any], cat: Catalog, table_name: str, tbls: list[CatalogTable]
) -> None:
    """Mark the catalogue available with the sources of ``tbls``. One table keeps its answer
    order (brightest first); several (a mover's visits) are merged by id and sorted the same
    way, by magnitude (none last), then id."""
    seen: dict[str, dict[str, Any]] = {}
    epochs: set[float] = set()
    for tbl in tbls:
        epochs |= {float(e) for e in tbl.epoch_jyear.tolist()}
        for i in range(len(tbl.ids)):
            seen.setdefault(
                tbl.ids[i],
                {
                    "id": tbl.ids[i],
                    "ra": wrap_ra(tbl.ra[i], 8),
                    "dec": round(float(tbl.dec[i]), 8),
                    "mag": tbl.mag[i],
                    "pmra_mas_yr": _opt(tbl.pmra[i]),
                    "pmdec_mas_yr": _opt(tbl.pmdec[i]),
                },
            )
    sources = list(seen.values())
    if len(tbls) > 1:
        sources.sort(key=lambda s: (s["mag"] is None, s["mag"] or 0.0, s["id"]))
    epoch_list = sorted(epochs)
    if cat == "wise":
        epoch_list = [wise.EPOCH_JYEAR]
    elif not epoch_list:
        epoch_list = [gaia.DR3_EPOCH_JYEAR]
    entry.update(
        available=True,
        table=table_name,
        epoch=", ".join(_epoch_text(e) for e in epoch_list),
        sources=sources,
    )


def _opt(v: float) -> float | None:
    return None if not math.isfinite(float(v)) else round(float(v), 4)
