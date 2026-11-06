"""Height fields (R6.3). Units: fraction of the body radius, row 0 = north pole."""

from __future__ import annotations

import numpy as np

from app.core.render import craters
from app.core.render.noise import F64, fbm, normalise, seed32
from app.core.render.params import BakeParams


def asteroid_height(p: BakeParams, dirs: F64) -> tuple[F64, F64]:
    """relief_amp * normalise(fbm) + craters + boulders; also the crater-floor mask."""
    rows, cols = dirs.shape[:2]
    s = seed32(p.seed)
    relief = p.relief_amp * normalise(fbm(dirs, s, p.noise_octaves, p.noise_freq))
    cr, floor = craters.craters(rows, cols, p.seed, p.crater_count)
    return relief + cr + craters.boulders(rows, cols, p.seed, p.boulder_density), floor


def lowfreq(dirs: F64, seed: int) -> F64:
    """Slow albedo variation in about [-1, 1] (artistic)."""
    return normalise(fbm(dirs, seed32(seed) + 100, 3, 1.5))


def bands_height(dirs: F64) -> F64:
    """Gas and brown-dwarf bodies have no measured relief: a flat map."""
    return np.zeros(dirs.shape[:2], dtype=np.float64)


def band_field(dirs: F64, seed: int) -> F64:
    """Latitude-stretched fbm (R7.4): coarse in longitude, fine in latitude, in about [-1, 1]."""
    stretched = dirs * np.array([1.5, 10.0, 1.5])
    return normalise(fbm(stretched, seed32(seed) + 200, 5, 1.0))
