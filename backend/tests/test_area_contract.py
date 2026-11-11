"""The six Area search schemas and their generated models (A17.8, A17.9, D-18, Q-208).

Validation uses ``jsonschema``: the generated Pydantic models drop the provenance if/then rules
(Q-40), so P7 checks its replies with ``app/core/card/validate.py``, never the models alone.
"""

from __future__ import annotations

import json
import re
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
from app.contract.area_index_schema import AreaError, AreaIndex
from app.contract.area_known_schema import AreaKnown
from app.contract.area_summary_schema import AreaSummary
from app.contract.area_tracks_schema import AreaTracks
from app.core.card import validate
from app.settings import BACKEND_DIR

SHARED = BACKEND_DIR.parent / "shared"
AREA = SHARED / "fixtures" / "area"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


SCHEMAS = {p.name: _load(p) for p in sorted((SHARED / "schemas").glob("*.schema.json"))}
_REGISTRY: Registry[Any] = Registry().with_resources(
    (s["$id"], Resource.from_contents(s, default_specification=DRAFT7)) for s in SCHEMAS.values()
)
SHARED_DEFS = SCHEMAS["area-index.schema.json"]["definitions"]
MODELS: dict[str, type[BaseModel]] = {
    "index": AreaIndex,
    "summary": AreaSummary,
    "known": AreaKnown,
    "dots": AreaDots,
    "tracks": AreaTracks,
    "checks": AreaChecks,
}
FILES = sorted(
    (p.relative_to(AREA).as_posix(), p.stem) for p in AREA.rglob("*.json") if p.stem in MODELS
)


def _validator(name: str) -> jsonschema.Draft7Validator:
    return jsonschema.Draft7Validator(SCHEMAS[f"area-{name}.schema.json"], registry=_REGISTRY)


def _def_validator(definition: str) -> jsonschema.Draft7Validator:
    schema = {"$ref": f"area-index.schema.json#/definitions/{definition}"}
    return jsonschema.Draft7Validator(schema, registry=_REGISTRY)


def test_every_area_reply_has_a_fixture() -> None:
    assert sorted({kind for _, kind in FILES}) == sorted(MODELS)
    assert len(FILES) == 11  # index + 5 replies for each of the two areas


@pytest.mark.parametrize(("rel", "kind"), FILES)
def test_fixture_validates(rel: str, kind: str) -> None:
    data = _load(AREA / rel)
    _validator(kind).validate(data)
    assert validate.errors(data, f"area-{kind}.schema.json") == []


@pytest.mark.parametrize(("rel", "kind"), FILES)
def test_fixture_round_trips_through_the_generated_model(rel: str, kind: str) -> None:
    data = _load(AREA / rel)
    dump = (
        MODELS[kind].model_validate(data).model_dump(mode="json", exclude_unset=True, by_alias=True)
    )
    assert dump == data
    # The same JSON text, so a float stays a float (5.0, not 5) on the way through.
    assert json.dumps(dump) == json.dumps(data)


@pytest.mark.parametrize("kind", sorted(MODELS))
def test_models_refuse_unknown_fields(kind: str) -> None:
    rel = next(r for r, k in FILES if k == kind)
    with pytest.raises(ValidationError):
        MODELS[kind].model_validate({**_load(AREA / rel), "made_up": 1})


@pytest.mark.parametrize(
    ("body", "ok"),
    [
        ({"error": "area_not_found", "detail": "No prepared area fixture:x."}, True),
        ({"error": "dot_not_found", "detail": "x"}, True),
        ({"error": "stamp_unavailable", "detail": "x"}, True),
        ({"error": "not_found", "detail": "x"}, False),
        ({"error": "area_not_found", "detail": ""}, False),
        ({"error": "area_not_found"}, False),
    ],
)
def test_error_body(body: dict[str, str], ok: bool) -> None:
    assert _def_validator("AreaError").is_valid(body) is ok
    if ok:
        AreaError.model_validate(body)
    else:
        with pytest.raises(ValidationError):
            AreaError.model_validate(body)


