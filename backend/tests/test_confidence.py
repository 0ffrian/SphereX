"""Data confidence and the 3D gate (issue #71 stream B, D-36, Q-220 to Q-222), and the Gaia MSC
temperature tier (Q-220)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.adapters import gaia
from app.adapters.gaia import GaiaAstro
from app.core.card import stars
from app.core.card.stars import StarCatalogue
from app.core.render import confidence as cf
from app.core.render.card_to_params import card_to_params

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def tv(value: Any, tag: str = "measured", **kw: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"value": value, "tag": tag, "source": "test", **kw}
    if tag == "derived":
        d.setdefault("formula", "f")
    if tag == "model_dependent":
        d.setdefault("assumption", "a")
    return d


def star_card(**fields: Any) -> dict[str, Any]:
    return {"id": "x", "name": "x", "type": "star", **fields}


# --- tables -------------------------------------------------------------------------------------


def test_every_table_sums_to_100_and_has_a_key() -> None:
    for kind, table in cf.TABLES.items():
        assert sum(i.weight for i in table.inputs) == 100, kind
        assert table.key_fields and len(table.key_fields) == len(table.key_labels), kind


# --- c per tag ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tag", "c"),
    [
        ("measured", 1.0),
        ("derived", 1.0),
        ("model_dependent", cf.MODEL_DEPENDENT_C),
        ("inferred_from_analog", 0.0),
        ("artistic", 0.0),
    ],
)
def test_c_by_tag(tag: str, c: float) -> None:
    assert cf.value_c("teff_K", tv(3000.0, tag))[0] == c


def test_derived_with_an_assumed_input_gets_the_placeholder_share() -> None:
    assert cf.value_c("f", tv(1.0, "derived", assumption="assumes x"))[0] == cf.DERIVED_ASSUMED_C


def test_error_bars_narrow_c_by_one_minus_sigma_over_class_sigma() -> None:
    # relative error 0.1 against class 0.5 -> 1 - 0.2
    c, _ = cf.value_c("mass_mearth", tv(10.0, err=1.0))
    assert c == pytest.approx(1 - 0.1 / cf.DEFAULT_CLASS_SIGMA_REL)
    # a pair uses the mean, a huge error floors at 0, and the tag's own c is the ceiling
    assert cf.value_c("m", tv(10.0, err=[1.0, 3.0]))[0] == pytest.approx(1 - 0.2 / 0.5)
    assert cf.value_c("m", tv(10.0, err=100.0))[0] == 0.0
    assert cf.value_c("m", tv(10.0, "model_dependent", err=0.0001))[0] == cf.MODEL_DEPENDENT_C


def test_missing_value_is_zero_and_missing() -> None:
    card = star_card(teff_K=tv(None), radius_rsun=tv(float("nan")))
    rows = {r["id"]: r for r in cf.confidence_block(card)["inputs"]}  # type: ignore[index]
    assert rows["temperature"]["tag"] == "missing" and rows["temperature"]["c"] == 0.0
    assert rows["radius"]["tag"] == "missing"


# --- the gate -----------------------------------------------------------------------------------


def test_gate_needs_class_key_and_score() -> None:
    ok = cf.confidence_block(star_card(teff_K=tv(3200.0, "derived"), radius_rsun=tv(0.2)))
    assert ok and ok["gate"]["passed"] and ok["gate"]["key_measurement"]
    assert ok["needed"] == ""

    # Score fine, no key measurement: a shape-model asteroid without its shape.
    a = {
        "id": "a",
        "name": "a",
        "type": "asteroid_shape",
        "diameter_km": tv(1.0),
        "rot_period_h": tv(5.0),
        "albedo": tv(0.1),
        "spectral_class": tv("C"),
        "gaia_rgb": tv([0.1, 0.1, 0.1]),
    }
    r = cf.confidence_block(a)
    assert r and r["score"] >= r["threshold"] and not r["gate"]["key_measurement"]
    assert not r["gate"]["passed"] and "key measurement" in r["needed"]

    # Key present, score too low: a spectral class alone on a star.
    low = cf.confidence_block(star_card(spectral_class=tv("M4V")))
    assert low and low["gate"]["key_measurement"] and not low["gate"]["score_ok"]
    assert not low["gate"]["passed"] and "Data confidence of at least 25%" in low["needed"]
    assert low["band"] == "too_little"


def test_an_unknown_class_is_refused_and_a_unscored_type_has_no_block() -> None:
    c = cf.confidence_block({"id": "m", "name": "m", "type": "candidate"})
    assert c and not c["gate"]["class_known"] and not c["gate"]["passed"] and c["score"] == 0.0
    assert cf.confidence_block({"id": "n", "name": "n", "type": "nebula"}) is None


def test_the_score_never_changes_a_provenance_tag_and_states_what_it_is() -> None:
    c = cf.confidence_block(star_card(teff_K=tv(3200.0, "derived")))
    assert c and c["tag"] == "derived" and c["formula"]
    assert "not the probability" in c["note"] and "Placeholder" in c["weights_note"]
    assert c["measured_share"] + c["estimated_share"] + c["assumed_share"] == pytest.approx(1.0)


def test_the_score_is_deterministic() -> None:
    card = star_card(teff_K=tv(3200.0, "derived"), radius_rsun=tv(0.2, "model_dependent", err=0.02))
    a = json.dumps(cf.confidence_block(card), sort_keys=True)
    assert a == json.dumps(cf.confidence_block(dict(card)), sort_keys=True)
    p1 = card_to_params({**card, "id": "x", "name": "x"})
    p2 = card_to_params({**card, "id": "x", "name": "x"})
    assert json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True)
    assert p1["confidence"]["score"] == cf.confidence_block(card)["score"]  # type: ignore[index]


def test_gas_amounts_count_per_molecule() -> None:
    one = {"id": "c", "name": "c", "type": "comet", "gas_Q": {"value": {"co2": tv(1e26)}}}
    r = cf.confidence_block(one)
    assert r
    gas = next(i for i in r["inputs"] if i["id"] == "gas")
    assert gas["c"] == pytest.approx(1 / 3, abs=1e-3) and r["gate"]["key_measurement"]


def test_sweep_weights_find_the_field_that_moves_the_metric() -> None:
    card = {"a": tv(1.0), "b": tv(2.0), "c": tv(3.0)}

    def metric(c: dict[str, Any]) -> float:
        return sum(
            10.0 * (v["value"] or 0.0) if k == "a" else (v["value"] or 0.0) for k, v in c.items()
        )

    w = cf.sweep_weights(card, metric, ["a", "b", "c"])
    assert w["a"] > w["c"] > w["b"] and sum(w.values()) == pytest.approx(1.0)
    assert cf.sweep_weights(card, lambda _c: 1.0, ["a"]) == {"a": 0.0}


# --- the 25 demo objects (calibration of the threshold, Q-222) -----------------------------------

# Scores as calibrated on 10 Nov 2026 with the placeholder weights, plus the nine objects added in
# issue #71 (11 Nov 2026, after the review fixes: Procyon A's interferometric radius, the Sun's
# class G2V, Titan's measured surface temperature, fluid and pressure). Failing: the two candidates
# (no class) (3I/ATLAS scores 0.5171 once the epoch-keyed gas rates count, Q-323).
# #93 3.5: an archive pl_eqt is derived with an assumed albedo (c = DERIVED_ASSUMED_C), so every
# exoplanet lost 7.5 points of temperature (and a giant 5 more of colour) against the 11 Nov pins.
DEMO_SCORES = {
    "star/simbad-name-barnard-s-star": (0.6, True),
    "brown_dwarf_binary/simbad-eps-ind-b": (0.475, True),
    "brown_dwarf/simbad-wisea-j085510-74-071442-5": (0.375, True),
    "star_ttauri/simbad-v-rw-aur": (0.5, True),
    "star_mira/simbad-v-r-dra": (0.5, True),
    "planet_rocky/simbad-trappist-1f": (0.5123, True),
    "planet_rocky/simbad-kepler-186f": (0.4081, True),
    "asteroid_shape/sbdb-20101955": (0.8407, True),
    "asteroid_procedural/sbdb-50788063": (0.475, True),
    "comet/sbdb-1004083": (0.5171, True),
    "gas_giant/simbad-hd-189733b": (0.4141, True),
    "planet_rocky/simbad-trappist-1e": (0.5038, True),
    "planet_water/simbad-k2-18b": (0.4441, True),
    "comet/sbdb-1000012": (0.4, True),
    "candidate/simbad-m-42": (0.0, False),
    "candidate/simbad-m-1": (0.0, False),
    "reference/ref-sun": (0.65, True),
    "reference/ref-jupiter": (0.55, True),
    "reference/ref-saturn": (0.55, True),
    "reference/ref-titan": (0.7, True),
    "star/simbad-alf-cmi": (0.6951, True),
    "star/simbad-eps-eri": (0.6, True),
    "planet_rocky/simbad-toi-700d": (0.4608, True),
    "gas_giant/simbad-wasp-39b": (0.4025, True),
    "planet_rocky/simbad-rho01-cnc-e": (0.5104, True),
}


def test_demo_pack_scores_are_what_the_card_gives() -> None:
    assert len(DEMO_SCORES) == 25
    for name, (score, passed) in DEMO_SCORES.items():
        asset = json.loads((ASSETS / f"{name}.json").read_text("utf-8"))
        got = cf.confidence_block(asset["card"])
        assert got is not None, name
        assert got["score"] == pytest.approx(score, abs=1e-4), name
        assert got["gate"]["passed"] is passed, name
        assert asset["render_params"]["confidence"] == got, name


def test_threshold_has_room_on_both_sides_of_the_demo_scores() -> None:
    scores = sorted(s for s, ok in DEMO_SCORES.values() if ok)
    assert scores[0] >= cf.CONFIDENCE_THRESHOLD + 0.1 - 1e-9  # the lowest passing object (3I/ATLAS)


# --- Gaia MSC (Q-220) ---------------------------------------------------------------------------

MSC_HEADER = ",".join(gaia.ASTRO_COLUMNS)


def astro(**kw: Any) -> GaiaAstro:
    base: dict[str, Any] = {
        "source_id": "1648328016354496384",
        "ra": 0.0,
        "dec": 0.0,
        "g_mag": 6.4,
        "teff_gspphot_k": None,
        "teff_gspphot_lower_k": None,
        "teff_gspphot_upper_k": None,
        "radius_flame_rsun": None,
        "radius_flame_lower_rsun": None,
        "radius_flame_upper_rsun": None,
        "teff_msc1_k": 3047.9,
        "teff_msc1_lower_k": 3000.0,
        "teff_msc1_upper_k": 3367.8,
    }
    return GaiaAstro(**{**base, **kw})


def test_the_adapter_reads_the_msc_columns() -> None:
    row = "1648328016354496384,248.1,66.7,6.37,,,,,,,3047.9,3000.0,3367.8"
    (g,) = gaia.parse_astro(f"{MSC_HEADER}\n{row}\n".encode())
    assert (g.teff_msc1_k, g.teff_msc1_lower_k, g.teff_msc1_upper_k) == (3047.9, 3000.0, 3367.8)
    assert g.teff_gspphot_k is None
    assert "a.teff_msc1" in gaia.astro_adql("gaia_dr3_source", "1", "2", "0.001")


def test_msc_is_tried_after_gsp_phot_and_before_the_class_table() -> None:
    mira = StarCatalogue(sp_type="M7e", gaia=astro())
    t = stars.teff_field(mira, "star_mira", None)
    assert (t["value"], t["tag"]) == (3047.9, "model_dependent")
    assert t["err"] == pytest.approx(319.9)
    assert "teff_msc1" in t["source"] and "1648328016354496384" in t["source"]
    # The binary assumption and the Mira variability are stated.
    assert "unresolved binary" in t["assumption"] and "Mira" in t["assumption"]
    # A usable GSP-Phot value wins.
    both = StarCatalogue(sp_type="K0V", gaia=astro(teff_gspphot_k=5000.0))
    assert stars.teff_field(both, "star", None)["value"] == 5000.0
    # A cool-star GSP-Phot value is skipped, and then the MSC value is used.
    cool = StarCatalogue(sp_type=None, gaia=astro(teff_gspphot_k=3099.6))
    assert stars.teff_field(cool, "star", None)["value"] == 3047.9
    # SIMBAD still comes first.
    from app.adapters.simbad import TeffRow

    s = StarCatalogue(teff_rows=(TeffRow(3300.0, "2020A"),), gaia=astro())
    assert stars.teff_field(s, "star", None)["tag"] == "derived"
    # A non-Mira star does not get the Mira sentence.
    t2 = stars.teff_field(StarCatalogue(sp_type=None, gaia=astro()), "star", None)
    assert "Mira" not in t2["assumption"]


def test_no_msc_value_means_the_old_refusal() -> None:
    t = stars.teff_field(
        StarCatalogue(sp_type=None, gaia=astro(teff_msc1_k=None)), "star_mira", None
    )
    assert t["value"] is None and t["source"].startswith("not available:")


def test_r_draconis_gets_a_colour_and_every_other_demo_star_is_unchanged() -> None:
    def card(name: str) -> dict[str, Any]:
        return json.loads((ASSETS / f"{name}.json").read_text("utf-8"))["card"]

    r = card("star_mira/simbad-v-r-dra")["teff_K"]
    assert (r["value"], r["tag"]) == (3047.9, "model_dependent")
    assert "teff_msc1" in r["source"]
    params = card_to_params(card("star_mira/simbad-v-r-dra"))
    assert "colour" in {layer["id"] for layer in params["layers"]}
    # Barnard's Star and RW Aur keep their SIMBAD-derived value: MSC is not read before it.
    assert card("star/simbad-name-barnard-s-star")["teff_K"]["tag"] == "derived"
    assert card("star_ttauri/simbad-v-rw-aur")["teff_K"]["tag"] == "derived"


# --- comet gas_Q shapes (Q-323) -----------------------------------------------------------------


def comet_card(gas: Any) -> dict[str, Any]:
    return {"id": "c", "name": "c", "type": "comet", "gas_Q": gas}


def test_gas_epoch_keyed_shape_counts_with_the_best_epoch_per_molecule() -> None:
    card = json.loads((ASSETS / "comet/sbdb-1004083.json").read_text("utf-8"))["card"]
    assert any(isinstance(v, dict) and "value" not in v for v in card["gas_Q"].values())
    assert cf._present_gas(card["gas_Q"])
    got = cf.confidence_block(card)
    assert got is not None
    row = next(r for r in got["inputs"] if r["id"] == "gas")
    assert row["tag"] == "measured" and row["c"] > 0 and row["fields"] == ["gas_Q"]
    assert got["gate"]["key_measurement"] is True
    assert "gas amounts" in got["found"]


def test_gas_flat_and_epoch_shapes_agree_for_one_epoch() -> None:
    flat = {"co2": tv(1.0e27, err=1.0e26), "h2o": tv(3.0e26, err=6.0e25)}
    assert cf._gas_c(flat) == cf._gas_c({"value": flat}) == cf._gas_c({"2025-08": flat})
    c, tag = cf._gas_c(flat) or (0.0, "")
    assert tag == "measured" and 0 < c < 2 / 3 + 1e-9


def test_gas_epochs_take_the_best_per_molecule_and_never_average() -> None:
    weak = {"co2": tv(1.0e27, err=9.0e26)}
    strong = {"co2": tv(1.0e27, err=1.0e25), "h2o": tv(2.0e26, "model_dependent")}
    c, tag = cf._gas_c({"a": weak, "b": strong}) or (0.0, "")
    c_strong = cf._gas_c(strong)
    assert c_strong is not None and c == c_strong[0] and tag == "model_dependent"


def test_gas_absent_or_empty_is_missing_and_not_a_key() -> None:
    for gas in (None, {}, {"2025-08": {}}, {"co2": {"value": None, "tag": "measured"}}):
        assert not cf._present_gas(gas)
        got = cf.confidence_block(comet_card(gas))
        assert got is not None and got["gate"]["key_measurement"] is False


def block(card: dict[str, Any]) -> dict[str, Any]:
    got = cf.confidence_block(card)
    assert got is not None
    return got


def test_an_analog_or_artistic_key_value_does_not_pass_the_gate() -> None:
    # Q-222 (issue #71 review): the key measurement must be data, not an analog or a drawn value.
    for tag in ("inferred_from_analog", "artistic"):
        got = cf.confidence_block(
            star_card(teff_K=tv(3200.0, tag), radius_rsun=tv(0.2, tag), spectral_class=tv("M", tag))
        )
        assert got is not None and got["gate"]["key_measurement"] is False, tag
        assert not got["gate"]["passed"]
    ok = cf.confidence_block(star_card(teff_K=tv(3200.0, "model_dependent")))
    assert ok is not None and ok["gate"]["key_measurement"] is True
    gas = {"2025-08": {"co2": tv(1e26, "inferred_from_analog")}}
    assert block(comet_card(gas))["gate"]["key_measurement"] is False


def test_a_measured_surface_temperature_fluid_and_pressure_count_for_a_rocky_world() -> None:
    base = {
        "id": "w",
        "name": "w",
        "type": "planet_rocky",
        "radius_rjup": tv(0.036),
        "mass_mearth": tv(0.0225),
    }
    plain = block(base)
    rows = {r["id"]: r for r in plain["inputs"]}
    # Without surface data: the fluid row is an analog (as before), the temperature missing.
    assert rows["fluid"]["tag"] == "inferred_from_analog" and rows["fluid"]["c"] == 0
    assert rows["temperature"]["tag"] == "missing"
    titan = {
        **base,
        "surface_temperature_K": tv(93.7),
        "surface_fluid": tv("methane"),
        "surface_pressure_bar": tv(1.467),
    }
    got = block(titan)
    rows = {r["id"]: r for r in got["inputs"]}
    assert rows["temperature"]["tag"] == "measured" and rows["temperature"]["c"] == 1
    assert rows["fluid"]["tag"] == "measured" and rows["fluid"]["c"] == 1
    assert got["score"] == pytest.approx(plain["score"] + 0.30)
    # One of the two fluid fields: half the row.
    half = block({**base, "surface_fluid": tv("methane")})
    assert {r["id"]: r for r in half["inputs"]}["fluid"]["c"] == 0.5


def test_found_text_joins_with_and() -> None:
    assert cf._join(["a", "b", "c"], "and") == "a, b and c"
    assert cf._join(["a", "b", "c"]) == "a, b or c"
    got = cf.confidence_block(star_card(teff_K=tv(3200.0), radius_rsun=tv(0.2)))
    assert got is not None and " or " not in got["found"] and " and " in got["found"]
