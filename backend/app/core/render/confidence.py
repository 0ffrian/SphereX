"""Data confidence and the 3D gate (D-36, Q-220 to Q-229, stage 7).

``C = sum(w_i c_i) / sum(w_i)``. ``c_i`` is how far the data narrows the range of the class for
quantity ``i``; ``w_i`` is how much that quantity changes the picture.

``c`` per input (Q-221):

* ``measured`` -> 1; ``derived`` -> 1 (a formula of measured values), or ``DERIVED_ASSUMED_C``
  when the value states an assumed input;
* ``model_dependent`` -> ``MODEL_DEPENDENT_C``; ``inferred_from_analog``, ``artistic`` and a
  missing value -> 0;
* a value with error bars: ``c = 1 - sigma_data / sigma_class`` (relative sigma), never above the
  tag's own ``c``.

**The weights below are placeholders.** They come from the approved prototype's hand tables
(Moon, 10 Nov 2026) until a sensitivity sweep exists. ``sweep_weights`` and
``scripts/confidence_sweep.py`` compute them from how much the rendered parameters change when an
input is removed. ``DEFAULT_CLASS_SIGMA_REL`` and ``MODEL_DEPENDENT_C`` are **[verify]**
placeholders for the same reason.

The score is **not** the probability that the picture is correct, and it does not change a
provenance tag (D-02, D-36). The gate (Q-222) needs a known class, one key measurement for the
type and ``C >= CONFIDENCE_THRESHOLD``. Deterministic: a pure function of the card.
"""

from __future__ import annotations

import math
import numbers
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

# D-36: the starting threshold. Calibrated on the 16 demo objects (Q-222).
CONFIDENCE_THRESHOLD = 0.25

# Share of the whole by tag. Same values as the approved prototype's table (Moon, 10 Nov 2026).
# [verify]: model_dependent = 0.5 is a placeholder for "a model fit narrows the class range about
# half way"; it has no measured basis yet.
MODEL_DEPENDENT_C = 0.5
# [verify]: a derived value whose formula includes an assumed input. The real value is the share
# of measured inputs, which the card does not list; half is a placeholder.
DERIVED_ASSUMED_C = 0.5
# [verify]: sigma_class as a fraction of the value, for a value with error bars. One placeholder
# for every field until a per-class range is measured; ``CLASS_SIGMA_REL`` overrides one field.
DEFAULT_CLASS_SIGMA_REL = 0.5
CLASS_SIGMA_REL: dict[str, float] = {}

BAND_MOSTLY_DATA = 0.75
BAND_PART_DATA = 0.5

NOT_A_PROBABILITY = (
    "This is how much of the picture rests on data. "
    "It is not the probability that the picture is correct."
)
FORMULA = (
    "C = sum(w_i c_i) / sum(w_i): c is 1 for a measured value or a formula of measured values, "
    "a placeholder share for a model-dependent one, and 0 for an assumed, artistic or missing "
    "one; the w_i are placeholder weights (D-36, Q-221)"
)
WEIGHTS_NOTE = (
    "Placeholder weights: they come from the approved prototype until a sensitivity sweep "
    "replaces them (D-36)."
)

Kind = Literal["card", "fixed"]


@dataclass(frozen=True)
class Input:
    """One quantity that shapes the picture.

    ``fields``: card fields that feed it (``any``: the best one counts; ``all``: the mean over the
    fields, so a missing one lowers it). A ``fixed`` input has no card field: its tag is always
    ``fixed_tag`` (the picture there is assumed or artistic) or, with ``fixed_tag`` ``None``, it is
    always missing because no data source exists yet.
    """

    id: str
    label: str
    weight: float
    fields: tuple[str, ...] = ()
    mode: Literal["any", "all"] = "any"
    fixed_tag: str | None = None
    kind: Kind = "card"
    derived_from_fields: bool = False  # a formula of these card values: c = 1 when all are present


def _card(
    id_: str, label: str, w: float, *fields: str, mode: Literal["any", "all"] = "any"
) -> Input:
    return Input(id_, label, w, fields, mode)


def _fixed(id_: str, label: str, w: float, tag: str | None) -> Input:
    return Input(id_, label, w, (), "any", tag, "fixed")


