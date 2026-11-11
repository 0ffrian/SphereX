"""Height fields (R6.3). Units: fraction of the body radius, row 0 = north pole."""

from __future__ import annotations

import numpy as np

from app.core.render import craters
from app.core.render.noise import F64, fbm, normalise, seed32
from app.core.render.params import BakeParams


def asteroid_layers(p: BakeParams, dirs: F64) -> dict[str, F64]:
    """The asteroid height field as separate layers (fraction of the local radius).

    ``shape`` (overall lumps, from strength against gravity), ``craters`` (eroded among
    themselves only), ``fine`` (fbm detail) and ``boulders``; ``floor`` is the crater-floor mask.
    The final height is their sum, added last (issue #71, Q-211).
    """
    rows, cols = dirs.shape[:2]
    axes = craters.ellipsoid_axes(p.axis_ratio)
    fine = p.fine_amp * normalise(fbm(dirs, seed32(p.seed), p.noise_octaves, p.noise_freq))
    cr, floor = craters.craters(rows, cols, p.seed, p.crater_coverage, axes, dirs)
    bo = craters.boulders(rows, cols, p.seed, p.boulder_density, axes, dirs)
    return {
        "shape": craters.shape_layer(dirs, p.seed, p.lump),
        "craters": cr,
        "fine": fine,
        "boulders": bo,
        "floor": floor,
    }


def asteroid_height(p: BakeParams, dirs: F64) -> tuple[F64, F64]:
    """Sum of the layers, and the crater-floor mask."""
    layers = asteroid_layers(p, dirs)
    total = layers["craters"] + layers["fine"] + layers["boulders"]
    return layers["shape"] + total, layers["floor"]


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
