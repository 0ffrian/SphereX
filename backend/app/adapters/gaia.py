"""Gaia DR3 cone search for catalogue overlays (issue #12, A3.2).

Checked 6 Nov 2026: IRSA TAP ``gaia_dr3_source`` answered a 0.05 deg cone in about 20 s; the
ESA archive ``gaiadr3.gaia_source`` took about 60 s (one attempt timed out at 90 s). IRSA is
tried first, ESA second; both serve the same columns. Positions are ICRS at ``ref_epoch``
(J2016.0 in DR3), ``pmra`` is mu_alpha*cos(dec) in mas/yr.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.adapters import tap
from app.cache.keys import CacheKey, norm_dec, norm_float, norm_ra
from app.cache.store import LiveResponse, Served
from app.context import Context

SOURCE = "gaia"
RELEASE = "gaia_dr3"
DEFAULT_TABLE = "gaia_dr3_source"  # IRSA's name; ESA serves the same data as gaiadr3.gaia_source
# Gaia DR3 reference epoch for every source (Gaia DR3 documentation, ``ref_epoch``).
DR3_EPOCH_JYEAR = 2016.0
# ASSUMPTION (Q-52): a display cut, not a physical value. Fainter sources are invisible at
# SPHEREx depth and would only crowd the overlay.
MAG_LIMIT_G = 20.0
# ASSUMPTION: row cap for one cone; brightest first, so a capped answer keeps the bright ones and
# is reported as ``overlay:gaia:truncated``.
MAX_ROWS = 5000
COLUMNS = (
    "source_id",
    "ra",
    "dec",
    "ref_epoch",
    "pmra",
    "pmdec",
    "parallax",
    "phot_g_mean_mag",
)


@dataclass(frozen=True)
class GaiaSource:
    source_id: str
    ra: float  # deg, ICRS at ref_epoch
    dec: float
    ref_epoch: float  # Julian year
    pmra_mas_yr: float | None  # mu_alpha*cos(dec)
    pmdec_mas_yr: float | None
    parallax_mas: float | None
    g_mag: float | None


@dataclass(frozen=True)
class GaiaCone:
    sources: list[GaiaSource]
    truncated: bool
    table: str
    served: Served


def gaia_key(
    ra: float,
    dec: float,
    radius_deg: float,
    mag_limit: float = MAG_LIMIT_G,
    max_rows: int = MAX_ROWS,
) -> CacheKey:
    """The defaults give the key every recorded cone was stored under (issue #95 keeps them)."""
    return CacheKey.make(
        SOURCE,
        RELEASE,
        ra=norm_ra(ra),
        dec=norm_dec(dec),
        radius=norm_float(radius_deg, 5),
        g_lt=norm_float(mag_limit, 2),
        top=str(max_rows),
    )


def parse(body: bytes) -> list[GaiaSource]:
    out: list[GaiaSource] = []
    for r in tap.read_csv(body, COLUMNS):
        epoch = tap.opt_float(r["ref_epoch"])
        out.append(
            GaiaSource(
                source_id=r["source_id"],
                ra=float(r["ra"]),
                dec=float(r["dec"]),
                ref_epoch=DR3_EPOCH_JYEAR if epoch is None else epoch,
                pmra_mas_yr=tap.opt_float(r["pmra"]),
                pmdec_mas_yr=tap.opt_float(r["pmdec"]),
                parallax_mas=tap.opt_float(r["parallax"]),
                g_mag=tap.opt_float(r["phot_g_mean_mag"]),
            )
        )
    return out


def cone(
    ctx: Context,
    ra: float,
    dec: float,
    radius_deg: float,
    *,
    refresh: bool = False,
    max_rows: int = MAX_ROWS,
) -> GaiaCone:
    """One cone, through the cache. Raises ``CacheMissOffline`` / ``UpstreamUnavailable``.
    ``max_rows`` is the row cap (part of the key); an answer that reaches it is truncated."""
    key = gaia_key(ra, dec, radius_deg, max_rows=max_rows)
    q = dict(key.query)

    def adql(table: str) -> str:
        return tap.cone_adql(
            table,
            COLUMNS,
            q["ra"],
            q["dec"],
            q["radius"],
            where=f"phot_g_mean_mag < {q['g_lt']}",
            order_by="phot_g_mean_mag, source_id",
            top=max_rows,
        )

    def live() -> LiveResponse:
        return tap.query_csv(
            ctx,
            ctx.settings.gaia_mirrors,
            adql,
            COLUMNS,
            read_timeout_s=ctx.settings.catalog_read_timeout_s,
            parse=parse,
        )

    served = ctx.cache.fetch(key, live, refresh=refresh)
    sources = parse(served.entry.body)
    table = str(served.entry.meta.get("table") or DEFAULT_TABLE)
    return GaiaCone(sources, len(sources) >= max_rows, table, served)


# --- astrophysical parameters of one star (issue #68 Part 8c, Q-152) ---------------------------
# IRSA serves the table as ``gaia_dr3_astrophys_param`` (not ``astrophysical_parameters``); the ESA
# archive as ``gaiadr3.astrophysical_parameters``. Both join ``gaia_source`` on ``source_id``
# (checked 2026-11-09). Each mirror's source table maps to its own astrophysical table.
ASTRO_TABLE = {
    "gaia_dr3_source": "gaia_dr3_astrophys_param",
    "gaiadr3.gaia_source": "gaiadr3.astrophysical_parameters",
}
# ASSUMPTION: match radius. Gaia DR3 positions are at J2016.0, so the SIMBAD position is first
# moved there with the SIMBAD proper motion; the nearest source within this radius is taken.
STAR_MATCH_RADIUS_ARCSEC = 3.0
STAR_MAX_ROWS = 10
ASTRO_COLUMNS = (
    "source_id",
    "ra",
    "dec",
    "phot_g_mean_mag",
    "teff_gspphot",
    "teff_gspphot_lower",
    "teff_gspphot_upper",
    "radius_flame",
    "radius_flame_lower",
    "radius_flame_upper",
    # Multiple Star Classifier (MSC): the Teff of the primary when the source is modelled as an
    # unresolved binary. ``_lower`` / ``_upper`` are the 16th and 84th percentiles (Gaia DR3
    # astrophysical_parameters datamodel). Issue #71 stream B, Q-220.
    "teff_msc1",
    "teff_msc1_lower",
    "teff_msc1_upper",
)


@dataclass(frozen=True)
class GaiaAstro:
    source_id: str
    ra: float
    dec: float
    g_mag: float | None
    teff_gspphot_k: float | None
    teff_gspphot_lower_k: float | None
    teff_gspphot_upper_k: float | None
    radius_flame_rsun: float | None
    radius_flame_lower_rsun: float | None
    radius_flame_upper_rsun: float | None
    teff_msc1_k: float | None = None
    teff_msc1_lower_k: float | None = None
    teff_msc1_upper_k: float | None = None


def astro_key(ra: float, dec: float) -> CacheKey:
    return CacheKey.make(
        SOURCE,
        RELEASE,
        what="astrophysical_parameters",
        cols="msc1",  # the column set changed (Q-220): an older cached body has no teff_msc1
        ra=norm_ra(ra),
        dec=norm_dec(dec),
        radius=norm_float(STAR_MATCH_RADIUS_ARCSEC / 3600.0, 5),
    )


def parse_astro(body: bytes) -> list[GaiaAstro]:
    out: list[GaiaAstro] = []
    for r in tap.read_csv(body, ASTRO_COLUMNS):
        out.append(
            GaiaAstro(
                source_id=r["source_id"],
                ra=float(r["ra"]),
                dec=float(r["dec"]),
                g_mag=tap.opt_float(r["phot_g_mean_mag"]),
                teff_gspphot_k=tap.opt_float(r["teff_gspphot"]),
                teff_gspphot_lower_k=tap.opt_float(r["teff_gspphot_lower"]),
                teff_gspphot_upper_k=tap.opt_float(r["teff_gspphot_upper"]),
                radius_flame_rsun=tap.opt_float(r["radius_flame"]),
                radius_flame_lower_rsun=tap.opt_float(r["radius_flame_lower"]),
                radius_flame_upper_rsun=tap.opt_float(r["radius_flame_upper"]),
                teff_msc1_k=tap.opt_float(r["teff_msc1"]),
                teff_msc1_lower_k=tap.opt_float(r["teff_msc1_lower"]),
                teff_msc1_upper_k=tap.opt_float(r["teff_msc1_upper"]),
            )
        )
    return out


def astro_adql(source_table: str, ra: str, dec: str, radius_deg: str) -> str:
    astro = ASTRO_TABLE[source_table]
    cols = ", ".join(
        f"s.{c}" if c in ("source_id", "ra", "dec", "phot_g_mean_mag") else f"a.{c}"
        for c in ASTRO_COLUMNS
    )
    return (
        f"SELECT TOP {STAR_MAX_ROWS} {cols} FROM {source_table} AS s "
        f"LEFT OUTER JOIN {astro} AS a ON s.source_id = a.source_id "
        f"WHERE 1=CONTAINS(POINT('ICRS',s.ra,s.dec),CIRCLE('ICRS',{ra},{dec},{radius_deg})) "
        "ORDER BY s.phot_g_mean_mag, s.source_id"
    )


def astro_near(
    ctx: Context, ra: float, dec: float, *, refresh: bool = False
) -> tuple[list[GaiaAstro], Served]:
    """Gaia DR3 sources (with their GSP-Phot, FLAME and MSC values) within
    ``STAR_MATCH_RADIUS_ARCSEC`` of an ICRS position at epoch J2016.0, through the cache. Raises
    ``CacheMissOffline`` / ``UpstreamUnavailable``."""
    key = astro_key(ra, dec)
    q = dict(key.query)
    mirrors = [(url, table) for url, table in ctx.settings.gaia_mirrors if table in ASTRO_TABLE]

    def live() -> LiveResponse:
        return tap.query_csv(
            ctx,
            mirrors,
            lambda table: astro_adql(table, q["ra"], q["dec"], q["radius"]),
            ASTRO_COLUMNS,
            read_timeout_s=ctx.settings.catalog_read_timeout_s,
            parse=parse_astro,
        )

    served = ctx.cache.fetch(key, live, refresh=refresh)
    return parse_astro(served.entry.body), served
