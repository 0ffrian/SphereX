"""IRSA Simple Image Access search for SPHEREx frames (A3.1). Tiny cones only."""

from __future__ import annotations

import io
import math
import warnings
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey, norm_dec, norm_float, norm_ra
from app.cache.store import CacheEntry, LiveResponse, Served
from app.context import Context
from app.timefmt import mjd_to_utc

SOURCE = "irsa_sia"


@dataclass(frozen=True)
class SiaRow:
    frame_id: str
    obs_id: str
    detector: int
    access_url: str
    t_min_mjd: float
    t_max_mjd: float
    em_min_um: float
    em_max_um: float
    # Detector footprint from ``s_region`` (issue #12): (ra, dec) vertices in degrees, ICRS, the
    # closing repeat of the first vertex removed. ``None`` when absent or not a POLYGON.
    s_region: tuple[tuple[float, float], ...] | None = None


def frame_time(row: SiaRow) -> datetime:
    """The one time per frame: midpoint of the SIA exposure bounds (MJD, UTC like the FITS
    ``TIMESYS``). Used for the position, the cutout centre, ``x``/``y`` and ``time``."""
    return mjd_to_utc((row.t_min_mjd + row.t_max_mjd) / 2.0)


@dataclass(frozen=True)
class SiaResult:
    rows: list[SiaRow]
    truncated: bool
    served: Served


def sia_key(release: str, ra: float, dec: float, radius_deg: float) -> CacheKey:
    # MAXREC is deliberately not in the key: the prefetch may lower it after a timeout, and the
    # server must still find the entry. The MAXREC used is stored in the entry's meta.
    return CacheKey.make(
        SOURCE, release, ra=norm_ra(ra), dec=norm_dec(dec), radius=norm_float(radius_deg, 6)
    )


def _votable(body: bytes):  # type: ignore[no-untyped-def]
    from astropy.io.votable import parse

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return parse(io.BytesIO(body), verify="ignore")


def query_status(body: bytes) -> str:
    vot = _votable(body)
    for res in vot.resources:
        for info in res.infos:
            if info.name == "QUERY_STATUS":
                return str(info.value).upper()
    for info in vot.infos:
        if info.name == "QUERY_STATUS":
            return str(info.value).upper()
    return "OK"


def _frame_id(did: str, obs_id: str, band: str) -> str:
    """``ivo://irsa.ipac/spherex_qr2?2026W12_1A_0311_3/D2`` -> ``2026W12_1A_0311_3_D2``."""
    if "?" in did:
        return did.split("?", 1)[1].replace("/", "_")
    det = band.rsplit("-", 1)[-1] if band else "D0"
    return f"{obs_id}_{det}"


def parse_s_region(text: str) -> tuple[tuple[float, float], ...] | None:
    """``POLYGON ICRS ra1 dec1 ra2 dec2 ...`` (as served by IRSA for SPHEREx, checked 6 Nov 2026)
    -> vertices. Anything else (another shape, another frame, odd numbers) gives ``None``."""
    parts = text.split()
    if len(parts) < 2 or parts[0].upper() != "POLYGON":
        return None
    nums = parts[1:]
    if nums and not _is_number(nums[0]):
        if nums[0].upper() not in ("ICRS", "J2000", "FK5"):
            return None
        nums = nums[1:]
    if len(nums) < 6 or len(nums) % 2 or not all(_is_number(n) for n in nums):
        return None
    pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums), 2)]
    if len(pts) > 3 and pts[-1] == pts[0]:
        pts = pts[:-1]
    return tuple(pts)


def _is_number(text: str) -> bool:
    """A finite number: ``nan`` and ``inf`` parse as floats but are not usable vertices."""
    try:
        return math.isfinite(float(text))
    except ValueError:
        return False


def parse_rows(body: bytes) -> list[SiaRow]:
    vot = _votable(body)
    tables = list(vot.iter_tables())
    if not tables:
        return []
    table = tables[0].to_table(use_names_over_ids=True)
    names = set(table.colnames)
    rows: list[SiaRow] = []

    def s(rec: Any, col: str) -> str:
        if col not in names:
            return ""
        v = rec[col]
        if v is np.ma.masked:
            return ""
        return v.decode() if isinstance(v, bytes) else str(v)

    for rec in table:
        if s(rec, "dataproduct_type") != "image" or s(rec, "calib_level") not in ("2", "2.0"):
            continue
        band = s(rec, "energy_bandpassname")
        obs_id = s(rec, "obs_id")
        frame_id = _frame_id(s(rec, "obs_publisher_did"), obs_id, band)
        det_text = frame_id.rsplit("_D", 1)[-1]
        rows.append(
            SiaRow(
                frame_id=frame_id,
                obs_id=obs_id,
                detector=int(det_text) if det_text.isdigit() else 0,
                access_url=s(rec, "access_url"),
                t_min_mjd=float(s(rec, "t_min")),
                t_max_mjd=float(s(rec, "t_max")),
                em_min_um=float(s(rec, "em_min")) * 1e6,
                em_max_um=float(s(rec, "em_max")) * 1e6,
                s_region=parse_s_region(s(rec, "s_region")),
            )
        )
    return rows


def raw_row_count(body: bytes) -> int:
    """Rows in the answer before any filtering (what MAXREC limits)."""
    tables = list(_votable(body).iter_tables())
    return len(tables[0].array) if tables else 0


def is_truncated(body: bytes, maxrec: object) -> bool:
    if query_status(body) == "OVERFLOW":
        return True
    return isinstance(maxrec, int) and maxrec > 0 and raw_row_count(body) >= maxrec


def _result(entry: CacheEntry, served: Served) -> SiaResult:
    rows = parse_rows(entry.body)
    truncated = is_truncated(entry.body, entry.meta.get("maxrec"))
    return SiaResult(rows=rows, truncated=truncated, served=served)


def search(
    ctx: Context,
    ra: float,
    dec: float,
    *,
    refresh: bool = False,
    maxrec: int | None = None,
    read_timeout_s: float | None = None,
    radius_deg: float | None = None,
) -> SiaResult:
    """One tiny cone. ``radius_deg`` defaults to ``SX_SIA_RADIUS_DEG``; the moving-object path
    search (issue #26) passes its own cone radius."""
    s = ctx.settings
    key = sia_key(s.data_release, ra, dec, s.sia_radius_deg if radius_deg is None else radius_deg)
    n = maxrec or s.sia_maxrec
    ra_t, dec_t, rad_t = dict(key.query)["ra"], dict(key.query)["dec"], dict(key.query)["radius"]

    def live() -> LiveResponse:
        params = {
            "COLLECTION": s.data_release,
            "POS": f"circle {ra_t} {dec_t} {rad_t}",
            "MAXREC": str(n),
        }
        resp = ctx.http.get(s.sia_url, params, read_timeout_s=read_timeout_s)
        status = query_status(resp.body)
        if status == "ERROR":
            raise UpstreamError("SIA returned QUERY_STATUS=ERROR")
        return LiveResponse(resp.body, resp.url, resp.status, resp.content_type, {"maxrec": n})

    served = ctx.cache.fetch(key, live, refresh=refresh)
    return _result(served.entry, served)
