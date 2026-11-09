"""Output grid, resampling, stretch and PNG for the composite (pure numpy, astropy WCS, Pillow).

Grid: a TAN (gnomonic) projection centred on the object, north up and east left (FITS
convention ``CDELT1 < 0``, ``CDELT2 > 0``), with an odd number of pixels a side so the centre is
a pixel centre. Arrays are kept in FITS orientation (row 0 = south) and flipped vertically when
the PNG is written, exactly like the cutout PNG (``app.core.find.png``): a PNG pixel ``(x, y)``
is the FITS pixel ``(x, (n - 1) - y)``.

Resampling: each output pixel centre -> (RA, Dec) through the grid WCS -> 0-based pixel in the
frame through the frame's own TAN-SIP WCS (``all_world2pix``) -> bilinear interpolation of the
frame's IMAGE. A sample outside the frame, or with a non-finite neighbour, is no data (NaN).
"""

from __future__ import annotations

import io
import math
import warnings
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.core.composite import config
from app.core.find import wcs as find_wcs
from app.core.measure import flags, solid_angle

F64 = NDArray[np.float64]
SR_TO_ARCSEC2 = (180.0 / math.pi * 3600.0) ** 2
MIN_SIZE = 3


def grid_size(size_arcsec: float, scale_arcsec: float) -> int:
    """The odd side length nearest to ``size_arcsec / scale_arcsec`` (ties go down), so the
    object sits on a pixel centre."""
    n = size_arcsec / scale_arcsec
    below = 2 * math.floor((n - 1.0) / 2.0) + 1
    best = below if n - below <= below + 2 - n else below + 2
    return max(MIN_SIZE, best)


def local_scale_arcsec(image_header: Any, x_fits0: float, y_fits0: float) -> float | None:
    """sqrt(pixel solid angle) at a pixel, in arcsec, from the frame's TAN-SIP WCS."""
    omega = solid_angle.pixel_solid_angle_sr(image_header, x_fits0, y_fits0)
    if omega is None:
        return None
    return math.sqrt(omega * SR_TO_ARCSEC2)


@dataclass(frozen=True)
class Grid:
    ra: float  # centre, deg
    dec: float
    scale_arcsec: float
    size: int

    @property
    def centre_fits0(self) -> float:
        return (self.size - 1) / 2.0

    def wcs(self) -> Any:
        from astropy.wcs import WCS

        w = WCS(naxis=2)
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        w.wcs.cunit = ["deg", "deg"]
        w.wcs.crval = [self.ra, self.dec]
        w.wcs.crpix = [self.centre_fits0 + 1.0, self.centre_fits0 + 1.0]
        w.wcs.cdelt = [-self.scale_arcsec / 3600.0, self.scale_arcsec / 3600.0]
        w.wcs.radesys = "ICRS"
        return w

    def sky(self) -> tuple[F64, F64]:
        """(RA, Dec) in degrees of every output pixel centre, FITS orientation ``[y, x]``."""
        yy, xx = np.mgrid[0 : self.size, 0 : self.size].astype(np.float64)
        ra, dec = self.wcs().wcs_pix2world(xx, yy, 0)
        return np.asarray(ra, dtype=np.float64), np.asarray(dec, dtype=np.float64)

    def png_xy(self, ra: float, dec: float) -> tuple[float, float]:
        """0-based PNG position (origin top left, y down) of a sky position."""
        x, y = self.wcs().wcs_world2pix(ra, dec, 0)
        return float(x), (self.size - 1) - float(y)


