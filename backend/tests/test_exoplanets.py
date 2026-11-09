"""Exoplanet Archive adapter and the Q-63 type rule (A3.8, R3.3 step 4), offline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.adapters import exoplanet_archive as ea
from app.core.card.validate import errors
from app.core.classify import (
    EXOPLANET_THRESHOLDS,
    PROPOSED_EXOPLANET_THRESHOLDS,
    CatalogueFacts,
    classify,
    classify_exoplanet,
    is_calculated,
)
from app.core.classify.zeng2019 import (
    EARTHLIKE_ROCKY,
    PURE_WATER_300K,
    radius_on_curve,
    water_curve_for,
)
from app.core.render.card_to_params import card_to_params
from tests.helpers import resolve_id

CALC = "<a refstr=CALCULATED_VALUE href=/docs/pscp_calc.html target=_blank>Calculated Value</a>"


@pytest.fixture
def proposed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Q-63 values as proposed; live since Moon's sign-off (issue #68), so this pins them."""
    for k, v in PROPOSED_EXOPLANET_THRESHOLDS.items():
        monkeypatch.setitem(EXOPLANET_THRESHOLDS, k, v)


def row(**kw: Any) -> dict[str, Any]:
    return {"pl_name": "X b", **kw}


def kind(**kw: Any) -> tuple[Any, tuple[str, ...]]:
    t, missing, _ = classify_exoplanet(row(**kw))
    return t, missing


# --- adapter ---------------------------------------------------------------------------------


def test_parse_empty_one_row_and_nulls() -> None:
    assert ea.parse(b"[]") is None
    r = ea.parse(json.dumps([{"pl_name": "K2-18 b", "pl_rade": 2.37, "pl_eqt": None}]).encode())
    assert r is not None and r["pl_rade"] == 2.37 and r["pl_eqt"] is None
    with pytest.raises(ValueError):
        ea.parse(b'{"error": 1}')


def test_name_candidates_and_adql() -> None:
    assert ea.name_candidates("K2-18 b", "K2-18b") == ["K2-18 b", "K2-18b"]
    assert ea.name_candidates("  TRAPPIST-1e ", None) == ["TRAPPIST-1e", "TRAPPIST-1 e"]
    assert ea.name_candidates(None, "") == []
    q = ea.adql(["O'Neil b"])
    assert "lower(pl_name) IN ('o''neil b')" in q


def test_parse_prefers_earliest_candidate() -> None:
    body = json.dumps([{"pl_name": "A b"}, {"pl_name": "A B"}]).encode()
    assert ea.parse(body, ["a b"])["pl_name"] == "A b"  # type: ignore[index]


def test_ref_text() -> None:
    r = {"pl_radj_reflink": "<a refstr=S href=https://x target=ref>Sarkis et al. 2018</a>"}
    assert ea.ref_text(r, "pl_radj") == "Sarkis et al. 2018"
    assert ea.ref_text({}, "pl_radj") == "no reference given"


# --- curves ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("m", "rock", "water"),
    [
        (1, 1.000, 1.413),
        (4, 1.460, 2.055),
        (8, 1.737, 2.455),
        (10, 1.833, 2.593),
        (20, 2.146, 3.047),
    ],
)
def test_curve_interpolation_matches_published_values(m: float, rock: float, water: float) -> None:
    assert radius_on_curve(EARTHLIKE_ROCKY, m) == pytest.approx(rock, abs=0.002)
    assert radius_on_curve(PURE_WATER_300K, m) == pytest.approx(water, abs=0.002)


def test_curve_outside_range_and_bad_input() -> None:
    assert radius_on_curve(PURE_WATER_300K, 0.01) is None
    assert radius_on_curve(EARTHLIKE_ROCKY, 1e4) is None
    assert radius_on_curve(EARTHLIKE_ROCKY, float("nan")) is None
    assert radius_on_curve(EARTHLIKE_ROCKY, 0.0) is None
    assert radius_on_curve(EARTHLIKE_ROCKY, 4.2296) == 1.4806  # a tabulated point


def test_water_curve_temperature_choice() -> None:
    assert water_curve_for(284.0)[0] == 300.0  # type: ignore[index]
    assert water_curve_for(400.0)[0] == 300.0  # type: ignore[index]  (tie goes colder)
    assert water_curve_for(401.0)[0] == 500.0  # type: ignore[index]
    assert water_curve_for(1000.0)[0] == 1000.0  # type: ignore[index]
    assert water_curve_for(1000.1) is None and water_curve_for(None) is None


# --- rule: every branch ----------------------------------------------------------------------


