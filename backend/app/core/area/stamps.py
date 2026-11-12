"""``/v1/areas/{area_id}/stamps/{dot_id}.png`` (A17.8): a 15 x 15 px stamp from the dot's cutout,
stretched as ``/cutouts/{frame_id}.png`` is (the per-frame asinh stretch of ``png.py`` over the
whole cutout, then the crop), so a stamp's grey levels match the frame's PNG. Pixels outside
the cutout are 0.

What is stored is the raw ``size x size`` uint8 pixels (row 0 at the top), not a PNG: compressed
PNG bytes depend on the zlib build (Windows and Linux Pillow wheels differ), so a stored PNG
would make the committed pack platform dependent. The API encodes the PNG when serving
(``app.core.find.png.encode_png``, formatting only; A16.2 holds) (PR #110 review).

The stamps are made when the area is prepared (``service.prepare``, the ``stamps`` stage) and
served from the stored entry, so the committed pack answers under ``SX_OFFLINE=1`` on a machine
without the cutouts (Q-420 (11), PR #110 review)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.core.find import png, wcs

STAMP_PX = 15


class StampUnavailable(Exception):
    """The cutout cannot be read or stretched (the dot gets no stored stamp: 503
    ``stamp_unavailable``)."""


@dataclass(frozen=True)
class StretchedCutout:
    """One cutout's stretched IMAGE in PNG orientation (row 0 at the top)."""

    img: np.ndarray

    @classmethod
    def of(cls, cutout: bytes) -> StretchedCutout:
        try:
            with wcs.open_fits(cutout) as hdul:
                data = np.asarray(hdul["IMAGE"].data)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise StampUnavailable(str(exc)) from exc
        u8 = png.stretch(data)
        if u8 is None:
            raise StampUnavailable("the cutout has no finite pixels to stretch")
        return cls(np.flipud(u8))

    def stamp(self, x: float, y: float, size: int = STAMP_PX) -> bytes:
        """The stamp's raw pixels (``size * size`` bytes, row 0 at the top), centred on the
        pixel holding ``(x, y)`` (PNG convention of ``/frames``)."""
        half = size // 2
        cx, cy = math.floor(x + 0.5), math.floor(y + 0.5)
        out = np.zeros((size, size), dtype=np.uint8)
        ny, nx = self.img.shape
        for r in range(size):
            yy = cy - half + r
            if not 0 <= yy < ny:
                continue
            for c in range(size):
                xx = cx - half + c
                if 0 <= xx < nx:
                    out[r, c] = self.img[yy, xx]
        return out.tobytes()


def stamp_png(cutout: bytes, x: float, y: float, size: int = STAMP_PX) -> bytes:
    pixels = np.frombuffer(StretchedCutout.of(cutout).stamp(x, y, size), dtype=np.uint8)
    return png.encode_png(np.flipud(pixels.reshape(size, size)))  # encode_png flips back
