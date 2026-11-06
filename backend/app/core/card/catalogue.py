"""Catalogue facts for stage 3 and stage 5: re-read the SIMBAD or SBDB answer that resolve used.

Both calls go through the D-25 read-through cache with the same key resolve used, so they are
cache hits (and work under ``SX_OFFLINE=1``). A miss is not an error: the facts stay empty, the
object is typed ``candidate`` and the reason goes in ``missing``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from typing import Any

from app.adapters import horizons, sbdb, simbad
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.classify import CatalogueFacts
from app.core.find.resolver import ResolvedObject
from app.timefmt import parse_utc

# ASSUMPTION: no DAMIT or NASA shape-model lookup exists yet (A3.7 is not built), so this maps
# an SBDB spkid to a same-origin mesh path (Q-44) by hand. Empty: every asteroid is
# `asteroid_procedural` until a model is added here with its source.
SHAPE_MODELS: dict[str, str] = {}


@dataclass(frozen=True)
class CatalogueData:
    facts: CatalogueFacts
    simbad_hit: simbad.SimbadHit | None = None
    sbdb_phys: dict[str, dict[str, Any]] = field(default_factory=dict)
    served: tuple[Served, ...] = ()
    missing: tuple[str, ...] = ()
    geometry: horizons.Geometry | None = None  # Q-62: Horizons phase angle and Sun vector
    geometry_reason: str | None = None


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
            facts = CatalogueFacts(
                sbdb_kind=answer.hit.kind,
                sbdb_taxonomy=label,
                sbdb_taxonomy_source=label_src,
                shape_model=SHAPE_MODELS.get(answer.hit.spkid),
            )
            return CatalogueData(facts, sbdb_phys=phys, served=(served,))
    except (CacheMissOffline, UpstreamUnavailable):
        return CatalogueData(CatalogueFacts(), missing=("catalogue",))
    return CatalogueData(CatalogueFacts(), missing=("catalogue",))


def with_geometry(ctx: Context, data: CatalogueData, obj: ResolvedObject) -> CatalogueData:
    """Add the Horizons phase angle and Sun vector for a moving SBDB object at its resolve
    epoch (Q-62). A miss or outage leaves ``geometry`` empty with a reason; never raises."""
    if obj.resolver != "sbdb" or not obj.spkid or not obj.epoch:
        return data
    try:
        geom, served = horizons.geometry(ctx, obj.spkid, parse_utc(obj.epoch))
    except CacheMissOffline:
        return replace(data, geometry_reason="Horizons geometry not cached and offline")
    except UpstreamUnavailable:
        return replace(data, geometry_reason="Horizons geometry unavailable")
    return replace(data, geometry=geom, served=(*data.served, *served))
