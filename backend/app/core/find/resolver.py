"""Name resolution in D-19 order, and the object registry behind every ``/v1/objects/{id}``."""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from app.adapters import horizons, sbdb, simbad
from app.cache.keys import CacheKey, norm_name
from app.cache.store import (
    CacheMissOffline,
    LiveResponse,
    Served,
    UpstreamUnavailable,
    earliest_cached_at,
)
from app.context import Context
from app.core.find.constellations import is_flamsteed
from app.core.find.ids import (
    BadQuery,
    coord_id,
    looks_like_small_body,
    parse_coord_id,
    parse_coords,
)
from app.core.find.ids import slug as make_slug
from app.core.find.version import DERIVATION_VERSION
from app.timefmt import J2000_UTC, iso_utc_z, parse_utc

REGISTRY_SOURCE = "derived.object"
# Q-25: typed coordinates are user input, not an observation. Tagged `derived` (identity) for now.
TYPED_COORDS = {
    "tag": "derived",
    "formula": "ra, dec = the coordinates typed in the query (user input, not an observation)",
}
J2000_ISO = iso_utc_z(J2000_UTC)


class NotFound(LookupError):
    pass


@dataclass(frozen=True)
class ResolvedObject:
    id: str
    name: str | None
    ra: float
    dec: float
    moving: bool
    resolver: str  # simbad | sbdb | coords
    epoch: str | None = None  # ISO-8601 UTC time of (ra, dec); J2000.0 for catalogue positions
    pm_ra_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    spkid: str | None = None
    provenance: dict[str, dict[str, str]] = field(default_factory=dict)
    # The name sent to SIMBAD or SBDB (after alias mapping). Stage 3 re-reads that cached
    # catalogue answer for the object type and physical values (A4.3); None for typed
    # coordinates and for registry entries written before issue #5.
    query: str | None = None

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> ResolvedObject:
        return cls(**d)


@dataclass(frozen=True)
class Resolution:
    obj: ResolvedObject
    cached_at: datetime | None


