"""Craters and boulders on the sphere (R6.3).

Features are evaluated only inside their latitude/longitude bounding box; 500 craters over a
2M-pixel map would otherwise be far too slow.
"""

from __future__ import annotations

import math

import numpy as np

from app.core.render.noise import F64
from app.core.render.params import (
    CRATER_DEPTH_PER_R,
    CRATER_R_MAX,
    CRATER_R_MIN,
)

# CREATIVE constants (artistic): sizes of boulders, in mean radii (issue #71, Q-210).
BOULDER_SIGMA_MIN, BOULDER_SIGMA_SPAN = 0.008, 0.014
BOULDER_AMP_PER_SIGMA = 0.7  # height / sigma
BOULDERS_PER_UNIT_DENSITY = 600
MAX_CRATERS = 1500
N_WAVES = 26
CRATER_REACH = 2.4  # a crater's profile is felt out to this many of its radii
# Erosion: a newer crater wears the relief of older ones inside its bowl (crater layer ONLY).
ERODE_CENTRE, ERODE_RIM = 0.45, 1.0


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


def ellipsoid_axes(ratio: float) -> F64:
    """Semi-axes (a, b, c) with a/b = ratio, c = b (R6.2), scaled so a*b*c = 1 (mean radius 1)."""
    ax = np.array([1.0, 1.0 / ratio, 1.0 / ratio])
    return np.asarray(ax * float(np.prod(ax)) ** (-1.0 / 3.0))


def surface_points(dirs: F64, axes: F64) -> F64:
    """Points of the ellipsoid in the direction of every pixel: distances between them are real
    distances on the body, so a crater of radius r is round on an elongated body."""
    return np.asarray(dirs * axes)


def shape_layer(dirs: F64, seed: int, lump: float) -> F64:
    """Overall shape: 26 low-order sine waves with amplitude k^-1.5, rms = 0.45 lump.

    Fraction of the local radius. Independent of the craters and of every later layer, so crater
    erosion can never touch it (issue #71: multiplying the total height gave needle spikes).
    """
    if lump <= 0:
        return np.zeros(dirs.shape[:2], dtype=np.float64)
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 3])))
    z = rng.uniform(-1.0, 1.0, N_WAVES)
    an = rng.uniform(0.0, 2 * np.pi, N_WAVES)
    k = 1.3 + 7.5 * rng.random(N_WAVES) ** 1.4
    phase = rng.uniform(0.0, 2 * np.pi, N_WAVES)
    c2 = np.sqrt(1 - z * z)
    axis = np.stack([c2 * np.cos(an), z, c2 * np.sin(an)], axis=1)  # (n, 3)
    amp = k**-1.5
    norm = lump * 0.45 / math.sqrt(float(np.sum(amp * amp)) / 2.0)
    out = np.zeros(dirs.shape[:2], dtype=np.float64)
    for n in range(N_WAVES):
        out += amp[n] * np.sin(k[n] * (dirs @ axis[n]) + phase[n])
    return out * norm


def _patch(
    grid: _Grid, pos: F64, axes: F64, theta: float, phi: float, reach: float
) -> tuple[tuple[np.ndarray, np.ndarray], F64, F64]:
    """Index, 3D distances (mean-radius units) and local radius of pixels within ``reach``."""
    cdir = _direction(theta, phi)
    cpos = cdir * axes
    chord = min(2.0, reach / float(axes.min()))
    rho = min(math.pi, 2.0 * math.asin(chord / 2.0) * 1.05 + 0.02)
    rows, cols, _ = grid.patch(theta, phi, rho)
    ix = np.ix_(rows, cols)
    p = pos[ix]
    dist = np.sqrt(np.sum((p - cpos) ** 2, axis=-1))
    return ix, dist, np.asarray(np.sqrt(np.sum(p * p, axis=-1)))


