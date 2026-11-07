"""Combine two cutouts of one object on frame A's grid (issue #12): A+B or A-B.

B's IMAGE is resampled onto A's pixels by bilinear interpolation through the two WCSs
(A pixel -> sky -> B pixel). A B pixel outside B, or touching a non-finite B pixel, is NaN.
Both frames must be in the same unit. Each SPHEREx frame samples a different wavelength, so a
combination of two frames mixes bands (Q-54); the reply header states both wavelengths.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np

from app.core.find import png, wcs

Op = Literal["add", "sub"]

SUB_CLIP_PERCENTILE = 99.5
SUB_ASINH_A = png.ASINH_A
MID_GREY = 128
# Numerical tolerance for the A -> sky -> B round trip (not a physical value): far below a pixel.
EDGE_TOL_PX = 1e-6
UNIT = "mjy/sr"  # BUNIT with spaces removed, lower case ("MJy / sr" in QR2)

SUB_STRETCH: dict[str, Any] = {
    "kind": "asinh_symmetric",
    "params": {
        "clip_percentile_abs": SUB_CLIP_PERCENTILE,
        "a": SUB_ASINH_A,
        "zero_value": MID_GREY,
        "nan_value": 0,
        "flip": "vertical (FITS row 0 is the bottom PNG row)",
    },
}
SUB_STRETCH_FORMULA = (
    "m = 99.5th percentile of |d| over finite pixels; v = clip(d/m, -1, 1); "
    "out = asinh(v/a)/asinh(1/a), a = 0.1; 8-bit = 128 + round(127*out) (0 -> mid-grey); "
    "m = 0 gives 128 everywhere; non-finite pixels -> 0"
)
RESAMPLE_FORMULA = (
    "B resampled onto A: A pixel centre -> (ra, dec) by A's celestial WCS -> B pixel by B's "
    "celestial WCS -> bilinear interpolation of B IMAGE; outside B or next to a non-finite B "
    "pixel -> NaN; a == b uses A itself"
)


class CombineError(ValueError):
    """The two cutouts cannot be combined (unit mismatch, or no finite pixel)."""


def unit(hdul: Any) -> str:
    return str(hdul["IMAGE"].header.get("BUNIT", "")).replace(" ", "").lower()


def resample_onto(hdul_a: Any, hdul_b: Any) -> np.ndarray:
    """B's IMAGE on A's pixel grid (FITS orientation), bilinear; NaN where B has no data."""
    ny, nx = np.asarray(hdul_a["IMAGE"].data).shape
    b = np.asarray(hdul_b["IMAGE"].data, dtype=np.float64)
    nyb, nxb = b.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    wa = wcs.celestial_wcs(hdul_a["IMAGE"].header)
    wb = wcs.celestial_wcs(hdul_b["IMAGE"].header)
    ra, dec = wa.pixel_to_world_values(xx.astype(np.float64), yy.astype(np.float64))
    xb, yb = wb.world_to_pixel_values(ra, dec)
    xb = np.asarray(xb, dtype=np.float64)
    yb = np.asarray(yb, dtype=np.float64)
    out = np.full((ny, nx), np.nan)
    if nxb < 2 or nyb < 2:
        return out
    # The WCS round trip leaves ~1e-10 px of float error, so an edge pixel of an identical grid
    # can land just outside [0, n - 1]. Accept it within EDGE_TOL_PX and clamp onto the grid.
    ok = np.isfinite(xb) & np.isfinite(yb)
    ok &= (xb >= -EDGE_TOL_PX) & (xb <= nxb - 1 + EDGE_TOL_PX)
    ok &= (yb >= -EDGE_TOL_PX) & (yb <= nyb - 1 + EDGE_TOL_PX)
    xc = np.clip(np.where(ok, xb, 0.0), 0.0, nxb - 1.0)
    yc = np.clip(np.where(ok, yb, 0.0), 0.0, nyb - 1.0)
    x0 = np.clip(np.floor(xc).astype(np.int64), 0, nxb - 2)
    y0 = np.clip(np.floor(yc).astype(np.int64), 0, nyb - 2)
    fx = xc - x0
    fy = yc - y0
    v = (
        (1 - fx) * (1 - fy) * b[y0, x0]
        + fx * (1 - fy) * b[y0, x0 + 1]
        + (1 - fx) * fy * b[y0 + 1, x0]
        + fx * fy * b[y0 + 1, x0 + 1]
    )
    out[ok] = v[ok]
    return out


def stretch_sub(d: np.ndarray) -> np.ndarray | None:
    """Symmetric asinh stretch centred on 0 (mid-grey), FITS orientation."""
    finite = np.isfinite(d)
    if not finite.any():
        return None
    m = float(np.percentile(np.abs(d[finite]), SUB_CLIP_PERCENTILE))
    u8 = np.zeros(d.shape, dtype=np.uint8)
    if not np.isfinite(m):
        return None
    if m == 0.0:
        u8[finite] = MID_GREY
        return u8
    v = np.clip(np.where(finite, d, 0.0) / m, -1.0, 1.0)
    out = np.arcsinh(v / SUB_ASINH_A) / np.arcsinh(1.0 / SUB_ASINH_A)
    vals = (MID_GREY + np.round(127.0 * out)).astype(np.uint8)
    u8[finite] = vals[finite]
    return u8


def combine(hdul_a: Any, hdul_b: Any, op: Op, *, same_frame: bool) -> tuple[bytes, dict[str, Any]]:
    """PNG bytes and the stretch used. Raises ``CombineError``."""
    if unit(hdul_a) != UNIT or unit(hdul_b) != UNIT:
        raise CombineError("both cutouts must have IMAGE in MJy/sr (BUNIT)")
    a = np.asarray(hdul_a["IMAGE"].data, dtype=np.float64)
    b = a.copy() if same_frame else resample_onto(hdul_a, hdul_b)
    if op == "add":
        u8 = png.stretch(a + b)
        stretch: dict[str, Any] = png.STRETCH
    else:
        u8 = stretch_sub(a - b)
        stretch = SUB_STRETCH
    if u8 is None:
        raise CombineError("the combined image has no finite pixel to stretch")
    return png.encode_png(u8), stretch


def formula(op: Op) -> str:
    expr = "A + B" if op == "add" else "A - B"
    stretch = png.STRETCH_FORMULA if op == "add" else SUB_STRETCH_FORMULA
    return f"{expr} in MJy/sr on A's grid; {RESAMPLE_FORMULA}; stretch: {stretch}"