def _derived(id_: str, label: str, w: float, *fields: str) -> Input:
    return Input(id_, label, w, fields, "all", None, "card", True)


@dataclass(frozen=True)
class TypeTable:
    inputs: tuple[Input, ...]
    # The key measurement (Q-222): any one of these card fields, non-null, passes.
    key_fields: tuple[str, ...]
    key_labels: tuple[str, ...]


# --- the per-type weight tables: PLACEHOLDERS (see the module docstring) -------------------------
# Each table sums to 100. Source of the numbers: the approved prototype (`OBJ` rows of
# sculptor-preview.html) for the asteroid, star, Mira and gas-giant tables; the comet, brown dwarf,
# rocky and water tables are new placeholders in the same style (Q-221).
_ASTEROID_SHAPE = TypeTable(
    (
        _card("shape", "Shape", 40, "shape_source"),
        _card("size", "Size", 15, "diameter_km"),
        _card("spin", "Spin", 10, "rot_period_h"),
        _card("albedo", "Albedo", 10, "albedo"),
        _card("spectral_class", "Spectral class", 10, "spectral_class"),
        _card("colour_map", "Surface colour map", 15, "gaia_rgb", "spherex_rgb"),
    ),
    ("shape_source",),
    ("a measured shape model",),
)
_ASTEROID_PROC = TypeTable(
    (
        _card("elongation", "Elongation", 25, "lightcurve_amp_mag"),
        _card("spin", "Spin", 10, "rot_period_h"),
        _card("size", "Size", 15, "diameter_km"),
        _card("albedo", "Albedo", 10, "albedo"),
        _fixed("relief", "Relief", 20, "artistic"),
        _fixed("craters", "Craters", 15, "artistic"),
        _card("colour_map", "Colour map", 5, "gaia_rgb", "spherex_rgb"),
    ),
    ("diameter_km",),
    ("a size",),
)
_COMET = TypeTable(
    (
        _card("sun_direction", "Sun direction", 10, "sun_vector"),
        _card("phase_angle", "Phase angle", 5, "phase_angle_deg"),
        _card("gas", "Gas amounts", 25, "gas_Q"),
        _card("coma", "Coma size", 10, "coma_radius_km"),
        _card("nucleus_size", "Nucleus size", 10, "nucleus_radius_km_max"),
        _card("nucleus_shape", "Nucleus shape", 15, "shape_source"),
        # No tail data source yet; stream F (Q-260 range) makes this a labelled model.
        _fixed("tail", "Tail", 5, None),
        _fixed("nucleus_surface", "Nucleus surface", 20, "artistic"),
    ),
    ("gas_Q", "coma_radius_km", "nucleus_radius_km_max", "shape_source"),
    ("a gas measurement", "a coma size", "a nucleus size", "a shape model"),
)
_BROWN_DWARF = TypeTable(
    (
        _card("spectral_class", "Spectral class", 25, "spectral_class"),
        _card("temperature", "Temperature", 20, "teff_K", "component_teff_K"),
        _card("radius", "Radius", 15, "radius_rjup"),
        _card("methane", "Methane band depth", 15, "ch4_depth_33"),
        _card("colour_map", "Colour", 5, "spherex_rgb"),
        _card("motion", "Motion on the sky", 5, "pm_mas_yr"),
        _fixed("bands", "Cloud bands", 15, "artistic"),
    ),
    ("spectral_class",),
    ("a spectral class",),
)
_STAR = TypeTable(
    (
        _card("temperature", "Temperature and colour", 30, "teff_K"),
        _card("radius", "Radius", 20, "radius_rsun"),
        _fixed("limb", "Edge darkening", 10, "model_dependent"),
        _card("spectral_class", "Spectral class", 10, "spectral_class"),
        _card("motion", "Motion on the sky", 5, "pm_mas_yr"),
        _fixed("cells", "Boiling cells", 15, "artistic"),
        _fixed("spots", "Spots", 10, "inferred_from_analog"),
    ),
    ("teff_K", "radius_rsun", "spectral_class"),
    ("a temperature", "a radius", "a spectral class"),
)
_MIRA = TypeTable(
    (
        _card("spectral_class", "Spectral class", 15, "spectral_class"),
        _card("period", "Pulsation period", 15, "period_var_d"),
        _card("motion", "Motion on the sky", 5, "pm_mas_yr"),
        _card("temperature", "Temperature and colour", 25, "teff_K"),
        _card("radius", "Radius", 15, "radius_rsun"),
        _fixed("limb", "Edge darkening", 5, "model_dependent"),
        _fixed("pulsation_size", "Pulsation size", 5, "artistic"),
        _fixed("surface", "Surface", 15, "artistic"),
    ),
    ("teff_K", "radius_rsun", "spectral_class", "period_var_d"),
    ("a temperature", "a radius", "a spectral class", "a pulsation period"),
)
_GAS_GIANT = TypeTable(
    (
        _card("radius", "Radius", 15, "radius_rjup"),
        _card("mass", "Mass", 5, "mass_mearth"),
        _card("orbit", "Orbit and tides", 10, "orbit_au", "orbital_period_d", mode="all"),
        _card("temperature", "Temperature", 15, "teq_K"),
        _derived("colour", "Colour", 10, "teq_K"),
        _fixed("bands", "Band structure", 20, "inferred_from_analog"),
        _fixed("storms", "Storms", 15, "artistic"),
        _fixed("turbulence", "Turbulence", 10, "artistic"),
    ),
    ("radius_rjup", "mass_mearth"),
    ("a radius", "a mass"),
)
_ROCKY = TypeTable(
    (
        _card("radius", "Radius", 15, "radius_rjup"),
        _card("mass", "Mass", 10, "mass_mearth"),
        _card("orbit", "Orbit and tides", 10, "orbit_au", "orbital_period_d", mode="all"),
        _card("temperature", "Temperature", 15, "teq_K"),
        _card("host_star", "Host star", 10, "host_teff_K", "host_radius_rsun", mode="all"),
        _fixed("fluid", "Surface fluid and pressure", 15, "inferred_from_analog"),
        _fixed("terrain", "Plates and terrain", 15, "artistic"),
        _fixed("clouds", "Clouds and ice", 10, "artistic"),
    ),
    ("radius_rjup", "mass_mearth"),
    ("a radius", "a mass"),
)

