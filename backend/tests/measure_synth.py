"""Synthetic SPHEREx-like cutouts for Stage 2 tests (deterministic; nothing binary is committed).

Images are non-square and the target sits off the diagonal, with a decoy source 5 px to its
right, so an x/y swap puts the aperture on empty sky and fails the analytic checks.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from astropy.io import fits

PIXEL_ARCSEC = 6.15
NX, NY = 41, 33
X0, Y0 = 17.3, 12.6
SKY = 0.3  # MJy/sr
VAR = 1.0e-3  # (MJy/sr)^2
# Source: 2x2 block fully inside the core, total S (sum of pixel values, MJy/sr).
SOURCE_PIXELS = ((17, 12), (18, 12), (17, 13), (18, 13))  # (x, y)
SOURCE_TOTAL = 8.0
DECOY_PIXELS = ((22, 12), (23, 12), (22, 13), (23, 13))
DECOY_TOTAL = 40.0
OUTER_PIXEL = (20, 12)  # (x, y): inside the aperture, outside the 1.5 px core

# Copied from a real QR2 cutout FLAGS header (IRSA, 5 Nov 2026; scratch probe of issue #1).
MP_BITS = {
    "TRANSIENT": 0,
    "OVERFLOW": 1,
    "SUR_ERROR": 2,
    "PHANTOM": 4,
    "REFERENCE": 5,
    "NONFUNC": 6,
    "DICHROIC": 7,
    "MISSING_DATA": 9,
    "HOT": 10,
    "COLD": 11,
    "FULLSAMPLE": 12,
    "PHANMISS": 14,
    "NONLINEAR": 15,
    "PERSIST": 17,
    "OUTLIER": 19,
    "SOURCE": 21,
    "GHOST": 22,
    "GHOST_FPA": 23,
    "GHOST_EXT": 24,
    "BLOOM": 26,
    "SNOWBALL": 27,
    "HALO": 28,
}


def celestial_header(
    nx: int = NX, ny: int = NY, crval: tuple[float, float] = (150.0, 2.0), crpix0: Any = None
) -> fits.Header:
    """Plain TAN WCS, 6.15 arcsec/px, east left. ``crpix0`` = 0-based reference pixel (x, y)."""
    cx, cy = crpix0 if crpix0 is not None else ((nx - 1) / 2.0, (ny - 1) / 2.0)
    h = fits.Header()
    h["WCSAXES"] = 2
    h["CTYPE1"], h["CTYPE2"] = "RA---TAN", "DEC--TAN"
    h["CUNIT1"], h["CUNIT2"] = "deg", "deg"
    h["CRPIX1"], h["CRPIX2"] = cx + 1.0, cy + 1.0
    h["CRVAL1"], h["CRVAL2"] = crval
    h["CDELT1"], h["CDELT2"] = -PIXEL_ARCSEC / 3600.0, PIXEL_ARCSEC / 3600.0
    h["RADESYS"] = "ICRS"
    return h


@dataclass
class Synth:
    nx: int = NX
    ny: int = NY
    crval: tuple[float, float] = (150.0, 2.0)
    image_bunit: str | None = "MJy / sr"
    var_bunit: str | None = "MJy2 / sr2"
    mp_keys: bool = True
    mp_omit: tuple[str, ...] = ()
    sky: float = SKY
    var: float = VAR
    image: np.ndarray[Any, Any] = field(init=False)
    variance: np.ndarray[Any, Any] = field(init=False)
    flags: np.ndarray[Any, Any] = field(init=False)

    def __post_init__(self) -> None:
        self.image = np.full((self.ny, self.nx), self.sky, dtype=np.float64)
        self.variance = np.full((self.ny, self.nx), self.var, dtype=np.float64)
        self.flags = np.zeros((self.ny, self.nx), dtype=np.int32)

    def add_block(self, pixels: tuple[tuple[int, int], ...], total: float) -> Synth:
        for x, y in pixels:
            self.image[y, x] += total / len(pixels)
        return self

    def standard(self) -> Synth:
        """Target block + decoy block on flat sky."""
        return self.add_block(SOURCE_PIXELS, SOURCE_TOTAL).add_block(DECOY_PIXELS, DECOY_TOTAL)

    def set_flag(self, x: int, y: int, *names: str) -> Synth:
        for n in names:
            self.flags[y, x] |= 1 << MP_BITS[n]
        return self

    def hdul(self) -> fits.HDUList:
        cel = celestial_header(self.nx, self.ny, self.crval)
        img_h = cel.copy()
        if self.image_bunit is not None:
            img_h["BUNIT"] = self.image_bunit
        var_h = cel.copy()
        if self.var_bunit is not None:
            var_h["BUNIT"] = self.var_bunit
        flag_h = cel.copy()
        if self.mp_keys:
            for name, bit in MP_BITS.items():
                if name in self.mp_omit:
                    continue
                flag_h[f"HIERARCH MP_{name}"] = bit
        return fits.HDUList(
            [
                fits.PrimaryHDU(),
                fits.ImageHDU(self.image.astype(np.float32), img_h, name="IMAGE"),
                fits.ImageHDU(self.flags, flag_h, name="FLAGS"),
                fits.ImageHDU(self.variance.astype(np.float32), var_h, name="VARIANCE"),
            ]
        )

    def fits_bytes(self) -> bytes:
        buf = io.BytesIO()
        self.hdul().writeto(buf)
        return buf.getvalue()
