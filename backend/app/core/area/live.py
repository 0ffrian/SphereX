"""Live areas (Q-462, issue #141): a box drawn anywhere is computed on request, in a background
job, instead of only the precomputed ``[[area]]`` entries of ``targets.toml``.

This module is the light half, imported by the API: the box rules, the area id, the choice of
two visits and the plan shown before anything runs. It loads no pipeline module (A16.2); the
job that runs the pipeline is ``live_jobs``, which imports it lazily in its worker.

- **Box:** centre and sides snapped to a 0.05 degree grid, each side at most 2 degrees (the UI
  holds the drawn box at 2 degrees, so a larger one is a client error).
- **Visits:** one SIA cone at the box centre (radius ``CENTRE_RADIUS_DEG``); its frames grouped
  into visits as the area pipeline does (a gap over ``visit_gap_h``); the pair of consecutive
  visits with the smallest gap at most ``MAX_GAP_H`` apart, the earliest on a tie. No such pair:
  ``area:no_visit_pair``.
- **Area id:** ``live-`` and 12 hex of the SHA-256 of the release, the snapped box and the two
  visit starts, so the same box with the same visits is the same area (and the same cache
  entries), and another visit pair is another area.
- **Windows:** one per visit, padded by ``WINDOW_PAD_MIN`` so ``find_frames`` keeps exactly those
  two visits over the whole box.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Any

from app.adapters import irsa_sia
from app.context import Context
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaSpec
from app.timefmt import iso_utc_z

GRID_DEG = 0.05
MAX_SIDE_DEG = 2.0
MAX_GAP_H = 6.0
WINDOW_PAD_MIN = 5.0
CENTRE_RADIUS_DEG = 0.001
CENTRE_MAXREC = 5000
MAX_ALTERNATIVES = 10
# Rough run time, kept on the high side: the known-object step (one Horizons request per
# SkyBoT candidate) dominates and varies. 13 Nov 2026 runs: QR3 0.66 deg2 ~9 min and
# 2.4 deg2 ~21 min; DR1 0.15 deg2 (14 candidates) 10.6 min. Shown as an estimate only.
ESTIMATE_BASE_S = 540.0
ESTIMATE_PER_DEG2_S = 600.0
VISITS_FORMULA = (
    "frames of one SIA cone at the box centre grouped into visits (gap over visit_gap_h); the "
    "pair of consecutive visits with the smallest gap at most max_gap_h apart, earliest on a tie"
)


class LiveAreaError(ValueError):
    """A request that cannot become a live area: ``code`` is the API error code."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class Box:
    ra: float
    dec: float
    width_deg: float
    height_deg: float

    def reply(self) -> dict[str, float]:
        return {
            "ra": self.ra,
            "dec": self.dec,
            "width_deg": self.width_deg,
            "height_deg": self.height_deg,
        }


@dataclass(frozen=True)
class Visit:
    start: datetime
    end: datetime
    n_frames: int

    def reply(self) -> dict[str, Any]:
        return {
            "start": iso_utc_z(self.start),
            "end": iso_utc_z(self.end),
            "n_frames": self.n_frames,
        }


@dataclass(frozen=True)
class Plan:
    area_id: str
    release: str
    box: Box
    visits: tuple[Visit, Visit]
    alternatives: tuple[tuple[Visit, Visit], ...]

    @property
    def n_frames(self) -> int:
        return self.visits[0].n_frames + self.visits[1].n_frames

    def estimate_s(self) -> int:
        return estimate_seconds(self.box)

    def spec(self) -> AreaSpec:
        pad = timedelta(minutes=WINDOW_PAD_MIN)
        wins = tuple((v.start - pad, v.end + pad) for v in self.visits)
        b = self.box
        return AreaSpec(self.area_id, b.ra, b.dec, b.width_deg, b.height_deg, self.release, wins)

    def reply(self) -> dict[str, Any]:
        return {
            "area_id": self.area_id,
            "release": self.release,
            "box": self.box.reply(),
            "visits": [v.reply() for v in self.visits],
            "n_frames": self.n_frames,
            "estimate_s": self.estimate_s(),
            "alternatives": [
                {"visits": [a.reply(), b.reply()], "gap_h": round(gap_hours(a, b), 3)}
                for a, b in self.alternatives
            ],
            "provenance": {
                "visits": {
                    "tag": "measured",
                    "source": f"IRSA SIA, collection {self.release}",
                    "formula": VISITS_FORMULA,
                }
            },
        }


def _snap(v: float) -> float:
    return round(round(v / GRID_DEG) * GRID_DEG, 2)