TABLES: dict[str, TypeTable] = {
    "asteroid_shape": _ASTEROID_SHAPE,
    "asteroid_procedural": _ASTEROID_PROC,
    "comet": _COMET,
    "brown_dwarf": _BROWN_DWARF,
    "brown_dwarf_binary": _BROWN_DWARF,
    "star": _STAR,
    "star_ttauri": _STAR,
    "star_mira": _MIRA,
    "gas_giant": _GAS_GIANT,
    "planet_rocky": _ROCKY,
    "planet_water": _ROCKY,
}
# Types with no table: ``candidate`` is refused (no known class). ``nebula`` and ``nova`` have no
# card field that could be a key measurement (Q-222), so no score or gate is set for them: the
# viewer's own refusals apply, and ``confidence`` is absent from their RenderParams.
UNSCORED_TYPES = ("nebula", "nova")

_TAG_C = {
    "measured": 1.0,
    "derived": 1.0,
    "model_dependent": MODEL_DEPENDENT_C,
    "inferred_from_analog": 0.0,
    "artistic": 0.0,
}
_RANK = ("measured", "derived", "model_dependent", "inferred_from_analog", "artistic")


def _weakest(tags: Sequence[str]) -> str:
    return max(tags, key=lambda t: _RANK.index(t) if t in _RANK else len(_RANK))


def _present(tv: Any) -> bool:
    if not isinstance(tv, Mapping):
        return False
    v = tv.get("value")
    if v is None:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, numbers.Real) and not math.isfinite(float(v)):
        return False  # NaN and inf are unknown, never a value (Q-40)
    return not (isinstance(v, str | list | tuple | Mapping) and len(v) == 0)


