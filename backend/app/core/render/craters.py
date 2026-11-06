"""Craters and boulders on the sphere (R6.3).

Features are evaluated only inside their latitude/longitude bounding box; 500 craters over a
2M-pixel map would otherwise be far too slow.
"""

from __future__ import annotations

import math

import numpy as np

from app.core.render.noise import F64

# CREATIVE constants (artistic): the spec fixes the profile but not the size range.
CRATER_R_MIN = 0.02  # angular radius, radians
CRATER_R_MAX = 0.20
BOULDER_SIGMA = 0.012  # radians
BOULDER_AMP = 0.006  # fraction of the body radius
BOULDERS_PER_UNIT_DENSITY = 300


class _Grid:
    """1D trig tables so a feature only builds the directions inside its box."""

    def __init__(self, height: int, width: int) -> None:
        theta = (np.arange(height) + 0.5) / height * np.pi
        phi = (np.arange(width) + 0.5) / width * 2 * np.pi
        self.h, self.w = height, width
        self.sin_t, self.cos_t = np.sin(theta), np.cos(theta)
        self.sin_p, self.cos_p = np.sin(phi), np.cos(phi)

    def patch(self, theta_c: float, phi_c: float, rho: float) -> tuple[np.ndarray, np.ndarray, F64]:
        """Rows, columns and unit directions (nr, nc, 3) of pixels within ``rho`` of the centre."""
        r0 = max(0, math.floor((theta_c - rho) / math.pi * self.h))
        r1 = min(self.h - 1, math.ceil((theta_c + rho) / math.pi * self.h))
        rows = np.arange(r0, r1 + 1)
        pole = theta_c - rho <= 0 or theta_c + rho >= math.pi
        cols = np.arange(self.w)
        if not pole:
            dphi = math.asin(min(1.0, math.sin(rho) / math.sin(theta_c)))
            c0 = math.floor((phi_c - dphi) / (2 * math.pi) * self.w)
            c1 = math.ceil((phi_c + dphi) / (2 * math.pi) * self.w)
            if c1 - c0 + 1 < self.w:
                cols = np.arange(c0, c1 + 1) % self.w
        d = np.empty((len(rows), len(cols), 3), dtype=np.float64)
        st = self.sin_t[rows][:, None]
        d[..., 0] = -self.cos_p[cols][None, :] * st
        d[..., 1] = self.cos_t[rows][:, None]
        d[..., 2] = self.sin_p[cols][None, :] * st
        return rows, cols, d


def _centres(rng: np.random.Generator, count: int) -> tuple[F64, F64]:
    """Uniform points on the sphere as (theta, phi) in the R6.1 convention."""
    theta = np.arccos(rng.uniform(-1.0, 1.0, count))
    phi = rng.uniform(0.0, 2 * np.pi, count)
    return theta, phi


def _direction(theta: float, phi: float) -> F64:
    return np.array(
        [-math.cos(phi) * math.sin(theta), math.cos(theta), math.sin(phi) * math.sin(theta)]
    )


def _angular_distance(d: F64, centre: F64) -> F64:
    chord = np.sqrt(np.sum((d - centre) ** 2, axis=-1))
    return np.asarray(2.0 * np.arcsin(np.clip(chord / 2.0, 0.0, 1.0)))


def craters(height: int, width: int, seed: int, count: int) -> tuple[F64, F64]:
    """Crater height (radius units) and floor mask in [0, 1], both (H, W)."""
    h = np.zeros((height, width), dtype=np.float64)
    floor = np.zeros((height, width), dtype=np.float64)
    if count <= 0:
        return h, floor
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 1])))
    radii = np.minimum(CRATER_R_MIN * (1.0 - rng.random(count)) ** -0.5, CRATER_R_MAX)
    theta_c, phi_c = _centres(rng, count)
    grid = _Grid(height, width)
    for r, tc, pc in zip(radii, theta_c, phi_c, strict=True):
        rows, cols, d = grid.patch(float(tc), float(pc), 1.6 * float(r))
        x = _angular_distance(d, _direction(float(tc), float(pc))) / r
        depth = 0.2 * r
        bowl = x < 1.0
        rim = (x >= 1.0) & (x < 1.6)
        prof = np.zeros_like(x)
        prof[bowl] = -depth * (1.0 - x[bowl] ** 2)
        prof[rim] = 0.25 * depth * np.exp(-(((x[rim] - 1.0) / 0.18) ** 2))
        ix = np.ix_(rows, cols)
        h[ix] += prof
        floor[ix] = np.maximum(floor[ix], np.where(bowl, 1.0 - x**2, 0.0))
    return h, floor


def boulders(height: int, width: int, seed: int, density: float) -> F64:
    """Small positive Gaussian bumps (radius units)."""
    h = np.zeros((height, width), dtype=np.float64)
    count = round(density * BOULDERS_PER_UNIT_DENSITY)
    if count <= 0:
        return h
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 2])))
    theta_c, phi_c = _centres(rng, count)
    grid = _Grid(height, width)
    for tc, pc in zip(theta_c, phi_c, strict=True):
        rows, cols, d = grid.patch(float(tc), float(pc), 3 * BOULDER_SIGMA)
        a = _angular_distance(d, _direction(float(tc), float(pc)))
        h[np.ix_(rows, cols)] += BOULDER_AMP * np.exp(-((a / BOULDER_SIGMA) ** 2))
    return h
