"""Type selection (R3.3, A4.3, UML 18). Pure functions: catalogue facts in, ObjectType out.

The class label (``spectral_class``) comes from a catalogue only. Matching the SPHEREx spectrum
against reference types (A4.3 step 2) needs reference spectra, which the repo does not hold yet;
until then the label's confidence is ``"catalogue"`` (taken as published) or ``"none"`` (no
label), never a fitted number. The card has no confidence field (Q-55).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from app.core.classify.zeng2019 import EARTHLIKE_ROCKY, radius_on_curve, water_curve_for

ObjectTypeName = Literal[
    "asteroid_shape",
    "asteroid_procedural",
    "comet",
    "brown_dwarf",
    "brown_dwarf_binary",
    "star_mira",
    "star_ttauri",
    "star",
    "candidate",
    "planet_rocky",
    "planet_water",
    "gas_giant",
    "nebula",
    "nova",
]
Confidence = Literal["catalogue", "none"]

# --- R12 #12 [verify]: exoplanet type thresholds -------------------------------------------
# R3.3 step 4 and R12 #12 say not to hard-code values until they are agreed. Agreed: Moon signed
# off Q-63 on 9 Nov 2026 (issue #68 Part 0.1; D-17 amended: Moon decides rules that change the 3D
# body, Atish owns and reviews this code). The values were checked against their sources (issue #68
# comment, 9 Nov 2026): 1.5 R_E and 6 R_E are project cuts based on the cited papers, not
# boundaries those papers define; 0.414 M_J and 317.83 are as published. The radius cut and the
# mass cut do not select the same planets (6-10 R_E is a giant by radius, Neptunian by Chen &
# Kipping's mass break): recorded in Q-63. This block is the single place for the numbers; the
# mass-radius tables sit in `zeng2019.py`. A None value still refuses the rule that needs it
# (`type:exoplanet_thresholds`), so withdrawing a value is a one-line change.
PROPOSED_EXOPLANET_THRESHOLDS: dict[str, float] = {
    # planet_rocky below this pl_rade. Weiss & Marcy 2014 (arXiv:1312.0936); Fulton et al. 2017
    # (arXiv:1703.10375, radius valley near 1.5-2 R_earth). [verify]
    "rocky_max_radius_earth": 1.5,
    # gas_giant from this pl_rade. Kopparapu et al. 2018 (arXiv:1802.09602). [verify]
    "giant_min_radius_earth": 6.0,
    # gas_giant by mass when pl_rade is missing: Chen & Kipping 2017 (arXiv:1603.08614),
    # Neptunian/Jovian transition at 0.414 M_J. [verify]
    "giant_min_mass_jup": 0.414,
    # Earth masses per Jupiter mass (IAU 2015 nominal GM ratio, M_J / M_E = 317.83). [verify]
    "earth_masses_per_jup": 317.83,
}
EXOPLANET_THRESHOLDS: dict[str, float | None] = dict(PROPOSED_EXOPLANET_THRESHOLDS)
# PSCompPars fills gaps with its own estimates and marks them in `<column>_reflink` with
# `refstr=CALCULATED_VALUE` (https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html):
# a radius from the Chen & Kipping 2017 mass-radius relation (often from an Msini mass), a mass
# from the radius, Teq = T_star * sqrt(R_star / a) * (1/4)^(1/4). A calculated radius or mass is
# never used to classify (the same circularity as "M-R relationship"); on 2026-11-07, 1,540 rows
# had a calculated pl_rade and 1,090 a calculated pl_eqt (PR #45 review).
CALCULATED_REFSTR = "refstr=CALCULATED_VALUE"


def is_calculated(row: Mapping[str, Any], column: str) -> bool:
    """True when the archive computed ``column`` itself instead of taking it from a paper."""
    link = row.get(f"{column}_reflink")
    return isinstance(link, str) and CALCULATED_REFSTR in link


# Archive `pl_bmassprov` values seen in PSCompPars on 2026-11-07: "Mass" (2491 rows), "Msini" (926),
# "Msin(i)/sin(i)" (15), "M-R relationship" (3032). Only "Mass" is used as a mass; "Msini" is a
# lower limit and "M-R relationship" is the archive's own estimate from the radius (circular).
# "Msin(i)/sin(i)" is left out too (an inclination-corrected estimate): a conservative choice.
TRUE_MASS_PROVENANCE = frozenset({"Mass"})
# planet_water: R between the Zeng 2019 Earth-like rocky curve and the 100% H2O curve whose
# tabulated temperature (300/500/700/1000 K) is nearest to pl_eqt, at the planet's mass; no
# water planet when pl_eqt is missing or above 1000 K. A model result: the interior is not observed.
# --------------------------------------------------------------------------------------------

# SIMBAD object types (otype codes). R3.3 names the classes; these are SIMBAD's codes for them.
SIMBAD_BROWN_DWARF = frozenset({"BD*"})
SIMBAD_MIRA = frozenset({"Mi*"})
# An extrasolar planet. `Pl?` (candidate) is a different code and is not matched (Q-63).
SIMBAD_PLANET = frozenset({"Pl"})
SIMBAD_TTAURI = frozenset({"TT*"})
# ASSUMPTION: "any other star" = a SIMBAD otype ending in '*' (stars and their variable classes)
# plus the supergiant and YSO codes that do not. Codes ending in '?' are candidates, not stars.
SIMBAD_OTHER_STAR_EXTRA = frozenset({"s*r", "s*y", "s*b", "Y*O"})


@dataclass(frozen=True)
class CatalogueFacts:
    """What stage 1 found about the object. Every field is optional; absent = no match."""

    sbdb_kind: str | None = None  # SBDB `kind`: an/au asteroid, cn/cu comet
    sbdb_taxonomy: str | None = None  # SBDB spec_B (SMASS), else spec_T (Tholen)
    sbdb_taxonomy_source: str | None = None
    shape_model: str | None = None  # a DAMIT or NASA shape model address, if one is known
    simbad_otype: str | None = None
    simbad_sp_type: str | None = None
    simbad_id: str | None = None
    exoplanet: Mapping[str, Any] | None = None  # NASA Exoplanet Archive row (A3.8)
    slider_kind: Literal["nebula", "nova"] | None = None  # R3.3 step 5: user sliders only


@dataclass(frozen=True)
class Classification:
    type: ObjectTypeName
    rule: str  # which R3.3 rule picked it, for logs and tests
    class_label: str | None = None
    class_label_source: str | None = None
    confidence: Confidence = "none"
    missing: tuple[str, ...] = field(default_factory=tuple)


def _is_star(otype: str) -> bool:
    return otype.endswith("*") or otype in SIMBAD_OTHER_STAR_EXTRA


def _has_known_components(sp_type: str | None) -> bool:
    """ASSUMPTION: a composite SIMBAD spectral type (``T1V+T6V``) means the system has known
    components (R3.3 "brown_dwarf_binary if the system has known components")."""
    return sp_type is not None and "+" in sp_type


def _num(row: Mapping[str, Any], key: str) -> float | None:
    v = row.get(key)
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    x = float(v)
    return x if math.isfinite(x) and x > 0 else None


def classify_exoplanet(
    row: Mapping[str, Any],
) -> tuple[ObjectTypeName | None, tuple[str, ...], str]:
    """R3.3 step 4 (Q-63): (type or None, refusal reasons, rule text). Central values only.

    R = pl_rade unless the archive calculated it; M = pl_bmasse only when pl_bmassprov is a true
    mass and the archive did not calculate it. Error bars are ignored.
    """
    t = EXOPLANET_THRESHOLDS
    if any(v is None for v in t.values()):
        return None, ("type:exoplanet_thresholds",), ""
    rocky_max = t["rocky_max_radius_earth"]
    giant_r = t["giant_min_radius_earth"]
    giant_mj = t["giant_min_mass_jup"]
    me_per_mj = t["earth_masses_per_jup"]
    assert rocky_max is not None and giant_r is not None
    assert giant_mj is not None and me_per_mj is not None

    r = None if is_calculated(row, "pl_rade") else _num(row, "pl_rade")
    true_mass = row.get("pl_bmassprov") in TRUE_MASS_PROVENANCE
    m = _num(row, "pl_bmasse") if true_mass and not is_calculated(row, "pl_bmasse") else None
    base = "R3.3.4 Exoplanet Archive"

    if r is None:
        if m is not None and m >= giant_mj * me_per_mj:
            return "gas_giant", (), f"{base}: R missing, M>={giant_mj} M_J (Chen & Kipping 2017)"
        return None, ("type:exoplanet_radius",), ""
    if r >= giant_r:
        return "gas_giant", (), f"{base}: R>={giant_r:g} R_earth (Kopparapu 2018)"
    if r < rocky_max:
        return "planet_rocky", (), f"{base}: R<{rocky_max:g} R_earth (Weiss & Marcy 2014)"
    if m is None:
        return None, ("type:exoplanet_mass",), ""
    r_rock = radius_on_curve(EARTHLIKE_ROCKY, m)
    if r_rock is None:
        return None, ("type:exoplanet_mass_range",), ""
    span = f"{rocky_max:g}<=R<{giant_r:g}"
    if r <= r_rock:
        return "planet_rocky", (), f"{base}: {span}, at or below Zeng 2019 Earth-like rocky curve"
    water = water_curve_for(_num(row, "pl_eqt"))
    if water is None:
        return None, ("type:exoplanet_water_model_range",), ""
    temp, curve = water
    r_water = radius_on_curve(curve, m)
    if r_water is None:
        return None, ("type:exoplanet_mass_range",), ""
    if r <= r_water:
        return (
            "planet_water",
            (),
            f"{base}: {span}, between Zeng 2019 rocky and 100% water ({temp:g} K) curves",
        )
    return None, ("type:exoplanet_envelope",), ""


# Q-317: reviewed type overrides for exoplanets the R3.3.4 rules refuse (no invented rule: a person
# read the source, and the row is used only when the rules gave NO type, never to change one).
# Key: the archive's ``pl_name``. Value: (type, why). 55 Cnc e: R 1.875 R_earth and M 7.99 M_earth
# (Bourrier et al. 2018, A&A 619, A1, the archive's default row) sit 8% above the Zeng 2019
# Earth-like curve, and pl_eqt 1958 K is above the hottest water table (1000 K), so the rules
# refuse (``type:exoplanet_water_model_range``). Archive density 6.66 g/cm3 is rock-like, and the
# planet is a known hot rocky super-Earth (lava world). [verify] against the paper's text.
REVIEWED_EXOPLANET_TYPES: dict[str, tuple[ObjectTypeName, str]] = {
    "55 Cnc e": (
        "planet_rocky",
        "reviewed override: R and M above the Earth-like curve, Teq above the water tables; "
        "archive density 6.66 g/cm3, Bourrier et al. 2018 (A&A 619, A1)",
    ),
}


def classify(facts: CatalogueFacts) -> Classification:
    """R3.3 in order: SBDB, SIMBAD, Exoplanet Archive, sliders, else candidate."""
    kind = (facts.sbdb_kind or "").lower()
    if kind.startswith("c"):
        return Classification("comet", "R3.3.1 SBDB comet", missing=("spectral_class",))
    if kind.startswith("a"):
        label = facts.sbdb_taxonomy
        conf: Confidence = "catalogue" if label else "none"
        miss = () if label else ("spectral_class",)
        if facts.shape_model:
            return Classification(
                "asteroid_shape",
                "R3.3.2 SBDB asteroid with a shape model",
                label,
                facts.sbdb_taxonomy_source,
                conf,
                miss,
            )
        return Classification(
            "asteroid_procedural",
            "R3.3.2 SBDB asteroid, no shape model",
            label,
            facts.sbdb_taxonomy_source,
            conf,
            miss,
        )

    otype = facts.simbad_otype
    if otype:
        sp = facts.simbad_sp_type
        label_src = f"SIMBAD {facts.simbad_id} sp_type" if facts.simbad_id else "SIMBAD sp_type"
        conf = "catalogue" if sp else "none"
        miss = () if sp else ("spectral_class",)
        src = label_src if sp else None
        if otype in SIMBAD_BROWN_DWARF:
            if _has_known_components(sp):
                return Classification(
                    "brown_dwarf_binary", "R3.3.3 SIMBAD brown dwarf, components", sp, src, conf
                )
            return Classification("brown_dwarf", "R3.3.3 SIMBAD brown dwarf", sp, src, conf, miss)
        if otype in SIMBAD_MIRA:
            return Classification("star_mira", "R3.3.3 SIMBAD Mira", sp, src, conf, miss)
        if otype in SIMBAD_TTAURI:
            return Classification("star_ttauri", "R3.3.3 SIMBAD T Tauri", sp, src, conf, miss)
        if _is_star(otype):
            return Classification("star", "R3.3.3 SIMBAD other star", sp, src, conf, miss)

    refused: tuple[str, ...] = ()
    if facts.exoplanet is not None:
        planet, refused, rule = classify_exoplanet(facts.exoplanet)
        if planet is not None:
            return Classification(planet, rule)
        reviewed = REVIEWED_EXOPLANET_TYPES.get(str(facts.exoplanet.get("pl_name")))
        if reviewed is not None:
            return Classification(reviewed[0], f"R3.3.4 {reviewed[1]}")

    if facts.slider_kind is not None:
        return Classification(facts.slider_kind, "R3.3.5 user sliders")

    return Classification("candidate", "R3.3.6 anything else", missing=refused)
