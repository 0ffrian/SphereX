"""Star list for movers (issue #95, A19.6, Q-143, Q-403): one Gaia DR3 and one CatWISE2020 cone
per visit, a mask radius from magnitude, de-duplication across the two catalogues and the
"near the track" test. Shared by Track's ``/overlays`` (``overlays.py``) and Discovery's star step
(A17.3, P4), so it is built once.

- **Cones.** Track: at the visit's mean predicted position, radius = half the cutout diagonal +
  the largest separation between two predicted positions of the visit + 30 arcsec, rounded up
  (``catalogs.cone_radius_arcsec``). Area: at the area centre, radius = half the area diagonal +
  30 arcsec, rounded up. ``mover_visits`` is the one builder for ``/overlays`` and the pre-fetch,
  so both ask for the same cache keys.
- **Limits.** Gaia ``G < 20`` (the adapter's key, unchanged); CatWISE ``W1 < W1_LIMIT``. Track
  cones keep the adapters' 5000-row cap; the area cone uses ``STAR_LIST_MAX_ROWS`` and a capped
  area answer is refused (a brightest-first partial list would keep faint stars as movers).
- **Pure and cache-backed.** Raw cone answers live in the disk cache (D-25); everything here is
  rebuilt from them, sorted and rounded, so the same cache gives the same lists.
"""

from __future__ import annotations

import csv
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import numpy as np

from app.adapters import gaia, wise
from app.cache.keys import CacheKey
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.find import wcs
from app.core.find.catalogs import (
    CATALOGS,
    CONE_MARGIN_ARCSEC,
    Catalog,
    CatalogTable,
    angular_sep_arcsec,
    cone_radius_arcsec,
    fetch_catalog,
)
from app.core.find.frames import FrameRecord
from app.core.find.propagate import CATALOGUE_FORMULA, propagate_many
from app.timefmt import mjd_to_utc

ConeKind = Literal["track", "area"]

# ASSUMPTION ([verify], A19.6): CatWISE2020 depth cut for the star list, W1 < 16.5. Fixed targets
# keep no W1 cut (Q-51); only the mover cones add it, as a separate cache key.
W1_LIMIT = 16.5
# ASSUMPTION ([verify], A19.6, starting values to check on the Eros frames): mask radius in
# cutout pixels from magnitude. Gaia r = clamp(2 + (14 - G), 2, 10); CatWISE-only
# r = clamp(2 + (11 - W1), 2, 10).
MASK_R_MIN_PX = 2.0
MASK_R_MAX_PX = 10.0
MASK_G_ZERO = 14.0
MASK_W1_ZERO = 11.0
# ASSUMPTION ([verify], A19.6): a mask is shown when its centre is within this distance of the
# visit's predicted track in the cutout (Q-403 (2)).
NEAR_TRACK_PX = 8.0
# ASSUMPTION (Q-403 (3)): a CatWISE source within this distance of a Gaia source, compared at the
# CatWISE epoch (MJD 57170), is the same star. Precedent: gaia.STAR_MATCH_RADIUS_ARCSEC.
DEDUPE_ARCSEC = 3.0
DEDUPE_EPOCH_MJD = wise.EPOCH_MJD
# Measured 11 Nov 2026 (IRSA TAP COUNT, Eros area cone 0.62083 deg at b ~ -4 deg): Gaia G < 20
# 32,256 rows, CatWISE W1 < 16.5 32,333 rows. The area cone's row cap, above both.
STAR_LIST_MAX_ROWS = 50000
# A17.1 (P3): frames less than visit_gap_h apart form one visit. Track-local copy until P3's
# ``group_visits`` lands; then this module imports it (Q-403 (8)).
VISIT_GAP_H = 1.0
GAP_TOLERANCE_S = 1e-3
# ASSUMPTION (Q-403 (6)): new live visit cones started per catalogue by one /overlays request. The
# rest are reported as ``overlay:<cat>:pending`` and started by a later request.
MAX_LIVE_VISIT_CONES = 8

