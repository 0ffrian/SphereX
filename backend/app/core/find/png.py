"""Cutout PNG: per-frame asinh stretch, 8-bit grey, deterministic bytes (D-16)."""

from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

LOWER_PERCENTILE = 1.0
UPPER_PERCENTILE = 99.5
ASINH_A = 0.1
COMPRESS_LEVEL = 6

STRETCH: dict[str, Any] = {
    "kind": "asinh",
    "params": {
        "lower_percentile": LOWER_PERCENTILE,
        "upper_percentile": UPPER_PERCENTILE,
        "a": ASINH_A,
        "per_frame": True,
        "nan_value": 0,
        "flip": "vertical (FITS row 0 is the bottom PNG row)",
    },
}
STRETCH_FORMULA = (
    "v = clip((d - p_lo)/(p_hi - p_lo), 0, 1) with p_lo, p_hi the 1st and 99.5th percentiles of "
    "the finite pixels of this frame; out = asinh(v/a)/asinh(1/a), a = 0.1; "
    "8-bit = round(255*out); non-finite pixels -> 0"
)


def stretch(image: np.ndarray) -> np.ndarray | None:
    """8-bit stretched image in FITS orientation, or ``None`` if it cannot be stretched."""
    data = np.asarray(image, dtype=np.float64)
    if data.ndim != 2 or data.size == 0:
        return None
    finite = np.isfinite(data)
    if not finite.any():
        return None
    lo, hi = np.percentile(data[finite], [LOWER_PERCENTILE, UPPER_PERCENTILE])
    if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
        return None
    v = np.clip((np.where(finite, data, lo) - lo) / (hi - lo), 0.0, 1.0)
    out = np.arcsinh(v / ASINH_A) / np.arcsinh(1.0 / ASINH_A)
    u8: np.ndarray = np.round(out * 255.0).astype(np.uint8)
    u8[~finite] = 0
    return u8


def encode_png(u8_fits_orientation: np.ndarray) -> bytes:
    img = Image.fromarray(np.ascontiguousarray(np.flipud(u8_fits_orientation)))
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=COMPRESS_LEVEL, optimize=False)
    return buf.getvalue()


def render_png(image: np.ndarray) -> bytes | None:
    u8 = stretch(image)
    return None if u8 is None else encode_png(u8)
