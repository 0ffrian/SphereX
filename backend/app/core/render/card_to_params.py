"""Pipeline stage 7 (A4.7): ObjectCard -> RenderParams with deterministic rules (R3.4, R6.2, R7).

Pure: the same card, seed and generator version give the same dict. Every layer carries a tag.
A layer whose required card value is null or absent is refused: it is left out and its id goes
into ``missing`` (R7 intro); nothing is guessed. Layer ids follow Q-38.

The generator parameters themselves (style, relief, palette, hydration, redness) are computed by
``params_from_card`` (R6.2), which the texture baker uses; this module adds the tags.
"""

from __future__ import annotations

import hashlib
import math
import numbers
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.core.render.bake import BAKER_RULES_VERSION, FILES, bake_dir
from app.core.render.blackbody import FORMULA as TEFF_FORMULA
from app.core.render.blackbody import teff_to_rgb
from app.core.render.palette import ASTEROID_PALETTE, BROWN_DWARF_PALETTE
from app.core.render.params import BAKED_TYPES, BakeParams, BakeRefusal, params_from_card
from app.core.render.spherex_rgb import CHANNELS_BY_TYPE

# Bump when a rule in this module changes. The baker's rules version is part of it, so the R6.7
# texture path changes whenever either changes. The seed is a hash of this version (Q-35), so a
# bump also re-seeds every procedural body: bump only when a surface rule changes. Issue #38 added
# Layer.tier, formula and assumed without changing any surface, so it bumped ASSET_VERSION
# (saved replies) instead and kept this at "1".
CARD_TO_PARAMS_VERSION = "1"
GENERATOR_VERSION = f"p{CARD_TO_PARAMS_VERSION}-b{BAKER_RULES_VERSION}"

# Texture size named in the URLs (D-05 desktop budget; the viewer downsamples for phones).
TEXTURE_WIDTH, TEXTURE_HEIGHT = 2048, 1024
TEXTURE_URL_ROOT = "/data/textures"  # R6.7, A5.4

# Physical constants for scale_m (radius in metres).
R_JUP_M = 6.9911e7  # Jupiter volumetric mean radius (NASA Jupiter fact sheet, 69,911 km)
R_SUN_M = 6.957e8  # IAU 2015 Resolution B3 nominal solar radius

# R8.4 / R8.5 haptic parameters (spec values).
TAU = 0.15  # height-map / terrain tick threshold, fraction of local relief std (R8.4)
FIELD_MAX_RATE_HZ = 30.0  # comet field pulse clamp(…, 2, 30) Hz (R8.4)
PULSE_MAX_RATE_HZ = 12.0  # brown dwarf flux pulse and teq pulse, 2-12 Hz (R8.5, D-12)

VISIBLE_BADGE = "Estimated visible colour"  # R5.2
ARTISTIC_BADGE = "Default (artist's choice)"  # D-02 (Q-36)
IR_BADGE = "SPHEREx infrared, whole-body average (false colour)"  # R5.2

# Least claim wins: when a layer combines inputs, it carries the weakest tag among them.
_RANK = {
    "measured": 0,
    "derived": 1,
    "model_dependent": 2,
    "inferred_from_analog": 3,
    "artistic": 4,
}

TIER_OF_TAG = {tag: rank + 1 for tag, rank in _RANK.items()}  # D-32: tier 1..5 = the five tags

# Rule inputs that are not on the card, stated as `assumed` (D-32). The values are the ones the
# cited rules fix (R6.2, R7.3, R7.5); none is a measurement.
ASSUMED_C_OVER_B = 1.0  # R6.2: c = b
ASSUMED_DENSITY_EXPONENT = 2.0  # R7.3: coma gas density falls as 1/r^2
ASSUMED_LIMB_U = 0.6  # R7.5: linear limb darkening coefficient

SHADER_KINDS = ("planet_rocky", "planet_water", "gas_giant", "nebula", "nova")
SUN_LIT = ("asteroid_shape", "asteroid_procedural", "comet", "planet_rocky", "planet_water")
SUN_LIT_ALL = (*SUN_LIT, "gas_giant")

