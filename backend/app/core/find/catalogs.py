"""Gaia DR3 and CatWISE2020 cones as arrays, shared by the overlays (issue #12, A4.9) and the star
list for movers (issue #95, A19.6).

Moved out of ``overlays.py`` so that ``stars.py`` and ``overlays.py`` both import it at module
level (no import cycle); ``overlays.py`` re-exports these names for its existing callers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

from app.adapters import gaia, wise
from app.cache.store import Served
from app.context import Context

Catalog = Literal["gaia", "wise"]
CATALOGS: tuple[Catalog, ...] = ("gaia", "wise")

# ASSUMPTION: slack for field-star proper motions between the catalogue epoch and the frame time
# (30 arcsec = 3 arcsec/yr over 10 years) and for rounding. Not a physical value of any object.
CONE_MARGIN_ARCSEC = 30.0


class ConeLike(Protocol):
    """Anything with a cone centre and radius (the overlays ``Cone``, the star list's
    ``StarCone``)."""

    @property
    def ra(self) -> float: ...

    @property
    def dec(self) -> float: ...

    @property
    def radius_deg(self) -> float: ...


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


CatalogFetch = tuple[CatalogTable, str, bool, Served]


def angular_sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Haversine separation in arcsec."""
    p1, p2 = math.radians(dec1), math.radians(dec2)
    dp, dl = p2 - p1, math.radians(ra2 - ra1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h)))) * 3600.0


def cone_radius_arcsec(cutout_size_arcsec: float, max_offset_arcsec: float) -> float:
    half_diagonal = cutout_size_arcsec * math.sqrt(2.0) / 2.0
    return float(math.ceil(half_diagonal + max_offset_arcsec + CONE_MARGIN_ARCSEC))


def fetch_catalog(
    ctx: Context,
    catalog: Catalog,
    cone: ConeLike,
    *,
    refresh: bool = False,
    w1_lt: float | None = None,
    max_rows: int | None = None,
) -> CatalogFetch:
    """(table, table name, truncated, served). Raises ``CacheMissOffline``,
    ``UpstreamUnavailable`` or ``ValueError`` (unreadable cached body).

    ``w1_lt`` (CatWISE only) and ``max_rows`` are passed to the adapter; ``None`` keeps the
    adapter's default, so the fixed-target keys do not change."""
    if catalog == "gaia":
        g = gaia.cone(
            ctx,
            cone.ra,
            cone.dec,
            cone.radius_deg,
            refresh=refresh,
            max_rows=gaia.MAX_ROWS if max_rows is None else max_rows,
        )
        tbl = CatalogTable(
            "gaia",
            [s.source_id for s in g.sources],
            np.array([s.ra for s in g.sources], dtype=np.float64),
            np.array([s.dec for s in g.sources], dtype=np.float64),
            nan_array([s.pmra_mas_yr for s in g.sources]),
            nan_array([s.pmdec_mas_yr for s in g.sources]),
            np.array([s.ref_epoch for s in g.sources], dtype=np.float64),
            [s.g_mag for s in g.sources],
        )
        return tbl, g.table, g.truncated, g.served
    w = wise.cone(
        ctx,
        cone.ra,
        cone.dec,
        cone.radius_deg,
        refresh=refresh,
        w1_lt=w1_lt,
        max_rows=wise.MAX_ROWS if max_rows is None else max_rows,
    )
    tbl = CatalogTable(
        "wise",
        [s.source_name for s in w.sources],
        np.array([s.ra for s in w.sources], dtype=np.float64),
        np.array([s.dec for s in w.sources], dtype=np.float64),
        nan_array([s.pmra_mas_yr for s in w.sources]),
        nan_array([s.pmdec_mas_yr for s in w.sources]),
        np.full(len(w.sources), wise.EPOCH_JYEAR, dtype=np.float64),
        [s.w1_mag for s in w.sources],
    )
    return tbl, w.table, w.truncated, w.served


def nan_array(values: list[float | None]) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in values], dtype=np.float64)