def test_area_tags_are_card_tags_without_artistic() -> None:
    area_tags = SHARED_DEFS["AreaTag"]["enum"]
    assert set(area_tags) < set(get_args(ApiTag))
    assert "artistic" not in area_tags and "inferred_from_analog" not in area_tags


def test_planted_dot_is_a_dot_without_id_and_label() -> None:
    defs = SCHEMAS["area-checks.schema.json"]["definitions"]
    dot = dict(SCHEMAS["area-dots.schema.json"]["definitions"]["AreaDot"]["properties"])
    del dot["dot_id"], dot["label"]
    planted = defs["AreaPlantedDot"]
    assert planted["properties"] == dot
    assert planted["required"] == list(dot)


def test_provenance_objects_are_closed() -> None:
    for name, schema in SCHEMAS.items():
        if not name.startswith("area-"):
            continue
        for title, definition in schema["definitions"].items():
            if title.endswith("Provenance"):
                assert definition["additionalProperties"] is False, title


@pytest.mark.parametrize(
    ("code", "ok"),
    [
        ("checks:not_run", True),
        ("rate_grid:visits", True),
        ("area:visits", True),
        ("frames:cone_maxrec:3", True),
        ("no_footprint:2025W35_2A_0023_4_D1", True),
        ("cutout:fixture-area-main-v1e1-D1", True),
        ("stars:gaia:1", True),
        ("stars:wise:2", True),
        ("skybot:2", True),
        ("horizons:433 Eros (A898 PA)", True),
        ("stamp:fixture-area-main-v1e1-D1:12", True),
        ("skybot:all", False),
        ("skybot:0", False),
        ("stars:2mass:1", False),
        ("frames:cone_failed:1", False),  # never stored (A17.1)
        ("area:not_prepared", False),  # decided in the frontend (A17.8)
        ("stamp:fixture-area-main-v1e1-D1", False),
        ("horizons:", False),
        ("checks:not_run ", False),
    ],
)
def test_missing_code_pattern(code: str, ok: bool) -> None:
    assert _def_validator("AreaMissingCode").is_valid(code) is ok
    assert bool(re.fullmatch(SHARED_DEFS["AreaMissingCode"]["pattern"], code)) is ok


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("2026-11-10T12:00:00Z", True),
        ("2026-11-10T12:00:00.000Z", True),
        ("2026-11-10T12:00:00.123456Z", True),
        ("2026-11-10T12:00:00+00:00", False),
        ("2026-11-10T12:00:00", False),
        ("2026-11-10 12:00:00Z", False),
    ],
)
def test_time_pattern(value: str, ok: bool) -> None:
    assert _def_validator("AreaUtcTime").is_valid(value) is ok


@pytest.mark.parametrize(
    ("entry", "ok"),
    [
        ({"tag": "measured"}, True),
        ({"tag": "derived", "formula": "a*b"}, True),
        ({"tag": "derived"}, False),
        ({"tag": "derived", "formula": "  "}, False),
        ({"tag": "model_dependent", "assumption": "orbits"}, True),
        ({"tag": "model_dependent", "formula": "x"}, False),
        ({"tag": "artistic"}, False),
        ({"tag": "measured", "note": "x"}, False),
    ],
)
def test_provenance_entry_rules(entry: dict[str, str], ok: bool) -> None:
    assert _def_validator("AreaProvenanceEntry").is_valid(entry) is ok


@pytest.mark.parametrize(
    ("value", "ok"),
    [([0.0, -90.0], True), ([359.9, 90.0], True), ([360.0, 0.0], False), ([1.0], False)],
)
def test_polygon_vertex_bounds(value: list[float], ok: bool) -> None:
    assert _def_validator("AreaRaDec").is_valid(value) is ok


def test_settings_keep_integers_and_floats_apart() -> None:
    summary = _load(AREA / "summary.json")
    settings = AreaSummary.model_validate(summary).method.settings
    assert type(settings["k_visit"]) is int
    assert type(settings["k_detect"]) is float
    assert type(settings["area_version"]) is str
    assert not _def_validator("AreaSettings").is_valid({"flag": True})
