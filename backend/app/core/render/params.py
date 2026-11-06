"""Card -> generator parameters (R6.2). Deterministic; the tags are applied by ``card_to_params``.

An LLM never produces a number here. Missing data means ``BakeRefusal``, not a guess.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

Style = Literal["rubble", "cratered", "large_cratered"]
Kind = Literal["asteroid", "bands"]

# R6.2 table: (noise_octaves, noise_freq, relief_amp, crater_count, boulder_density)
_STYLE_RULES: dict[str, tuple[int, float, float, int, float]] = {
    "rubble": (7, 6.0, 0.04, 40, 1.0),
    "cratered": (6, 3.0, 0.03, 250, 0.2),
    "large_cratered": (6, 2.0, 0.02, 500, 0.05),
}

BAKED_TYPES = ("asteroid_procedural", "brown_dwarf", "brown_dwarf_binary")


class BakeRefusal(Exception):
    """The card lacks what the baker needs. ``missing`` lists card fields, not layers."""

    def __init__(self, reason: str, missing: list[str]) -> None:
        super().__init__(reason)
        self.reason = reason
        self.missing = missing


@dataclass(frozen=True)
class BakeParams:
    kind: Kind
    seed: int
    radius_m: float
    base_rgb: tuple[float, float, float]  # linear RGB
    brightness: float
    style: Style | None = None
    noise_octaves: int = 0
    noise_freq: float = 0.0
    relief_amp: float = 0.0
    crater_count: int = 0
    boulder_density: float = 0.0
    hydration: bool = False
    redness: float = 0.0
    band_contrast: float = 0.0
    haze: float = 0.0
    missing: tuple[str, ...] = ()  # layers baked flat because their input is absent


def _val(card: Mapping[str, Any], key: str) -> Any:
    tv = card.get(key)
    return tv.get("value") if isinstance(tv, Mapping) else None


def _number(card: Mapping[str, Any], key: str) -> float | None:
    v = _val(card, key)
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else None


def style_for(diameter_km: float) -> Style:
    """D < 1 km rubble; 1 to 50 km cratered; above 50 km large_cratered (R6.2)."""
    if diameter_km < 1.0:
        return "rubble"
    return "cratered" if diameter_km <= 50.0 else "large_cratered"


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _asteroid(card: Mapping[str, Any], seed: int) -> BakeParams:
    from app.core.render.palette import ASTEROID_PALETTE

    d = _number(card, "diameter_km")
    if d is None or d <= 0:
        raise BakeRefusal("no diameter: the relief and its scale cannot be set", ["diameter_km"])
    rgb_v = _val(card, "gaia_rgb")
    cls = _val(card, "spectral_class")
    letter = cls.strip()[:1].upper() if isinstance(cls, str) else ""
    if isinstance(rgb_v, list) and len(rgb_v) == 3:
        base = (float(rgb_v[0]), float(rgb_v[1]), float(rgb_v[2]))
    elif letter in ASTEROID_PALETTE:
        base = ASTEROID_PALETTE[letter]
    else:
        raise BakeRefusal(
            "no colour: neither gaia_rgb nor a spectral class with a palette (S, C, V, X)",
            ["gaia_rgb or spectral_class"],
        )
    albedo = _number(card, "albedo")
    brightness = _clamp(0.12 + 1.6 * albedo, 0.12, 0.8) if albedo is not None else 1.0
    depth3 = _number(card, "band_depth_3um")
    slope = _number(card, "slope_075_25")
    style = style_for(d)
    octaves, freq, relief, n_craters, boulders = _STYLE_RULES[style]
    return BakeParams(
        kind="asteroid",
        seed=seed,
        radius_m=d * 500.0,
        base_rgb=base,
        brightness=brightness,
        style=style,
        noise_octaves=octaves,
        noise_freq=freq,
        relief_amp=relief,
        crater_count=n_craters,
        boulder_density=boulders,
        hydration=depth3 is not None and depth3 > 0.05,
        redness=_clamp(slope / 100.0, -0.08, 0.08) if slope is not None else 0.0,
    )


def _bands(card: Mapping[str, Any], seed: int) -> BakeParams:
    from app.core.render.palette import BROWN_DWARF_PALETTE

    cls = _val(card, "spectral_class")
    # Binary cards hold one class string such as "T1+T6" (Q-34); the primary sets the palette.
    letter = cls.split("+")[0].strip()[:1].upper() if isinstance(cls, str) else ""
    if letter not in BROWN_DWARF_PALETTE:
        raise BakeRefusal("no spectral class with a palette (T, Y)", ["spectral_class"])
    base, haze = BROWN_DWARF_PALETTE[letter]
    ch4 = _number(card, "ch4_depth_33")
    return BakeParams(
        kind="bands",
        seed=seed,
        radius_m=1.0,  # unused: the height map is flat
        base_rgb=base,
        brightness=1.0,
        band_contrast=_clamp(2.0 * ch4, 0.1, 0.8) if ch4 is not None else 0.0,
        haze=haze,
        missing=() if ch4 is not None else ("bands",),
    )


def params_from_card(card: Mapping[str, Any], seed: int) -> BakeParams:
    if seed < 0:
        raise ValueError("seed must be an integer >= 0 (Q-35)")
    kind = card.get("type")
    if kind == "asteroid_procedural":
        return _asteroid(card, seed)
    if kind in ("brown_dwarf", "brown_dwarf_binary"):
        return _bands(card, seed)
    raise BakeRefusal(f"type {kind!r} has no baked textures (R6, D-01)", ["textures"])