def crater_radii(seed: int, coverage: float) -> tuple[F64, F64, F64, F64]:
    """Crater radii (mean radii, largest first), centres (theta, phi) and freshness.

    N(>D) ~ D^-2 (Pareto, exponent 2) from CRATER_R_MIN, capped at CRATER_R_MAX, until
    sum(r^2) reaches 4 x coverage or MAX_CRATERS (saturation). Deterministic in (seed, coverage).
    """
    empty = np.zeros(0)
    if coverage <= 0:
        return empty, empty, empty, empty
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 1])))
    u = rng.random(MAX_CRATERS)
    r = np.minimum(CRATER_R_MAX, CRATER_R_MIN * (1.0 - u * 0.985) ** -0.5)
    theta, phi = _centres(rng, MAX_CRATERS)
    deg = 0.35 + 0.65 * rng.random(MAX_CRATERS)
    n = int(np.searchsorted(np.cumsum(r * r), coverage * 4.0)) + 1
    n = min(n, MAX_CRATERS)
    order = np.argsort(-r[:n], kind="stable")
    return r[:n][order], theta[:n][order], phi[:n][order], deg[:n][order]


def craters(
    height: int, width: int, seed: int, coverage: float, axes: F64, dirs: F64
) -> tuple[F64, F64]:
    """Crater relief (fraction of the local radius) and floor mask in [0, 1], both (H, W).

    Profile (d = distance / crater radius): bowl ``-depth (1 - d^2) + 0.2 depth d^4`` inside,
    ``0.2 depth d^-5`` outside, out to 2.4 radii. Each new crater wears the relief already
    inside its bowl by 0.45 + 0.55 d. That erosion acts on this layer only (issue #71).
    """
    h = np.zeros((height, width), dtype=np.float64)
    floor = np.zeros((height, width), dtype=np.float64)
    radii, theta, phi, deg = crater_radii(seed, coverage)
    if len(radii) == 0:
        return h, floor
    pos = surface_points(dirs, axes)
    grid = _Grid(height, width)
    for rc, tc, pc, dg in zip(radii, theta, phi, deg, strict=True):
        ix, dist, rl = _patch(grid, pos, axes, float(tc), float(pc), CRATER_REACH * float(rc))
        d = dist / rc
        near = d < CRATER_REACH
        depth = CRATER_DEPTH_PER_R * rc * dg
        d_safe = np.where(near, np.maximum(d, 1e-9), 1.0)
        prof = np.where(
            d_safe < 1.0,
            -depth * (1.0 - d_safe**2) + 0.2 * depth * d_safe**4,
            0.2 * depth * d_safe**-5,
        )
        old = h[ix]
        erode = np.where(d < 1.0, ERODE_CENTRE + (ERODE_RIM - ERODE_CENTRE) * d, 1.0)
        h[ix] = np.where(near, old * erode + prof / rl, old)
        floor[ix] = np.maximum(floor[ix], np.where(d < 1.0, 1.0 - d**2, 0.0))
    return h, floor


def boulders(height: int, width: int, seed: int, density: float, axes: F64, dirs: F64) -> F64:
    """Small positive Gaussian bumps (fraction of the local radius), round on the ellipsoid."""
    h = np.zeros((height, width), dtype=np.float64)
    count = round(density * BOULDERS_PER_UNIT_DENSITY)
    if count <= 0:
        return h
    rng = np.random.Generator(np.random.PCG64(np.random.SeedSequence([seed, 2])))
    theta_c, phi_c = _centres(rng, count)
    sig = BOULDER_SIGMA_MIN + BOULDER_SIGMA_SPAN * rng.random(count) ** 2
    pos = surface_points(dirs, axes)
    grid = _Grid(height, width)
    for tc, pc, s in zip(theta_c, phi_c, sig, strict=True):
        ix, dist, rl = _patch(grid, pos, axes, float(tc), float(pc), 3.0 * float(s))
        h[ix] += BOULDER_AMP_PER_SIGMA * s * np.exp(-((dist / s) ** 2)) / rl
    return h
