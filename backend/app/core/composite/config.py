"""Composite constants. Display choices, not physical values about any object.

Every constant here is part of the composite's derived cache key (``params_dict``), so changing
one rebuilds the image. Bump ``COMPOSITE_VERSION`` when the code changes the bytes.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.core.measure.config import REJECT_FLAGS

COMPOSITE_VERSION = "composite-1"

# CREATIVE: placeholder — Atish to decide. Target wavelength (um) of each channel. A display
# choice (short / middle / long end of SPHEREx's 0.75-5.0 um range, near 2MASS J and K and WISE
# W2), not physics. Order is blue, green, red.
CHANNELS: tuple[str, str, str] = ("blue", "green", "red")
TARGET_UM: dict[str, float] = {"blue": 1.2, "green": 2.2, "red": 4.5}
# ASSUMPTION: a frame counts for a channel only within this fraction of the target wavelength
# (1.08-1.32, 1.98-2.42 and 4.05-4.95 um), so a channel never borrows a far-away band.
MAX_OFFSET_FRACTION = 0.10

# ASSUMPTION: the three frames must lie within this many days of each other ("one survey pass").
# SPHEREx covers its whole 0.75-5 um range at one sky position over a few days of a pass; the
# cached passes span at most about 14 days.
MAX_PASS_SPAN_DAYS = 14.0

# Per-band stretch, like the cutout PNG (``app.core.find.png``) but on the resampled band.
# Black is the band's median (its sky level), so the sky is dark in every band.
LOWER_PERCENTILE = 50.0
UPPER_PERCENTILE = 99.5
ASINH_A = 0.1
# White is never closer to the sky than this many robust sigmas (1.4826 x MAD of the band). A band
# with no bright source (4.5 um often) would otherwise stretch its own noise to full brightness
# and tint the whole sky.
MIN_RANGE_SIGMA = 10.0
MAD_TO_SIGMA = 1.4826

# Resampling: bilinear on the frame's IMAGE array; a sample whose four neighbours are not all
# finite, or that falls outside the frame, is no data (black).
INTERPOLATION = "bilinear"
# Pixels with any of Stage 2's reject flags (A4.2: hot, transient, overflow ...) are masked as no
# data before resampling, so a hot pixel in one band never shows as a coloured "source".
MASK_FLAGS: tuple[str, ...] = REJECT_FLAGS
COMPRESS_LEVEL = 6

# Output grid scale: the median over the three frames of sqrt(pixel solid angle) at the object
# pixel, from each frame's TAN-SIP WCS (``app.core.measure.solid_angle``), rounded to this.
SCALE_DP = 2


def params_dict() -> dict[str, Any]:
    return {
        "version": COMPOSITE_VERSION,
        "channels": list(CHANNELS),
        "target_um": TARGET_UM,
        "max_offset_fraction": MAX_OFFSET_FRACTION,
        "max_pass_span_days": MAX_PASS_SPAN_DAYS,
        "stretch": {
            "kind": "asinh",
            "lower_percentile": LOWER_PERCENTILE,
            "upper_percentile": UPPER_PERCENTILE,
            "a": ASINH_A,
            "min_range_sigma": MIN_RANGE_SIGMA,
            "per_band": True,
        },
        "interpolation": INTERPOLATION,
        "mask_flags": list(MASK_FLAGS),
        "compress_level": COMPRESS_LEVEL,
        "scale_dp": SCALE_DP,
    }


def params_sha() -> str:
    text = json.dumps(params_dict(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("ascii")).hexdigest()