TRACK_CONE_FORMULA = (
    "centre = normalised mean of the unit vectors of the visit's predicted positions (Horizons "
    "TLIST at each frame midpoint); radius = ceil(cutout_size*sqrt(2)/2 + largest separation "
    f"between two predicted positions of the visit + {CONE_MARGIN_ARCSEC:g} arcsec)"
)
AREA_CONE_FORMULA = (
    "centre = area centre; radius = ceil(sqrt(width^2 + height^2)/2 * 3600 + "
    f"{CONE_MARGIN_ARCSEC:g}) arcsec"
)
MASK_RADIUS_FORMULA = (
    f"Gaia r = clamp(2 + ({MASK_G_ZERO:g} - G), {MASK_R_MIN_PX:g}, {MASK_R_MAX_PX:g}) px; "
    f"CatWISE r = clamp(2 + ({MASK_W1_ZERO:g} - W1), {MASK_R_MIN_PX:g}, {MASK_R_MAX_PX:g}) px; "
    "a source in both catalogues takes the larger; no magnitude -> "
    f"{MASK_R_MIN_PX:g} px; rounded to 0.01 px (starting values, [verify])"
)
DEDUPE_FORMULA = (
    "Gaia positions propagated to MJD 57170 (the CatWISE epoch) and compared with CatWISE "
    f"ra_pm, dec_pm; pairs within {DEDUPE_ARCSEC:g} arcsec matched one to one, closest first; "
    "a matched pair is one star with the Gaia id and position"
)
MASKS_FORMULA = (
    f"{CATALOGUE_FORMULA}; placed like the markers; Gaia DR3 G < {gaia.MAG_LIMIT_G:g} and "
    f"CatWISE2020 W1 < {W1_LIMIT:g} [verify], one cone each per visit; {DEDUPE_FORMULA}; "
    f"{MASK_RADIUS_FORMULA}; shown when the centre is within {NEAR_TRACK_PX:g} px [verify] of "
    "the polyline through the visit's predicted positions placed with this frame's WCS"
)


@dataclass(frozen=True)
class StarCone:
    """One catalogue cone of a visit. ``ra``/``dec``/``radius_deg`` are what the cache key is
    built from, so the same visit gives the same key everywhere."""

    visit: int
    kind: ConeKind
    ra: float
    dec: float
    radius_deg: float
    formula: str


@dataclass(frozen=True)
class TrackVisit:
    """The frames of one visit of a mover, with their predicted positions (the frame records'
    ``ra``/``dec``, the exact Horizons TLIST positions, A19.4) and the visit's cone."""

    visit: int
    frames: tuple[FrameRecord, ...]
    cone: StarCone

    @property
    def frame_ids(self) -> tuple[str, ...]:
        return tuple(f.frame_id for f in self.frames)

    def track_radec(self) -> tuple[np.ndarray, np.ndarray]:
        """The predicted positions in time order, one per distinct midpoint (both detectors of
        an exposure share theirs)."""
        seen: dict[float, tuple[float, float]] = {}
        for f in sorted(self.frames, key=lambda f: (midpoint_mjd(f), f.frame_id)):
            seen.setdefault(midpoint_mjd(f), (f.ra, f.dec))
        pts = list(seen.values())
        return (
            np.array([p[0] for p in pts], dtype=np.float64),
            np.array([p[1] for p in pts], dtype=np.float64),
        )


@dataclass(frozen=True)
class Star:
    """One star of a visit's list. ``catalog`` is ``gaia`` for a Gaia source (with ``wise_id``
    when CatWISE has it too) and ``wise`` for a CatWISE-only source."""

    catalog: Catalog
    id: str
    ra0: float  # deg at epoch_jyear
    dec0: float
    pmra_mas_yr: float | None  # mu_alpha*cos(dec)
    pmdec_mas_yr: float | None
    epoch_jyear: float
    g_mag: float | None
    w1_mag: float | None
    wise_id: str | None
    r_px: float


