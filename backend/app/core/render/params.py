"""Card -> generator parameters (R6.2). Deterministic; the tags are applied by ``card_to_params``.

An LLM never produces a number here. Missing data means ``BakeRefusal``, not a guess.
"""

from __future__ import annotations

import math
import numbers
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

Style = Literal["rubble", "cratered", "large_cratered"]
Kind = Literal["asteroid", "bands"]

# R6.2 table (issue #71, Q-210): (noise_octaves, noise_freq) of the fine detail layer only. The
# overall shape, the craters and the boulders now come from physics (below), not from the style.
_STYLE_RULES: dict[str, tuple[int, float]] = {
    "rubble": (7, 6.0),
    "cratered": (6, 3.0),
    "large_cratered": (6, 2.0),
}

# --- Physics of a small body (issue #71 stream A, D-36, Q-210). -------------------------------
G_NEWTON = 6.674e-11  # m^3 kg^-1 s^-2. CODATA 2018: 6.67430e-11.
# Effective strength Y in h/R = Y / (rho g R). Order of magnitude taken from the approved
# prototype; real asteroid cohesion spans roughly 1e3 to 1e7 Pa. [verify] with a citation.
STRENGTH_Y_PA = 1.0e6  # [verify]
LUMP_MIN, LUMP_MAX = 0.03, 0.30  # clamp of h/R (prototype)
# Bulk density by class family, `inferred_from_analog` (a card carries no density). Each value is
# one real body: C-type = Bennu 1190 +- 13 (Lauretta et al. 2019, Nature 568, 55); S-type = Eros
# 2670 (Yeomans et al. 2000, Science 289, 2085). Other classes use the generic value below.
DENSITY_ANALOG_KG_M3: dict[str, float] = {
    **dict.fromkeys("CBFGDP", 1190.0),
    **dict.fromkeys("SQVAORKL", 2670.0),
}
DENSITY_GENERIC_KG_M3 = 1500.0  # [verify] no analog for X, M, E or an unknown class: a mid value.
# Spin barrier of a strengthless body, P = sqrt(3 pi / (G rho)) (Pravec and Harris 2000,
# Icarus 148, 12): a body spinning faster than this must be solid rock.
SOLID_BELOW_KM = 0.15  # prototype: smaller than this is a monolith (the spin-barrier data).
RUBBLE_BELOW_KM = 40.0  # prototype: up to this a rubble pile, above it fractured under regolith.
# Boulder density factor by structure (relative to rubble = 1). Artistic (prototype values).
BOULDER_FACTOR: dict[str, float] = {"solid": 0.45, "rubble": 1.0, "fractured": 0.25}
# Crater coverage: sum(rc^2) over the craters is 4 x coverage. Surface age has no card field: the
# default is the prototype's 70 on a 0 to 100 scale (artistic). N(>D) ~ D^-2 up to saturation.
SURFACE_AGE_PERCENT = 70.0
CRATER_COVERAGE_ROCKY = 0.05 + 0.27 * SURFACE_AGE_PERCENT / 100.0
CRATER_COVERAGE_SMOOTH = 0.012
SMOOTH_LUMP_FACTOR = 0.3
SMOOTH_FINE_FACTOR = 0.25
FINE_AMP = 0.012  # fraction of the radius, artistic
CRATER_R_MIN = 0.014  # smallest crater radius, in mean radii (artistic, prototype)
CRATER_R_MAX = 0.38
CRATER_DEPTH_PER_R = 0.42  # depth / crater radius at full freshness (artistic, prototype)
Roughness = Literal["rocky", "smooth"]
Structure = Literal["solid", "rubble", "fractured"]

NEUTRAL_RGB = (0.5, 0.5, 0.5)  # placeholder when no colour source exists; see missing
BAKED_TYPES = ("asteroid_procedural", "brown_dwarf", "brown_dwarf_binary")


