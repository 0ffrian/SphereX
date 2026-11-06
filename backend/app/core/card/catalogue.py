"""Catalogue facts for stage 3 and stage 5: re-read the SIMBAD or SBDB answer that resolve used.

Both calls go through the D-25 read-through cache with the same key resolve used, so they are
cache hits (and work under ``SX_OFFLINE=1``). A miss is not an error: the facts stay empty, the
object is typed ``candidate`` and the reason goes in ``missing``.
"""

from __future__ import annotations

import json
import logging
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.adapters import sbdb, simbad
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.classify import CatalogueFacts
from app.core.find.resolver import ResolvedObject

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ShapeModel:
    """One registry entry (A3.7, Q-61). ``lod0`` is the same-origin mesh path (Q-44)."""

    spkid: str
    name: str
    lod0: str
    lod1: str
    citation: str
    doi: str
    licence: str
    convex: bool

    @property
    def source(self) -> str:
        return f"{self.citation} DOI {self.doi}, licence {self.licence}"


def load_shape_registry(shapes_dir: Path) -> dict[str, ShapeModel]:
    """Read ``registry.toml``. A missing or broken file means no shape models, never a crash."""
    path = shapes_dir / "registry.toml"
    if not path.exists():
        return {}
    try:
        rows = tomllib.loads(path.read_text("utf-8")).get("model", [])
        models = [
            ShapeModel(
                spkid=str(r["spkid"]),
                name=str(r["name"]),
                lod0=str(r["lod0"]),
                lod1=str(r["lod1"]),
                citation=str(r["citation"]),
                doi=str(r["doi"]),
                licence=str(r["licence"]),
                convex=bool(r["convex"]),
            )
            for r in rows
        ]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("shape registry %s unreadable, no shape models: %s", path, e)
        return {}
    return {m.spkid: m for m in models}


@dataclass(frozen=True)
class CatalogueData:
    facts: CatalogueFacts
    simbad_hit: simbad.SimbadHit | None = None
    sbdb_phys: dict[str, dict[str, Any]] = field(default_factory=dict)
    shape: ShapeModel | None = None
    served: tuple[Served, ...] = ()
    missing: tuple[str, ...] = ()


def _sbdb_phys(body: bytes) -> dict[str, dict[str, Any]]:
    try:
        doc = json.loads(body)
    except ValueError:
        return {}
    rows = doc.get("phys_par") if isinstance(doc, dict) else None
    out: dict[str, dict[str, Any]] = {}
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and isinstance(row.get("name"), str):
            out[row["name"]] = row
    return out


def _taxonomy(phys: dict[str, dict[str, Any]]) -> tuple[str | None, str | None]:
    """SMASS (spec_B) first, Tholen (spec_T) second."""
    for key, scheme in (("spec_B", "SMASS"), ("spec_T", "Tholen")):
        row = phys.get(key)
        value = row.get("value") if row else None
        if isinstance(value, str) and value.strip():
            ref = row.get("ref") if row else None
            return value.strip(), f"JPL SBDB {key} ({scheme} taxonomy; {ref or 'no reference'})"
    return None, None


def gather(ctx: Context, obj: ResolvedObject) -> CatalogueData:
    if obj.resolver == "coords":
        return CatalogueData(CatalogueFacts())
    name = obj.query or obj.name
    if not name:
        return CatalogueData(CatalogueFacts(), missing=("catalogue",))
    try:
        if obj.resolver == "simbad":
            hit, served = simbad.query(ctx, name)
            if hit is None:
                return CatalogueData(CatalogueFacts(), served=(served,), missing=("catalogue",))
            facts = CatalogueFacts(
                simbad_otype=hit.otype, simbad_sp_type=hit.sp_type, simbad_id=hit.main_id
            )
            return CatalogueData(facts, simbad_hit=hit, served=(served,))
        if obj.resolver == "sbdb":
            answer, served = sbdb.query(ctx, name)
            if answer.hit is None:
                return CatalogueData(CatalogueFacts(), served=(served,), missing=("catalogue",))
            phys = _sbdb_phys(served.entry.body)
            label, label_src = _taxonomy(phys)
            shape = load_shape_registry(ctx.settings.shapes_dir).get(answer.hit.spkid)
            facts = CatalogueFacts(
                sbdb_kind=answer.hit.kind,
                sbdb_taxonomy=label,
                sbdb_taxonomy_source=label_src,
                shape_model=shape.lod0 if shape else None,
            )
            return CatalogueData(facts, sbdb_phys=phys, shape=shape, served=(served,))
    except (CacheMissOffline, UpstreamUnavailable):
        return CatalogueData(CatalogueFacts(), missing=("catalogue",))
    return CatalogueData(CatalogueFacts(), missing=("catalogue",))
