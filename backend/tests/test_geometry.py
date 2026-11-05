"""Proper motion, WCS, pixel convention and PNG stretch."""

from __future__ import annotations

import hashlib
import io
import math
import warnings
from datetime import UTC, datetime

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from PIL import Image

from app.core.find import png, wcs
from app.core.find.frames import frame_geometry
from app.core.find.propagate import propagate
from app.timefmt import iso_utc_z, julian_years_since_j2000, mjd_to_utc, parse_utc

# --- proper motion ------------------------------------------------------------------------

BARNARD = (269.4520769586187, 4.693364966576667, -801.551, 10362.394)  # recorded SIMBAD values


def sep_arcsec(a: tuple[float, float], b: tuple[float, float]) -> float:
    dra = (a[0] - b[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dra, a[1] - b[1]) * 3600.0


def test_barnard_moves_about_269_arcsec_by_2026() -> None:
    ra0, dec0, pmra, pmdec = BARNARD
    when = datetime(2026, 1, 1, tzinfo=UTC)
    moved = propagate(ra0, dec0, pmra, pmdec, when)
    expected = math.hypot(pmra, pmdec) / 1000.0 * julian_years_since_j2000(when)
    assert abs(sep_arcsec(moved, (ra0, dec0)) - expected) < 0.01
    assert 265 < expected < 272


def test_no_pm_means_no_motion() -> None:
    assert propagate(10.0, 20.0, None, None, datetime(2026, 1, 1, tzinfo=UTC)) == (10.0, 20.0)


def test_pm_near_pole_uses_cos_dec() -> None:
    ra, _ = propagate(10.0, 80.0, 1000.0, 0.0, datetime(2010, 1, 1, 11, 58, 55, 816000, tzinfo=UTC))
    years = julian_years_since_j2000(datetime(2010, 1, 1, 11, 58, 55, 816000, tzinfo=UTC))
    assert math.isclose(
        (ra - 10.0) * math.cos(math.radians(80.0)) * 3.6e6, 1000.0 * years, rel_tol=1e-9
    )


# --- time ---------------------------------------------------------------------------------


def test_iso_times_end_in_z() -> None:
    assert iso_utc_z(mjd_to_utc(61116.6838)).endswith("Z")
    assert iso_utc_z(parse_utc("2026-03-17T16:24:40.486")) == "2026-03-17T16:24:40.486Z"


# --- pixel convention (end to end, synthetic) -----------------------------------------------

NX, NY = 16, 12  # under 201 pixels, so only the bright pixel is above p_hi (99.5%)
CRPIX = (8.0, 6.0)  # FITS 1-based
CRVAL = (10.0, 20.0)


def synthetic_hdul(bright_ix: int, bright_iy: int) -> fits.HDUList:
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crpix = list(CRPIX)
    w.wcs.crval = list(CRVAL)
    w.wcs.cdelt = [-6.15 / 3600, 6.15 / 3600]
    data = (1.0 + 0.01 * np.arange(NY * NX)).reshape(NY, NX).astype(np.float32)
    data[bright_iy, bright_ix] = 1000.0
    img = fits.ImageHDU(data, header=w.to_header(), name="IMAGE")
    flags = np.zeros((NY, NX), dtype=np.int32)
    flags[bright_iy, bright_ix] = (1 << 10) | (1 << 21)
    fh = fits.Header()
    fh["MP_HOT"] = 10
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # 9-character keyword becomes HIERARCH, as in SPHEREx
        fh["MP_SOURCE"] = 21
    return fits.HDUList([fits.PrimaryHDU(), img, fits.ImageHDU(flags, header=fh, name="FLAGS")])


def test_world_to_pixel_at_crval_is_crpix_minus_one() -> None:
    hdul = synthetic_hdul(0, 0)
    x0, y0 = wcs.object_pixel(hdul, *CRVAL)
    assert math.isclose(x0, CRPIX[0] - 1, abs_tol=1e-9)
    assert math.isclose(y0, CRPIX[1] - 1, abs_tol=1e-9)


def test_png_argmax_equals_api_xy() -> None:
    ix, iy = int(CRPIX[0] - 1), int(CRPIX[1] - 1)  # the pixel at CRVAL
    hdul = synthetic_hdul(ix, iy)
    geo = frame_geometry(hdul, *CRVAL)
    out = png.render_png(np.asarray(hdul["IMAGE"].data))
    assert out is not None
    decoded = np.asarray(Image.open(io.BytesIO(out)))
    assert decoded.shape == (NY, NX)
    row, col = np.unravel_index(int(np.argmax(decoded)), decoded.shape)
    assert (col, row) == (round(geo.x), round(geo.y))
    # vertical flip; integer = pixel centre (no half-pixel shift)
    assert math.isclose(geo.x, ix, abs_tol=1e-9) and math.isclose(geo.y, NY - 1 - iy, abs_tol=1e-9)


def test_flags_at_nearest_pixel_uses_floor_x_plus_half() -> None:
    hdul = synthetic_hdul(7, 5)
    assert wcs.flags_at(hdul, 7.0, 5.0) == ["HOT", "SOURCE"]
    assert wcs.flags_at(hdul, 7.49, 4.51) == ["HOT", "SOURCE"]
    assert wcs.flags_at(hdul, 7.5, 5.0) == []  # floor(8.0) = 8: the next pixel
    assert wcs.flags_at(hdul, -3.0, 5.0) is None


def test_north_angle_for_standard_orientation() -> None:
    hdul = synthetic_hdul(0, 0)
    angle, mirrored = wcs.north_angle(hdul, 7.0, 5.0)
    assert abs(angle) < 1e-3 and mirrored is False  # north up, east left


# --- stretch --------------------------------------------------------------------------------


def test_png_is_deterministic() -> None:
    rng = np.random.default_rng(1)
    data = rng.normal(10.0, 2.0, (58, 59)).astype(np.float32)
    data[3, 4] = np.nan
    a, b = png.render_png(data), png.render_png(data.copy())
    assert a is not None and b is not None
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest()
    decoded = np.asarray(Image.open(io.BytesIO(a)))
    assert decoded[58 - 1 - 3, 4] == 0  # NaN -> 0, flipped row


def test_stretch_refuses_instead_of_nan() -> None:
    assert png.stretch(np.full((4, 4), np.nan)) is None
    assert png.stretch(np.full((4, 4), 3.0)) is None  # p_hi == p_lo
    assert png.render_png(np.zeros((0, 0))) is None
