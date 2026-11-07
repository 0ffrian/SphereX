"""Validate cards and render params against ``shared/schemas/`` with a real validator (Q-40).

The generated Pydantic models (D-18) cannot express the R3.1 ``formula``/``assumption`` rules
and accept NaN, so every reply is checked with ``jsonschema`` (draft-07) before it is sent.
Not in ``app/contract/``: that directory is regenerated and must hold generated files only.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

from app.settings import BACKEND_DIR

SCHEMAS_DIR = BACKEND_DIR.parent / "shared" / "schemas"
CARD_SCHEMA = "object-card.schema.json"
PARAMS_SCHEMA = "render-params.schema.json"


class ContractViolation(ValueError):
    """A reply this backend built does not match the shared schema. A bug, never user error."""


@lru_cache(maxsize=1)
def _validators(schemas_dir: Path = SCHEMAS_DIR) -> dict[str, Draft7Validator]:
    docs = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in schemas_dir.glob("*.json")}
    registry: Registry[Any] = Registry().with_resources(
        (d["$id"], Resource.from_contents(d, default_specification=DRAFT7)) for d in docs.values()
    )
    return {name: Draft7Validator(doc, registry=registry) for name, doc in docs.items()}


def errors(instance: Any, schema: str) -> list[str]:
    v = _validators()[schema]
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in sorted(v.iter_errors(instance), key=lambda e: list(map(str, e.absolute_path)))
    ]


def check(instance: Any, schema: str) -> None:
    errs = errors(instance, schema)
    if errs:
        raise ContractViolation(f"{schema}: {'; '.join(errs[:5])}")


def check_card(card: Any) -> None:
    check(card, CARD_SCHEMA)


def check_params(params: Any) -> None:
    check(params, PARAMS_SCHEMA)