class BakeRefusal(Exception):
    """The card lacks what the baker needs. ``missing`` lists card fields, not layers.

    Only a missing diameter (asteroids), spectral class (brown dwarfs) or an unbaked type
    refuses the whole bake; other gaps bake flat and are listed in ``BakeParams.missing``.
    """

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
    # Peak-to-peak range of the height field, fraction of the radius: the scale of the displacement
    # and of height.png (stored as 0.5 + h / relief_amp). Derived from the fields below.
    relief_amp: float = 0.0
    boulder_density: float = 0.0
    # Issue #71 stream A (Q-210). Rough and rocky is the default; only data can make it smooth.
    roughness: Roughness = "rocky"
    structure: Structure = "rubble"
    density_kg_m3: float = DENSITY_GENERIC_KG_M3
    density_source: str = "generic"  # "analog_c", "analog_s" or "generic"
    spin_period_h: float | None = None
    lump: float = 0.0  # h/R = clamp(Y / (rho g R), 0.03, 0.3), times SMOOTH_LUMP_FACTOR if smooth
    crater_coverage: float = 0.0
    axis_ratio: float = 1.0  # a/b = 10^(0.4 A), c = b (R6.2); 1 without a light curve
    fine_amp: float = 0.0
    hydration: bool = False
    redness: float = 0.0
    band_contrast: float = 0.0
    haze: float = 0.0
    # Inputs that were absent: "albedo_map" (no colour: neutral grey), "gaia_rgb" (present but
    # unusable), "brightness" (no albedo value), "bands" (no ch4_depth_33). The viewer must not
    # draw those layers as data.
    missing: tuple[str, ...] = ()


def _val(card: Mapping[str, Any], key: str) -> Any:
    tv = card.get(key)
    return tv.get("value") if isinstance(tv, Mapping) else None


def _number(card: Mapping[str, Any], key: str) -> float | None:
    v = _val(card, key)
    if isinstance(v, bool) or not isinstance(v, numbers.Real):
        return None
    try:
        x = float(v)
    except OverflowError:  # a JSON integer such as 10**400
        return None
    return x if math.isfinite(x) else None  # NaN and inf are unknown, never a value (Q-40)


def _rgb(card: Mapping[str, Any], key: str) -> tuple[float, float, float] | None:
    v = _val(card, key)
    if not isinstance(v, list | tuple) or len(v) != 3:
        return None
    out: list[float] = []
    for c in v:
        x = _number({"c": {"value": c}}, "c")
        if x is None:
            return None
        out.append(x)
    return (out[0], out[1], out[2])


def style_for(diameter_km: float) -> Style:
    """D < 1 km rubble; 1 to 50 km cratered; above 50 km large_cratered (R6.2)."""
    if diameter_km < 1.0:
        return "rubble"
    return "cratered" if diameter_km <= 50.0 else "large_cratered"


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def surface_gravity(radius_m: float, density: float) -> float:
    """g = (4/3) pi G rho R for a uniform sphere, m/s^2 (derived)."""
    return 4.0 / 3.0 * math.pi * G_NEWTON * density * radius_m


def lump_ratio(radius_m: float, density: float) -> float:
    """h/R = clamp(Y / (rho g R), 0.03, 0.3): the relief that rock strength can hold (derived)."""
    # A vanishing radius would divide by zero; 1 mm is far below any body and clamps to LUMP_MAX.
    radius_m = max(radius_m, 1e-3)
    g = surface_gravity(radius_m, density)
    return _clamp(STRENGTH_Y_PA / (density * g * radius_m), LUMP_MIN, LUMP_MAX)


def spin_barrier_h(density: float) -> float:
    """Shortest period a strengthless rubble pile survives, hours: sqrt(3 pi / (G rho))."""
    return math.sqrt(3.0 * math.pi / (G_NEWTON * density)) / 3600.0


def structure_of(diameter_km: float, density: float, spin_period_h: float | None) -> Structure:
    """Solid above the spin barrier or when tiny; rubble to 40 km; fractured rock above that."""
    fast = spin_period_h is not None and spin_period_h < spin_barrier_h(density)
    if fast or diameter_km < SOLID_BELOW_KM:
        return "solid"
    return "rubble" if diameter_km < RUBBLE_BELOW_KM else "fractured"


def data_says_smooth(card: Mapping[str, Any]) -> bool:
    """True only when the card carries data that makes the surface smooth.

    ASSUMPTION (Q-212): no card field carries radar roughness or thermal inertia yet, so nothing
    can switch a body to smooth and this is always False: the default stays rocky. The switch is
    here so a later field only has to be read in this one place.
    """
    del card
    return False