TYPE_LABEL = {
    "asteroid_shape": "Asteroid",
    "asteroid_procedural": "Asteroid",
    "comet": "Comet",
    "brown_dwarf": "Brown dwarf",
    "brown_dwarf_binary": "Brown dwarf binary",
    "star_mira": "Mira variable",
    "star_ttauri": "T Tauri star",
    "star": "Star",
    "candidate": "Candidate",
    "planet_rocky": "Rocky planet",
    "planet_water": "Water planet",
    "gas_giant": "Gas giant",
    "nebula": "Nebula",
    "nova": "Nova",
}


# --- seed -----------------------------------------------------------------------------------


def seed_for(object_id: str, generator_version: str) -> int:
    """Seed = hash of (object id + generator version) (R1, A5.1).

    ASSUMPTION (Q-35 is open): SHA-256 of ``id + "\\n" + generator_version`` in UTF-8, first 4
    bytes big-endian. 32 bits, because the shader field uses the low 32 bits (Q-48) and a JSON
    number above 2**53 loses precision in the browser.
    """
    digest = hashlib.sha256(f"{object_id}\n{generator_version}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


# --- card access ----------------------------------------------------------------------------


def _tv(card: Mapping[str, Any], key: str) -> Mapping[str, Any] | None:
    tv = card.get(key)
    return tv if isinstance(tv, Mapping) and "tag" in tv else None


def _num(card: Mapping[str, Any], key: str) -> float | None:
    tv = _tv(card, key)
    v = tv.get("value") if tv else None
    if isinstance(v, bool) or not isinstance(v, numbers.Real):
        return None
    try:
        x = float(v)
    except OverflowError:
        return None
    return x if math.isfinite(x) else None  # NaN and inf are unknown (Q-40)


def _str(card: Mapping[str, Any], key: str) -> str | None:
    tv = _tv(card, key)
    v = tv.get("value") if tv else None
    return v if isinstance(v, str) and v.strip() else None


def _vec(card: Mapping[str, Any], key: str, n: int) -> list[float] | None:
    tv = _tv(card, key)
    v = tv.get("value") if tv else None
    if not isinstance(v, list | tuple) or len(v) != n:
        return None
    out: list[float] = []
    for c in v:
        if isinstance(c, bool) or not isinstance(c, numbers.Real) or not math.isfinite(float(c)):
            return None
        out.append(float(c))
    return out


def _tag(card: Mapping[str, Any], key: str) -> str:
    tv = _tv(card, key)
    return str(tv["tag"]) if tv else "artistic"


def _assumed(
    card: Mapping[str, Any], requires: list[str], rule_inputs: Mapping[str, float] | None = None
) -> dict[str, float | str]:
    """Inputs that were not measured (D-32): the explicit rule inputs, then each required card
    field whose value is model_dependent, keyed by field name. A group of values such as
    ``gas_Q`` is walked member by member, in sorted order, keyed ``gas_Q.co2``. Deterministic
    order."""
    out: dict[str, float | str] = dict(rule_inputs or {})
    for key in requires:
        group = card.get(key)
        if isinstance(group, Mapping) and "tag" not in group:
            members = sorted(k for k, m in group.items() if isinstance(m, Mapping) and "tag" in m)
            for member, used in _assumed(group, members).items():
                out[f"{key}.{member}"] = used
            continue
        tv = _tv(card, key)
        if tv is None or tv.get("tag") != "model_dependent":
            continue
        v = tv.get("value")
        if isinstance(v, bool):
            continue
        if isinstance(v, numbers.Real) and math.isfinite(float(v)):
            out[key] = float(v)
        elif isinstance(v, str):
            out[key] = v
        elif isinstance(v, list | tuple) and v:
            out[key] = ", ".join(f"{float(c):g}" for c in v)
        elif isinstance(tv.get("assumption"), str) and tv["assumption"].strip():
            # No usable value (null, NaN): state the card's own assumption instead (R3.1).
            out[key] = tv["assumption"].strip()
    return out


def _weakest(*tags: str) -> str:
    return max(tags, key=lambda t: _RANK[t])


def _has(card: Mapping[str, Any], key: str) -> bool:
    """A required field is present when its value is usable (null, NaN, blank = absent)."""
    tv = _tv(card, key)
    if tv is None:
        return False
    v = tv.get("value")
    if isinstance(v, str):
        return bool(v.strip())
    if isinstance(v, list | tuple):
        return _vec(card, key, len(v)) is not None
    return _num(card, key) is not None


def _lightcurve_ok(card: Mapping[str, Any]) -> bool:
    lc = card.get("lightcurve")
    return isinstance(lc, list) and len(lc) > 0


# --- builders -------------------------------------------------------------------------------


class _Plan:
    def __init__(self) -> None:
        self.layers: list[dict[str, Any]] = []
        self.missing: list[str] = []

    def layer(
        self,
        ok: bool,
        layer_id: str,
        tag: str,
        description: str,
        requires: list[str],
        *,
        card: Mapping[str, Any] | None = None,
        formula: str | None = None,
        rule_inputs: Mapping[str, float] | None = None,
    ) -> bool:
        """Add a layer, or refuse it. ``formula`` is required for any layer whose tag can come out
        derived or model_dependent; ``card`` is needed to state ``assumed`` (D-32)."""
        if ok:
            layer: dict[str, Any] = {
                "id": layer_id,
                "tag": tag,
                "tier": TIER_OF_TAG[tag],
                "description": description,
                "requires": requires,
            }
            if tag in ("derived", "model_dependent"):
                if not formula:
                    raise ValueError(f"layer {layer_id}: tag {tag} needs a formula (D-32)")
                layer["formula"] = formula
            if tag == "model_dependent":
                assumed = _assumed(card or {}, requires, rule_inputs)
                if not assumed:
                    # Never label measured inputs as assumed: the rule must name what it assumed.
                    raise ValueError(
                        f"layer {layer_id}: model_dependent needs an assumed input (D-32)"
                    )
                layer["assumed"] = assumed
            self.layers.append(layer)
        else:
            self.refuse(layer_id)
        return ok

    def refuse(self, item: str) -> None:
        if item not in self.missing:
            self.missing.append(item)


def _rgb_tv(
    value: list[float] | tuple[float, ...], tag: str, source: str, **extra: str
) -> dict[str, Any]:
    out: dict[str, Any] = {"value": [float(c) for c in value], "tag": tag, "source": source}
    out.update(extra)
    return out


def _off(
    badge: str, source: str, channels: tuple[float, float, float] | None = None
) -> dict[str, Any]:
    mode: dict[str, Any] = {"available": False, "badge": badge, "rgb": None, "source": source}
    if channels is not None:
        mode["channels_um"] = list(channels)
    return mode


def _ir_mode(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any] | None:
    channels = CHANNELS_BY_TYPE.get(str(card.get("type")))
    if channels is None:
        return None  # R5.2 defines the channels for asteroids, comets and brown dwarfs only
    rgb = _vec(card, "spherex_rgb", 3)
    if rgb is None:
        plan.refuse("spherex_ir")
        return _off(IR_BADGE, "spherex_rgb", channels)
    tv = dict(_tv(card, "spherex_rgb") or {})
    tv["value"] = rgb
    return {
        "available": True,
        "badge": IR_BADGE,
        "rgb": tv,
        "source": "spherex_rgb",
        "channels_um": list(channels),
    }


def _asteroid_colour(card: Mapping[str, Any]) -> tuple[dict[str, Any] | None, str, str]:
    """(rgb TV, VisibleMode source, colour field name) from gaia_rgb, else the R6.4 palette."""
    gaia = _vec(card, "gaia_rgb", 3)
    if gaia is not None:
        tv = dict(_tv(card, "gaia_rgb") or {})
        tv["value"] = gaia
        return tv, "gaia_rgb", "gaia_rgb"
    cls = _str(card, "spectral_class")
    letter = cls.strip()[:1].upper() if cls else ""
    base = ASTEROID_PALETTE.get(letter)
    if base is None:
        return None, "class_palette", "spectral_class"
    tv = _rgb_tv(base, "inferred_from_analog", f"R6.4 class palette {letter} (no gaia_rgb)")
    return tv, "class_palette", "spectral_class"


def _texture_urls(object_id: str, version: str, seed: int) -> dict[str, str]:
    """R6.7 path as a URL, with the Q-47 size directory. The path segments are the baker's
    directory names, quoted once more for the URL (``%`` -> ``%25``), so a server that decodes
    the URL lands on exactly the baked directory."""
    d = bake_dir(Path("."), object_id, version, seed, TEXTURE_WIDTH, TEXTURE_HEIGHT)
    base = "/".join([TEXTURE_URL_ROOT, *(quote(part, safe="") for part in d.parts)])
    names = dict(zip(("albedo", "height", "height_bin", "normal"), FILES, strict=True))
    return {k: f"{base}/{v}" for k, v in sorted(names.items())}


def _bake(card: Mapping[str, Any], seed: int) -> BakeParams | None:
    if card.get("type") not in BAKED_TYPES:
        return None
    try:
        return params_from_card(card, seed)
    except BakeRefusal:
        return None


# --- per type -------------------------------------------------------------------------------


def _asteroid_shape(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any]:
    mesh = plan.layer(
        _has(card, "shape_source") and _has(card, "diameter_km"),
        "mesh",
        _weakest(_tag(card, "shape_source"), _tag(card, "diameter_km")),
        "Shape model scaled to the diameter on the card (R7.1).",
        ["shape_source", "diameter_km"],
        card=card,
        formula="Shape model scaled to diameter_km",
    )
    plan.layer(
        _has(card, "rot_period_h"),
        "spin",
        _tag(card, "rot_period_h"),
        "Rotation sped up, with the factor shown on screen (R7.1).",
        ["rot_period_h"],
        card=card,
        formula="spin rate = 2 pi / rot_period_h",
    )
    rgb, _, field = _asteroid_colour(card)
    plan.layer(
        rgb is not None and _has(card, "albedo"),
        "material",
        _weakest(str(rgb["tag"]) if rgb else "artistic", _tag(card, "albedo"), "derived"),
        "Colour = base_rgb * brightness; display L = clamp(0.12 + 1.6 * albedo, 0.12, 0.8) (R6.2).",
        [field, "albedo"],
        card=card,
        formula="L = clamp(0.12 + 1.6 * albedo, 0.12, 0.8)",
    )
    return {
        "texture": "mesh" if mesh else "none",
        "texture_tag": _weakest(_tag(card, "shape_source"), _tag(card, "diameter_km"))
        if mesh
        else "artistic",
        "data": "none",
        "data_tag": "artistic",
        "params": {},
    }


def _asteroid_procedural(
    card: Mapping[str, Any], plan: _Plan, bake: BakeParams | None
) -> dict[str, Any]:
    body = _has(card, "diameter_km") and bake is not None
    if not body:
        plan.refuse("mesh")  # R11: no diameter -> mesh refused, no crash
        return _no_haptics()
    plan.layer(
        _has(card, "lightcurve_amp_mag"),
        "ellipsoid",
        "model_dependent",
        "Assumption: a/b = 10^(0.4 * A), c = b, from the light-curve amplitude (R6.2).",
        ["diameter_km", "lightcurve_amp_mag"],
        card=card,
        formula="a/b = 10^(0.4 * A), c = b",
        rule_inputs={"c_over_b": ASSUMED_C_OVER_B},
    )
    rgb, _, field = _asteroid_colour(card)
    assert bake is not None
    colour_ok = (
        rgb is not None and "albedo_map" not in bake.missing and "gaia_rgb" not in bake.missing
    )
    brightness_ok = "brightness" not in bake.missing
    desc = (
        "Colour from gaia_rgb (R6.2)"
        if field == "gaia_rgb"
        else f"Class palette {(_str(card, 'spectral_class') or '?')[:1].upper()}, "
        "as no gaia_rgb is present (R6.4)"
    )
    plan.layer(
        colour_ok and brightness_ok,
        "albedo_map",
        _weakest(str(rgb["tag"]) if rgb else "artistic", _tag(card, "albedo"), "derived"),
        f"{desc}; brightness = clamp(0.12 + 1.6 * albedo, 0.12, 0.8).",
        [field, "albedo"],
        card=card,
        formula="L = clamp(0.12 + 1.6 * albedo, 0.12, 0.8)",
    )
    plan.layer(
        True,
        "relief",
        "artistic",
        f"Procedural height field from the seed, style {bake.style} (R6.2, R6.3).",
        ["diameter_km"],
    )
    return {
        "texture": "height",
        "texture_tag": "artistic",
        "data": "none",
        "data_tag": "artistic",
        "params": {"tau": TAU},
    }


def _comet(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any]:
    plan.layer(
        _has(card, "nucleus_radius_km_max"),
        "nucleus",
        _tag(card, "nucleus_radius_km_max"),
        "Dark sphere at the upper size limit (R7.3).",
        ["nucleus_radius_km_max"],
        card=card,
        formula="nucleus radius = nucleus_radius_km_max",
    )
    gas = card.get("gas_Q")
    has_q = isinstance(gas, Mapping) and any(_has(gas, k) for k in ("co2", "h2o", "co"))
    epochs = card.get("epochs")
    one_epoch = isinstance(epochs, list) and len(epochs) == 1  # Q-42
    shells = plan.layer(
        has_q and one_epoch and _has(card, "coma_radius_km"),
        "gas_shells",
        "model_dependent",
        "Assumption: density falls as 1/r^2 out to the coma radius; Q itself is measured "
        "(R7.3, Q-38).",
        ["gas_Q", "coma_radius_km"],
        card=card,
        formula="n(r) proportional to Q / r^2 out to coma_radius_km",
        rule_inputs={"density_exponent": ASSUMED_DENSITY_EXPONENT},
    )
    if not shells:
        plan.refuse("field")
    return {
        "texture": "none",
        "texture_tag": "artistic",
        "data": "field" if shells else "none",
        "data_tag": "model_dependent" if shells else "artistic",  # Q-17: the safer tag
        "params": {"maxRateHz": FIELD_MAX_RATE_HZ} if shells else {},
    }


def _brown_dwarf(card: Mapping[str, Any], plan: _Plan, bake: BakeParams | None) -> dict[str, Any]:
    plan.layer(
        _has(card, "radius_rjup"),
        "body",
        _tag(card, "radius_rjup"),
        "Assumption: brown dwarf radii are about 1 Jupiter radius (R7.4).",
        ["radius_rjup"],
        card=card,
        formula="radius = radius_rjup * R_Jup",
    )
    emissive = plan.layer(
        _has(card, "flux_45um"),
        "emissive",
        _tag(card, "flux_45um"),
        "Emissive intensity from normalised flux_45um (R7.4).",
        ["flux_45um"],
        card=card,
        formula="intensity = normalised flux_45um",
    )
    bands = plan.layer(
        bake is not None and _has(card, "ch4_depth_33") and "bands" not in bake.missing,
        "bands",
        "artistic",
        "Latitude-stretched band pattern; contrast = clamp(2 * ch4_depth_33, 0.1, 0.8) "
        "(R7.4, R5.3).",
        ["ch4_depth_33", "spectral_class"],
    )
    if card.get("type") == "brown_dwarf_binary":
        plan.layer(
            _has(card, "spectral_class"),
            "orbit",
            "artistic",
            "Two bodies on an illustrative mutual orbit (R7.4). No orbit numbers are shown.",
            ["spectral_class"],
        )
    if not emissive:
        plan.refuse("flux_pulse")
    return {
        "texture": "bands" if bands else "none",
        "texture_tag": "artistic",
        "data": "flux_pulse" if emissive else "none",
        "data_tag": _tag(card, "flux_45um") if emissive else "artistic",
        "params": {"maxRateHz": PULSE_MAX_RATE_HZ} if emissive else {},
    }


def _star(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any]:
    kind = card.get("type")
    plan.layer(
        _has(card, "teff_K") and teff_to_rgb(_num(card, "teff_K") or 0.0) is not None,
        "colour",
        _weakest(_tag(card, "teff_K"), "derived"),
        "Teff to sRGB through a blackbody colour calculation (R7.5).",
        ["teff_K"],
        card=card,
        formula=TEFF_FORMULA,
    )
    plan.layer(
        True,
        "limb_darkening",
        "model_dependent",
        "Assumption: linear limb darkening, I(mu) = 1 - 0.6 * (1 - mu) (R7.5).",
        [],
        card=card,
        formula="I(mu) = 1 - u * (1 - mu), u = 0.6",
        rule_inputs={"limb_darkening_u": ASSUMED_LIMB_U},
    )
    data, data_tag = "none", "artistic"
    if kind == "star":
        if plan.layer(
            _has(card, "pm_mas_yr"),
            "motion_trail",
            _tag(card, "pm_mas_yr"),
            "Motion trail from pm_mas_yr over the SPHEREx epochs (R7.5).",
            ["pm_mas_yr"],
            card=card,
            formula="trail = pm_mas_yr * elapsed time",
        ):
            data, data_tag = "motion", _tag(card, "pm_mas_yr")
        else:
            plan.refuse("motion")
    elif kind == "star_mira":
        if plan.layer(
            _lightcurve_ok(card),
            "brightness_curve",
            "measured",
            "Brightness follows the measured light curve as you scrub (R7.5).",
            ["lightcurve"],
            card=card,
            formula="brightness = measured lightcurve flux",
        ):
            data, data_tag = "heartbeat", "measured"
        else:
            plan.refuse("heartbeat")
        plan.layer(
            _has(card, "period_var_d"),
            "radius_pulsation",
            "artistic",
            "Radius pulsation of 10 percent (R7.5).",
            ["period_var_d"],
            card=card,
            formula="radius = 1 + 0.1 * pulsation phase",
        )
    elif kind == "star_ttauri":
        plan.layer(True, "disc", "artistic", "Tilted disc (R7.5).", [])
        if plan.layer(
            _lightcurve_ok(card),
            "dust_screen",
            "artistic",
            "Screen opacity = clamp(1 - flux/median_flux, 0, 0.9). The timing is measured, "
            "the geometry is artistic (R7.5, Q-38).",
            ["lightcurve"],
        ):
            data, data_tag = "dimming", "measured"
        else:
            plan.refuse("dimming")
    return {
        "texture": "none",
        "texture_tag": "artistic",
        "data": data,
        "data_tag": data_tag,
        "params": {},
    }


def _shader_kind(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any]:
    kind = card.get("type")
    if kind in ("nebula", "nova"):
        plan.layer(
            _has(card, "diameter_km"),
            "point_cloud",
            "artistic",
            "Point cloud from the sliders (R7.7).",
            ["diameter_km"],
        )
        return {
            "texture": "none",
            "texture_tag": "artistic",
            "data": "field",
            "data_tag": "artistic",
            "params": {},
        }
    plan.layer(
        True,
        "surface",
        "artistic",
        "Browser shader surface and shared CPU field (R7.7). Nothing about it is measured.",
        [],
    )
    texture = "flow" if kind == "gas_giant" else "terrain"
    params: dict[str, float] = {} if kind == "gas_giant" else {"tau": TAU}
    if _has(card, "teq_K"):
        params["maxRateHz"] = PULSE_MAX_RATE_HZ
        return {
            "texture": texture,
            "texture_tag": "artistic",
            "data": "teq_pulse",
            "data_tag": _tag(card, "teq_K"),
            "params": params,
        }
    plan.refuse("teq_pulse")  # D-12: teq_K null -> teq_pulse refused
    return {
        "texture": texture,
        "texture_tag": "artistic",
        "data": "none",
        "data_tag": "artistic",
        "params": params,
    }


def _no_haptics() -> dict[str, Any]:
    return {
        "texture": "none",
        "texture_tag": "artistic",
        "data": "none",
        "data_tag": "artistic",
        "params": {},
    }


# --- shared parts ---------------------------------------------------------------------------


def _scale_m(card: Mapping[str, Any]) -> float | None:
    kind = card.get("type")
    if kind in ("asteroid_shape", "asteroid_procedural", "nebula", "nova"):
        d = _num(card, "diameter_km")
        return d * 500.0 if d is not None and d > 0 else None
    if kind == "comet":
        r = _num(card, "nucleus_radius_km_max")
        return r * 1000.0 if r is not None and r > 0 else None
    if kind in ("brown_dwarf", "brown_dwarf_binary", "planet_rocky", "planet_water", "gas_giant"):
        r = _num(card, "radius_rjup")
        return r * R_JUP_M if r is not None and r > 0 else None
    if kind in ("star", "star_mira", "star_ttauri"):
        r = _num(card, "radius_rsun")
        return r * R_SUN_M if r is not None and r > 0 else None
    return None  # candidate: no body (R7.6)


def _lighting(card: Mapping[str, Any]) -> dict[str, Any]:
    if card.get("type") not in SUN_LIT_ALL:
        return {"mode": "self"}
    out: dict[str, Any] = {"mode": "sun"}
    sun = _vec(card, "sun_vector", 3)
    if sun is not None and any(sun):
        out["sun_dir"] = sun
    phase = _num(card, "phase_angle_deg")
    if phase is not None:
        out["phase_angle_deg"] = phase
    return out


def _visible(card: Mapping[str, Any], plan: _Plan) -> dict[str, Any]:
    kind = str(card.get("type"))
    if kind in SHADER_KINDS:
        # R7.7: shader colours are the artist's choice; neutral grey stands for "no data colour".
        rgb = _rgb_tv([0.5, 0.5, 0.5], "artistic", "artist's neutral default (R7.7, D-02)")
        return {"available": True, "badge": ARTISTIC_BADGE, "rgb": rgb, "source": "class_palette"}
    if kind in ("asteroid_shape", "asteroid_procedural"):
        colour, source, _ = _asteroid_colour(card)
        if colour is not None:
            return {"available": True, "badge": VISIBLE_BADGE, "rgb": colour, "source": source}
    elif kind in ("brown_dwarf", "brown_dwarf_binary"):
        cls = _str(card, "spectral_class")
        letter = cls.split("+")[0].strip()[:1].upper() if cls else ""
        if letter in BROWN_DWARF_PALETTE:
            base = BROWN_DWARF_PALETTE[letter][0]
            rgb = _rgb_tv(
                base, "inferred_from_analog", f"brown dwarf class palette {letter} (R7.4, Q-47)"
            )
            return {
                "available": True,
                "badge": VISIBLE_BADGE,
                "rgb": rgb,
                "source": "class_palette",
            }
    elif kind in ("star", "star_mira", "star_ttauri"):
        teff = _num(card, "teff_K")
        rgb3 = teff_to_rgb(teff) if teff is not None else None
        if rgb3 is not None:
            tag = _weakest(_tag(card, "teff_K"), "derived")
            extra = {"formula": TEFF_FORMULA} if tag == "derived" else {}
            if tag == "model_dependent":
                extra = {"assumption": f"teff_K is model dependent; colour by {TEFF_FORMULA}"}
            rgb = _rgb_tv(rgb3, tag, f"teff_K = {teff:g} K", **extra)
            # Q-36: no `teff` source value exists yet; the tag and formula state the basis.
            return {
                "available": True,
                "badge": VISIBLE_BADGE,
                "rgb": rgb,
                "source": "class_palette",
            }
    plan.refuse("visible")
    return _off(VISIBLE_BADGE, "class_palette")


def _fmt(x: float) -> str:
    return f"{x:.3g}"


def _alt_text(card: Mapping[str, Any], params: Mapping[str, Any]) -> str:
    """R9: "<name>, <type>, <size + tag>, <colour basis>, viewed at <phase>°. Surface relief: …"."""
    kind = str(card.get("type"))
    name = str(card.get("name") or card.get("id"))
    label = TYPE_LABEL.get(kind, kind)
    if kind == "candidate":
        return f"{name}. {label}. Not enough data for a 3D model: distance and albedo unknown."

    def sized(value_key: str, unit: str) -> str:
        words = _tag(card, value_key).replace("_", " ")
        return f"{_fmt(_num(card, value_key) or 0)} {unit} ({words})"

    size = "size unknown"
    if kind in ("asteroid_shape", "asteroid_procedural") and _has(card, "diameter_km"):
        size = sized("diameter_km", "km across")
    elif kind == "comet" and _has(card, "nucleus_radius_km_max"):
        r = _fmt(_num(card, "nucleus_radius_km_max") or 0)
        size = f"nucleus at most {r} km in radius (upper limit)"
    elif kind in (
        "brown_dwarf",
        "brown_dwarf_binary",
        "planet_rocky",
        "planet_water",
        "gas_giant",
    ) and _has(card, "radius_rjup"):
        size = sized("radius_rjup", "Jupiter radii")
    elif kind in ("star", "star_mira", "star_ttauri") and _has(card, "radius_rsun"):
        size = sized("radius_rsun", "solar radii")
    elif kind in ("nebula", "nova") and _has(card, "diameter_km"):
        size = "size from a slider (artistic)"
    visible = params["view_modes"]["visible"]
    if not visible["available"]:
        colour = "no visible colour basis"
    elif visible["rgb"]["tag"] == "artistic":
        colour = "artist's colour"
    elif kind in ("star", "star_mira", "star_ttauri"):
        colour = "colour from Teff"
    elif visible["source"] == "gaia_rgb":
        colour = "colour from gaia_rgb"
    else:
        colour = "colour from a class palette"
    light = params["lighting"]
    if light["mode"] == "self":
        view = "self-luminous"
    elif "phase_angle_deg" in light:
        view = f"viewed at {_fmt(light['phase_angle_deg'])} degrees"
    else:
        view = "lit by its star" if kind in SHADER_KINDS else "phase angle unknown"
    relief = (
        "measured"
        if kind == "asteroid_shape" and any(layer["id"] == "mesh" for layer in params["layers"])
        else "illustrative"
    )
    return f"{name}, {label}, {size}, {colour}, {view}. Surface relief: {relief}."


# --- entry point ----------------------------------------------------------------------------


def card_to_params(
    card: Mapping[str, Any],
    *,
    seed: int | None = None,
    generator_version: str = GENERATOR_VERSION,
    extra_missing: tuple[str, ...] = (),
) -> dict[str, Any]:
    """RenderParams (R3.4) as a JSON-ready dict. ``seed`` defaults to ``seed_for(id, version)``.

    ``extra_missing`` carries refusals from earlier stages (for example stage 3's
    ``type:exoplanet_thresholds``) so the user sees them.
    """
    object_id = str(card["id"])
    kind = str(card["type"])
    if seed is None:
        seed = seed_for(object_id, generator_version)
    if seed < 0:
        raise ValueError("seed must be an integer >= 0 (Q-35)")
    plan = _Plan()
    bake = _bake(card, seed)

    if kind == "asteroid_shape":
        haptics = _asteroid_shape(card, plan)
    elif kind == "asteroid_procedural":
        haptics = _asteroid_procedural(card, plan, bake)
    elif kind == "comet":
        haptics = _comet(card, plan)
    elif kind in ("brown_dwarf", "brown_dwarf_binary"):
        haptics = _brown_dwarf(card, plan, bake)
    elif kind in ("star", "star_mira", "star_ttauri"):
        haptics = _star(card, plan)
    elif kind in SHADER_KINDS:
        haptics = _shader_kind(card, plan)
    else:  # candidate: no 3D (R7.6); detections in the flipbook
        plan.refuse("mesh")
        haptics = {
            "texture": "none",
            "texture_tag": "artistic",
            "data": "detections",
            "data_tag": "measured",
            "params": {},
        }

    view_modes: dict[str, Any] = {"visible": _visible(card, plan)}
    ir = _ir_mode(card, plan)
    if ir is not None:
        view_modes["spherex_ir"] = ir

    out: dict[str, Any] = {
        "id": object_id,
        "type": kind,
        "generator_version": generator_version,
        "seed": seed,
        "scale_m": _scale_m(card),
        "layers": plan.layers,
    }
    if bake is not None and (kind != "asteroid_procedural" or "mesh" not in plan.missing):
        out["textures"] = _texture_urls(object_id, generator_version, seed)
    elif kind in BAKED_TYPES:
        plan.refuse("textures")
    out["lighting"] = _lighting(card)
    out["view_modes"] = view_modes
    out["haptics"] = haptics
    for m in extra_missing:
        plan.refuse(m)
    out["missing"] = plan.missing
    out["alt_text"] = _alt_text(card, out)
    # Fixed key order (R3.4) so serialised bytes are stable.
    order = (
        "id",
        "type",
        "generator_version",
        "seed",
        "scale_m",
        "layers",
        "textures",
        "lighting",
        "view_modes",
        "haptics",
        "alt_text",
        "missing",
    )
    return {k: out[k] for k in order if k in out}
