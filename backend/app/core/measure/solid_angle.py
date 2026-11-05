"""Pixel solid angle at the object pixel, from the cutout's celestial WCS (incl. SIP).

``Omega = |(u(x+0.5, y) - u(x-0.5, y)) x (u(x, y+0.5) - u(x, y-0.5))|`` with ``u`` the unit
vector of each sky position. No RA differences are taken, so RA 0/360 and the poles are safe.
This stands in for IRSA's solid-angle pixel map, which a cutout does not include; the map's
median is the IMAGE header's ``OMEGA_MEDIAN`` [verify] V2.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from app.core.find import wcs

FORMULA = (
    "Omega = |(u(x+0.5,y) - u(x-0.5,y)) x (u(x,y+0.5) - u(x,y-0.5))|, u = unit vector of the "
    "TAN-SIP WCS sky position, at the object pixel"
)


def unit_vectors(ra_deg: Any, dec_deg: Any) -> NDArray[np.float64]:
    ra = np.radians(np.asarray(ra_deg, dtype=np.float64))
    dec = np.radians(np.asarray(dec_deg, dtype=np.float64))
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def pixel_solid_angle_sr(image_header: Any, x0: float, y0: float) -> float | None:
    """Solid angle (sr) of one pixel at ``(x0, y0)`` (0-based FITS orientation), or None."""
    try:
        w = wcs.celestial_wcs(image_header)
        xs = np.array([x0 + 0.5, x0 - 0.5, x0, x0], dtype=np.float64)
        ys = np.array([y0, y0, y0 + 0.5, y0 - 0.5], dtype=np.float64)
        ra, dec = w.pixel_to_world_values(xs, ys)
    except (ValueError, TypeError, KeyError, MemoryError):
        return None
    u = unit_vectors(ra, dec)
    omega = float(np.linalg.norm(np.cross(u[0] - u[1], u[2] - u[3])))
    if not math.isfinite(omega) or omega <= 0.0:
        return None
    return omega