@dataclass
class StarList:
    """The star list of one visit. A catalogue whose cone could not be served is in ``failed``
    (its stars are absent, never guessed); ``truncated`` names a capped Track cone."""

    visit: int
    cone: StarCone
    stars: list[Star]
    failed: set[Catalog] = field(default_factory=set)
    truncated: set[Catalog] = field(default_factory=set)
    served: list[Served] = field(default_factory=list)

    def missing_codes(self) -> list[str]:
        """Area search codes (A17.8): ``stars:<cat>:<visit>`` per failed catalogue."""
        return [f"stars:{cat}:{self.visit}" for cat in CATALOGS if cat in self.failed]


# --- Visits and cones ---------------------------------------------------------------------------


def midpoint_mjd(f: FrameRecord) -> float:
    return (f.t_min_mjd + f.t_max_mjd) / 2.0


def track_visits(
    frames: Iterable[FrameRecord], gap_h: float = VISIT_GAP_H
) -> list[list[FrameRecord]]:
    """A17.1's rule on a mover's frames: sorted by midpoint (then frame id); a gap of ``gap_h``
    or more between two consecutive midpoints starts a new visit. Equal midpoints (both
    detectors of an exposure) are never split. Visits are returned in time order (visit 1
    first)."""
    ordered = sorted(frames, key=lambda f: (midpoint_mjd(f), f.frame_id))
    visits: list[list[FrameRecord]] = []
    last: float | None = None
    for f in ordered:
        mid = midpoint_mjd(f)
        # Compared in seconds with a 1 ms tolerance: MJD floats near 61000 carry ~1 us of
        # rounding, so an exact 1 h gap must not read as 59.99999 min.
        if last is None or (mid - last) * 86400.0 >= gap_h * 3600.0 - GAP_TOLERANCE_S:
            visits.append([])
        visits[-1].append(f)
        last = mid
    return visits


def mean_position(ra: Sequence[float], dec: Sequence[float]) -> tuple[float, float]:
    """Normalised mean of the unit vectors (safe across RA 0). RA in [0, 360)."""
    r, d = np.radians(np.asarray(ra, float)), np.radians(np.asarray(dec, float))
    x = float(np.sum(np.cos(d) * np.cos(r)))
    y = float(np.sum(np.cos(d) * np.sin(r)))
    z = float(np.sum(np.sin(d)))
    n = math.sqrt(x * x + y * y + z * z)
    if n == 0.0:
        raise ValueError("no mean position: the unit vectors cancel")
    ra_c = math.degrees(math.atan2(y, x)) % 360.0
    if ra_c >= 360.0:  # -1e-17 % 360.0 is 360.0 in Python
        ra_c = 0.0
    dec_c = math.degrees(math.asin(max(-1.0, min(1.0, z / n))))
    return ra_c, dec_c


def max_pair_sep_arcsec(ra: Sequence[float], dec: Sequence[float]) -> float:
    """Largest separation between two of the positions (0 for one position)."""
    best = 0.0
    for i in range(len(ra)):
        for j in range(i + 1, len(ra)):
            best = max(best, angular_sep_arcsec(ra[i], dec[i], ra[j], dec[j]))
    return best


def track_cone(visit: int, frames: Sequence[FrameRecord], cutout_size_arcsec: float) -> StarCone:
    if not frames:
        raise ValueError("a visit has at least one frame")
    ra = [f.ra for f in frames]
    dec = [f.dec for f in frames]
    ra_c, dec_c = mean_position(ra, dec)
    radius = cone_radius_arcsec(cutout_size_arcsec, max_pair_sep_arcsec(ra, dec))
    return StarCone(visit, "track", ra_c, dec_c, radius / 3600.0, TRACK_CONE_FORMULA)


