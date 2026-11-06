"""Colour (R6.4): deterministic palettes, no AI. Linear RGB in, 8-bit sRGB out."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from app.core.render.noise import F64
from app.core.render.params import BakeParams

# R6.4, tag inferred_from_analog. Used only when gaia_rgb is missing.
ASTEROID_PALETTE: dict[str, tuple[float, float, float]] = {
    "S": (0.62, 0.55, 0.47),
    "C": (0.26, 0.25, 0.24),
    "V": (0.70, 0.62, 0.55),
    "X": (0.45, 0.44, 0.43),
}

# PLACEHOLDER (inferred_from_analog): R7.4 says "T is warmer, Y is cooler with a water-cloud
# haze" but gives no numbers. Values are (base linear RGB, haze fraction). See Q-47.
BROWN_DWARF_PALETTE: dict[str, tuple[tuple[float, float, float], float]] = {
    "T": ((0.50, 0.24, 0.14), 0.0),
    "Y": ((0.30, 0.26, 0.36), 0.2),
}
_HAZE_RGB = (0.80, 0.82, 0.90)


def srgb_encode(linear: F64) -> NDArray[np.uint8]:
    """IEC 61966-2-1 transfer curve, rounded to 8 bits."""
    x = np.clip(linear, 0.0, 1.0)
    s = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.rint(s * 255).astype(np.uint8)


def asteroid_albedo(p: BakeParams, lowfreq: F64, floor_mask: F64) -> NDArray[np.uint8]:
    """base_rgb * brightness * (1 + 0.05 lowfreq) * (1 - 0.15 floor); hydration, redness (R6.2)."""
    base = np.array(p.base_rgb, dtype=np.float64)
    base[0] += p.redness  # redness: shift the tint toward red
    base[2] -= p.redness
    base = np.clip(base, 0.0, 1.0) * p.brightness
    contrast = 0.7 if p.hydration else 1.0
    gain = 0.85 if p.hydration else 1.0
    factor = (1.0 + 0.05 * contrast * lowfreq) * (1.0 - 0.15 * contrast * floor_mask)
    return srgb_encode(base[None, None, :] * (gain * factor)[..., None])


def bands_albedo(p: BakeParams, band: F64) -> NDArray[np.uint8]:
    """Band texture: base colour modulated by ``band`` in [-1, 1] at ``band_contrast``."""
    base = np.array(p.base_rgb, dtype=np.float64)
    base = base * (1 - p.haze) + np.array(_HAZE_RGB) * p.haze
    return srgb_encode(base[None, None, :] * (1.0 + p.band_contrast * band)[..., None])