def load_aliases(targets_file: Path) -> dict[str, str]:
    """Map names to the query the pre-fetch used, so the cached answer is found offline.

    Each target's display ``name`` is an alias of its ``query``. ASSUMPTION: extra ``aliases``
    in targets.toml map short names SIMBAD does not know (e.g. ``WISE 0855``). Keys lower-case.
    """
    if not targets_file.is_file():
        return {}
    doc = tomllib.loads(targets_file.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for t in doc.get("target", []):
        for a in [t["name"], *t.get("aliases", [])]:
            out[norm_name(a).lower()] = str(t["query"])
    return out


def registry_key(object_id: str) -> CacheKey:
    return CacheKey.make(REGISTRY_SOURCE, None, id=object_id, v=DERIVATION_VERSION)


def _coords_object(ra: float, dec: float) -> ResolvedObject:
    return ResolvedObject(
        id=coord_id(ra, dec),
        name=None,
        ra=ra,
        dec=dec,
        moving=False,
        resolver="coords",
        provenance={"ra": dict(TYPED_COORDS), "dec": dict(TYPED_COORDS)},
    )


def _from_simbad(
    ctx: Context, name: str, refresh: bool = False
) -> tuple[ResolvedObject | None, list[Served]]:
    hit, served = simbad.query(ctx, name, refresh=refresh)
    if hit is None:
        return None, [served]
    src = f"SIMBAD {hit.main_id}, ICRS epoch J2000"
    prov = {
        "ra": {"tag": "measured", "source": src},
        "dec": {"tag": "measured", "source": src},
    }
    if hit.pmra_mas_yr is not None and hit.pmdec_mas_yr is not None:
        prov["pm_ra_mas_yr"] = {"tag": "measured", "source": f"SIMBAD {hit.main_id}"}
        prov["pm_dec_mas_yr"] = {"tag": "measured", "source": f"SIMBAD {hit.main_id}"}
    obj = ResolvedObject(
        id=f"simbad-{make_slug(hit.main_id)}",
        name=hit.main_id,
        ra=hit.ra,
        dec=hit.dec,
        moving=False,
        resolver="simbad",
        epoch=J2000_ISO,
        pm_ra_mas_yr=hit.pmra_mas_yr,
        pm_dec_mas_yr=hit.pmdec_mas_yr,
        provenance=prov,
        query=name,
    )
    return obj, [served]


def sbdb_name_matches(query: str, hit: sbdb.SbdbHit) -> bool:
    """True when the SBDB object's name is the query: ``849 Ara`` matches asteroid 849 Ara, but
    ``61 Cyg`` does not match asteroid 61 Danae."""
    short = re.sub(r"\s*\(.*\)\s*$", "", hit.shortname or hit.fullname)
    return norm_name(short).lower() == norm_name(query).lower()


def _from_sbdb(
    ctx: Context, name: str, refresh: bool = False, *, require_name_match: bool = False
) -> tuple[ResolvedObject | None, list[Served], bool]:
    answer, served = sbdb.query(ctx, name, refresh=refresh)
    if answer.hit is None:
        return None, [served], answer.ambiguous
    hit = answer.hit
    if require_name_match and not sbdb_name_matches(name, hit):
        # A Flamsteed star name ("61 Cyg") must not fall back to a numbered asteroid ("61").
        return None, [served], False
    epoch = parse_utc(ctx.settings.ephemeris_epoch)
    points, served_h = horizons.ephemeris(
        ctx, hit.spkid, [epoch], comet=hit.is_comet, refresh=refresh
    )
    if not points:
        raise UpstreamUnavailable(f"Horizons returned no position for {hit.spkid}")
    p = points[0]
    basis = f"{horizons.BASIS}, at {iso_utc_z(epoch)}"
    obj = ResolvedObject(
        id=f"sbdb-{hit.spkid}",
        name=hit.fullname,
        ra=p.ra,
        dec=p.dec,
        moving=True,
        resolver="sbdb",
        epoch=iso_utc_z(epoch),
        spkid=hit.spkid,
        provenance={
            "ra": {"tag": "model_dependent", "assumption": basis},
            "dec": {"tag": "model_dependent", "assumption": basis},
        },
        query=name,
    )
    return obj, [served, served_h], False


def resolve(ctx: Context, q: str, aliases: dict[str, str], *, refresh: bool = False) -> Resolution:
    text = norm_name(q)
    if not text:
        raise BadQuery("Enter a name or 'ra,dec' in degrees.")
    coords = parse_coords(text)
    if coords is not None:
        return Resolution(_coords_object(*coords), None)

    name = aliases.get(text.lower(), text)
    order = ["sbdb", "simbad"] if looks_like_small_body(name) else ["simbad", "sbdb"]
    flamsteed = is_flamsteed(name)
    served_all: list[Served] = []
    errors: list[Exception] = []
    ambiguous = False
    for service in order:
        try:
            if service == "simbad":
                obj, served = _from_simbad(ctx, name, refresh)
            else:
                obj, served, amb = _from_sbdb(ctx, name, refresh, require_name_match=flamsteed)
                ambiguous = ambiguous or amb
        except (CacheMissOffline, UpstreamUnavailable) as exc:
            errors.append(exc)
            continue
        served_all.extend(served)
        if obj is not None:
            save_object(ctx, obj, served_all)
            return Resolution(obj, earliest_cached_at(served_all))
    if errors:
        raise errors[0]
    if ambiguous:
        raise NotFound(f"Several small bodies match '{name}'. Give a fuller designation.")
    raise NotFound(f"No object called '{name}' in SIMBAD or the JPL Small-Body Database.")


def save_object(ctx: Context, obj: ResolvedObject, sources: list[Served]) -> None:
    earliest = min((s.entry.fetched_at for s in sources), default=None)
    body = {
        "object": obj.to_json(),
        "sources_earliest_fetched_at": iso_utc_z(earliest) if earliest else None,
    }
    data = json.dumps(body, sort_keys=True).encode("utf-8")
    ctx.cache.put(
        registry_key(obj.id),
        LiveResponse(data, "derived:resolve", 200, "application/json"),
        if_changed=True,  # resolve runs often; never rewrite an unchanged registry entry
    )


def load_object(ctx: Context, object_id: str) -> ResolvedObject | None:
    coords = parse_coord_id(object_id)
    if coords is not None:
        return _coords_object(*coords)
    entry = ctx.cache.get(registry_key(object_id))
    if entry is None:
        return None
    return ResolvedObject.from_json(json.loads(entry.body)["object"])
