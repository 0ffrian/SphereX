"""Proper-motion propagation of a catalogue position to a frame time (A4.1).

SIMBAD positions are ICRS at epoch J2000. High proper-motion targets move tens of SPHEREx
pixels by 2026 (Barnard's Star about 269 arcsec), so every frame uses the propagated position.
"""

from __future__ import annotations

import math
from datetime import datetime

from app.timefmt import julian_years_since_j2000

FORMULA = (
    "ra(t) = ra0 + pmra*dt/cos(dec0)/3.6e6; dec(t) = dec0 + pmdec*dt/3.6e6; "
    "dt = Julian years since J2000.0; pmra = mu_alpha*cos(dec) in mas/yr (SIMBAD)"
)
NEGLECTED = (
    "linear: neglects parallax (at most 0.55 arcsec, for Barnard's Star) and perspective "
    "acceleration (under 0.5 arcsec over 26 years), both under 0.1 SPHEREx pixel"
)


def propagate(
    ra0: float, dec0: float, pmra_mas_yr: float | None, pmdec_mas_yr: float | None, when: datetime
) -> tuple[float, float]:
    """Position at ``when``. Without a proper motion the catalogue position is returned."""
    if pmra_mas_yr is None or pmdec_mas_yr is None:
        return ra0, dec0
    dt = julian_years_since_j2000(when)
    cosd = math.cos(math.radians(dec0))
    dra = pmra_mas_yr * dt / 3.6e6 / cosd if cosd > 1e-9 else 0.0
    dec = dec0 + pmdec_mas_yr * dt / 3.6e6
    return (ra0 + dra) % 360.0, max(-90.0, min(90.0, dec))
