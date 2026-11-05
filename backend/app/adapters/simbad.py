"""SIMBAD name resolution through TAP (A3.10). Mirrors are tried in order."""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey, norm_name
from app.cache.store import LiveResponse, Served
from app.context import Context

SOURCE = "simbad"
COLUMNS = (
    "basic.main_id",
    "basic.ra",
    "basic.dec",
    "basic.pmra",
    "basic.pmdec",
    "basic.plx_value",
    "basic.otype",
    "basic.sp_type",
)


@dataclass(frozen=True)
class SimbadHit:
    main_id: str
    ra: float  # ICRS, epoch J2000 (deg)
    dec: float
    pmra_mas_yr: float | None  # mu_alpha * cos(delta)
    pmdec_mas_yr: float | None
    plx_mas: float | None
    otype: str | None
    sp_type: str | None


def simbad_key(name: str) -> CacheKey:
    return CacheKey.make(SOURCE, None, ident=norm_name(name))


def adql(name: str) -> str:
    ident = norm_name(name).replace("'", "''")
    return (
        f"SELECT {', '.join(COLUMNS)} FROM ident JOIN basic ON ident.oidref = basic.oid "
        f"WHERE ident.id = '{ident}'"
    )


def _opt(v: object) -> float | None:
    return None if v is None else float(v)  # type: ignore[arg-type]


def parse(body: bytes) -> SimbadHit | None:
    doc = json.loads(body)
    data = doc.get("data") or []
    if not data:
        return None
    r = data[0]
    if r[1] is None or r[2] is None:
        return None
    return SimbadHit(
        main_id=str(r[0]),
        ra=float(r[1]),
        dec=float(r[2]),
        pmra_mas_yr=_opt(r[3]),
        pmdec_mas_yr=_opt(r[4]),
        plx_mas=_opt(r[5]),
        otype=None if r[6] is None else str(r[6]),
        sp_type=None if r[7] is None else str(r[7]),
    )


def query(ctx: Context, name: str, *, refresh: bool = False) -> tuple[SimbadHit | None, Served]:
    urls = ctx.settings.simbad_urls
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": adql(name)}

    def live() -> LiveResponse:
        errors: list[str] = []
        for i, url in enumerate(urls):
            try:
                resp = ctx.http.get(url, params, retry_connect=i == len(urls) - 1)
            except UpstreamError as exc:
                errors.append(str(exc))
                continue
            try:
                json.loads(resp.body)  # an ADQL error comes back as VOTable XML
            except ValueError:
                errors.append(f"{url}: not JSON (query error)")
                continue
            return resp
        raise UpstreamError("; ".join(errors) or "no SIMBAD URL configured")

    served = ctx.cache.fetch(simbad_key(name), live, refresh=refresh)
    return parse(served.entry.body), served
