"""Scans (Q-470, issue #156): a region of sky cut into squares of at most 2 degrees, each one a
live area (Q-462) run one after another on the live-area worker.

This module is the light half, imported by the API: the region rules, the split into squares
and the plan shown before anything runs. Pure math, no pipeline module and no numpy (A16.2).

- **Region:** centre and sides snapped to the 0.05 degree grid, each side at most
  ``MAX_REGION_SIDE_DEG``, at most ``MAX_SQUARES`` squares (else ``scan:too_large``), and no
  region reaching a pole (``|dec| + h/2 < 89``, else ``area:bad_box``).
- **Split:** ``cols = ceil(width / 2)`` and ``rows = ceil(height / 2)``, all squares the same size
  (``width/cols`` by ``height/rows``), so there are no thin edge slivers.
- **Centres:** on the gnomonic plane of the region centre, north up and RA growing to the left
  as the sky is drawn, then deprojected to RA and Dec.
- **Order:** index 1 to N, top row first, left to right on screen, row by row (not snake order).
- **Overlap:** each square is padded by ``PAD_DEG`` on every side, then snapped with
  ``live.snap_box``, so its ``area_id`` is that of a single live area of the same box. A padded
  side never exceeds the 2 degree live cap: a square already 2 degrees on a side is not padded
  on that axis (Q-470).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.core.area.live import (
    GRID_DEG,
    MAX_SIDE_DEG,
    Box,
    LiveAreaError,
    estimate_seconds,
    snap_box,
)

MAX_REGION_SIDE_DEG = 12.0
MAX_SQUARES = 36
PAD_DEG = 0.05
POLE_LIMIT_DEG = 89.0
KINDS = ("discovery", "known")
SPLIT_FORMULA = (
    "cols = ceil(width / 2), rows = ceil(height / 2), equal squares; centres on the gnomonic "
    "plane of the region centre (north up, RA growing to the left); each square padded 0.05 deg "
    "a side (at most 2 deg) and snapped to the 0.05 deg grid"
)


def _snap(v: float) -> float:
    return round(round(v / GRID_DEG) * GRID_DEG, 2)


@dataclass(frozen=True)
class Square:
    index: int  # 1..N, top row first, left to right
    row: int  # 0 = top
    col: int  # 0 = left on screen (east)
    box: Box


@dataclass(frozen=True)
class ScanPlan:
    region: Box
    cols: int
    rows: int
    squares: tuple[Square, ...]

    def reply(self, release: str, kind: str, stored: Mapping[int, str]) -> dict[str, Any]:
        """The ``scan-plan.schema.json`` body; ``stored`` maps a square index to the id of a
        stored area of the same box (its estimate is then 0)."""
        return {
            "region": self.region.reply(),
            "release": release,
            "kind": kind,
            "cols": self.cols,
            "rows": self.rows,
            "squares": [
                {
                    "index": s.index,
                    "row": s.row,
                    "col": s.col,
                    "box": s.box.reply(),
                    "area_id": stored.get(s.index),
                }
                for s in self.squares
            ],
            "estimate_s": sum(
                estimate_seconds(s.box) for s in self.squares if s.index not in stored
            ),
            "provenance": {
                "squares": {
                    "tag": "derived",
                    "source": "the drawn region",
                    "formula": SPLIT_FORMULA,
                }
            },
        }


def grid_shape(width_deg: float, height_deg: float) -> tuple[int, int]:
    """``(cols, rows)``: the fewest squares of at most 2 degrees a side."""
    cols = max(1, math.ceil(width_deg / MAX_SIDE_DEG - 1e-9))
    rows = max(1, math.ceil(height_deg / MAX_SIDE_DEG - 1e-9))
    return cols, rows


def snap_region(ra: float, dec: float, width_deg: float, height_deg: float) -> Box:
    """Validate and snap a drawn region (Q-470). Raises ``LiveAreaError`` for a bad one."""
    vals = (ra, dec, width_deg, height_deg)
    if not all(math.isfinite(v) for v in vals):
        raise LiveAreaError("area:bad_box", "The region has a value that is not a number.")
    if not (-90.0 <= dec <= 90.0):
        raise LiveAreaError("area:bad_box", "Dec must be between -90 and 90 degrees.")
    if width_deg <= 0.0 or height_deg <= 0.0:
        raise LiveAreaError("area:bad_box", "The region must have a width and a height.")
    if max(width_deg, height_deg) > MAX_REGION_SIDE_DEG + 1e-9:
        raise LiveAreaError(
            "scan:too_large", f"A scan is at most {MAX_REGION_SIDE_DEG:g} degrees a side."
        )
    w = min(max(_snap(width_deg), GRID_DEG), MAX_REGION_SIDE_DEG)
    h = min(max(_snap(height_deg), GRID_DEG), MAX_REGION_SIDE_DEG)
    cols, rows = grid_shape(w, h)
    if cols * rows > MAX_SQUARES:
        raise LiveAreaError("scan:too_large", f"A scan is at most {MAX_SQUARES} squares.")
    region = Box(_snap(ra % 360.0) % 360.0, _snap(dec), w, h)
    if abs(region.dec) + region.height_deg / 2.0 >= POLE_LIMIT_DEG:
        raise LiveAreaError("area:bad_box", "Scans cannot reach a celestial pole.")
    return region


def deproject(ra0: float, dec0: float, xi_deg: float, eta_deg: float) -> tuple[float, float]:
    """Inverse gnomonic projection about ``(ra0, dec0)``; ``xi`` towards east (growing RA),
    ``eta`` towards north, all in degrees. RA in [0, 360)."""
    x, y = math.radians(xi_deg), math.radians(eta_deg)
    d0 = math.radians(dec0)
    rho = math.hypot(x, y)
    if rho == 0.0:
        return ra0 % 360.0, dec0
    c = math.atan(rho)
    sinc, cosc = math.sin(c), math.cos(c)
    dec = math.asin(cosc * math.sin(d0) + y * sinc * math.cos(d0) / rho)
    ra = math.radians(ra0) + math.atan2(
        x * sinc, rho * math.cos(d0) * cosc - y * math.sin(d0) * sinc
    )
    return math.degrees(ra) % 360.0, math.degrees(dec)


def split(region: Box) -> ScanPlan:
    """The region's squares in scan order (Q-470)."""
    cols, rows = grid_shape(region.width_deg, region.height_deg)
    sw, sh = region.width_deg / cols, region.height_deg / rows
    pw, ph = min(sw + 2 * PAD_DEG, MAX_SIDE_DEG), min(sh + 2 * PAD_DEG, MAX_SIDE_DEG)
    squares = []
    for r in range(rows):
        eta = region.height_deg / 2.0 - (r + 0.5) * sh
        for c in range(cols):
            xi = region.width_deg / 2.0 - (c + 0.5) * sw  # left on screen is east (+xi)
            ra, dec = deproject(region.ra, region.dec, xi, eta)
            squares.append(Square(r * cols + c + 1, r, c, snap_box(ra, dec, pw, ph)))
    return ScanPlan(region, cols, rows, tuple(squares))


def plan_scan(ra: float, dec: float, width_deg: float, height_deg: float) -> ScanPlan:
    return split(snap_region(ra, dec, width_deg, height_deg))


__all__ = [
    "KINDS",
    "MAX_REGION_SIDE_DEG",
    "MAX_SQUARES",
    "PAD_DEG",
    "ScanPlan",
    "Square",
    "deproject",
    "grid_shape",
    "plan_scan",
    "snap_region",
    "split",
]
