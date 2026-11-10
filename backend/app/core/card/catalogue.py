"""Catalogue facts for stage 3 and stage 5: re-read the SIMBAD or SBDB answer that resolve used.

Both calls go through the D-25 read-through cache with the same key resolve used, so they are
cache hits (and work under ``SX_OFFLINE=1``). A miss is not an error: the facts stay empty, the
object is typed ``candidate`` and the reason goes in ``missing``.
"""

from __future__ import annotations

import json
import logging
import math
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from app.adapters import exoplanet_archive, gaia, horizons, sbdb, simbad
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.card import literature as lit
from app.core.card import stars
from app.core.classify import CatalogueFacts
from app.core.classify.rules import SIMBAD_PLANET
from app.core.find.propagate import propagate
from app.core.find.resolver import ResolvedObject, is_comet
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
    # Half the diagonal of the mesh's bounding box, in km: the radius of the "bounding sphere" the
    # viewer scales a mesh by (Q-43, Q-162). None for rows ingested before ingest_shape wrote it.
    bbox_half_diagonal_km: float | None = None

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
                bbox_half_diagonal_km=(
                    float(r["bbox_half_diagonal_km"]) if "bbox_half_diagonal_km" in r else None
                ),
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
    literature: lit.Literature = lit.EMPTY  # Q-153: filled only where the catalogue is null
    star: stars.StarCatalogue | None = None  # Q-152: Teff, radius and period sources
    dwarf_table: stars.DwarfTable | None = None


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


def literature_key(obj: ResolvedObject) -> str | None:
    """Registry key (Q-153): the SPK-ID for a small body, the object id for anything else."""
    return obj.spkid if obj.resolver == "sbdb" else obj.id


def gather(ctx: Context, obj: ResolvedObject) -> CatalogueData:
    data = _gather(ctx, obj)
    return replace(
        data, literature=lit.load_literature(ctx.settings.literature_file, literature_key(obj))
    )


def _gather(ctx: Context, obj: ResolvedObject) -> CatalogueData:
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


@dataclass(frozen=True)
class GeometryAnswer:
    """What ``fetch_geometry`` found: the geometry, or the reason there is none."""

    geometry: horizons.Geometry | None = None
    served: tuple[Served, ...] = ()
    reason: str | None = None


def fetch_geometry(ctx: Context, obj: ResolvedObject) -> GeometryAnswer | None:
    """The Horizons phase angle and Sun vector for a moving SBDB object at its resolve epoch
    (Q-62); None when the object has none to ask for. Needs only the resolved object, so the
    object job starts it in parallel with the catalogue (issue #41). Never raises."""
    if obj.resolver != "sbdb" or not obj.spkid or not obj.epoch:
        return None
    try:
        geom, served = horizons.geometry(
            ctx, obj.spkid, parse_utc(obj.epoch), comet=is_comet(ctx, obj)
        )
    except CacheMissOffline:
        return GeometryAnswer(reason="Horizons geometry not cached and offline")
    except UpstreamUnavailable:
        return GeometryAnswer(reason="Horizons geometry unavailable")
    return GeometryAnswer(geom, tuple(served))


def apply_geometry(data: CatalogueData, answer: GeometryAnswer | None) -> CatalogueData:
    if answer is None:
        return data
    if answer.geometry is not None:
        return replace(data, geometry=answer.geometry, served=(*data.served, *answer.served))
    # "lighting" in missing: the user sees the refusal, and the asset is not saved with null
    # lighting (service.py saves only when `missing` is empty), so a later run can fill it.
    return replace(data, geometry_reason=answer.reason, missing=(*data.missing, "lighting"))


def with_geometry(ctx: Context, data: CatalogueData, obj: ResolvedObject) -> CatalogueData:
    """Add the Horizons phase angle and Sun vector for a moving SBDB object at its resolve
    epoch (Q-62). A miss or outage leaves ``geometry`` empty with a reason; never raises."""
    return apply_geometry(data, fetch_geometry(ctx, obj))


