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


def _fetch(ctx: Context, key: CacheKey, text: str, *, refresh: bool) -> Served:
    urls = ctx.settings.simbad_urls
    params = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": text}

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

    return ctx.cache.fetch(key, live, refresh=refresh)


def query(ctx: Context, name: str, *, refresh: bool = False) -> tuple[SimbadHit | None, Served]:
    served = _fetch(ctx, simbad_key(name), adql(name), refresh=refresh)
    return parse(served.entry.body), served


# --- measurement tables (issue #68 Part 8c, Q-152) --------------------------------------------
# ``mesFe_h`` (published spectroscopic Teff, log g, [Fe/H]) and ``mesVar`` (variability periods)
# are SIMBAD measurement tables. Columns checked against TAP_SCHEMA on 2026-11-09; ``period`` is in
# days. Table names are case-sensitive and worked as written on the Harvard mirror.


@dataclass(frozen=True)
class TeffRow:
    teff_k: float
    bibcode: str


@dataclass(frozen=True)
class VarRow:
    period_d: float
    vartyp: str | None
    magtyp: str | None
    bibcode: str


def teff_key(name: str) -> CacheKey:
    return CacheKey.make(SOURCE, None, ident=norm_name(name), table="mesFe_h")


def var_key(name: str) -> CacheKey:
    return CacheKey.make(SOURCE, None, ident=norm_name(name), table="mesVar")


def _measurement_adql(name: str, table: str, columns: tuple[str, ...], not_null: str) -> str:
    ident = norm_name(name).replace("'", "''")
    cols = ", ".join(f"{table}.{c}" for c in columns)
    return (
        f"SELECT {cols} FROM ident JOIN {table} ON ident.oidref = {table}.oidref "
        f"WHERE ident.id = '{ident}' AND {table}.{not_null} IS NOT NULL"
    )


def teff_adql(name: str) -> str:
    return _measurement_adql(name, "mesFe_h", ("teff", "bibcode"), "teff")


def var_adql(name: str) -> str:
    return _measurement_adql(name, "mesVar", ("period", "vartyp", "magtyp", "bibcode"), "period")


def _rows(body: bytes) -> list[list[object]]:
    data = json.loads(body).get("data") or []
    return [r for r in data if isinstance(r, list)]


def _positive(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    x = float(v)
    return x if x > 0 and x == x and x != float("inf") else None


def parse_teff(body: bytes) -> list[TeffRow]:
    out = []
    for r in _rows(body):
        t = _positive(r[0])
        if t is not None and r[1]:
            out.append(TeffRow(t, str(r[1])))
    return out


def parse_var(body: bytes) -> list[VarRow]:
    out = []
    for r in _rows(body):
        p = _positive(r[0])
        if p is not None and r[3]:
            out.append(
                VarRow(
                    p,
                    None if r[1] is None else str(r[1]).strip(),
                    None if r[2] is None else str(r[2]).strip(),
                    str(r[3]),
                )
            )
    return out


def teff_rows(ctx: Context, name: str, *, refresh: bool = False) -> tuple[list[TeffRow], Served]:
    served = _fetch(ctx, teff_key(name), teff_adql(name), refresh=refresh)
    return parse_teff(served.entry.body), served


def var_rows(ctx: Context, name: str, *, refresh: bool = False) -> tuple[list[VarRow], Served]:
    served = _fetch(ctx, var_key(name), var_adql(name), refresh=refresh)
    return parse_var(served.entry.body), served