def snap_box(ra: float, dec: float, width_deg: float, height_deg: float) -> Box:
    """Validate and snap a drawn box (Q-462). Raises ``LiveAreaError`` for a bad one."""
    vals = (ra, dec, width_deg, height_deg)
    if not all(math.isfinite(v) for v in vals):
        raise LiveAreaError("area:bad_box", "The box has a value that is not a number.")
    if not (-90.0 <= dec <= 90.0):
        raise LiveAreaError("area:bad_box", "Dec must be between -90 and 90 degrees.")
    if width_deg <= 0.0 or height_deg <= 0.0:
        raise LiveAreaError("area:bad_box", "The box must have a width and a height.")
    if max(width_deg, height_deg) > MAX_SIDE_DEG + 1e-9:
        raise LiveAreaError(
            "area:too_large", f"A live area is at most {MAX_SIDE_DEG:g} degrees a side."
        )
    w = min(max(_snap(width_deg), GRID_DEG), MAX_SIDE_DEG)
    h = min(max(_snap(height_deg), GRID_DEG), MAX_SIDE_DEG)
    box = Box(_snap(ra % 360.0) % 360.0, _snap(dec), w, h)
    if abs(box.dec) + box.height_deg / 2.0 >= 89.0:
        raise LiveAreaError("area:bad_box", "Live areas cannot reach a celestial pole.")
    return box


def estimate_seconds(box: Box) -> int:
    return round(ESTIMATE_BASE_S + ESTIMATE_PER_DEG2_S * box.width_deg * box.height_deg)


def area_id(release: str, box: Box, visits: tuple[Visit, Visit]) -> str:
    text = "|".join(
        [
            release,
            f"{box.ra:.2f}",
            f"{box.dec:.2f}",
            f"{box.width_deg:.2f}",
            f"{box.height_deg:.2f}",
            iso_utc_z(visits[0].start),
            iso_utc_z(visits[1].start),
        ]
    )
    return "live-" + hashlib.sha256(text.encode()).hexdigest()[:12]


def group_visits(times: Sequence[datetime], gap_h: float) -> list[Visit]:
    """Frame times into visits: a new visit after a gap of more than ``gap_h`` hours."""
    out: list[list[datetime]] = []
    for t in sorted(times):
        if out and (t - out[-1][-1]).total_seconds() <= gap_h * 3600.0:
            out[-1].append(t)
        else:
            out.append([t])
    return [Visit(g[0], g[-1], len(g)) for g in out]


def gap_hours(a: Visit, b: Visit) -> float:
    return (b.start - a.end).total_seconds() / 3600.0


def visit_pairs(visits: Sequence[Visit], max_gap_h: float = MAX_GAP_H) -> list[tuple[Visit, Visit]]:
    """Consecutive pairs at most ``max_gap_h`` apart, closest first, earliest on a tie."""
    pairs = [(a, b) for a, b in pairwise(visits) if gap_hours(a, b) <= max_gap_h]
    return sorted(pairs, key=lambda p: (gap_hours(*p), p[0].start))


def plan_from_times(
    release: str,
    box: Box,
    times: Sequence[datetime],
    *,
    pair: tuple[datetime, datetime] | None = None,
) -> Plan:
    """The plan from the frame times at the box centre; ``pair`` picks a visit pair by the two
    visit starts (the picker), else the closest pair."""
    visits = group_visits(times, DEFAULT_AREA_CONFIG.visit_gap_h)
    pairs = visit_pairs(visits)
    if not pairs:
        raise LiveAreaError(
            "area:no_visit_pair",
            f"SPHEREx did not see this patch twice within {MAX_GAP_H:g} hours.",
        )
    chosen = pairs[0]
    if pair is not None:
        match = [p for p in pairs if (p[0].start, p[1].start) == pair]
        if not match:
            raise LiveAreaError(
                "area:no_visit_pair", "That pair of visits is not available for this box."
            )
        chosen = match[0]
    rest = tuple(p for p in pairs if p is not chosen)[:MAX_ALTERNATIVES]
    return Plan(area_id(release, box, chosen), release, box, chosen, rest)


def plan_area(ctx: Context, box: Box, *, pair: tuple[datetime, datetime] | None = None) -> Plan:
    """One SIA cone at the box centre, through the read-through cache. Raises the adapter's
    ``CacheMissOffline``, ``UpstreamUnavailable`` or ``UpstreamError`` as they come."""
    res = irsa_sia.search(ctx, box.ra, box.dec, radius_deg=CENTRE_RADIUS_DEG, maxrec=CENTRE_MAXREC)
    times = [irsa_sia.frame_time(r) for r in res.rows]
    return plan_from_times(ctx.settings.data_release, box, times, pair=pair)


__all__ = [
    "MAX_SIDE_DEG",
    "Box",
    "LiveAreaError",
    "Plan",
    "Visit",
    "area_id",
    "estimate_seconds",
    "group_visits",
    "plan_area",
    "plan_from_times",
    "snap_box",
    "visit_pairs",
]
