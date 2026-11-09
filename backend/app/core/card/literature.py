"""Literature registry: reviewed values for objects the catalogues leave empty (A3.11, Q-153).

``backend/assets/literature.toml`` is curated, read-only config, in the same spirit as the shape
registry (``assets/shapes/registry.toml``) and ``targets.toml``. It is not a model output and no
code writes it. Stage 4 (``build.py``) fills a card field from it **only when the catalogue value
is null**; it never overrides a catalogue value. A row that breaks a rule below is skipped with a
warning, never trusted.

Rules (checked on load):

- ``key``: the SBDB SPK-ID for a small body; the card's object id (for example
  ``simbad-eps-ind-b``) for anything else, because stars and brown dwarfs have no SPK-ID.
- ``tag`` is one of the five provenance tags and follows the source: a measurement is
  ``measured``; a number computed from an assumed input is ``model_dependent`` with the input in
  ``assumption``; ``derived`` needs a ``formula``.
- ``citation`` (paper and table or section) is required. ``source`` on the card reads
  ``literature: <citation>``.
- A ``[[refusal]]`` row keeps a field refused and gives the reason, for a published number that
  does not map onto the field.
"""

from __future__ import annotations

import logging
import math
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("shift_spectrum")

TAGS = frozenset({"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"})


@dataclass(frozen=True)
class LiteratureValue:
    key: str
    field: str
    value: float | list[float]
    tag: str
    citation: str
    table: str
    note: str
    err: float | list[float] | None = None
    formula: str | None = None
    assumption: str | None = None

    def to_tv(self) -> dict[str, Any]:
        """The card's tagged value (R3.1). ``source`` starts with ``literature:`` (Q-153)."""
        where = f", {self.table}" if self.table else ""
        source = f"literature: {self.citation}{where} (backend/assets/literature.toml)"
        if self.note:
            source += f". {self.note}"
        out: dict[str, Any] = {"value": self.value, "tag": self.tag, "source": source}
        if self.err is not None:
            out["err"] = self.err
        if self.formula:
            out["formula"] = self.formula
        if self.assumption:
            out["assumption"] = self.assumption
        return out


@dataclass(frozen=True)
class Literature:
    """The rows for one object: ``values`` by card field, ``refusals`` (field -> reason)."""

    values: dict[str, LiteratureValue]
    refusals: dict[str, str]

    def tv(self, field: str) -> dict[str, Any] | None:
        v = self.values.get(field)
        return v.to_tv() if v is not None else None


EMPTY = Literature({}, {})


def _finite(x: object) -> bool:
    return isinstance(x, int | float) and not isinstance(x, bool) and math.isfinite(float(x))


def _number_or_list(x: object) -> float | list[float] | None:
    if _finite(x):
        return float(x)  # type: ignore[arg-type]
    if isinstance(x, list) and x and all(_finite(c) for c in x):
        return [float(c) for c in x]
    return None


def _parse_value(r: dict[str, Any]) -> LiteratureValue:
    value = _number_or_list(r["value"])
    if value is None:
        raise ValueError("value must be a finite number or a list of them")
    tag = str(r["tag"])
    if tag not in TAGS:
        raise ValueError(f"unknown tag {tag!r}")
    citation = str(r["citation"]).strip()
    if not citation:
        raise ValueError("citation is required")
    formula = str(r["formula"]).strip() if r.get("formula") else None
    assumption = str(r["assumption"]).strip() if r.get("assumption") else None
    if tag == "derived" and not formula:
        raise ValueError("derived needs a formula")
    if tag == "model_dependent" and not assumption:
        raise ValueError("model_dependent needs an assumption")
    err = _number_or_list(r["err"]) if "err" in r else None
    if "err" in r and err is None:
        raise ValueError("err must be a finite number or a list of them")
    return LiteratureValue(
        key=str(r["key"]),
        field=str(r["field"]),
        value=value,
        tag=tag,
        citation=citation,
        table=str(r.get("table", "")).strip(),
        note=str(r.get("note", "")).strip(),
        err=err,
        formula=formula,
        assumption=assumption,
    )


# path -> ((mtime_ns, size), rows). The file changes by hand, so reuse the parse until it does.
_CACHE: dict[Path, tuple[tuple[int, int], dict[str, Literature]]] = {}


def _parse_file(path: Path) -> dict[str, Literature]:
    try:
        doc = tomllib.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as e:
        log.warning("literature registry %s unreadable, no literature values: %s", path, e)
        return {}
    values: dict[str, dict[str, LiteratureValue]] = {}
    refusals: dict[str, dict[str, str]] = {}
    for r in doc.get("value", []):
        try:
            v = _parse_value(r)
        except (KeyError, ValueError, TypeError, AttributeError) as e:
            log.warning("literature row skipped (%s): %r", e, r)
            continue
        values.setdefault(v.key, {})[v.field] = v
    for r in doc.get("refusal", []):
        try:
            refusals.setdefault(str(r["key"]), {})[str(r["field"])] = str(r["reason"]).strip()
        except (KeyError, TypeError, AttributeError) as e:
            log.warning("literature refusal skipped (%s): %r", e, r)
    keys = values.keys() | refusals.keys()
    return {k: Literature(values.get(k, {}), refusals.get(k, {})) for k in keys}


def load_literature(path: Path, key: str | None) -> Literature:
    """The registry rows for ``key`` (an SPK-ID or an object id); empty when there are none or
    the file is missing or broken. Never raises."""
    if key is None:
        return EMPTY
    try:
        st = path.stat()
    except OSError:
        return EMPTY
    stamp = (st.st_mtime_ns, st.st_size)
    hit = _CACHE.get(path)
    if hit is None or hit[0] != stamp:
        hit = (stamp, _parse_file(path))
        _CACHE[path] = hit
    return hit[1].get(key, EMPTY)
