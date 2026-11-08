"""Band selection for the composite: one frame per channel, all from one survey pass.

Input is one ``Candidate`` per Stage 1 frame, with Stage 2's verdict on it: usable (a spectrum
point), flagged (Stage 2 dropped aperture pixels outside the core) or refused (``saturated``,
``aperture_flags`` and the other A4.2 reasons). A refused frame is never used, so a saturated or
bad core never reaches the image silently.

Rules (constants in ``config``):
- A frame counts for a channel when ``|wavelength - target| / target <= MAX_OFFSET_FRACTION``.
- A pass is any window of ``MAX_PASS_SPAN_DAYS`` that starts at a usable frame's time. In each
  window every channel takes its best usable frame: unflagged before flagged, then the nearest
  wavelength, then the smallest frame id.
- The chosen window has all three channels and, in this order, the fewest flagged channels, the
  smallest summed relative wavelength offset, the shortest time span, the earliest start and the
  smallest frame ids. Every step is a total order, so the choice is deterministic.

Refusals (``missing``): ``composite:<channel>:no_frame`` (no frame near the target),
``composite:<channel>:saturated`` (every frame near it was refused as saturated),
``composite:<channel>:no_usable_frame`` (refused for other reasons), then
``composite:too_few_bands`` and, when a channel failed on saturation only,
``composite:saturated``; ``composite:no_common_pass`` when every channel has frames but no pass
holds all three. A refused frame nearer to the target than the one used, inside the chosen pass,
is listed as ``composite:<channel>:skipped:<reason>:<frame_id>``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.core.composite import config

SATURATED = "saturated"
TOO_FEW_BANDS = "composite:too_few_bands"
ALL_SATURATED = "composite:saturated"
NO_COMMON_PASS = "composite:no_common_pass"


@dataclass(frozen=True)
class Candidate:
    frame_id: str
    time: datetime
    wavelength_um: float
    usable: bool
    flagged: bool = False
    refusal: str | None = None  # Stage 2 reason when not usable


@dataclass(frozen=True)
class Pick:
    channel: str
    candidate: Candidate
    offset_fraction: float


@dataclass
class Selection:
    picks: list[Pick] = field(default_factory=list)  # blue, green, red; empty when refused
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.picks) == len(config.CHANNELS)


def offset_fraction(c: Candidate, channel: str) -> float:
    target = config.TARGET_UM[channel]
    return abs(c.wavelength_um - target) / target


def in_band(c: Candidate, channel: str) -> bool:
    return offset_fraction(c, channel) <= config.MAX_OFFSET_FRACTION + 1e-12


def _pick_key(c: Candidate, channel: str) -> tuple[bool, float, str]:
    return (c.flagged, round(offset_fraction(c, channel), 9), c.frame_id)


def _channel_refusal(channel: str, near: list[Candidate]) -> str | None:
    if not near:
        return f"composite:{channel}:no_frame"
    if any(c.usable for c in near):
        return None
    if all(c.refusal == SATURATED for c in near):
        return f"composite:{channel}:{SATURATED}"
    return f"composite:{channel}:no_usable_frame"


Score = tuple[int, float, float, datetime, tuple[str, ...]]


def _best(cands: list[Candidate], channel: str, start: datetime, end: datetime) -> Candidate | None:
    inside = [c for c in cands if start <= c.time <= end]
    return min(inside, key=lambda c: _pick_key(c, channel)) if inside else None


def select_bands(candidates: Iterable[Candidate]) -> Selection:
    cands = sorted(candidates, key=lambda c: (c.time, c.frame_id))
    near = {ch: [c for c in cands if in_band(c, ch)] for ch in config.CHANNELS}

    refusals = [r for ch in config.CHANNELS if (r := _channel_refusal(ch, near[ch])) is not None]
    if refusals:
        refused = [*refusals, TOO_FEW_BANDS]
        if any(r.endswith(":" + SATURATED) for r in refusals):
            refused.append(ALL_SATURATED)
        return Selection([], sorted(refused))

    usable = {ch: [c for c in near[ch] if c.usable] for ch in config.CHANNELS}
    span = timedelta(days=config.MAX_PASS_SPAN_DAYS)
    starts = sorted({c.time for ch in config.CHANNELS for c in usable[ch]})
    best: tuple[Score, datetime, list[Candidate]] | None = None
    for start in starts:
        end = start + span
        chosen = [_best(usable[ch], ch, start, end) for ch in config.CHANNELS]
        picked = [c for c in chosen if c is not None]
        if len(picked) != len(config.CHANNELS):
            continue
        times = [c.time for c in picked]
        offsets = sum(offset_fraction(c, ch) for c, ch in zip(picked, config.CHANNELS, strict=True))
        score: Score = (
            sum(1 for c in picked if c.flagged),
            round(offsets, 9),
            (max(times) - min(times)).total_seconds(),
            start,
            tuple(c.frame_id for c in picked),
        )
        if best is None or score < best[0]:
            best = (score, start, picked)
    if best is None:
        return Selection([], [NO_COMMON_PASS])

    _, start, best_picks = best
    end = start + span
    picks: list[Pick] = []
    missing: list[str] = []
    for c, ch in zip(best_picks, config.CHANNELS, strict=True):
        off = offset_fraction(c, ch)
        picks.append(Pick(ch, c, off))
        for other in near[ch]:
            if not other.usable and start <= other.time <= end and offset_fraction(other, ch) < off:
                missing.append(f"composite:{ch}:skipped:{other.refusal}:{other.frame_id}")
    return Selection(picks, sorted(missing))
