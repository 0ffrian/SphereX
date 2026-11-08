"""Landmarks on the real baked sky and the real tiles (skipped when they are not on disk).

Run after ``scripts.sky_mirror`` and ``scripts.sky_bake`` on the machine's cache
(``SX_CACHE_DIR`` or the default). They check that the HiPS tile orientation and the
equirectangular convention are right on real 2MASS data:

- the Galactic plane (b = 0) is much brighter than |b| = 30 deg;
- the Galactic centre, the LMC and the SMC are brighter than their surroundings;
- of the 8 square symmetries of a tile, only ``TILE_ORIENTATION`` joins tiles without seams.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from app.core.sky import bake
from app.core.sky.surveys import equirect_name, hips_dir, survey_dir, tile_relpath
from app.settings import Settings

SURVEY = "2mass_color"
CACHE = Settings().cache_dir


def galactic_to_icrs(
    l_deg: NDArray[np.float64], b_deg: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    from astropy import units as u
    from astropy.coordinates import SkyCoord

    c = SkyCoord(l=l_deg * u.deg, b=b_deg * u.deg, frame="galactic").icrs
    return np.asarray(c.ra.deg), np.asarray(c.dec.deg)


def load(width: int) -> NDArray[np.float64]:
    path = survey_dir(CACHE, SURVEY) / equirect_name(width, width // 2)
    if not path.is_file():
        pytest.skip(f"{path} not baked")
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.float64)


def at(img: NDArray[np.float64], ra: NDArray[np.float64], dec: NDArray[np.float64]) -> Any:
    h, w = img.shape
    x = np.clip(np.floor(np.mod(ra, 360.0) / 360.0 * w).astype(int), 0, w - 1)
    y = np.clip(np.floor((90.0 - dec) / 180.0 * h).astype(int), 0, h - 1)
    return img[y, x]


def disc_mean(img: NDArray[np.float64], ra0: float, dec0: float, r0: float, r1: float) -> float:
    """Mean of the pixels between r0 and r1 degrees from (ra0, dec0)."""
    h, w = img.shape
    dec = 90.0 - 180.0 * (np.arange(h) + 0.5) / h
    ra = 360.0 * (np.arange(w) + 0.5) / w
    rows = np.abs(dec - dec0) <= r1
    rr, dd = np.meshgrid(np.radians(ra), np.radians(dec[rows]))
    a0, d0 = np.radians(ra0), np.radians(dec0)
    cosd = np.sin(dd) * np.sin(d0) + np.cos(dd) * np.cos(d0) * np.cos(rr - a0)
    sep = np.degrees(np.arccos(np.clip(cosd, -1, 1)))
    sel = (sep >= r0) & (sep <= r1)
    return float(img[rows][sel].mean())


@pytest.mark.parametrize("width", [4096, 8192])
def test_galactic_plane_is_brighter_than_high_latitudes(width: int) -> None:
    img = load(width)
    l_deg = np.arange(0.0, 360.0, 0.5)
    plane = at(img, *galactic_to_icrs(l_deg, np.zeros_like(l_deg))).mean()
    high = np.mean(
        [at(img, *galactic_to_icrs(l_deg, np.full_like(l_deg, b))).mean() for b in (-30, 30)]
    )
    assert plane > 2.0 * high, (plane, high)


@pytest.mark.parametrize("width", [4096, 8192])
def test_galactic_centre_lmc_and_smc_stand_out(width: int) -> None:
    img = load(width)
    gc = disc_mean(img, 266.405, -28.936, 0.0, 1.5) / disc_mean(img, 266.405, -28.936, 8, 12)
    lmc = disc_mean(img, 80.894, -69.756, 0.0, 2.0) / disc_mean(img, 80.894, -69.756, 8, 12)
    smc = disc_mean(img, 13.187, -72.829, 0.0, 1.0) / disc_mean(img, 13.187, -72.829, 5, 8)
    assert gc > 1.5, gc
    assert lmc > 1.3, lmc
    assert smc > 1.2, smc


def _tiles(order: int, sub: int) -> NDArray[np.uint8]:
    hdir = hips_dir(CACHE, SURVEY)
    paths = [hdir / tile_relpath(order, n) for n in range(12 * 4**order)]
    if not all(p.is_file() for p in paths):
        pytest.skip(f"order {order} tiles not mirrored")
    return np.stack(
        [bake.box_mean(bake.decode_tile(Path(p).read_bytes(), 512), 512 // sub) for p in paths]
    )


def test_only_the_chosen_orientation_is_seamless() -> None:
    raw = _tiles(2, 32)
    ratios = {o: bake.orientation_seam_ratio(raw, 2, o) for o in bake.ALL_ORIENTATIONS}
    best = min(ratios, key=lambda o: ratios[o])
    assert best == bake.TILE_ORIENTATION, ratios
    others = sorted(v for o, v in ratios.items() if o != best)
    assert ratios[best] < 0.6 * others[0], ratios