def area_cone(ra: float, dec: float, width_deg: float, height_deg: float, visit: int) -> StarCone:
    """Every visit of an area has the same cone (same key), so one fetch serves them all."""
    half_diag = 0.5 * math.hypot(width_deg, height_deg) * 3600.0
    radius = float(math.ceil(half_diag + CONE_MARGIN_ARCSEC))
    return StarCone(visit, "area", ra % 360.0, dec, radius / 3600.0, AREA_CONE_FORMULA)


def mover_visits(frames: Iterable[FrameRecord], cutout_size_arcsec: float) -> list[TrackVisit]:
    """The one builder of a mover's visit cones, used by ``/overlays`` and the pre-fetch."""
    return [
        TrackVisit(n, tuple(fs), track_cone(n, fs, cutout_size_arcsec))
        for n, fs in enumerate(track_visits(frames), start=1)
    ]


def mover_star_cones(frames: Iterable[FrameRecord], cutout_size_arcsec: float) -> list[StarCone]:
    return [v.cone for v in mover_visits(frames, cutout_size_arcsec)]


def fetch_options(cat: Catalog, cone: StarCone) -> dict[str, Any]:
    """Adapter options for a star-list cone: the W1 cut for CatWISE, the area row cap."""
    opts: dict[str, Any] = {}
    if cat == "wise":
        opts["w1_lt"] = W1_LIMIT
    if cone.kind == "area":
        opts["max_rows"] = STAR_LIST_MAX_ROWS
    return opts


def cone_key(cat: Catalog, cone: StarCone) -> CacheKey:
    """The cache key ``fetch_catalog(..., **fetch_options(cat, cone))`` reads and writes."""
    opts = fetch_options(cat, cone)
    max_rows = int(opts.get("max_rows", gaia.MAX_ROWS if cat == "gaia" else wise.MAX_ROWS))
    if cat == "gaia":
        return gaia.gaia_key(cone.ra, cone.dec, cone.radius_deg, max_rows=max_rows)
    return wise.wise_key(cone.ra, cone.dec, cone.radius_deg, w1_lt=W1_LIMIT, max_rows=max_rows)


# --- Mask radius, de-duplication, propagation -------------------------------------------------


def _clamp_r(zero: float, mag: float) -> float:
    return min(MASK_R_MAX_PX, max(MASK_R_MIN_PX, 2.0 + (zero - mag)))


def mask_radius_px(g_mag: float | None, w1_mag: float | None) -> float:
    """``MASK_RADIUS_FORMULA``: the larger of the Gaia and CatWISE radii a source has; no
    magnitude at all gives the minimum."""
    radii = []
    if g_mag is not None and math.isfinite(g_mag):
        radii.append(_clamp_r(MASK_G_ZERO, g_mag))
    if w1_mag is not None and math.isfinite(w1_mag):
        radii.append(_clamp_r(MASK_W1_ZERO, w1_mag))
    return round(max(radii), 2) if radii else MASK_R_MIN_PX


def _unit(ra: np.ndarray, dec: np.ndarray) -> np.ndarray:
    r, d = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)], axis=1)


