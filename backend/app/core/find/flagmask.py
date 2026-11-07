"""FLAGS overlay PNG (issue #12): one RGBA pixel per cutout pixel, coloured by flag group.

Each pixel takes the colour of the first group in ``FLAG_GROUPS`` order whose bits are set in
the FLAGS extension; pixels with no grouped bit are transparent. Bit numbers are read from the
``MP_*`` header keywords (``wcs.flag_names``), never assumed. Same size and vertical flip as the
cutout PNG (``png.encode_png``); deterministic bytes.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image

from app.core.find import png, wcs

ALPHA = 160


@dataclass(frozen=True)
class FlagGroup:
    group: str
    rgba: tuple[int, int, int, int]
    names: tuple[str, ...]  # a trailing ``*`` matches any name with that prefix


# Okabe-Ito colours (colour-blind safe): vermillion, yellow, reddish purple, sky blue. A display
# choice (`artistic`), stated in the overlays reply.
FLAG_GROUPS: tuple[FlagGroup, ...] = (
    FlagGroup("saturation", (213, 94, 0, ALPHA), ("OVERFLOW", "SUR_ERROR", "NONLINEAR")),
    FlagGroup(
        "bad_pixel",
        (240, 228, 66, ALPHA),
        (
            "HOT",
            "COLD",
            "NONFUNC",
            "MISSING_DATA",
            "DICHROIC",
            "FULLSAMPLE",
            "OUTLIER",
            "TRANSIENT",
        ),
    ),
    FlagGroup(
        "artefact",
        (204, 121, 167, ALPHA),
        (
            "PERSIST",
            "PHANTOM",
            "PHANMISS",
            "REFERENCE",
            "GHOST*",
            "BLOOM",
            "SNOWBALL",
            "HALO",
            "CROSSTALK",
            "STREAK",
            "SATELLITE_HALO",
        ),
    ),
    FlagGroup("source", (86, 180, 233, ALPHA), ("SOURCE",)),
)


class FlagMaskUnavailable(LookupError):
    """No FLAGS extension, or its header names no flag bits."""


def _matches(name: str, patterns: tuple[str, ...]) -> bool:
    return any(name.startswith(p[:-1]) if p.endswith("*") else name == p for p in patterns)


def group_masks(flags_header: Any) -> list[int]:
    """Bitmask per group (``FLAG_GROUPS`` order) from the header's ``MP_*`` names."""
    names = wcs.flag_names(flags_header)
    return [
        sum(1 << bit for bit, name in names.items() if _matches(name, g.names) and 0 <= bit < 32)
        for g in FLAG_GROUPS
    ]


def available(hdul: Any) -> bool:
    return "FLAGS" in hdul and bool(wcs.flag_names(hdul["FLAGS"].header))


def rgba(hdul: Any) -> np.ndarray:
    """RGBA uint8 array in FITS orientation. Raises ``FlagMaskUnavailable``."""
    if not available(hdul):
        raise FlagMaskUnavailable("the cutout has no FLAGS extension with MP_* bit names")
    data = np.asarray(hdul["FLAGS"].data).astype(np.int64) & 0xFFFFFFFF
    if data.ndim != 2:
        raise FlagMaskUnavailable("FLAGS is not a 2-D image")
    out = np.zeros((*data.shape, 4), dtype=np.uint8)
    done = np.zeros(data.shape, dtype=bool)
    for g, mask in zip(FLAG_GROUPS, group_masks(hdul["FLAGS"].header), strict=True):
        if not mask:
            continue
        hit = ((data & mask) != 0) & ~done
        out[hit] = g.rgba
        done |= hit
    return out


def render_png(hdul: Any) -> bytes:
    img = Image.fromarray(np.ascontiguousarray(np.flipud(rgba(hdul))))
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=png.COMPRESS_LEVEL, optimize=False)
    return buf.getvalue()


FORMULA = (
    "each pixel takes the colour of the first group (saturation, bad_pixel, artefact, source) "
    "with a FLAGS bit set; bit numbers from the MP_* keywords of the FLAGS header; transparent "
    "where no grouped bit is set; flipped vertically like the cutout PNG"
)
