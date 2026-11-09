"""Stage 3 type selection (R3.3, A4.3, UML 18)."""

from __future__ import annotations

import pytest

from app.core.classify import EXOPLANET_THRESHOLDS, CatalogueFacts, classify, classify_exoplanet


@pytest.mark.parametrize(
    ("facts", "expected"),
    [
        (CatalogueFacts(sbdb_kind="cn"), "comet"),
        (CatalogueFacts(sbdb_kind="cu"), "comet"),
        (CatalogueFacts(sbdb_kind="an"), "asteroid_procedural"),
        (CatalogueFacts(sbdb_kind="au", shape_model="/meshes/x.glb"), "asteroid_shape"),
        (CatalogueFacts(simbad_otype="BD*", simbad_sp_type="Y2"), "brown_dwarf"),
        (CatalogueFacts(simbad_otype="BD*", simbad_sp_type="T1V+T6V"), "brown_dwarf_binary"),
        (CatalogueFacts(simbad_otype="BD*"), "brown_dwarf"),
        (CatalogueFacts(simbad_otype="Mi*", simbad_sp_type="M4.5-6+e"), "star_mira"),
        # A composite type on a T Tauri star does not make it a brown dwarf binary.
        (CatalogueFacts(simbad_otype="TT*", simbad_sp_type="K1/5e+K5e"), "star_ttauri"),
        (CatalogueFacts(simbad_otype="BY*", simbad_sp_type="M4V"), "star"),
        (CatalogueFacts(simbad_otype="*"), "star"),
        (CatalogueFacts(simbad_otype="s*r"), "star"),
        (CatalogueFacts(simbad_otype="BD?"), "candidate"),  # a candidate is not a brown dwarf
        (CatalogueFacts(simbad_otype="G"), "candidate"),  # a galaxy is not a star
        (CatalogueFacts(slider_kind="nebula"), "nebula"),
        (CatalogueFacts(slider_kind="nova"), "nova"),
        (CatalogueFacts(), "candidate"),
    ],
)
def test_r33_rules(facts: CatalogueFacts, expected: str) -> None:
    assert classify(facts).type == expected


def test_sbdb_wins_over_simbad() -> None:
    """R3.3 order: the SBDB rules come first."""
    assert classify(CatalogueFacts(sbdb_kind="an", simbad_otype="BD*")).type == (
        "asteroid_procedural"
    )


def test_class_label_comes_from_the_catalogue_with_its_confidence() -> None:
    c = classify(CatalogueFacts(simbad_otype="BD*", simbad_sp_type="Y2", simbad_id="W"))
    assert (c.class_label, c.confidence) == ("Y2", "catalogue")
    assert c.class_label_source and "SIMBAD" in c.class_label_source
    a = classify(CatalogueFacts(sbdb_kind="an", sbdb_taxonomy="S", sbdb_taxonomy_source="SBDB"))
    assert (a.class_label, a.confidence) == ("S", "catalogue")
    none = classify(CatalogueFacts(sbdb_kind="an"))
    assert (none.class_label, none.confidence) == (None, "none")
    assert "spectral_class" in none.missing


def test_exoplanet_thresholds_refuse_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """R12 #12: a threshold set to None refuses the rule instead of guessing."""
    monkeypatch.setitem(EXOPLANET_THRESHOLDS, "rocky_max_radius_earth", None)
    row = {"pl_rade": 1.0, "pl_bmasse": 1.0, "pl_eqt": 300.0}
    planet, missing, _ = classify_exoplanet(row)
    assert planet is None and missing == ("type:exoplanet_thresholds",)
    c = classify(CatalogueFacts(exoplanet=row))
    assert c.type == "candidate"
    assert "type:exoplanet_thresholds" in c.missing


def test_classify_is_deterministic() -> None:
    f = CatalogueFacts(simbad_otype="BD*", simbad_sp_type="T1V+T6V", simbad_id="x")
    assert classify(f) == classify(f)
