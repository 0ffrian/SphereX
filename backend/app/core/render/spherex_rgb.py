"""SPHEREx infrared view colour (R5.2) and windowed fluxes from the object's own spectrum.

Each channel is the median flux of the unflagged spectrum points within +/- 0.05 um of the
channel wavelength, normalised by the maximum channel. Fewer than 2 points in any window, or a
maximum channel that is not positive, means no colour: the mode is disabled and listed in
``missing`` by ``card_to_params``.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable, Mapping
from typing import Any

HALF_WINDOW_UM = 0.05  # R5.2
MIN_POINTS = 2  # R5.2: "fewer than 2 points ... the mode is disabled"

# R5.2 channel wavelengths (R, G, B) in um.
CHANNELS_SMALL_BODY = (3.0, 2.0, 1.0)  # asteroids and comets
CHANNELS_BROWN_DWARF = (4.5, 3.3, 1.25)

CHANNELS_BY_TYPE: dict[str, tuple[float, float, float]] = {
    "asteroid_shape": CHANNELS_SMALL_BODY,
    "asteroid_procedural": CHANNELS_SMALL_BODY,
    "comet": CHANNELS_SMALL_BODY,
    "brown_dwarf": CHANNELS_BROWN_DWARF,
    "brown_dwarf_binary": CHANNELS_BROWN_DWARF,
}


def _usable(points: Iterable[Mapping[str, Any]]) -> list[tuple[float, float]]:
    out = []
    for p in points:
        if p.get("flagged"):
            continue
        w, f = p.get("wavelength_um"), p.get("flux")
        if not isinstance(w, int | float) or not isinstance(f, int | float):
            continue
        if math.isfinite(w) and math.isfinite(f):
            out.append((float(w), float(f)))
    return out


def window_median(points: Iterable[Mapping[str, Any]], centre_um: float) -> float | None:
    """Median flux within +/- 0.05 um of ``centre_um``; None with fewer than 2 points."""
    fluxes = [f for w, f in _usable(points) if abs(w - centre_um) <= HALF_WINDOW_UM + 1e-12]
    if len(fluxes) < MIN_POINTS:
        return None
    return float(statistics.median(fluxes))


def spherex_rgb(
    points: Iterable[Mapping[str, Any]], channels: tuple[float, float, float]
) -> tuple[float, float, float] | None:
    pts = list(points)
    meds = [window_median(pts, c) for c in channels]
    if any(m is None for m in meds):
        return None
    vals = [float(m) for m in meds if m is not None]
    peak = max(vals)
    if peak <= 0.0:
        return None
    r, g, b = (round(max(0.0, v / peak), 4) for v in vals)
    return (r, g, b)


def formula(channels: tuple[float, float, float]) -> str:
    r, g, b = channels
    return (
        f"R, G, B = median unflagged flux within +/-{HALF_WINDOW_UM} um of {r}, {g}, {b} um, "
        "divided by the largest channel (R5.2)"
    )
