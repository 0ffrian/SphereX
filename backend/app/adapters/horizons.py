"""JPL Horizons observer ephemeris (A3.4).

Positions are predictions from JPL's orbit solution, so callers tag them ``model_dependent``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey
from app.cache.store import LiveResponse, Served
from app.context import Context
from app.timefmt import utc_to_jd

SOURCE = "horizons"
# [verify] geocentre. SPHEREx is in low Earth orbit; a spacecraft-centred ephemeris would
# remove the small parallax for near-Earth objects.
CENTER = "500@399"
BASIS = "JPL Horizons orbit solution; geocentric astrometric RA/Dec (ICRF), TIME_TYPE=UT"


@dataclass(frozen=True)
class EphemPoint:
    time: datetime
    ra: float
    dec: float


def jd_list(times: list[datetime]) -> list[str]:
    return [f"{utc_to_jd(t):.6f}" for t in times]


def horizons_key(spkid: str, jds: list[str]) -> CacheKey:
    return CacheKey.make(SOURCE, None, command=f"DES={spkid};", center=CENTER, tlist=",".join(jds))


def parse(body: bytes) -> list[tuple[str, float, float]]:
    doc = json.loads(body)
    text = str(doc.get("result", ""))
    if "$$SOE" not in text:
        raise ValueError("Horizons result has no ephemeris block")
    block = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    out: list[tuple[str, float, float]] = []
    for line in block.strip().splitlines():
        cols = [c.strip() for c in line.split(",")]
        if len(cols) >= 5 and cols[3] and cols[4]:
            out.append((cols[0], float(cols[3]), float(cols[4])))
    return out


def _parse_horizons_time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%b-%d %H:%M:%S.%f").replace(tzinfo=UTC)


def ephemeris(
    ctx: Context, spkid: str, times: list[datetime], *, refresh: bool = False
) -> tuple[list[EphemPoint], Served]:
    jds = jd_list(times)
    key = horizons_key(spkid, jds)

    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'DES={spkid};'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'{CENTER}'",
            "TLIST_TYPE": "JD",
            "TIME_TYPE": "UT",  # [verify] TLIST read as UT
            "TLIST": " ".join(f"'{j}'" for j in jds),
            "QUANTITIES": "'1'",
            "ANG_FORMAT": "DEG",
            "CSV_FORMAT": "YES",
            "EXTRA_PREC": "YES",
        }
        resp = ctx.http.get(ctx.settings.horizons_url, params)
        try:
            parse(resp.body)
        except ValueError as exc:
            raise UpstreamError(str(exc)) from exc
        return resp

    served = ctx.cache.fetch(key, live, refresh=refresh)
    rows = parse(served.entry.body)
    points = [EphemPoint(_parse_horizons_time(t), ra, dec) for t, ra, dec in rows]
    return points, served