# Gaia DR3 reference epoch as a datetime: J2016.0 = 2016-01-01T12:00 TT (about 69 s after UTC).
_GAIA_EPOCH = parse_utc("2016-01-01T12:00:00Z")


def with_star_data(
    ctx: Context, data: CatalogueData, obj: ResolvedObject, kind: str
) -> CatalogueData:
    """The SIMBAD Teff rows, the SIMBAD variability rows (``star_mira`` only) and the Gaia
    astrophysical parameters of a star of type ``kind`` (Q-152). Each call is independent: one that
    fails leaves its reason on the catalogue and ``star_catalogue`` in ``missing`` (so the asset
    is not saved); the others still count. Never raises."""
    name = obj.query or obj.name
    hit = data.simbad_hit
    table = stars.load_dwarf_table(ctx.settings.dwarf_teff_file)
    if obj.resolver != "simbad" or not name or hit is None:
        return replace(data, dwarf_table=table)
    served: list[Served] = []
    failed = False

    def reason(what: str, exc: Exception) -> str:
        nonlocal failed
        failed = True
        why = "not cached and offline" if isinstance(exc, CacheMissOffline) else "unavailable"
        return f"{what} {why}"

    teff_rows: list[simbad.TeffRow] = []
    teff_reason = None
    try:
        teff_rows, s = simbad.teff_rows(ctx, name)
        served.append(s)
    except (CacheMissOffline, UpstreamUnavailable) as exc:
        teff_reason = reason("SIMBAD mesFe_h", exc)
    var_rows: list[simbad.VarRow] = []
    var_reason = None
    if kind == "star_mira":
        try:
            var_rows, s = simbad.var_rows(ctx, name)
            served.append(s)
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            var_reason = reason("SIMBAD mesVar", exc)
    g: gaia.GaiaAstro | None = None
    sep: float | None = None
    gaia_reason = None
    if hit.pmra_mas_yr is None or hit.pmdec_mas_yr is None:
        # Without a proper motion the J2000 position is up to arcseconds off at the Gaia epoch
        # (2016.0), so a match could pick a neighbour. Refuse the tier rather than guess (Q-152).
        gaia_reason = "SIMBAD gives no proper motion, so no safe Gaia DR3 match"
    else:
        ra, dec = propagate(
            hit.ra, hit.dec, hit.pmra_mas_yr, hit.pmdec_mas_yr, _GAIA_EPOCH, epoch_jyear=2000.0
        )
        try:
            near, s = gaia.astro_near(ctx, ra, dec)
            served.append(s)
            g, sep = nearest(near, ra, dec)
            if g is None:
                gaia_reason = "no Gaia DR3 source within the match radius"
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            gaia_reason = reason("Gaia DR3", exc)
    cat = stars.StarCatalogue(
        teff_rows=tuple(teff_rows),
        teff_reason=teff_reason,
        var_rows=tuple(var_rows),
        var_reason=var_reason,
        gaia=g,
        gaia_sep_arcsec=sep,
        gaia_reason=gaia_reason,
        sp_type=hit.sp_type,
    )
    return replace(
        data,
        star=cat,
        dwarf_table=table,
        served=(*data.served, *served),
        missing=(*data.missing, "star_catalogue") if failed else data.missing,
    )


def nearest(
    sources: list[gaia.GaiaAstro], ra: float, dec: float
) -> tuple[gaia.GaiaAstro | None, float | None]:
    """The source closest to (ra, dec) within the match radius, and its separation in arcsec."""
    best: tuple[float, str, gaia.GaiaAstro] | None = None
    for s in sources:
        d = _sep_arcsec(ra, dec, s.ra, s.dec)
        if d <= gaia.STAR_MATCH_RADIUS_ARCSEC and (best is None or (d, s.source_id) < best[:2]):
            best = (d, s.source_id, s)
    return (best[2], best[0]) if best else (None, None)


def _sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    p1, p2 = math.radians(dec1), math.radians(dec2)
    dl = math.radians(ra2 - ra1)
    # haversine
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600.0
