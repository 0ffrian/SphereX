"""Visits and exposures from frame midpoints (A17.1; shared by Area search, Track may adopt it).

Pure and neutral: no I/O, no import from ``app.core.area`` (so Track's code in ``core/find`` can
use it without importing the area pipeline). Rules (A17.1, Q-400):

- Midpoints sorted in time. A new **visit** starts when the gap to the previous midpoint is
  ``visit_gap_h`` or more (a chained rule: frames 50 min apart stay one visit however many).
- Inside a visit, a midpoint within ``exposure_tol_s`` of the first midpoint of the current
  exposure joins it (both detectors of one exposure share a midpoint); otherwise a new
  **exposure** starts. Visits and exposures are numbered from 1 in time order.
- An exposure's ``time`` is the earliest midpoint of its frames.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Slot:
    """Where one input midpoint falls."""

    visit: int
    exposure: int
    time: datetime  # the exposure's time: the earliest midpoint of its frames


def group_visits(
    midpoints: Sequence[datetime], visit_gap_h: float, exposure_tol_s: float
) -> list[Slot]:
    """One ``Slot`` per input midpoint, in input order (the input need not be sorted).

    Ties keep input order, so equal midpoints are always one exposure.
    """
    order = sorted(range(len(midpoints)), key=lambda i: (midpoints[i], i))
    gap_s = visit_gap_h * 3600.0
    out: list[Slot | None] = [None] * len(midpoints)
    visit = 0
    exposure = 0
    prev: datetime | None = None
    exp_start: datetime | None = None
    for i in order:
        t = midpoints[i]
        if prev is None or (t - prev).total_seconds() >= gap_s:
            visit += 1
            exposure = 1
            exp_start = t
        elif exp_start is None or (t - exp_start).total_seconds() > exposure_tol_s:
            exposure += 1
            exp_start = t
        prev = t
        assert exp_start is not None
        out[i] = Slot(visit, exposure, exp_start)
    return [s for s in out if s is not None]


def visit_spans(
    midpoints: Sequence[datetime], slots: Sequence[Slot]
) -> dict[int, tuple[datetime, datetime]]:
    """First and last midpoint of each visit."""
    spans: dict[int, tuple[datetime, datetime]] = {}
    for t, s in zip(midpoints, slots, strict=True):
        lo, hi = spans.get(s.visit, (t, t))
        spans[s.visit] = (min(lo, t), max(hi, t))
    return dict(sorted(spans.items()))


def visit_gaps_s(spans: dict[int, tuple[datetime, datetime]]) -> list[float]:
    """Seconds between consecutive visits' span midpoints (A17 ``Δt_v``: mid-time to mid-time)."""
    mids = [a + (b - a) / 2 for a, b in spans.values()]
    return [(b - a).total_seconds() for a, b in itertools.pairwise(mids)]
