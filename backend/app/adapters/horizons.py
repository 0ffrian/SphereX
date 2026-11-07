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
# SPHEREx spacecraft as the observer (astro-verifier, 7 Nov 2026: Horizons id -163182; checked
# live the same day, "Center body name: SPHEREx (spacecraft) (-163182)", covering 2025-04-01 to
# 2026-06-01). Used for the moving-object frame positions (issue #26): from low Earth orbit the
# geocentric parallax of a near-Earth asteroid can exceed a 6.15" pixel.
SPHEREX_CENTER = "500@-163182"
SPHEREX_BASIS = (
    "JPL Horizons orbit solution; astrometric RA/Dec (ICRF) seen from the SPHEREx spacecraft "
    f"(CENTER={SPHEREX_CENTER}), TIME_TYPE=UT"
)
# Horizons answers at most about 90,024 lines per request (astro-verifier, 7 Nov 2026); longer
# ranges are split into requests of at most this many samples.
MAX_LINES = 90_000


@dataclass(frozen=True)
class EphemPoint:
    time: datetime
    ra: float
    dec: float


def jd_list(times: list[datetime]) -> list[str]:
    return [f"{utc_to_jd(t):.6f}" for t in times]


def horizons_key(spkid: str, jds: list[str], center: str = CENTER) -> CacheKey:
    return CacheKey.make(SOURCE, None, command=f"DES={spkid};", center=center, tlist=",".join(jds))


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
    ctx: Context,
    spkid: str,
    times: list[datetime],
    *,
    refresh: bool = False,
    center: str = CENTER,
) -> tuple[list[EphemPoint], Served]:
    jds = jd_list(times)
    key = horizons_key(spkid, jds, center)

    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'DES={spkid};'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'{center}'",
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


# Moving-object frame search (issue #26, Q-21): one ephemeris over the data release window,
# sampled on a fixed grid, instead of one TLIST time per call.
RANGE_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def range_key(
    spkid: str, start: datetime, stop: datetime, step_min: int, center: str = SPHEREX_CENTER
) -> CacheKey:
    return CacheKey.make(
        SOURCE,
        None,
        command=f"DES={spkid};",
        center=center,
        start=start.astimezone(UTC).strftime(RANGE_TIME_FORMAT),
        stop=stop.astimezone(UTC).strftime(RANGE_TIME_FORMAT),
        step=f"{int(step_min)}m",
    )


def ephemeris_range(
    ctx: Context,
    spkid: str,
    start: datetime,
    stop: datetime,
    step_min: int,
    *,
    refresh: bool = False,
    center: str = SPHEREX_CENTER,
) -> tuple[list[EphemPoint], Served]:
    """Positions from ``start`` to ``stop`` (UT) every ``step_min`` minutes, one Horizons call
    (the caller keeps a call under ``MAX_LINES`` samples).

    Same target, quantities and precision as ``ephemeris``; ``TIME_DIGITS=FRACSEC`` keeps the
    time column in the ``%Y-%b-%d %H:%M:%S.%f`` form the parser reads.
    """
    key = range_key(spkid, start, stop, step_min, center)
    q = dict(key.query)

    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'DES={spkid};'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'{center}'",
            "START_TIME": f"'{q['start']}'",
            "STOP_TIME": f"'{q['stop']}'",
            "STEP_SIZE": f"'{int(step_min)} m'",
            "TIME_TYPE": "UT",  # [verify] START/STOP read as UT, as for TLIST
            "TIME_DIGITS": "FRACSEC",
            "QUANTITIES": "'1'",
            "ANG_FORMAT": "DEG",
            "CSV_FORMAT": "YES",
            "EXTRA_PREC": "YES",
        }
        resp = ctx.http.get(ctx.settings.horizons_url, params)
        try:
            if not parse(resp.body):
                raise ValueError("Horizons ephemeris block is empty")
        except ValueError as exc:
            raise UpstreamError(str(exc)) from exc
        return resp

    served = ctx.cache.fetch(key, live, refresh=refresh)
    rows = parse(served.entry.body)
    points = [EphemPoint(_parse_horizons_time(t), ra, dec) for t, ra, dec in rows]
    return points, served
