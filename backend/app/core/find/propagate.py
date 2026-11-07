"""Proper-motion propagation of a catalogue position to a frame time (A4.1).

SIMBAD positions are ICRS at epoch J2000. High proper-motion targets move tens of SPHEREx
pixels by 2026 (Barnard's Star about 269 arcsec), so every frame uses the propagated position.
Catalogue overlays (issue #12) use the same formula from their own epoch: Gaia DR3 J2016.0,
CatWISE2020 MJD 57170.
"""

from __future__ import annotations

import math
from datetime import datetime

import numpy as np

from app.timefmt import julian_years_since_j2000

J2000_JYEAR = 2000.0

FORMULA = (
    "ra(t) = ra0 + pmra*dt/cos(dec0)/3.6e6; dec(t) = dec0 + pmdec*dt/3.6e6; "
    "dt = Julian years since J2000.0; pmra = mu_alpha*cos(dec) in mas/yr (SIMBAD)"
)
CATALOGUE_FORMULA = (
    "ra(t) = ra0 + pmra*dt/cos(dec0)/3.6e6; dec(t) = dec0 + pmdec*dt/3.6e6; "
    "dt = Julian years from the catalogue epoch to the frame time; pmra = mu_alpha*cos(dec) in "
    "mas/yr; no proper motion -> catalogue position"
)
NEGLECTED = (
    "linear: neglects parallax (at most 0.55 arcsec, for Barnard's Star) and perspective "
    "acceleration (under 0.5 arcsec over 26 years), both under 0.1 SPHEREx pixel"
)


def propagate(
    ra0: float,
    dec0: float,
    pmra_mas_yr: float | None,
    pmdec_mas_yr: float | None,
    when: datetime,
    *,
    epoch_jyear: float = J2000_JYEAR,
) -> tuple[float, float]:
    """Position at ``when`` from a position at Julian epoch ``epoch_jyear`` (default J2000.0).

    Without a proper motion the catalogue position is returned."""
    if pmra_mas_yr is None or pmdec_mas_yr is None:
        return ra0, dec0
    dt = julian_years_since_j2000(when) - (epoch_jyear - J2000_JYEAR)
    cosd = math.cos(math.radians(dec0))
    dra = pmra_mas_yr * dt / 3.6e6 / cosd if cosd > 1e-9 else 0.0
    dec = dec0 + pmdec_mas_yr * dt / 3.6e6
    return (ra0 + dra) % 360.0, max(-90.0, min(90.0, dec))


def propagate_many(
    ra0: np.ndarray,
    dec0: np.ndarray,
    pmra_mas_yr: np.ndarray,
    pmdec_mas_yr: np.ndarray,
    when: datetime,
    epoch_jyear: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised ``propagate``: the same formula, element by element. A NaN proper motion
    (no astrometric solution) keeps the catalogue position."""
    ra0 = np.asarray(ra0, dtype=np.float64)
    dec0 = np.asarray(dec0, dtype=np.float64)
    pmra = np.asarray(pmra_mas_yr, dtype=np.float64)
    pmdec = np.asarray(pmdec_mas_yr, dtype=np.float64)
    has_pm = np.isfinite(pmra) & np.isfinite(pmdec)
    dt = julian_years_since_j2000(when) - (np.asarray(epoch_jyear, dtype=np.float64) - J2000_JYEAR)
    cosd = np.cos(np.radians(dec0))
    safe = cosd > 1e-9
    dra = np.where(
        has_pm & safe, np.where(has_pm, pmra, 0.0) * dt / 3.6e6 / np.where(safe, cosd, 1.0), 0.0
    )
    ddec = np.where(has_pm, np.where(has_pm, pmdec, 0.0) * dt / 3.6e6, 0.0)
    return (ra0 + dra) % 360.0, np.clip(dec0 + ddec, -90.0, 90.0)
