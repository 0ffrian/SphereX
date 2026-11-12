"""``/v1/areas/{area_id}/stamps/{dot_id}.png`` (A17.8): a 15 x 15 px stamp from the cached cutout,
stretched as ``/cutouts/{frame_id}.png`` is (the per-frame asinh stretch of ``png.py`` over the
whole cutout, then the crop), so a stamp's grey levels match the frame's PNG. Pixels outside
the cutout are 0. Deterministic bytes."""

from __future__ import annotations

import math

import numpy as np

from app.core.find import png, wcs

STAMP_PX = 15


class StampUnavailable(Exception):
    """The cutout is not cached or cannot be stretched (503 ``stamp_unavailable``)."""


def stamp_png(cutout: bytes, x: float, y: float, size: int = STAMP_PX) -> bytes:
    """The stamp centred on the pixel holding ``(x, y)`` (PNG convention of ``/frames``)."""
    try:
        with wcs.open_fits(cutout) as hdul:
            data = np.asarray(hdul["IMAGE"].data)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise StampUnavailable(str(exc)) from exc
    u8 = png.stretch(data)
    if u8 is None:
        raise StampUnavailable("the cutout has no finite pixels to stretch")
    img = np.flipud(u8)  # PNG orientation: row 0 at the top
    half = size // 2
    cx, cy = math.floor(x + 0.5), math.floor(y + 0.5)
    out = np.zeros((size, size), dtype=np.uint8)
    ny, nx = img.shape
    for r in range(size):
        yy = cy - half + r
        if not 0 <= yy < ny:
            continue
        for c in range(size):
            xx = cx - half + c
            if 0 <= xx < nx:
                out[r, c] = img[yy, xx]
    return png.encode_png(np.flipud(out))  # encode_png flips FITS orientation back