def test_live_thresholds_are_the_signed_off_values() -> None:
    # Issue #68 Part 0.1: Moon signed off Q-63; the live values are exactly the proposed ones.
    assert EXOPLANET_THRESHOLDS == PROPOSED_EXOPLANET_THRESHOLDS


def test_thresholds_unset_refuses_every_planet(monkeypatch: pytest.MonkeyPatch) -> None:
    # Withdrawing the values still refuses with a reason instead of guessing.
    for k in EXOPLANET_THRESHOLDS:
        monkeypatch.setitem(EXOPLANET_THRESHOLDS, k, None)
    assert kind(pl_rade=15.6) == (None, ("type:exoplanet_thresholds",))
    assert kind(pl_rade=0.92) == (None, ("type:exoplanet_thresholds",))


def test_is_calculated() -> None:
    assert is_calculated({"pl_rade_reflink": CALC}, "pl_rade")
    assert not is_calculated({"pl_rade_reflink": "<a refstr=AGOL>Agol 2021</a>"}, "pl_rade")
    assert not is_calculated({}, "pl_rade")


@pytest.mark.usefixtures("proposed")
def test_calculated_values_never_classify() -> None:
    # Proxima Cen b: archive radius 1.02 from a mass-radius relation, Msini mass -> refused.
    assert kind(pl_rade=1.02, pl_rade_reflink=CALC, pl_bmasse=1.07, pl_bmassprov="Msini") == (
        None,
        ("type:exoplanet_radius",),
    )
    # 51 Peg b: calculated radius ignored, true mass above 0.414 M_J -> gas giant by mass.
    t, _, rule = classify_exoplanet(
        row(pl_rade=14.1, pl_rade_reflink=CALC, pl_bmasse=150.0, pl_bmassprov="Mass")
    )
    assert t == "gas_giant" and "R missing" in rule
    # A calculated mass is not a true mass either, whatever pl_bmassprov says.
    assert kind(pl_rade=2.37, pl_bmasse=8.92, pl_bmassprov="Mass", pl_bmasse_reflink=CALC)[1] == (
        "type:exoplanet_mass",
    )


@pytest.mark.usefixtures("proposed")
def test_rule_branches() -> None:
    assert kind(pl_rade=0.92)[0] == "planet_rocky"
    assert kind(pl_rade=15.6)[0] == "gas_giant"
    assert kind(pl_rade=6.0)[0] == "gas_giant"
    assert kind(pl_rade=1.499)[0] == "planet_rocky"
    # 1.5 <= R < 6 needs a true mass
    assert kind(pl_rade=2.4) == (None, ("type:exoplanet_mass",))
    assert kind(pl_rade=2.4, pl_bmasse=9.0, pl_bmassprov="Msini")[1] == ("type:exoplanet_mass",)
    assert kind(pl_rade=2.4, pl_bmasse=9.0, pl_bmassprov="M-R relationship")[1] == (
        "type:exoplanet_mass",
    )
    base = {"pl_bmasse": 8.92, "pl_bmassprov": "Mass", "pl_eqt": 284.0}
    assert kind(pl_rade=1.7, **base)[0] == "planet_rocky"  # below the rocky curve (1.74 at 8.92)
    assert kind(pl_rade=2.37, **base)[0] == "planet_water"
    assert kind(pl_rade=3.5, **base) == (None, ("type:exoplanet_envelope",))
    # water band but no water model at this temperature
    assert kind(pl_rade=2.37, **{**base, "pl_eqt": 1958.0}) == (
        None,
        ("type:exoplanet_water_model_range",),
    )
    assert kind(pl_rade=2.37, **{**base, "pl_eqt": None})[1] == (
        "type:exoplanet_water_model_range",
    )
    # mass outside the curves
    assert kind(pl_rade=2.0, pl_bmasse=1e4, pl_bmassprov="Mass")[1] == (
        "type:exoplanet_mass_range",
    )


@pytest.mark.usefixtures("proposed")
def test_rule_radius_missing() -> None:
    giant = 0.414 * 317.83
    assert kind(pl_bmasse=giant + 1, pl_bmassprov="Mass")[0] == "gas_giant"
    assert kind(pl_bmasse=giant - 1, pl_bmassprov="Mass") == (None, ("type:exoplanet_radius",))
    assert kind(pl_bmasse=giant + 1, pl_bmassprov="Msini")[1] == ("type:exoplanet_radius",)
    assert kind()[1] == ("type:exoplanet_radius",)


