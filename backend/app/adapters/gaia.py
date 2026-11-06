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
# ASSUMPTION (Q-45): a display cut, not a physical value. Fainter sources are invisible at
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


def gaia_key(ra: float, dec: float, radius_deg: float, mag_limit: float = MAG_LIMIT_G) -> CacheKey:
    return CacheKey.make(
        SOURCE,
        RELEASE,
        ra=norm_ra(ra),
        dec=norm_dec(dec),
        radius=norm_float(radius_deg, 5),
        g_lt=norm_float(mag_limit, 2),
        top=str(MAX_ROWS),
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
    ctx: Context, ra: float, dec: float, radius_deg: float, *, refresh: bool = False
) -> GaiaCone:
    """One cone, through the cache. Raises ``CacheMissOffline`` / ``UpstreamUnavailable``."""
    key = gaia_key(ra, dec, radius_deg)
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
            top=MAX_ROWS,
        )

    def live() -> LiveResponse:
        return tap.query_csv(
            ctx,
            ctx.settings.gaia_mirrors,
            adql,
            COLUMNS,
            read_timeout_s=ctx.settings.catalog_read_timeout_s,
        )

    served = ctx.cache.fetch(key, live, refresh=refresh)
    sources = parse(served.entry.body)
    table = str(served.entry.meta.get("table") or DEFAULT_TABLE)
    return GaiaCone(sources, len(sources) >= MAX_ROWS, table, served)
