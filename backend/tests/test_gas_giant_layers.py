"""Issue #62, D-32: the gas giant's tiered layers replace the single artistic `surface`.

Layers: `bands`, `flattening`, `colour`, `storms`, `turbulence`. Tags follow the tier chain."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

import pytest

from app.core.card.validate import errors
from app.core.render import gas_giant as gg
from app.core.render.card_to_params import card_to_params

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
IDS = ["bands", "flattening", "colour", "storms", "turbulence"]


def card() -> dict[str, Any]:
    return copy.deepcopy(json.loads((FIXTURES / "cards" / "gas_giant.json").read_text()))


def layers(c: dict[str, Any]) -> dict[str, dict[str, Any]]:
    p = card_to_params(c, seed=1)
    assert errors(p, "render-params.schema.json") == []
    return {x["id"]: x for x in p["layers"]}


def tv(value: float, tag: str = "measured") -> dict[str, Any]:
    out: dict[str, Any] = {"value": value, "tag": tag, "source": "synthetic fixture: test"}
    if tag == "model_dependent":
        out["assumption"] = "test"
    return out


def test_surface_is_split_into_five_layers_in_order() -> None:
    ls = layers(card())
    assert list(ls) == IDS
    assert "surface" not in ls


def test_tags_without_a_spin_follow_the_tier_chain() -> None:
    ls = layers(card())  # teq_K measured, no rot_period_h
    assert {k: v["tag"] for k, v in ls.items()} == {
        "bands": "model_dependent",
        "flattening": "model_dependent",
        "colour": "derived",
        "storms": "inferred_from_analog",
        "turbulence": "artistic",
    }
    # Tier 3 states the typical inputs it used (D-32); the missing spin is among them.
    assert ls["bands"]["assumed"] == {"rot_period_h": gg.TYPICAL_SPIN_H, "zonal_wind_ms": 50.0}
    assert ls["flattening"]["assumed"] == {
        "rot_period_h": gg.TYPICAL_SPIN_H,
        "mean_density": "same as Jupiter",
    }
    assert ls["bands"]["formula"] and ls["flattening"]["formula"] and ls["colour"]["formula"]
    assert "formula" not in ls["storms"] and "assumed" not in ls["storms"]


def test_a_measured_spin_leaves_only_the_wind_assumed() -> None:
    c = card()
    c["rot_period_h"] = tv(10.0)
    ls = layers(c)
    assert ls["bands"]["requires"] == ["radius_rjup", "rot_period_h"]
    # The card has no wind, so the best tag stays model_dependent, never derived.
    assert ls["bands"]["tag"] == "model_dependent"
    assert ls["bands"]["assumed"] == {"zonal_wind_ms": 50.0}
    assert ls["flattening"]["assumed"] == {"mean_density": "same as Jupiter"}


def test_a_weaker_spin_tag_gives_a_weaker_layer_never_a_stronger_one() -> None:
    c = card()
    c["rot_period_h"] = tv(10.0, "inferred_from_analog")
    ls = layers(c)
    assert ls["bands"]["tag"] == "inferred_from_analog"
    assert ls["flattening"]["tag"] == "inferred_from_analog"


def test_colour_follows_teq_and_falls_back_to_the_artist_default() -> None:
    c = card()
    c["teq_K"] = tv(900.0, "derived")
    assert layers(c)["colour"]["tag"] == "derived"
    c["teq_K"] = tv(900.0, "model_dependent")
    assert layers(c)["colour"]["tag"] == "model_dependent"
    del c["teq_K"]
    colour = layers(c)["colour"]
    assert colour["tag"] == "artistic" and colour["requires"] == []


def test_no_radius_refuses_bands_and_nothing_is_invented() -> None:
    c = card()
    c["radius_rjup"] = {"value": None, "tag": "measured", "source": "synthetic fixture: test"}
    p = card_to_params(c, seed=1)
    assert "bands" in p["missing"] and p["scale_m"] is None
    assert "bands" not in {x["id"] for x in p["layers"]}


def test_a_null_typical_value_refuses_the_layer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The typical values are [verify]: set to None they refuse their layers."""
    monkeypatch.setattr(gg, "TYPICAL_SPIN_H", None)
    p = card_to_params(card(), seed=1)
    assert {"bands", "flattening"} <= set(p["missing"])
    monkeypatch.setattr(gg, "TYPICAL_SPIN_H", 9.925)
    monkeypatch.setattr(gg, "TYPICAL_ZONAL_WIND_MS", None)
    assert "bands" in card_to_params(card(), seed=1)["missing"]


def test_deterministic() -> None:
    a = json.dumps(card_to_params(card(), seed=3), sort_keys=True)
    assert a == json.dumps(card_to_params(card(), seed=3), sort_keys=True)


def test_twin_of_the_frontend_physics() -> None:
    """The numbers `physics/gasGiants.ts` uses, pinned here (A7.2: Jupiter ~ 22)."""
    omega = gg.spin_rate_rad_s(9.925)
    assert omega is not None and omega == pytest.approx(2 * math.pi / (9.925 * 3600))
    n = gg.band_count(omega, gg.R_JUP_M, 50.0)
    assert n is not None and 20 < n < 24
    assert gg.flattening_from_spin(9.925) == pytest.approx(0.06487)
    assert gg.flattening_from_spin(4.9625) == pytest.approx(0.06487 * 4)
    assert gg.spin_rate_rad_s(0) is None and gg.band_count(1e-4, 7e7, 0) is None
