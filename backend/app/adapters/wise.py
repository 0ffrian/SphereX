"""CatWISE2020 cone search for catalogue overlays (issue #12, A3.3).

Checked 6 Nov 2026 on IRSA TAP (``catwise_2020``, TAP_SCHEMA.columns): ``ra_pm``/``dec_pm`` are
positions at MJD 57170 from the PSF fit including motion, ``pmra``/``pmdec`` are the apparent
motion in arcsec/yr (relative, not absolute, and noisy for faint sources), ``w1mpro_pm`` the W1
profile-fit magnitude with motion. A 0.03 deg cone answered in about 17 s. The cone is applied
to the ``ra``/``dec`` columns (the indexed mean-epoch position).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.adapters import tap
from app.cache.keys import CacheKey, norm_dec, norm_float, norm_ra
from app.cache.store import LiveResponse, Served
from app.context import Context
from app.timefmt import MJD_OFFSET

SOURCE = "wise"
RELEASE = "catwise2020"
TABLE = "catwise_2020"
# Epoch of ra_pm/dec_pm (IRSA column description, checked 6 Nov 2026).
EPOCH_MJD = 57170.0
# J2000.0 = JD 2451545.0 (TT); the TT-UTC offset (about 69 s) is far below a SPHEREx pixel.
EPOCH_JYEAR = 2000.0 + (EPOCH_MJD + MJD_OFFSET - 2451545.0) / 365.25
# ASSUMPTION: row cap for one cone; brightest W1 first, reported as ``overlay:wise:truncated``.
MAX_ROWS = 5000
COLUMNS = ("source_name", "ra_pm", "dec_pm", "pmra", "pmdec", "w1mpro_pm")


@dataclass(frozen=True)
class WiseSource:
    source_name: str
    ra: float  # deg at EPOCH_MJD
    dec: float
    pmra_mas_yr: float | None  # converted from arcsec/yr; mu_alpha*cos(dec) [verify]
    pmdec_mas_yr: float | None
    w1_mag: float | None


@dataclass(frozen=True)
class WiseCone:
    sources: list[WiseSource]
    truncated: bool
    table: str
    served: Served


def wise_key(ra: float, dec: float, radius_deg: float) -> CacheKey:
    return CacheKey.make(
        SOURCE,
        RELEASE,
        ra=norm_ra(ra),
        dec=norm_dec(dec),
        radius=norm_float(radius_deg, 5),
        top=str(MAX_ROWS),
    )


def _mas(arcsec_per_yr: float | None) -> float | None:
    return None if arcsec_per_yr is None else arcsec_per_yr * 1000.0


def parse(body: bytes) -> list[WiseSource]:
    out: list[WiseSource] = []
    for r in tap.read_csv(body, COLUMNS):
        ra, dec = tap.opt_float(r["ra_pm"]), tap.opt_float(r["dec_pm"])
        if ra is None or dec is None:
            continue  # no position at the stated epoch: refuse the row, never guess one
        out.append(
            WiseSource(
                source_name=r["source_name"],
                ra=ra,
                dec=dec,
                pmra_mas_yr=_mas(tap.opt_float(r["pmra"])),
                pmdec_mas_yr=_mas(tap.opt_float(r["pmdec"])),
                w1_mag=tap.opt_float(r["w1mpro_pm"]),
            )
        )
    return out


def cone(
    ctx: Context, ra: float, dec: float, radius_deg: float, *, refresh: bool = False
) -> WiseCone:
    """One cone, through the cache. Raises ``CacheMissOffline`` / ``UpstreamUnavailable``."""
    key = wise_key(ra, dec, radius_deg)
    q = dict(key.query)

    def adql(table: str) -> str:
        return tap.cone_adql(
            table,
            COLUMNS,
            q["ra"],
            q["dec"],
            q["radius"],
            order_by="w1mpro_pm, source_name",
            top=MAX_ROWS,
        )

    def live() -> LiveResponse:
        return tap.query_csv(
            ctx,
            [(ctx.settings.wise_tap_url, TABLE)],
            adql,
            COLUMNS,
            read_timeout_s=ctx.settings.catalog_read_timeout_s,
            parse=parse,
        )

    served = ctx.cache.fetch(key, live, refresh=refresh)
    sources = parse(served.entry.body)
    raw_rows = len(tap.read_csv(served.entry.body, COLUMNS))
    return WiseCone(sources, raw_rows >= MAX_ROWS, TABLE, served)
