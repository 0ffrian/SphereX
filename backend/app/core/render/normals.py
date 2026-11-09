"""Normal map from a height map, equirectangular-aware (R6.5)."""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from app.core.render.noise import F64


def normals_from_height(h: F64, radius_m: float, strength: float = 1.0) -> NDArray[np.uint8]:
    """Unit normals from ``normal_vectors``, encoded as RGB8 (rounded, R6.5)."""
    n = normal_vectors(h, radius_m, strength)
    return np.rint((n * 0.5 + 0.5) * 255).astype(np.uint8)


def normal_vectors(h: F64, radius_m: float, strength: float = 1.0) -> F64:
    """Tangent-space unit normals, OpenGL convention (+X east/u, +Y north/up v, +Z out), float64.

    ``h`` is in body-radius units, row 0 = north pole. Longitude wraps; the poles are padded.
    Encoded by ``normals_from_height``, a flat surface is (128, 128, 255). Also the hillshade of
    the Gemini repaint (R6.6), so one height field drives both. Non-finite heights would
    give zero-length normals, so they are rejected here as well as at the card.
    """
    if not np.all(np.isfinite(h)) or not math.isfinite(radius_m) or radius_m <= 0:
        raise ValueError("height map and radius must be finite, radius > 0")
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
    return n
