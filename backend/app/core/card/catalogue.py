"""Catalogue facts for stage 3 and stage 5: re-read the SIMBAD or SBDB answer that resolve used.

Both calls go through the D-25 read-through cache with the same key resolve used, so they are
cache hits (and work under ``SX_OFFLINE=1``). A miss is not an error: the facts stay empty, the
object is typed ``candidate`` and the reason goes in ``missing``.
"""

from __future__ import annotations

import json
import logging
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from app.adapters import exoplanet_archive, horizons, sbdb, simbad
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.classify import CatalogueFacts
from app.core.classify.rules import SIMBAD_PLANET
from app.core.find.resolver import ResolvedObject
from app.timefmt import parse_utc

log = logging.getLogger("shift_spectrum")


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


# registry path -> ((mtime_ns, size), parsed rows). The file changes only when ingest_shape runs,
# so /card and every mesh request reuse the parsed rows until it does. The mesh files are still
# checked on every call (two stats), so a deleted GLB is never registered.
_REGISTRY_CACHE: dict[Path, tuple[tuple[int, int], tuple[ShapeModel, ...]]] = {}


def load_shape_registry(shapes_dir: Path) -> dict[str, ShapeModel]:
    """Read ``registry.toml``. A missing or broken file means no shape models, never a crash."""
    path = shapes_dir / "registry.toml"
    try:
        st = path.stat()
    except OSError:
        return {}
    stamp = (st.st_mtime_ns, st.st_size)
    hit = _REGISTRY_CACHE.get(path)
    if hit is not None and hit[0] == stamp:
        models = hit[1]
    else:
        models = _parse_shape_registry(path)
        _REGISTRY_CACHE[path] = (stamp, models)
    out: dict[str, ShapeModel] = {}
    for m in models:
        # Refuse rather than invent: a registry row whose mesh is not on disk would type the
        # object asteroid_shape with a `measured` shape_source that answers 404.
        if not all(mesh_file(shapes_dir, p) is not None for p in (m.lod0, m.lod1)):
            log.warning("shape model %s (%s) skipped: mesh file missing", m.spkid, m.lod0)
            continue
        out[m.spkid] = m
    return out


def _parse_shape_registry(path: Path) -> tuple[ShapeModel, ...]:
    try:
        rows = tomllib.loads(path.read_text("utf-8")).get("model", [])
        return tuple(
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
        )
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("shape registry %s unreadable, no shape models: %s", path, e)
        return ()


SHAPE_URL_ROOT = "/data/shapes/"


def mesh_file(shapes_dir: Path, url: str) -> Path | None:
    """The file behind a registry mesh path (``/data/shapes/<name>.glb``), or None."""
    if not url.startswith(SHAPE_URL_ROOT):
        return None
    path = shapes_dir / url.removeprefix(SHAPE_URL_ROOT)
    return path if "/" not in url.removeprefix(SHAPE_URL_ROOT) and path.is_file() else None


@dataclass(frozen=True)
class CatalogueData:
    facts: CatalogueFacts
    simbad_hit: simbad.SimbadHit | None = None
    sbdb_phys: dict[str, dict[str, Any]] = field(default_factory=dict)
    shape: ShapeModel | None = None
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
            row = None
            served_all: tuple[Served, ...] = (served,)
            missing: tuple[str, ...] = ()
            if hit.otype in SIMBAD_PLANET:
                # A3.8: an extrasolar planet gets its Exoplanet Archive row. A miss is not an error.
                try:
                    row, planet_served = exoplanet_archive.query(ctx, (name, hit.main_id))
                except (CacheMissOffline, UpstreamUnavailable):
                    row, planet_served = None, None
                    missing = ("exoplanet_archive",)
                if planet_served is not None:
                    served_all = (served, planet_served)
                if row is None:
                    missing = ("exoplanet_archive",)
            facts = CatalogueFacts(
                simbad_otype=hit.otype,
                simbad_sp_type=hit.sp_type,
                simbad_id=hit.main_id,
                exoplanet=row,
            )
            return CatalogueData(facts, simbad_hit=hit, served=served_all, missing=missing)
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


def with_geometry(ctx: Context, data: CatalogueData, obj: ResolvedObject) -> CatalogueData:
    """Add the Horizons phase angle and Sun vector for a moving SBDB object at its resolve
    epoch (Q-62). A miss or outage leaves ``geometry`` empty with a reason; never raises."""
    if obj.resolver != "sbdb" or not obj.spkid or not obj.epoch:
        return data
    try:
        geom, served = horizons.geometry(ctx, obj.spkid, parse_utc(obj.epoch))
    except CacheMissOffline:
        reason = "Horizons geometry not cached and offline"
    except UpstreamUnavailable:
        reason = "Horizons geometry unavailable"
    else:
        return replace(data, geometry=geom, served=(*data.served, *served))
    # "lighting" in missing: the user sees the refusal, and the asset is not saved with null
    # lighting (service.py saves only when `missing` is empty), so a later run can fill it.
    return replace(data, geometry_reason=reason, missing=(*data.missing, "lighting"))
