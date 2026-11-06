"""Seeded 3D value noise and fbm on the unit sphere (R6.1, R6.3).

Everything is a pure function of (direction, seed), so a map is seamless at u = 0/1 by
construction and the same inputs always give the same array.
"""

from __future__ import annotations

import hashlib

import numpy as np
from numpy.typing import NDArray

F64 = NDArray[np.float64]
_MASK = 0xFFFFFFFF


def seed32(seed: int) -> int:
    """Fold any non-negative seed (Q-35) into the 32 bits the noise hash uses.

    SHA-256 of the decimal seed, so every bit of a 64-bit seed matters (seeds 0 and 2**32 differ).
    """
    return int.from_bytes(hashlib.sha256(str(seed).encode("ascii")).digest()[:4], "big")


def sphere_dirs(height: int, width: int) -> F64:
    """Unit direction of every pixel centre, shape (H, W, 3), as in R6.1.

    Row 0 is the north pole (three.js ``SphereGeometry`` with ``flipY = true``).
    """
    theta = (np.arange(height) + 0.5) / height * np.pi
    phi = (np.arange(width) + 0.5) / width * 2 * np.pi
    st, ct = np.sin(theta)[:, None], np.cos(theta)[:, None]
    out = np.empty((height, width, 3), dtype=np.float64)
    out[..., 0] = -np.cos(phi)[None, :] * st
    out[..., 1] = ct
    out[..., 2] = np.sin(phi)[None, :] * st
    return out


def _rand(ix: NDArray[np.int64], iy: NDArray[np.int64], iz: NDArray[np.int64], seed: int) -> F64:
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) & _MASK
    h = ((h ^ (h >> 13)) * 1274126177) & _MASK
    return ((h ^ (h >> 16)) / 4294967295.0).astype(np.float64)


def value_noise3(p: F64, seed: int) -> F64:
    """Smooth value noise in [-1, 1]; ``p`` has shape (..., 3)."""
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * (3 - 2 * f)
    out = np.zeros(p.shape[:-1], dtype=np.float64)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (
                    (u[..., 0] if dx else 1 - u[..., 0])
                    * (u[..., 1] if dy else 1 - u[..., 1])
                    * (u[..., 2] if dz else 1 - u[..., 2])
                )
                out += w * _rand(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out * 2 - 1


def fbm(
    dirs: F64, seed: int, octaves: int, freq: float, lacunarity: float = 2.0, gain: float = 0.5
) -> F64:
    """Fractal sum of ``octaves`` value-noise layers. Not normalised: see ``normalise``."""
    total = np.zeros(dirs.shape[:-1], dtype=np.float64)
    amp = 1.0
    for o in range(octaves):
        total += amp * value_noise3(dirs * (freq * lacunarity**o), seed + o)
        amp *= gain
    return total


def normalise(field: F64) -> F64:
    """Scale to about [-1, 1] by the 99.5th percentile of |field|, then clip.

    Data-dependent but deterministic; it makes ``relief_amp`` mean the peak relief.
    """
    scale = float(np.percentile(np.abs(field), 99.5))
    if scale <= 0.0:
        return np.zeros_like(field)
    return np.clip(field / scale, -1.0, 1.0)
