"""Shared fixtures against the real JSON Schemas (A12, D-18).

The generated Pydantic models drop the R3.1 if/then rules, so validation uses ``jsonschema``.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, get_args

import jsonschema
import pytest
from pydantic import BaseModel, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

from app.api.models import Tag as ApiTag
from app.contract.area_checks_schema import AreaChecks
from app.contract.area_dots_schema import AreaDots
from app.contract.area_index_schema import AreaIndex
from app.contract.area_job_schema import LiveAreaJob
from app.contract.area_known_schema import AreaKnown
from app.contract.area_live_plan_schema import LiveAreaPlan
from app.contract.area_summary_schema import AreaSummary
from app.contract.area_tracks_schema import AreaTracks
from app.contract.object_card_schema import ObjectCard
from app.contract.render_params_schema import RenderParams
from app.contract.run_list_schema import RunList
from app.contract.run_results_schema import RunResults
from app.contract.run_schema import Run
from app.contract.scan_plan_schema import ScanPlan
from app.contract.track_path_schema import TrackPath
from app.settings import BACKEND_DIR

SHARED = BACKEND_DIR.parent / "shared"
SHADER_KINDS = {"planet_rocky", "planet_water", "gas_giant", "nebula", "nova"}
ALL_ARTISTIC_KINDS = {"nebula", "nova"}
SYNTHETIC = "synthetic fixture"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CARD_SCHEMA = _load(SHARED / "schemas" / "object-card.schema.json")
PARAMS_SCHEMA = _load(SHARED / "schemas" / "render-params.schema.json")
OBJECT_TYPES: list[str] = CARD_SCHEMA["definitions"]["ObjectType"]["enum"]
TAGS: list[str] = CARD_SCHEMA["definitions"]["Tag"]["enum"]
TV_DEFINITIONS = ["TVNumber", "TVString", "TVRgb", "TVVec3", "TVPair"]

# Issue #68 Part 6: two extra `planet_rocky` fixtures with real archive values sit beside the
# one-per-type set; they are checked on their own below.
DEMO_PLANETS = ["planet_kepler186f", "planet_trappist1f"]
DEMO_ASTEROIDS = ["asteroid_shape_bennu"]  # Part 8a: the real Bennu model beside Eros
EXTRA = [*DEMO_PLANETS, *DEMO_ASTEROIDS]
_ALL_CARDS = {p.stem: _load(p) for p in sorted((SHARED / "fixtures" / "cards").glob("*.json"))}
_ALL_PARAMS = {p.stem: _load(p) for p in sorted((SHARED / "fixtures" / "params").glob("*.json"))}
CARDS = {k: v for k, v in _ALL_CARDS.items() if k not in EXTRA}
PARAMS = {k: v for k, v in _ALL_PARAMS.items() if k not in EXTRA}
INVALID = _load(SHARED / "fixtures" / "invalid" / "cases.json")

# Every schema in shared/schemas/, keyed by its $id without ".schema.json" (the card, the params
# and the six Area search schemas, A17.9).
SCHEMAS = {
    schema["$id"].removesuffix(".schema.json"): schema
    for schema in (_load(p) for p in sorted((SHARED / "schemas").glob("*.schema.json")))
}
_REGISTRY: Registry[Any] = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema, default_specification=DRAFT7))
    for schema in SCHEMAS.values()
)
VALIDATORS = {
    name: jsonschema.Draft7Validator(schema, registry=_REGISTRY) for name, schema in SCHEMAS.items()
}
MODELS: dict[str, type[BaseModel]] = {
    "object-card": ObjectCard,
    "render-params": RenderParams,
    "area-index": AreaIndex,
    "area-summary": AreaSummary,
    "area-known": AreaKnown,
    "area-dots": AreaDots,
    "area-tracks": AreaTracks,
    "area-checks": AreaChecks,
    "area-job": LiveAreaJob,
    "area-live-plan": LiveAreaPlan,
    "track-path": TrackPath,
    "run": Run,
    "run-list": RunList,
    "run-results": RunResults,
    "scan-plan": ScanPlan,
}


def _tagged(node: Any) -> Iterator[dict[str, Any]]:
    """Every tagged value (TV) inside a card or params object."""
    if isinstance(node, list):
        for item in node:
            yield from _tagged(item)
    elif isinstance(node, dict):
        if "value" in node and "tag" in node:
            yield node
        for item in node.values():
            yield from _tagged(item)


def _with_context(error: jsonschema.ValidationError) -> Iterator[jsonschema.ValidationError]:
    """An error and, for ``anyOf``, the errors of each branch."""
    yield error
    for child in error.context or []:
        yield from _with_context(child)


def _is_provenance_rule(case: dict[str, Any]) -> bool:
    """The R3.1 if/then rules, which the generators drop.

    ``const`` is the tier that must match the tag (D-32); a ``pattern`` counts only on a
    ``formula`` or ``assumption`` (the non-blank rule), because other patterns (ids, times,
    missing codes) are real field constraints that the models keep.
    """
    expect = case["expect"]
    path = expect["path"]
    return (
        expect["keyword"] == "const"
        or (expect["keyword"] == "pattern" and path.endswith(("/formula", "/assumption")))
        or expect.get("detail") in {"formula", "assumption", "assumed"}
    )


def test_schemas_are_valid_draft7() -> None:
    assert sorted(SCHEMAS) == sorted(MODELS)
    for schema in SCHEMAS.values():
        jsonschema.Draft7Validator.check_schema(schema)


def test_one_card_and_one_params_fixture_per_object_type() -> None:
    assert sorted(CARDS) == sorted(OBJECT_TYPES)
    assert sorted(PARAMS) == sorted(OBJECT_TYPES)


def test_demo_planets_are_extra_fixtures() -> None:
    assert sorted(_ALL_CARDS) == sorted([*OBJECT_TYPES, *EXTRA])
    assert sorted(_ALL_PARAMS) == sorted([*OBJECT_TYPES, *EXTRA])


def test_bennu_fixture_pair_validates_and_names_its_real_source() -> None:
    card, params = _ALL_CARDS["asteroid_shape_bennu"], _ALL_PARAMS["asteroid_shape_bennu"]
    VALIDATORS["object-card"].validate(card)
    VALIDATORS["render-params"].validate(params)
    assert card["type"] == params["type"] == "asteroid_shape"
    assert card["id"] == params["id"]
    assert card["shape_source"]["value"] == "/data/shapes/bennu-spo-v54.glb"
    for tv in _tagged(card):
        assert str(tv.get("source", "")).startswith("synthetic fixture: real 101955 Bennu value, ")


@pytest.mark.parametrize("name", DEMO_PLANETS)
def test_demo_planet_pair_validates_and_round_trips(name: str) -> None:
    card, params = _ALL_CARDS[name], _ALL_PARAMS[name]
    VALIDATORS["object-card"].validate(card)
    VALIDATORS["render-params"].validate(params)
    assert card["type"] == params["type"] == "planet_rocky"
    assert card["id"] == params["id"]
    dump = {"mode": "json", "exclude_unset": True, "by_alias": True}
    assert ObjectCard.model_validate(card).model_dump(**dump) == card
    assert RenderParams.model_validate(params).model_dump(**dump) == params
    # Every value is a real archive value and says so (the Q-114 pattern).
    for tv in _tagged(card):
        assert str(tv.get("source", "")).startswith("synthetic fixture: real ")


def test_api_tag_literal_matches_the_schema() -> None:
    assert list(get_args(ApiTag)) == TAGS


def test_every_tagged_value_definition_has_the_same_rules() -> None:
    """The schema repeats the TV body per payload (no generics); only ``value`` may differ."""
    bodies = []
    for name in TV_DEFINITIONS:
        body = json.loads(json.dumps(CARD_SCHEMA["definitions"][name]))
        for key in ("title", "description"):
            del body[key]
        del body["properties"]["value"]
        bodies.append(body)
    assert all(body == bodies[0] for body in bodies)


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_fixture_pair_validates_and_agrees(object_type: str) -> None:
    card, params = CARDS[object_type], PARAMS[object_type]
    VALIDATORS["object-card"].validate(card)
    VALIDATORS["render-params"].validate(params)
    assert card["type"] == params["type"] == object_type
    assert card["id"] == params["id"]


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_fixture_pair_round_trips_through_the_generated_models(object_type: str) -> None:
    # exclude_unset is the only dump that matches the schema: a plain dump adds null for every unset
    # field, and exclude_none drops the required `value: null` and `scale_m: null` (Q-40).
    # by_alias: `components[].class` is `class_` in Python (a keyword) and `class` on the wire.
    card, params = CARDS[object_type], PARAMS[object_type]
    dump = {"mode": "json", "exclude_unset": True, "by_alias": True}
    assert ObjectCard.model_validate(card).model_dump(**dump) == card
    assert RenderParams.model_validate(params).model_dump(**dump) == params


@pytest.mark.parametrize("case", INVALID, ids=[case["name"] for case in INVALID])
def test_invalid_case_is_rejected_for_its_stated_reason(case: dict[str, Any]) -> None:
    errors = list(VALIDATORS[case["schema"]].iter_errors(case["instance"]))
    assert len(errors) == 1  # the stated defect, and nothing else wrong with the instance
    expect = case["expect"]
    assert any(
        "".join(f"/{part}" for part in error.absolute_path) == expect["path"]
        and error.validator == expect["keyword"]
        and expect.get("detail", "") in error.message
        for error in _with_context(errors[0])
    )


@pytest.mark.parametrize("case", INVALID, ids=[case["name"] for case in INVALID])
def test_generated_models_enforce_all_but_the_provenance_rules(case: dict[str, Any]) -> None:
    """Pydantic drops the R3.1 if/then rules, so it alone cannot guard a live reply (Q-40)."""
    model = MODELS[case["schema"]]
    # `dropped_by_models`: another schema-only rule (the area checks' per-ticket if/then).
    if _is_provenance_rule(case) or case.get("dropped_by_models", False):
        model.model_validate(case["instance"])
    else:
        with pytest.raises(ValidationError):
            model.model_validate(case["instance"])


@pytest.mark.parametrize(
    ("tagged", "accepted"),
    [
        ({"tag": "derived", "formula": "a*b"}, True),
        ({"tag": "derived", "formula": " \t"}, False),
        ({"tag": "model_dependent", "assumption": "  "}, False),
        ({"tag": "measured", "formula": "  "}, True),  # same as assertTagged: tag rules only
    ],
)
def test_blank_rules_match_assert_tagged(tagged: dict[str, str], accepted: bool) -> None:
    card = {"id": "fixture:t", "name": "t", "type": "candidate"}
    albedo = {"value": 1.0, "source": SYNTHETIC, **tagged}
    assert VALIDATORS["object-card"].is_valid({**card, "albedo": albedo}) is accepted


def test_generated_models_refuse_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ObjectCard.model_validate({**CARDS["candidate"], "made_up": 1})
    with pytest.raises(ValidationError):
        RenderParams.model_validate({**PARAMS["candidate"], "made_up": 1})


# Fixture honesty: nothing here may be mistaken for a real result (CLAUDE.md, data first).


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_fixture_is_unmistakably_synthetic(object_type: str) -> None:
    card, params = CARDS[object_type], PARAMS[object_type]
    assert card["id"] == f"fixture:{object_type}"
    assert card["name"].startswith(f"{SYNTHETIC.capitalize()}: ")
    assert params["alt_text"].startswith(f"{SYNTHETIC.capitalize()}. ")
    assert params["generator_version"].startswith("fixture-")
    for value in _tagged([card, params]):
        assert value["source"].startswith(f"{SYNTHETIC}: ")


def _dynamics_values(params: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    dynamics = params.get("dynamics", {})
    return [(k, v) for k, v in dynamics.items() if k != "speedup"]


# DynamicsValue has no assertTagged twin: its model_dependent rule is `assumed` (D-32).
_SPEEDUP_NEEDS = {
    "spin": {"spin_period_h"},
    "spots": {"spot_lifetime_d"},
    "flares": {"flare_rate_per_d"},
    "winds": {"jet_speed_ms"},
    "clouds": {"jet_speed_ms", "diff_rotation", "spin_period_h"},
    "pulsation": {"pulsation_period_d"},
}


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_every_params_fixture_has_dynamics_with_matching_speedup(object_type: str) -> None:
    params = PARAMS[object_type]
    assert "speedup" in params["dynamics"]
    present = {key for key, _ in _dynamics_values(params)}
    for process in params["dynamics"]["speedup"]:
        assert _SPEEDUP_NEEDS[process] & present, process  # only animated processes are sped up
    for _key, value in _dynamics_values(params):
        assert value["source"].startswith(f"{SYNTHETIC}: ")
        assert value["tier"] == TAGS.index(value["tag"]) + 1
    for item in params["missing"]:
        if item.startswith("dynamics:"):
            assert item.removeprefix("dynamics:") not in present


# Card fields that measure a dynamics rate directly, in the same unit (R3.4).
_CARD_FIELD_OF_RATE = {"spin_period_h": "rot_period_h", "pulsation_period_d": "period_var_d"}


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_measured_card_rate_wins_and_tier_1_needs_one(object_type: str) -> None:
    """D-32: the first rung that answers wins, so a measured card value is the tier 1 rate; and a
    tier 1 rate is never measured anywhere but on the card (R3.4)."""
    card, rates = CARDS[object_type], dict(_dynamics_values(PARAMS[object_type]))
    for key, field in _CARD_FIELD_OF_RATE.items():
        tv = card.get(field)
        if isinstance(tv, dict) and tv.get("tag") == "measured" and tv.get("value") is not None:
            assert key in rates, key
            assert (rates[key]["value"], rates[key]["tier"]) == (tv["value"], 1), key
    for key, value in rates.items():
        if value["tier"] == 1:
            field = _CARD_FIELD_OF_RATE.get(key)
            assert field is not None, f"{key}: no card field can measure it"
            assert card.get(field, {}).get("tag") == "measured", key


def test_layer_and_dynamics_value_share_the_tier_rules() -> None:
    """The tier/formula/assumed rules are written out twice (no generics); they must not drift."""
    schema = PARAMS_SCHEMA["definitions"]
    assert schema["Layer"]["allOf"] == schema["DynamicsValue"]["allOf"]
    for key in ("tier", "formula", "assumed"):
        assert schema["Layer"]["properties"][key] == schema["DynamicsValue"]["properties"][key]


def test_fixtures_exercise_every_tier_and_a_dynamics_refusal() -> None:
    tiers = {
        v["tier"]
        for p in PARAMS.values()
        for v in [*p["layers"], *dict(_dynamics_values(p)).values()]
    }
    assert tiers == {1, 2, 3, 4, 5}
    dyn_tiers = {v["tier"] for p in PARAMS.values() for _, v in _dynamics_values(p)}
    assert dyn_tiers == {1, 2, 3, 4, 5}
    assert any(item.startswith("dynamics:") for p in PARAMS.values() for item in p["missing"])


def test_fixtures_exercise_every_tag() -> None:
    tags = {value["tag"] for value in _tagged(list(CARDS.values()))}
    assert tags == set(TAGS)


# Per-type rules from the specs.


@pytest.mark.parametrize("object_type", sorted(ALL_ARTISTIC_KINDS))
def test_nebula_and_nova_are_all_artistic(object_type: str) -> None:
    card, params = CARDS[object_type], PARAMS[object_type]
    assert {value["tag"] for value in _tagged([card, params])} == {"artistic"}  # D-12
    assert {layer["tag"] for layer in params["layers"]} == {"artistic"}
    assert {params["haptics"]["texture_tag"], params["haptics"]["data_tag"]} == {"artistic"}


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_textures_follow_d01_and_r67(object_type: str) -> None:
    params = PARAMS[object_type]
    if object_type in SHADER_KINDS:
        assert "textures" not in params  # D-01: drawn by browser shaders
        return
    textures = params.get("textures", {})
    prefix = f"/data/textures/{params['id']}/{params['generator_version']}/{params['seed']}/"
    assert all(url.startswith(prefix) for url in textures.values() if isinstance(url, str))
    if params["haptics"]["texture"] == "height":
        assert "height_bin" in textures  # R8.4: the height-map source samples height.bin


def test_candidate_has_no_3d_body() -> None:
    params = PARAMS["candidate"]
    assert params["layers"] == []
    assert params["scale_m"] is None
    assert "mesh" in params["missing"]


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_unknown_size_refuses_the_body(object_type: str) -> None:
    params = PARAMS[object_type]
    assert (params["scale_m"] is None) == ("mesh" in params["missing"])  # Q-33, R11


@pytest.mark.parametrize("object_type", ["planet_rocky", "planet_water", "gas_giant"])
def test_teq_pulse_follows_teq_k(object_type: str) -> None:
    teq, params = CARDS[object_type]["teq_K"], PARAMS[object_type]
    if teq["value"] is None:  # D-12: refused and listed
        assert "teq_pulse" in params["missing"]
        assert params["haptics"]["data"] == "none"
    else:
        assert params["haptics"]["data"] == "teq_pulse"
        assert params["haptics"]["data_tag"] == teq["tag"]


def test_a_fixture_has_a_refused_teq_pulse() -> None:
    assert CARDS["planet_rocky"]["teq_K"]["value"] is None
    assert "teq_pulse" in PARAMS["planet_rocky"]["missing"]


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_layers_only_use_present_data(object_type: str) -> None:
    """Refuse rather than invent: a drawn layer's required card fields exist and are known."""
    card, params = CARDS[object_type], PARAMS[object_type]
    for layer in params["layers"]:
        for name in layer["requires"]:
            assert name in CARD_SCHEMA["properties"]
            field = card.get(name)
            assert field is not None
            assert not isinstance(field, dict) or field.get("value", True) is not None
    assert not {layer["id"] for layer in params["layers"]} & set(params["missing"])


@pytest.mark.parametrize("object_type", OBJECT_TYPES)
def test_view_modes_follow_d23_and_r52(object_type: str) -> None:
    params = PARAMS[object_type]
    modes = params["view_modes"]
    assert "channels_um" not in modes["visible"]  # D-23: IRMode only
    for key, mode in modes.items():
        assert (mode["rgb"] is not None) == mode["available"]
        assert (key in params["missing"]) == (not mode["available"])  # D-23