def match_pairs(gaia_tbl: CatalogTable, wise_tbl: CatalogTable) -> list[tuple[int, int]]:
    """(Gaia index, CatWISE index) pairs that are one star (``DEDUPE_FORMULA``). Candidates are
    found in cells of the unit sphere one match radius wide, then taken closest first (ties by
    Gaia id, then CatWISE id), each source at most once."""
    if not gaia_tbl.ids or not wise_tbl.ids:
        return []
    when = mjd_to_utc(DEDUPE_EPOCH_MJD)
    g_ra, g_dec = propagate_many(
        gaia_tbl.ra, gaia_tbl.dec, gaia_tbl.pmra, gaia_tbl.pmdec, when, gaia_tbl.epoch_jyear
    )
    gu = _unit(g_ra, g_dec)
    wu = _unit(wise_tbl.ra, wise_tbl.dec)
    cell = 2.0 * math.sin(math.radians(DEDUPE_ARCSEC / 3600.0) / 2.0)  # chord of the radius
    gcells = np.floor(gu / cell).astype(np.int64)
    wcells = np.floor(wu / cell).astype(np.int64)
    buckets: dict[tuple[int, int, int], list[int]] = {}
    for i, c in enumerate(gcells.tolist()):
        buckets.setdefault((c[0], c[1], c[2]), []).append(i)
    near = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)]
    cand: list[tuple[float, str, str, int, int]] = []
    for j, c in enumerate(wcells.tolist()):
        for da, db, dc in near:
            for i in buckets.get((c[0] + da, c[1] + db, c[2] + dc), ()):
                sep = angular_sep_arcsec(
                    float(g_ra[i]), float(g_dec[i]), float(wise_tbl.ra[j]), float(wise_tbl.dec[j])
                )
                if sep <= DEDUPE_ARCSEC:
                    cand.append((round(sep, 6), gaia_tbl.ids[i], wise_tbl.ids[j], i, j))
    cand.sort()
    used_g: set[int] = set()
    used_w: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for _, _, _, i, j in cand:
        if i in used_g or j in used_w:
            continue
        used_g.add(i)
        used_w.add(j)
        pairs.append((i, j))
    return pairs


def _opt(v: float) -> float | None:
    return float(v) if math.isfinite(float(v)) else None


def stars_from_tables(gaia_tbl: CatalogTable | None, wise_tbl: CatalogTable | None) -> list[Star]:
    """One list from the two catalogues: every Gaia source (with ``wise_id`` and the larger
    radius when CatWISE has it too), then the CatWISE-only sources. Sorted by catalogue,
    magnitude (none last), id."""
    pairs = match_pairs(gaia_tbl, wise_tbl) if gaia_tbl and wise_tbl else []
    wise_of = dict(pairs)
    matched_w = {j for _, j in pairs}
    out: list[Star] = []
    if gaia_tbl is not None:
        for i, sid in enumerate(gaia_tbl.ids):
            j = wise_of.get(i)
            w1 = wise_tbl.mag[j] if (j is not None and wise_tbl is not None) else None
            out.append(
                Star(
                    "gaia",
                    sid,
                    float(gaia_tbl.ra[i]),
                    float(gaia_tbl.dec[i]),
                    _opt(gaia_tbl.pmra[i]),
                    _opt(gaia_tbl.pmdec[i]),
                    float(gaia_tbl.epoch_jyear[i]),
                    gaia_tbl.mag[i],
                    w1,
                    wise_tbl.ids[j] if (j is not None and wise_tbl is not None) else None,
                    mask_radius_px(gaia_tbl.mag[i], w1),
                )
            )
    if wise_tbl is not None:
        for j, wid in enumerate(wise_tbl.ids):
            if j in matched_w:
                continue
            out.append(
                Star(
                    "wise",
                    wid,
                    float(wise_tbl.ra[j]),
                    float(wise_tbl.dec[j]),
                    _opt(wise_tbl.pmra[j]),
                    _opt(wise_tbl.pmdec[j]),
                    float(wise_tbl.epoch_jyear[j]),
                    None,
                    wise_tbl.mag[j],
                    None,
                    mask_radius_px(None, wise_tbl.mag[j]),
                )
            )
    out.sort(key=_star_order)
    return out


def _star_order(s: Star) -> tuple[str, bool, float, str]:
    mag = s.g_mag if s.catalog == "gaia" else s.w1_mag
    return (s.catalog, mag is None, mag if mag is not None else 0.0, s.id)


def positions_at(stars: Sequence[Star], when: datetime) -> tuple[np.ndarray, np.ndarray]:
    """Each star propagated from its own epoch to ``when`` (no proper motion: catalogue
    position)."""
    nan = np.nan
    return propagate_many(
        np.array([s.ra0 for s in stars], dtype=np.float64),
        np.array([s.dec0 for s in stars], dtype=np.float64),
        np.array([nan if s.pmra_mas_yr is None else s.pmra_mas_yr for s in stars], np.float64),
        np.array([nan if s.pmdec_mas_yr is None else s.pmdec_mas_yr for s in stars], np.float64),
        when,
        np.array([s.epoch_jyear for s in stars], dtype=np.float64),
    )


