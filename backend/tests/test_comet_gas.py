"""Issue #71 stream F: 3I/ATLAS gas by epoch (Q-42, Q-260), the Horizons path (Q-261) and the tail
layers (Q-263). The committed demo asset is the card under test."""

from __future__ import annotations

import copy
import json
import math
import tomllib
from pathlib import Path
from typing import Any

from app.core.card.literature import load_literature
from app.core.render.card_to_params import card_to_params
from tests.test_card_to_params import errors

ASSETS = Path(__file__).resolve().parent.parent / "assets"
ASSET = json.loads((ASSETS / "comet" / "sbdb-1004083.json").read_text("utf-8"))
CARD: dict[str, Any] = ASSET["card"]


def params(card: dict[str, Any]) -> dict[str, Any]:
    return card_to_params(card, seed=ASSET["seed"], generator_version=ASSET["generator_version"])


def test_published_rates_are_loaded_with_their_errors() -> None:
    q = CARD["gas_Q"]
    assert q["2025-08"]["h2o"]["value"] == 3.2e26
    assert math.isclose(q["2025-08"]["co2"]["err"], 1.6e26)
    assert q["2025-08"]["co"]["value"] == 1.0e26
    assert q["2025-12"]["h2o"]["value"] == 1.4e28
    assert q["2025-12"]["co"]["value"] == 7.6e27
    assert CARD["epochs"] == ["2025-08", "2025-12"]
    assert CARD["coma_radius_km"]["value"] == 4.2e5
    assert CARD["nucleus_radius_km_max"]["value"] == 2.5
    for epoch in q.values():
        for tv in epoch.values():
            assert tv["tag"] == "measured" and tv["source"].startswith("literature: ")


def test_december_rows_are_version_two_only() -> None:
    """Version 1 of arXiv:2601.06759 gave Q(H2O) about 6e27; nothing from it may be loaded."""
    text = (ASSETS / "literature.toml").read_text("utf-8")
    rows = tomllib.loads(text)["value"]
    dec = [r for r in rows if r["field"].startswith("gas_Q.2025-12.")]
    assert len(dec) == 3 and all("v2" in r["citation"] for r in dec)
    assert not any(r["value"] == 6e27 for r in rows)


def test_literature_loader_exposes_the_epoch_fields() -> None:
    lit = load_literature(ASSETS / "literature.toml", "1004083")
    assert lit.tv("gas_Q.2025-08.h2o") is not None
    assert lit.tv("gas_Q.2025-12.h2o2") is None


def test_params_validate_and_carry_the_tail_layers() -> None:
    p = params(CARD)
    assert errors(p, "render-params.schema.json") == []
    by = {layer["id"]: layer for layer in p["layers"]}
    assert by["gas_shells"]["tag"] == "model_dependent"
    assert by["ion_tail"]["tag"] == "derived" and by["ion_tail"]["formula"]
    assert by["dust_tail"]["tag"] == "model_dependent"
    assert "beta_values" in by["dust_tail"]["assumed"]
    assert "gas_shells" not in p["missing"]


def test_track_is_horizons_and_perihelion_is_right() -> None:
    rows = CARD["orbit_track"]["value"]
    assert CARD["orbit_track"]["tag"] == "derived" and CARD["orbit_track"]["formula"]
    assert all(len(r) == 7 for r in rows)
    r = [math.dist((0, 0, 0), row[1:4]) for row in rows]
    assert math.isclose(min(r), 1.357, abs_tol=0.01)  # q = 1.356 au (JPL SBDB)


def test_a_comet_without_a_track_has_no_tail_rows_and_a_broken_track_refuses() -> None:
    plain = copy.deepcopy(CARD)
    del plain["orbit_track"]
    ids = {layer["id"] for layer in params(plain)["layers"]} | set(params(plain)["missing"])
    assert "ion_tail" not in ids and "dust_tail" not in ids
    broken = copy.deepcopy(CARD)
    broken["orbit_track"]["value"] = [[1.0, 0, 0]]
    p = params(broken)
    assert {"ion_tail", "dust_tail"} <= set(p["missing"])


def test_one_epoch_only_card_keeps_the_flat_rule() -> None:
    card = copy.deepcopy(CARD)
    card["gas_Q"] = card["gas_Q"]["2025-12"]
    card["epochs"] = ["2025-08", "2025-12"]
    assert "gas_shells" in params(card)["missing"]  # one set of values, two epochs: refused (Q-42)
