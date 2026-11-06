"""Normal map from a height map, equirectangular-aware (R6.5)."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from app.core.render.noise import F64


def normals_from_height(h: F64, radius_m: float, strength: float = 1.0) -> NDArray[np.uint8]:
    """Tangent-space normals, OpenGL convention (+X east/u, +Y north/up v, +Z out), as RGB8.

    ``h`` is in body-radius units, row 0 = north pole. Longitude wraps; the poles are padded.
    Unlike the R6.5 snippet, the encoding rounds instead of truncating, so a flat surface
    encodes as (128, 128, 255), not (127, 127, 255).
    """
    rows, cols = h.shape
    theta = (np.arange(rows) + 0.5) / rows * np.pi
    coslat = np.clip(np.sin(theta), 0.05, None)[:, None]
    dx = 2 * np.pi * radius_m * coslat / cols  # metres per pixel along u
    dy = np.pi * radius_m / rows  # metres per pixel along v
    hm = h * radius_m
    dh_du = (np.roll(hm, -1, axis=1) - np.roll(hm, 1, axis=1)) / (2 * dx)
    hp = np.pad(hm, ((1, 1), (0, 0)), mode="edge")
    dh_drow = (hp[2:] - hp[:-2]) / (2 * dy)  # +row = southward
    nx = -strength * dh_du
    ny = +strength * dh_drow  # tangent-space +Y points north
    n = np.stack([nx, ny, np.ones_like(nx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.rint((n * 0.5 + 0.5) * 255).astype(np.uint8)