@pytest.mark.usefixtures("proposed")
def test_rule_text_states_comparison() -> None:
    _, _, rule = classify_exoplanet(
        row(pl_rade=2.37, pl_bmasse=8.92, pl_bmassprov="Mass", pl_eqt=284.0)
    )
    assert "1.5<=R<6" in rule and "Zeng 2019" in rule and "300 K" in rule


@pytest.mark.usefixtures("proposed")
def test_thresholds_block_is_single_source(monkeypatch: pytest.MonkeyPatch) -> None:
    assert all(isinstance(v, float) for v in PROPOSED_EXOPLANET_THRESHOLDS.values())
    monkeypatch.setitem(EXOPLANET_THRESHOLDS, "giant_min_radius_earth", 20.0)
    assert kind(pl_rade=15.6, pl_bmasse=232.0, pl_bmassprov="Mass")[0] is None
    src = Path(__file__).resolve().parents[1] / "app" / "core" / "classify" / "rules.py"
    body = src.read_text(encoding="utf-8").split("def classify_exoplanet")[1]
    for literal in ("1.5", "6.0", "0.414", "317.83"):
        assert literal not in body.split("def classify(")[0]


def test_pl_candidate_is_not_a_planet() -> None:
    assert classify(CatalogueFacts(simbad_otype="Pl?")).type == "candidate"


# --- end to end, offline ---------------------------------------------------------------------

PLANETS = {
    "TRAPPIST-1 e": "planet_rocky",
    "K2-18 b": "planet_water",
    "HD 209458 b": "gas_giant",
    "GJ 1214 b": "candidate",
}


@pytest.mark.usefixtures("proposed")
@pytest.mark.parametrize(("name", "want"), PLANETS.items())
def test_fixture_planets_offline(client: TestClient, name: str, want: str) -> None:
    oid = resolve_id(client, name)
    card_r = client.get(f"/v1/objects/{oid}/card")
    params_r = client.get(f"/v1/objects/{oid}/render-params")
    assert card_r.status_code == 200 and params_r.status_code == 200, card_r.text
    card, params = card_r.json(), params_r.json()
    assert errors(card, "object-card.schema.json") == []
    assert errors(params, "render-params.schema.json") == []
    assert card["type"] == params["type"] == want
    assert card["name"] == name  # the archive's pl_name, not SIMBAD's main_id (Q-63)
    assert "type:exoplanet_thresholds" not in params["missing"]
    if want == "candidate":
        assert "type:exoplanet_envelope" in params["missing"]
        return
    assert card["radius_rjup"]["tag"] == "measured" and card["radius_rjup"]["value"] > 0
    assert "Exoplanet Archive" in card["radius_rjup"]["source"]
    assert card["teq_K"]["tag"] in ("measured", "derived")
    assert params["scale_m"] > 0
    assert "spectrum" in params["missing"]  # no SPHEREx frames recorded: null with a reason


LIVE_TYPES = {**PLANETS, "51 Peg b": "gas_giant", "Proxima Cen b": "candidate"}


@pytest.mark.parametrize(("name", "want"), LIVE_TYPES.items())
def test_fixture_planets_are_typed_live(client: TestClient, name: str, want: str) -> None:
    """Issue #68 Part 0.1: the rule is on without the `proposed` fixture; each recorded planet
    gets the class `targets.toml` documents, and none is refused for missing thresholds."""
    oid = resolve_id(client, name)
    params = client.get(f"/v1/objects/{oid}/render-params").json()
    assert params["type"] == want
    assert "type:exoplanet_thresholds" not in params["missing"]


@pytest.mark.usefixtures("proposed")
def test_calculated_archive_values_are_not_measured(client: TestClient) -> None:
    oid = resolve_id(client, "51 Peg b")
    card = client.get(f"/v1/objects/{oid}/card").json()
    assert errors(card, "object-card.schema.json") == []
    assert card["type"] == "gas_giant"  # by its true mass; the calculated radius is not used
    radius, teq = card["radius_rjup"], card["teq_K"]
    assert radius["tag"] == "model_dependent" and "Chen & Kipping" in radius["assumption"]
    assert teq["tag"] == "derived" and "(1/4)^(1/4)" in teq["formula"]
    assert "calculated value" in radius["source"] and "calculated value" in teq["source"]

    oid = resolve_id(client, "Proxima Cen b")
    params = client.get(f"/v1/objects/{oid}/render-params").json()
    assert params["type"] == "candidate" and "type:exoplanet_radius" in params["missing"]


def test_card_to_params_lists_refusal_reason() -> None:
    card = {"id": "x", "name": "x", "type": "candidate"}
    p = card_to_params(card, seed=1, extra_missing=("type:exoplanet_mass",))
    assert "type:exoplanet_mass" in p["missing"]
