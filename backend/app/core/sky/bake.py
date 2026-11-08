"""Resample a local colour HiPS into an all-sky equirectangular JPEG (numpy + Pillow).

Output convention (fixed; the frontend depends on it), ICRS:

- column ``x`` -> RA = 360 * (x + 0.5) / W degrees (RA 0 at the left edge, increasing right);
- row ``y`` -> Dec = 90 - 180 * (y + 0.5) / H degrees (north at the top).

**Tile pixel orientation.** IVOA HiPS 1.0: tile ``n`` of order ``k`` and width ``w = 2**m``
holds the order ``k + m`` NESTED sub-pixels ``n * w**2 + interleave(lx, ly)``, where ``lx`` (even
bits) and ``ly`` (odd bits) are the HEALPix face coordinates inside the tile (``lx`` grows from
the tile's south corner to its east corner, ``ly`` from south to west). In the JPEG as decoded
(first row of the file = row 0):

    row = lx        col = ly

The first JPEG row is the tile's south-west edge. Shown with its first row at the *bottom*
(the FITS convention, which HipsGen uses for both formats: the JPEG rows are not flipped
relative to the FITS array), a tile has the face's north corner top right and east top left,
i.e. the sky seen from inside. This was checked on the real 2MASS tiles (7 Nov 2026): of the
8 square symmetries only this one joins neighbouring tiles without seams (colour jump across
tile edges / inside tiles = 1.6, every other candidate 3.8 to 6.3, ``orientation_seam_ratio``),
and the landmark tests (``tests/test_sky_landmarks.py``) pass on the bake.
``TILE_ORIENTATION`` encodes it.

Each tile is first box-averaged to ``sub_width`` (an aligned block of the nested sub-pixels, so
the mean is the parent pixel of order ``k + log2(sub_width)``) and then sampled at the nearest
parent pixel of each output pixel centre. Deterministic: same tiles -> same bytes.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass
from math import log2

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.core.sky import healpix

U8 = NDArray[np.uint8]

JPEG_QUALITY = 90


@dataclass(frozen=True)
class Orientation:
    """Where face coordinates ``(lx, ly)`` sit in the tile image (row 0 = first row read).

    ``(a, b) = (ly, lx) if transpose else (lx, ly)``; ``row = w-1-a if flip_row else a``;
    ``col = w-1-b if flip_col else b``.
    """

    transpose: bool
    flip_row: bool
    flip_col: bool

    def to_local(self, img: U8) -> U8:
        """Reindex an image ``[row, col, ...]`` into ``[lx, ly, ...]``."""
        a = img
        if self.flip_row:
            a = a[::-1]
        if self.flip_col:
            a = a[:, ::-1]
        if self.transpose:
            a = a.swapaxes(0, 1)
        return np.ascontiguousarray(a)


# row = lx, col = ly in the decoded JPEG (see the module docstring).
TILE_ORIENTATION = Orientation(transpose=False, flip_row=False, flip_col=False)

ALL_ORIENTATIONS = tuple(
    Orientation(t, r, c) for t in (False, True) for r in (False, True) for c in (False, True)
)


class BakeError(RuntimeError):
    pass


def decode_tile(data: bytes, width: int) -> U8:
    with Image.open(io.BytesIO(data)) as im:
        rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
    if rgb.shape != (width, width, 3):
        raise BakeError(f"tile is {rgb.shape[1]}x{rgb.shape[0]}, expected {width}x{width}")
    return rgb


def box_mean(img: U8, factor: int) -> U8:
    if factor == 1:
        return img
    h, w, c = img.shape
    a = img.reshape(h // factor, factor, w // factor, factor, c).astype(np.float32)
    return np.rint(a.mean(axis=(1, 3))).astype(np.uint8)


def choose_sub_width(order: int, tile_width: int, out_width: int) -> int:
    """Smallest power-of-two width whose pixels are no larger than an output pixel."""
    target = 360.0 / out_width
    s = 1
    while s < tile_width and healpix.pixel_size_deg(order + int(log2(s))) > target:
        s *= 2
    return s


def load_tiles(
    read_tile: Callable[[int], bytes],
    order: int,
    tile_width: int,
    sub_width: int,
    orientation: Orientation = TILE_ORIENTATION,
) -> U8:
    """All tiles of ``order`` as ``[tile, lx, ly, rgb]`` at ``sub_width``."""
    if tile_width % sub_width:
        raise BakeError("sub_width must divide the tile width")
    n_tiles = 12 << (2 * order)
    out = np.empty((n_tiles, sub_width, sub_width, 3), dtype=np.uint8)
    for n in range(n_tiles):
        img = box_mean(decode_tile(read_tile(n), tile_width), tile_width // sub_width)
        out[n] = orientation.to_local(img)
    return out


def ra_dec_grid(width: int, height: int, rows: slice) -> tuple[NDArray[np.float64], ...]:
    x = np.arange(width, dtype=np.float64)
    y = np.arange(height, dtype=np.float64)[rows]
    ra = 360.0 * (x + 0.5) / width
    dec = 90.0 - 180.0 * (y + 0.5) / height
    return np.meshgrid(ra, dec)


def sample(tiles: U8, order: int, ra_deg: NDArray[np.float64], dec_deg: NDArray[np.float64]) -> U8:
    """Colour at each (RA, Dec) from ``[tile, lx, ly, rgb]`` tiles of ``order``."""
    sub = tiles.shape[1]
    m = int(log2(sub))
    theta = np.radians(90.0 - dec_deg)
    phi = np.radians(ra_deg)
    pix = healpix.ang2pix(order + m, theta, phi)
    tile = pix >> (2 * m)
    local = pix & ((1 << (2 * m)) - 1)
    lx = healpix.compress_bits(local)
    ly = healpix.compress_bits(local >> 1)
    out: U8 = tiles[tile, lx, ly]
    return out


def bake_equirect(tiles: U8, order: int, width: int, height: int, strip_rows: int = 256) -> U8:
    if width != 2 * height:
        raise BakeError("an all-sky equirectangular image is 2:1")
    out = np.empty((height, width, 3), dtype=np.uint8)
    for y0 in range(0, height, strip_rows):
        rows = slice(y0, min(height, y0 + strip_rows))
        ra, dec = ra_dec_grid(width, height, rows)
        out[rows] = sample(tiles, order, ra, dec)
    return out


def encode_jpeg(img: U8, quality: int = JPEG_QUALITY) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(img, mode="RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def orientation_seam_ratio(raw_tiles: U8, order: int, orientation: Orientation) -> float:
    """Mean grey-level jump across tile edges divided by the mean jump inside tiles.

    ``raw_tiles`` are box-averaged tiles as images ``[tile, row, col, rgb]``. Rendered at
    1024x512. A wrong orientation scrambles each tile, so its edges stop matching the
    neighbours and the ratio grows; the right one gives the lowest ratio (a diagnostic, used by
    the landmark test).
    """
    local = np.stack([orientation.to_local(t) for t in raw_tiles])
    h, w = 512, 1024
    img = bake_equirect(local, order, w, h).astype(np.float32).mean(axis=2)
    ra, dec = ra_dec_grid(w, h, slice(0, h))
    tile = healpix.ang2pix(order, np.radians(90.0 - dec), np.radians(ra))
    dx, dy = np.abs(np.diff(img, axis=1)), np.abs(np.diff(img, axis=0))
    same_x, same_y = tile[:, 1:] == tile[:, :-1], tile[1:] == tile[:-1]
    cross = np.concatenate([dx[~same_x], dy[~same_y]]).mean()
    within = np.concatenate([dx[same_x], dy[same_y]]).mean()
    return float(cross / within)
