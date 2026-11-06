"""Exoplanet Archive adapter and the Q-63 type rule (A3.8, R3.3 step 4), offline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.adapters import exoplanet_archive as ea
from app.core.card.validate import errors
from app.core.classify import EXOPLANET_THRESHOLDS, CatalogueFacts, classify, classify_exoplanet
from app.core.classify.zeng2019 import (
    EARTHLIKE_ROCKY,
    PURE_WATER_300K,
    radius_on_curve,
    water_curve_for,
)
from app.core.render.card_to_params import card_to_params
from tests.test_api import resolve_id


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


def test_rule_radius_missing() -> None:
    giant = 0.414 * 317.83
    assert kind(pl_bmasse=giant + 1, pl_bmassprov="Mass")[0] == "gas_giant"
    assert kind(pl_bmasse=giant - 1, pl_bmassprov="Mass") == (None, ("type:exoplanet_radius",))
    assert kind(pl_bmasse=giant + 1, pl_bmassprov="Msini")[1] == ("type:exoplanet_radius",)
    assert kind()[1] == ("type:exoplanet_radius",)


def test_rule_text_states_comparison() -> None:
    _, _, rule = classify_exoplanet(
        row(pl_rade=2.37, pl_bmasse=8.92, pl_bmassprov="Mass", pl_eqt=284.0)
    )
    assert "1.5<=R<6" in rule and "Zeng 2019" in rule and "300 K" in rule


def test_thresholds_block_is_single_source(monkeypatch: pytest.MonkeyPatch) -> None:
    assert all(isinstance(v, float) for v in EXOPLANET_THRESHOLDS.values())
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
    assert "type:exoplanet_thresholds" not in params["missing"]
    if want == "candidate":
        assert "type:exoplanet_envelope" in params["missing"]
        return
    assert card["radius_rjup"]["tag"] == "measured" and card["radius_rjup"]["value"] > 0
    assert "Exoplanet Archive" in card["radius_rjup"]["source"]
    assert card["teq_K"]["tag"] in ("measured", "derived")
    assert params["scale_m"] > 0
    assert "spectrum" in params["missing"]  # no SPHEREx frames recorded: null with a reason


def test_card_to_params_lists_refusal_reason() -> None:
    card = {"id": "x", "name": "x", "type": "candidate"}
    p = card_to_params(card, seed=1, extra_missing=("type:exoplanet_mass",))
    assert "type:exoplanet_mass" in p["missing"]
