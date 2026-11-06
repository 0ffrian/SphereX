"""Type selection (R3.3, A4.3, UML 18). Pure functions: catalogue facts in, ObjectType out.

The class label (``spectral_class``) comes from a catalogue only. Matching the SPHEREx spectrum
against reference types (A4.3 step 2) needs reference spectra, which the repo does not hold yet;
until then the label's confidence is ``"catalogue"`` (taken as published) or ``"none"`` (no
label), never a fitted number. The card has no confidence field (Q-50).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

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
# R3.3 step 4 and R12 #12: "Do not hard-code values until they are agreed." The docs give no
# columns and no cut-offs, so every entry is None and `classify_exoplanet` refuses (Q-51 lists
# sourced candidates for the team). Patch the values here, in this one place, once agreed.
EXOPLANET_THRESHOLDS: dict[str, float | None] = {
    "rocky_max_radius_earth": None,  # planet_rocky below this pl_rade [verify]
    "giant_min_radius_earth": None,  # gas_giant from this pl_rade [verify]
    "giant_min_mass_jup": None,  # gas_giant by mass when pl_rade is missing [verify]
}
# planet_water has no catalogue observable yet (Q-51); there is no threshold for it.
# --------------------------------------------------------------------------------------------

# SIMBAD object types (otype codes). R3.3 names the classes; these are SIMBAD's codes for them.
SIMBAD_BROWN_DWARF = frozenset({"BD*"})
SIMBAD_MIRA = frozenset({"Mi*"})
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
    exoplanet: Mapping[str, Any] | None = None  # NASA Exoplanet Archive row (A3.8, not built)
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


def classify_exoplanet(
    row: Mapping[str, Any],
) -> tuple[ObjectTypeName | None, tuple[str, ...]]:
    """R3.3 step 4. Refuses while the R12 #12 thresholds are not agreed (all None)."""
    if any(v is None for v in EXOPLANET_THRESHOLDS.values()):
        return None, ("type:exoplanet_thresholds",)
    # Unreachable until the thresholds are agreed; the rule itself is also still to decide.
    return None, ("type:exoplanet_rule",)


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
        planet, refused = classify_exoplanet(facts.exoplanet)
        if planet is not None:
            return Classification(planet, "R3.3.4 Exoplanet Archive")

    if facts.slider_kind is not None:
        return Classification(facts.slider_kind, "R3.3.5 user sliders")

    return Classification("candidate", "R3.3.6 anything else", missing=refused)