def _sigma(err: Any) -> float | None:
    if isinstance(err, bool):
        return None
    if isinstance(err, numbers.Real):
        s = abs(float(err))
    elif (
        isinstance(err, list | tuple)
        and err
        and all(isinstance(e, numbers.Real) and not isinstance(e, bool) for e in err)
    ):
        s = sum(abs(float(e)) for e in err) / len(err)
    else:
        return None
    return s if math.isfinite(s) else None


def value_c(field: str, tv: Mapping[str, Any]) -> tuple[float, str]:
    """``(c, tag)`` of one present tagged value (Q-221)."""
    tag = str(tv.get("tag"))
    base = _TAG_C.get(tag, 0.0)
    if tag == "derived" and tv.get("assumption"):
        base = DERIVED_ASSUMED_C
    v = tv.get("value")
    sigma = _sigma(tv.get("err"))
    if (
        sigma is not None
        and tag in ("measured", "derived", "model_dependent")
        and isinstance(v, numbers.Real)
        and not isinstance(v, bool)
        and float(v) != 0.0
    ):
        rel = sigma / abs(float(v))
        sigma_class = CLASS_SIGMA_REL.get(field, DEFAULT_CLASS_SIGMA_REL)
        base = min(base, max(0.0, 1.0 - rel / sigma_class))
    return base, tag


def _gas_c(tv: Mapping[str, Any]) -> tuple[float, str] | None:
    """``gas_Q`` holds one TVNumber per molecule: the mean ``c`` of the three, 0 for an absent one
    (so one molecule of three counts a third), and the weakest tag of the present ones."""
    value = tv.get("value") if "value" in tv else tv
    if not isinstance(value, Mapping):
        return None
    got = [(value_c(f"gas_Q.{k}", m)) for k, m in value.items() if _present(m)]
    if not got:
        return None
    return sum(c for c, _ in got) / 3.0, _weakest([t for _, t in got])


def _field_c(card: Mapping[str, Any], field: str) -> tuple[float, str] | None:
    tv = card.get(field)
    if field == "gas_Q":
        return _gas_c(tv) if isinstance(tv, Mapping) else None
    if not _present(tv):
        return None
    assert isinstance(tv, Mapping)
    return value_c(field, tv)


def _score_input(card: Mapping[str, Any], inp: Input) -> tuple[float, str, tuple[str, ...]]:
    """``(c, status, fields_with_data)``. Status is a tag, or ``missing``."""
    if inp.kind == "fixed":
        if inp.fixed_tag is None:
            return 0.0, "missing", ()
        return _TAG_C[inp.fixed_tag], inp.fixed_tag, ()
    results = [(f, _field_c(card, f)) for f in inp.fields]
    have = [(f, r) for f, r in results if r is not None]
    if not have:
        return 0.0, "missing", ()
    if inp.derived_from_fields:
        if len(have) < len(inp.fields):
            return 0.0, "missing", tuple(f for f, _ in have)
        # A formula of the card values: only as strong as its weakest input.
        c = min(r[0] for _, r in have)
        return c, "derived", tuple(f for f, _ in have)
    if inp.mode == "all":
        c = sum(r[0] for _, r in have) / len(inp.fields)
        tag = _weakest([r[1] for _, r in have])
        return c, tag, tuple(f for f, _ in have)
    best = max(have, key=lambda fr: (fr[1][0], -_RANK.index(fr[1][1]) if fr[1][1] in _RANK else 0))
    return best[1][0], best[1][1], (best[0],)


def _band(score: float) -> str:
    if score >= BAND_MOSTLY_DATA:
        return "mostly_data"
    if score >= BAND_PART_DATA:
        return "part_data"
    if score >= CONFIDENCE_THRESHOLD:
        return "mostly_assumed"
    return "too_little"


def _r(x: float) -> float:
    return round(x, 4)