def bilinear(image: NDArray[Any], x: F64, y: F64) -> F64:
    """Bilinear sample of ``image[y, x]`` at 0-based pixel coordinates; NaN means no data."""
    data = np.asarray(image, dtype=np.float64)
    ny, nx = data.shape
    out = np.full(x.shape, np.nan, dtype=np.float64)
    if nx < 2 or ny < 2:
        return out
    ok = np.isfinite(x) & np.isfinite(y) & (x >= 0) & (x <= nx - 1) & (y >= 0) & (y <= ny - 1)
    if not ok.any():
        return out
    xs, ys = x[ok], y[ok]
    x0 = np.minimum(np.floor(xs).astype(np.int64), nx - 2)
    y0 = np.minimum(np.floor(ys).astype(np.int64), ny - 2)
    fx, fy = xs - x0, ys - y0
    i00 = data[y0, x0]
    i10 = data[y0, x0 + 1]
    i01 = data[y0 + 1, x0]
    i11 = data[y0 + 1, x0 + 1]
    finite = np.isfinite(i00) & np.isfinite(i10) & np.isfinite(i01) & np.isfinite(i11)
    v = (
        (1 - fx) * (1 - fy) * np.where(finite, i00, 0.0)
        + fx * (1 - fy) * np.where(finite, i10, 0.0)
        + (1 - fx) * fy * np.where(finite, i01, 0.0)
        + fx * fy * np.where(finite, i11, 0.0)
    )
    out[ok] = np.where(finite, v, np.nan)
    return out


def masked_image(hdul: Any) -> tuple[NDArray[np.float64], bool]:
    """IMAGE as float64 with every pixel that carries a ``MASK_FLAGS`` bit set to NaN (no data),
    and whether the mask could be applied.

    Bits come from the FLAGS header (``MP_*``). A cutout without FLAGS, with a FLAGS array of
    another shape, or whose header defines none of ``MASK_FLAGS``, is used unmasked (``False``);
    the caller lists that.
    """
    data = np.array(hdul["IMAGE"].data, dtype=np.float64)
    if "FLAGS" not in hdul:
        return data, False
    bits = flags.bits_by_name(hdul["FLAGS"].header)
    flag_arr = np.asarray(hdul["FLAGS"].data)
    if flag_arr.shape != data.shape or not any(n in bits for n in config.MASK_FLAGS):
        return data, False
    mask, _ = flags.mask_of(flag_arr, config.MASK_FLAGS, bits)
    data[mask] = np.nan
    return data, True


def resample(image: NDArray[Any], image_header: Any, ra: F64, dec: F64) -> F64:
    """The frame's IMAGE sampled at sky positions ``(ra, dec)`` (any shape)."""
    w = find_wcs.celestial_wcs(image_header)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        # quiet: a point the SIP inversion cannot converge on keeps its best estimate instead of
        # raising; only points far outside the frame can fail, and those fail the bounds check.
        x, y = w.all_world2pix(ra.ravel(), dec.ravel(), 0, quiet=True)
    xs = np.asarray(x, dtype=np.float64).reshape(ra.shape)
    ys = np.asarray(y, dtype=np.float64).reshape(ra.shape)
    return bilinear(image, xs, ys)


def stretch(band: F64) -> NDArray[np.uint8] | None:
    """Per-band asinh stretch between the band's own robust limits; no data -> 0.

    ``lo`` = the ``LOWER_PERCENTILE`` (the median: the sky), ``hi`` = the larger of the
    ``UPPER_PERCENTILE`` and ``median + MIN_RANGE_SIGMA * 1.4826 * MAD``.
    """
    finite = np.isfinite(band)
    if not finite.any():
        return None
    values = band[finite]
    lo, hi = np.percentile(values, [config.LOWER_PERCENTILE, config.UPPER_PERCENTILE])
    med = float(np.median(values))
    sigma = config.MAD_TO_SIGMA * float(np.median(np.abs(values - med)))
    hi = max(float(hi), med + config.MIN_RANGE_SIGMA * sigma)
    if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
        return None
    v = np.clip((np.where(finite, band, lo) - lo) / (hi - lo), 0.0, 1.0)
    out = np.arcsinh(v / config.ASINH_A) / np.arcsinh(1.0 / config.ASINH_A)
    u8: NDArray[np.uint8] = np.round(out * 255.0).astype(np.uint8)
    u8[~finite] = 0
    return u8


def encode_rgb(red: NDArray[np.uint8], green: NDArray[np.uint8], blue: NDArray[np.uint8]) -> bytes:
    """8-bit RGB PNG from three bands in FITS orientation (flipped so north is up)."""
    rgb = np.stack([red, green, blue], axis=-1)
    img = Image.fromarray(np.ascontiguousarray(np.flipud(rgb)))  # uint8 (h, w, 3) -> RGB
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=config.COMPRESS_LEVEL, optimize=False)
    return buf.getvalue()