# --- Near the track ------------------------------------------------------------------------------


def near_track(
    xs: np.ndarray, ys: np.ndarray, path_xy: np.ndarray, max_px: float = NEAR_TRACK_PX
) -> np.ndarray:
    """True where the point is within ``max_px`` (inclusive) of the polyline ``path_xy``
    (shape (n, 2), n >= 1; repeated points are allowed). Non-finite points are never near."""
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    path = np.asarray(path_xy, dtype=np.float64).reshape(-1, 2)
    path = path[np.all(np.isfinite(path), axis=1)]
    if xs.size == 0 or path.shape[0] == 0:
        return np.zeros(xs.shape, dtype=bool)
    best = np.hypot(xs - path[0, 0], ys - path[0, 1])
    for k in range(path.shape[0] - 1):
        ax, ay = path[k]
        bx, by = path[k + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0.0:
            d = np.hypot(xs - ax, ys - ay)
        else:
            t = np.clip(((xs - ax) * dx + (ys - ay) * dy) / L2, 0.0, 1.0)
            d = np.hypot(xs - (ax + t * dx), ys - (ay + t * dy))
        best = np.minimum(best, d)
    out: np.ndarray = np.isfinite(best) & (best <= max_px)
    return out


def frame_masks(
    hdul: Any, when: datetime, stars: Sequence[Star], track: tuple[np.ndarray, np.ndarray]
) -> list[dict[str, Any]]:
    """Masks for one frame: the stars inside the cutout (the marker rule) whose centre is near
    the visit's track placed with this frame's WCS. ``{catalog, id, x, y, r_px}``, x/y in the
    frames reply convention, in the star list's order."""
    if not stars:
        return []
    ny, nx = np.asarray(hdul["IMAGE"].data).shape
    ra, dec = positions_at(stars, when)
    xs, ys = wcs.png_xy_many(hdul, ra, dec)
    finite = np.isfinite(xs) & np.isfinite(ys)
    inside = finite & (xs >= -0.5) & (xs < nx - 0.5) & (ys >= -0.5) & (ys < ny - 0.5)
    px, py = wcs.png_xy_many(hdul, track[0], track[1])
    keep = inside & near_track(xs, ys, np.stack([px, py], axis=1))
    return [
        {
            "catalog": stars[i].catalog,
            "id": stars[i].id,
            "x": round(float(xs[i]), 3),
            "y": round(float(ys[i]), 3),
            "r_px": stars[i].r_px,
        }
        for i in np.flatnonzero(keep).tolist()
    ]


# --- The library call (Discovery's star step, P4) -------------------------------------------


def star_list(ctx: Context, cone: StarCone, *, refresh: bool = False) -> StarList:
    """Both catalogues for one visit cone, through the cache. Never raises for a catalogue: a
    failed cone, an offline cache miss, an unreadable cached body or a capped area answer puts
    the catalogue in ``failed``."""
    tables: dict[Catalog, CatalogTable] = {}
    out = StarList(cone.visit, cone, [])
    for cat in CATALOGS:
        try:
            tbl, _, truncated, srv = fetch_catalog(
                ctx, cat, cone, refresh=refresh, **fetch_options(cat, cone)
            )
        except (CacheMissOffline, UpstreamUnavailable, ValueError, KeyError, csv.Error):
            out.failed.add(cat)
            continue
        out.served.append(srv)
        if truncated and cone.kind == "area":
            out.failed.add(cat)  # Q-403 (5): a capped area answer is refused
            continue
        if truncated:
            out.truncated.add(cat)
        tables[cat] = tbl
    out.stars = stars_from_tables(tables.get("gaia"), tables.get("wise"))
    return out