def relief_range(
    lump: float,
    roughness: Roughness,
    fine_amp: float,
    boulder_density: float,
    crater_coverage: float,
) -> float:
    """Design bound of the peak-to-peak height range (fraction of the radius).

    About 3 sigma of the shape waves (rms 0.45 lump), the deepest and highest crater, the fine
    layer and the tallest boulder. Used as the displacement scale; ``bake`` clips beyond it.
    """
    crater_r_max = min(CRATER_R_MAX, CRATER_R_MIN * (1.0 / 0.015) ** 0.5) if crater_coverage else 0
    half = (
        1.4 * lump
        + CRATER_DEPTH_PER_R * crater_r_max
        + fine_amp
        + (0.02 if boulder_density > 0 else 0.0)
    )
    return round(2.0 * half, 3)


def _density(letter: str) -> tuple[float, str]:
    if letter in DENSITY_ANALOG_KG_M3:
        return DENSITY_ANALOG_KG_M3[letter], "analog_c" if letter in "CBFGDP" else "analog_s"
    return DENSITY_GENERIC_KG_M3, "generic"


def _asteroid(card: Mapping[str, Any], seed: int) -> BakeParams:
    from app.core.render.palette import ASTEROID_PALETTE

    d = _number(card, "diameter_km")
    if d is None or d <= 0 or not math.isfinite(d * 500.0):
        raise BakeRefusal("no diameter: the relief and its scale cannot be set", ["diameter_km"])
    missing: list[str] = []
    cls = _val(card, "spectral_class")
    letter = cls.strip()[:1].upper() if isinstance(cls, str) else ""
    gaia = _rgb(card, "gaia_rgb")
    if gaia is None and _val(card, "gaia_rgb") is not None:
        missing.append(
            "gaia_rgb"
        )  # present but unusable: the palette colour is analog, not derived
    base = gaia or ASTEROID_PALETTE.get(letter)
    if base is None:
        # Only the albedo layer needs a colour (R7.2): height and normals are still baked.
        # The albedo.webp stays only because RenderParams.textures requires it; it is a neutral
        # grey from no measurement, so card_to_params must refuse the `albedo_map` layer and the
        # visible mode when `albedo_map` is listed here (Q-47).
        base = NEUTRAL_RGB
        missing.append("albedo_map")
    albedo = _number(card, "albedo")
    if albedo is None:
        brightness = 1.0  # not the R6.2 formula: listed so card_to_params can say so
        missing.append("brightness")
    else:
        brightness = _clamp(0.12 + 1.6 * albedo, 0.12, 0.8)
    depth3 = _number(card, "band_depth_3um")
    slope = _number(card, "slope_075_25")
    style = style_for(d)
    octaves, freq = _STYLE_RULES[style]
    radius_m = d * 500.0
    rho, rho_source = _density(letter)
    period = _number(card, "rot_period_h")
    if period is not None and period <= 0:
        period = None
    structure = structure_of(d, rho, period)
    smooth = data_says_smooth(card)
    roughness: Roughness = "smooth" if smooth else "rocky"
    lump = lump_ratio(radius_m, rho) * (SMOOTH_LUMP_FACTOR if smooth else 1.0)
    coverage = CRATER_COVERAGE_SMOOTH if smooth else CRATER_COVERAGE_ROCKY
    boulders = 0.0 if smooth else BOULDER_FACTOR[structure]
    fine = FINE_AMP * (SMOOTH_FINE_FACTOR if smooth else 1.0)
    amp = _number(card, "lightcurve_amp_mag")
    ratio = 10.0 ** (0.4 * amp) if amp is not None and amp >= 0 else 1.0
    return BakeParams(
        kind="asteroid",
        seed=seed,
        radius_m=radius_m,
        base_rgb=base,
        brightness=brightness,
        style=style,
        noise_octaves=octaves,
        noise_freq=freq,
        relief_amp=relief_range(lump, roughness, fine, boulders, coverage),
        boulder_density=boulders,
        roughness=roughness,
        structure=structure,
        density_kg_m3=rho,
        density_source=rho_source,
        spin_period_h=period,
        lump=lump,
        crater_coverage=coverage,
        axis_ratio=ratio,
        fine_amp=fine,
        hydration=depth3 is not None and depth3 > 0.05,
        redness=_clamp(slope / 100.0, -0.08, 0.08) if slope is not None else 0.0,
        missing=tuple(missing),
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
