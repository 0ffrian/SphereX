"""Sky to pixel per frame (A4.1 step 3), wavelength and flags at the object pixel.

Pixel conventions:
- FITS orientation, 0-based (``x_fits0``, ``y_fits0``): astropy ``world_to_pixel``; integer
  coordinates are pixel centres (pixel 0 spans -0.5 to +0.5). Stage 2 (#2) uses these.
- PNG as served (API ``x``, ``y``): the FITS array flipped vertically, origin top-left, y down:
  ``x = x_fits0``, ``y = (ny - 1) - y_fits0``.
"""

from __future__ import annotations

import io
import math
import re
import warnings
from typing import Any

import numpy as np

SIP_KEY = re.compile(r"^(A|B|AP|BP)_(\d+_\d+|ORDER|DMAX)$")

NORTH_ANGLE_FORMULA = (
    "north_angle_deg = atan2(-dx_n, dy_n) of the pixel step towards +1 arcsec Dec, in the "
    "displayed PNG (counter-clockwise from up); mirrored when east is to the right of north. "
    "Rotate the PNG clockwise by north_angle_deg about (x, y), then flip horizontally if mirrored, "
    "to show north up and east left"
)


def open_fits(body: bytes) -> Any:
    from astropy.io import fits

    return fits.open(io.BytesIO(body), memmap=False, lazy_load_hdus=False)


def celestial_wcs(header: Any) -> Any:
    from astropy.wcs import WCS

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return WCS(header)


def object_pixel(hdul: Any, ra: float, dec: float) -> tuple[float, float]:
    """0-based pixel in FITS array orientation for (ra, dec) in degrees."""
    w = celestial_wcs(hdul["IMAGE"].header)
    x, y = w.world_to_pixel_values(ra, dec)
    return float(x), float(y)


def to_png_xy(x_fits0: float, y_fits0: float, ny: int) -> tuple[float, float]:
    return x_fits0, (ny - 1) - y_fits0


def png_xy_many(hdul: Any, ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """``object_pixel`` then ``to_png_xy`` for many positions (issue #12 markers): the same WCS
    call and the same flip as the frames reply ``x``, ``y``."""
    ny = np.asarray(hdul["IMAGE"].data).shape[0]
    w = celestial_wcs(hdul["IMAGE"].header)
    x0, y0 = w.world_to_pixel_values(np.asarray(ra, float), np.asarray(dec, float))
    x0 = np.asarray(x0, dtype=np.float64)
    y0 = np.asarray(y0, dtype=np.float64)
    return x0, (ny - 1) - y0


def png_corners_world(hdul: Any) -> list[tuple[float, float]]:
    """(ra, dec) of the outer pixel corners of the cutout, in PNG order: top-left, top-right,
    bottom-right, bottom-left (PNG top = last FITS row)."""
    ny, nx = np.asarray(hdul["IMAGE"].data).shape
    w = celestial_wcs(hdul["IMAGE"].header)
    xs = np.array([-0.5, nx - 0.5, nx - 0.5, -0.5])
    ys = np.array([ny - 0.5, ny - 0.5, -0.5, -0.5])
    ra, dec = w.pixel_to_world_values(xs, ys)
    return [(float(r) % 360.0, float(d)) for r, d in zip(ra, dec, strict=True)]


def inside(x: float, y: float, nx: int, ny: int) -> bool:
    return -0.5 <= x < nx - 0.5 and -0.5 <= y < ny - 0.5


def wavelength_at(hdul: Any, x_fits0: float, y_fits0: float) -> tuple[float, float] | None:
    """Central wavelength and bandwidth (um) at a pixel, from the ``WCS-WAVE`` lookup table.

    The table WCS (alternate key ``W``) shares the header with the celestial SIP keywords;
    astropy would apply them to the table lookup, so the SIP keywords are dropped from a copy of
    the header first (same effect as ``wcs.sip = None`` in IRSA's SPHEREx examples) [verify].
    """
    from astropy import units as u
    from astropy.wcs import WCS

    try:
        header = hdul["IMAGE"].header.copy()
        for k in [k for k in header if SIP_KEY.match(k)]:
            del header[k]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ww = WCS(header, fobj=hdul, key="W")
            wl, bw = ww.pixel_to_world(x_fits0, y_fits0)
        wl_um = float(u.Quantity(wl).to_value(u.um))
        bw_um = float(u.Quantity(bw).to_value(u.um))
    except (KeyError, ValueError, TypeError, AttributeError, MemoryError):
        return None
    if not (math.isfinite(wl_um) and wl_um > 0 and math.isfinite(bw_um)):
        return None
    return wl_um, bw_um


def flag_names(header: Any) -> dict[int, str]:
    """Bit number -> name from the FLAGS header (e.g. 10 -> HOT).

    Two conventions: QR2 writes ``MP_<NAME> = <bit>``; QR3 and DR1 write mask planes,
    ``MSKNnnnn = '<NAME>'`` with ``MSKMnnnn = 1 << n`` (same names and bit numbers). ``MP_*``
    wins when both are present. A ``MSKM`` that is not a single bit is ignored."""
    out: dict[int, str] = {}
    for k, v in header.items():
        if k.startswith("MP_") and isinstance(v, int) and not isinstance(v, bool):
            out[v] = k[3:]
    if out:
        return out
    for k, v in header.items():
        if not (k.startswith("MSKN") and isinstance(v, str) and v.strip()):
            continue
        mask = header.get("MSKM" + k[4:])
        single_bit = isinstance(mask, int) and not isinstance(mask, bool) and mask > 0
        if single_bit and mask & (mask - 1) == 0:
            out[mask.bit_length() - 1] = v.strip()
    return out


def flags_at(hdul: Any, x_fits0: float, y_fits0: float) -> list[str] | None:
    """Names of the FLAGS bits set at the nearest pixel (``floor(x + 0.5)``)."""
    if "FLAGS" not in hdul:
        return None
    data = np.asarray(hdul["FLAGS"].data)
    ix, iy = math.floor(x_fits0 + 0.5), math.floor(y_fits0 + 0.5)
    if not (0 <= iy < data.shape[0] and 0 <= ix < data.shape[1]):
        return None
    value = int(data[iy, ix])
    names = flag_names(hdul["FLAGS"].header)
    return [names.get(bit, f"BIT{bit}") for bit in range(32) if value >> bit & 1]


def north_angle(hdul: Any, x_fits0: float, y_fits0: float) -> tuple[float, bool]:
    w = celestial_wcs(hdul["IMAGE"].header)
    ra, dec = (float(v) for v in w.pixel_to_world_values(x_fits0, y_fits0))
    step = 1.0 / 3600.0
    xn, yn = (float(v) for v in w.world_to_pixel_values(ra, dec + step))
    cosd = max(math.cos(math.radians(dec)), 1e-9)
    xe, ye = (float(v) for v in w.world_to_pixel_values(ra + step / cosd, dec))
    dxn, dyn = xn - x_fits0, yn - y_fits0  # FITS deltas = displayed PNG deltas with y up
    dxe, dye = xe - x_fits0, ye - y_fits0
    angle = math.degrees(math.atan2(-dxn, dyn))
    mirrored = (dxn * dye - dyn * dxe) < 0
    return round(angle, 3), mirrored