def _join(items: Sequence[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " or " + items[-1]


def confidence_block(
    card: Mapping[str, Any], *, threshold: float = CONFIDENCE_THRESHOLD
) -> dict[str, Any] | None:
    """The ``confidence`` object of RenderParams, or ``None`` for a type without a table."""
    kind = str(card.get("type"))
    if kind in UNSCORED_TYPES:
        return None
    table = TABLES.get(kind)
    if table is None:  # candidate (or a new type): the class is not known, so no 3D body
        return _unknown_class(kind, threshold)

    rows: list[dict[str, Any]] = []
    total = sum(i.weight for i in table.inputs)
    m = e = 0.0
    for inp in table.inputs:
        c, status, got = _score_input(card, inp)
        part = inp.weight * c / total
        if status == "measured":
            m += part
        else:
            e += part
        rows.append(
            {
                "id": inp.id,
                "label": inp.label,
                "weight": inp.weight,
                "c": _r(c),
                "tag": status,
                "points": _r(100.0 * part),
                "fields": list(got or inp.fields),
            }
        )
    score = m + e
    key_ok = any(_present(card.get(f)) for f in table.key_fields)
    score_ok = score + 1e-9 >= threshold
    passed = key_ok and score_ok

    have = [r["label"] for r in rows if r["tag"] in _RANK[:3] and r["fields"]]
    found = (
        "Data for: " + _join([x.lower() if i else x for i, x in enumerate(have)]) + "."
        if have
        else "No usable measurement yet."
    )
    needed = ""
    if not key_ok:
        needed = f"At least one key measurement: {_join(list(table.key_labels))}."
    if not score_ok:
        needed = (needed + " " if needed else "") + (
            f"Data confidence of at least {round(100 * threshold)}% (now {round(100 * score)}%)."
        )
    # What would raise it most: the heaviest input that has card fields and is not fully data.
    lacking = [
        (inp, r)
        for inp, r in zip(table.inputs, rows, strict=True)
        if inp.kind == "card" and r["c"] < 1.0
    ]
    raise_text: str | None = None
    if lacking:
        inp, _r_row = max(lacking, key=lambda ir: (ir[0].weight * (1.0 - ir[1]["c"]), ir[0].id))
        raise_text = f"A better measurement of: {inp.label.lower()}."
    return {
        "score": _r(score),
        "measured_share": _r(m),
        "estimated_share": _r(e),
        "assumed_share": _r(max(0.0, 1.0 - m - e)),
        "threshold": threshold,
        "band": _band(score),
        "gate": {
            "class_known": True,
            "key_measurement": key_ok,
            "score_ok": score_ok,
            "passed": passed,
        },
        "found": found,
        "needed": needed,
        "raise": raise_text,
        "inputs": rows,
        "tag": "derived",
        "formula": FORMULA,
        "weights_note": WEIGHTS_NOTE,
        "note": NOT_A_PROBABILITY,
    }


def _unknown_class(kind: str, threshold: float) -> dict[str, Any]:
    return {
        "score": 0.0,
        "measured_share": 0.0,
        "estimated_share": 0.0,
        "assumed_share": 1.0,
        "threshold": threshold,
        "band": "too_little",
        "gate": {
            "class_known": False,
            "key_measurement": False,
            "score_ok": False,
            "passed": False,
        },
        "found": "Its name and position.",
        "needed": (
            "A rule that identifies the kind of object, then a measurement of its size or gas."
        ),
        "raise": None,
        "inputs": [],
        "tag": "derived",
        "formula": "No class is known, so no weights apply and the score is 0 (Q-222)",
        "weights_note": WEIGHTS_NOTE,
        "note": NOT_A_PROBABILITY,
    }


# --- later: weights from a sensitivity sweep ----------------------------------------------


def sweep_weights(
    card: Mapping[str, Any],
    metric: Callable[[Mapping[str, Any]], float],
    fields: Sequence[str],
) -> dict[str, float]:
    """Weights from how much ``metric(card)`` (a number that describes the picture) moves when one
    field is removed. Returns each field's share of the total movement (0 when nothing moves).

    ``metric`` must be deterministic. This is the replacement for the placeholder tables: run it
    on real cards with a metric such as the distance between two baked textures
    (``scripts/confidence_sweep.py`` uses the count of changed RenderParams values)."""
    base = metric(card)
    moves: dict[str, float] = {}
    for f in fields:
        trial = dict(card)
        if f in trial:
            trial[f] = {**trial[f], "value": None} if isinstance(trial[f], Mapping) else None
        moves[f] = abs(metric(trial) - base)
    total = sum(moves.values())
    return {f: (v / total if total > 0 else 0.0) for f, v in moves.items()}
