"""Aperture weights, annulus and background (pure numpy; arrays are indexed ``[y, x]``).

Pixel ``(x, y)`` (column, row) spans ``x +- 0.5`` and ``y +- 0.5``; integer coordinates are pixel
centres, like Stage 1's ``x_fits0``/``y_fits0``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

Shape = tuple[int, int]


def pixel_centres(shape: Shape) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """``(xx, yy)`` for an array of ``shape = (ny, nx)``: the one place x and y are laid out."""
    ny, nx = shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    return xx.astype(np.float64), yy.astype(np.float64)


def aperture_inside(shape: Shape, x0: float, y0: float, r: float) -> bool:
    """True when every pixel the circle touches lies inside the array."""
    ny, nx = shape
    return x0 - r >= 0.0 and y0 - r >= 0.0 and x0 + r <= nx - 1.0 and y0 + r <= ny - 1.0


def aperture_weights(
    shape: Shape, x0: float, y0: float, r: float, subpixels: int
) -> NDArray[np.float64]:
    """Fraction of an ``n x n`` grid of sub-pixel centres inside the circle, per pixel.

    Deterministic; a weight changes in steps of ``1 / n**2`` as the centre moves.
    """
    n = int(subpixels)
    xx, yy = pixel_centres(shape)
    w = np.zeros(shape, dtype=np.float64)
    box = (np.abs(xx - x0) <= r + 1.0) & (np.abs(yy - y0) <= r + 1.0)
    if not box.any():
        return w
    offs = (np.arange(n, dtype=np.float64) + 0.5) / n - 0.5
    bx = xx[box][:, None, None] + offs[None, None, :]  # x varies along the last axis
    by = yy[box][:, None, None] + offs[None, :, None]  # y along the middle axis
    inside = (bx - x0) ** 2 + (by - y0) ** 2 <= r * r
    w[box] = inside.reshape(inside.shape[0], -1).mean(axis=1)
    return w


def distance(shape: Shape, x0: float, y0: float) -> NDArray[np.float64]:
    xx, yy = pixel_centres(shape)
    return np.asarray(np.hypot(xx - x0, yy - y0), dtype=np.float64)


def annulus_mask(
    shape: Shape, x0: float, y0: float, r_in: float, r_out: float
) -> NDArray[np.bool_]:
    d = distance(shape, x0, y0)
    return np.asarray((d >= r_in) & (d < r_out), dtype=np.bool_)


@dataclass(frozen=True)
class Background:
    level: float  # MJy/sr
    variance: float  # (MJy/sr)^2, variance of the level
    n: int  # pixels kept after clipping


def clipped_background(
    values: NDArray[Any], variances: NDArray[Any], sigma: float, maxiters: int, min_pixels: int
) -> Background | None:
    """Sigma-clipped mean of the annulus pixels and the variance of that mean.

    ``var(B) = max(sum(V) / N**2, s**2 / N)``: the VARIANCE term, unless the scatter of the kept
    pixels (``s``, ddof 1) is larger (confusion, faint neighbours). None below ``min_pixels``.
    When the robust width (MAD) is zero, clipping uses the ordinary sample std.
    """
    from astropy.stats import mad_std, sigma_clip

    v = np.asarray(values, dtype=np.float64)
    var = np.asarray(variances, dtype=np.float64)
    if v.size < max(min_pixels, 2):
        return None
    # More than half the pixels sharing one value gives a zero robust width, which would clip
    # every other pixel however close; then clip with the ordinary sample std instead (same
    # k). If that is zero too, every value is equal and nothing is clipped.
    stdfunc = "mad_std" if float(mad_std(v)) > 0.0 else "std"
    clipped = sigma_clip(v, sigma=sigma, maxiters=maxiters, cenfunc="median", stdfunc=stdfunc)
    keep = ~np.ma.getmaskarray(clipped)
    n = int(keep.sum())
    if n < max(min_pixels, 2):
        return None
    kept = v[keep]
    level = float(np.mean(kept))
    var_v = float(np.sum(var[keep])) / (n * n)
    var_s = float(np.var(kept, ddof=1)) / n
    return Background(level=level, variance=max(var_v, var_s), n=n)
