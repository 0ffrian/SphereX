"""JPL Horizons observer ephemeris (A3.4).

Positions are predictions from JPL's orbit solution, so callers tag them ``model_dependent``.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey
from app.cache.store import CacheMissOffline, LiveResponse, Served, UpstreamUnavailable
from app.context import Context
from app.timefmt import utc_to_jd

SOURCE = "horizons"
# [verify] geocentre. SPHEREx is in low Earth orbit; a spacecraft-centred ephemeris would
# remove the small parallax for near-Earth objects.
CENTER = "500@399"
GEOCENTRE = CENTER
BASIS = "JPL Horizons orbit solution; geocentric astrometric RA/Dec (ICRF), TIME_TYPE=UT"
# SPHEREx spacecraft as the observer (astro-verifier, 7 Nov 2026: Horizons id -163182; checked
# live the same day, "Center body name: SPHEREx (spacecraft) (-163182)", covering 2025-04-01 to
# 2026-06-01). Used for the phase angle (R5.1) and the moving-object frame positions (issue
# #26): from low Earth orbit the geocentric parallax of a near-Earth asteroid can exceed a
# 6.15" pixel.
OBSERVER_SPHEREX = "500@-163182"
SPHEREX_BASIS = (
    "JPL Horizons orbit solution; astrometric RA/Dec (ICRF) seen from the SPHEREx spacecraft "
    f"(CENTER={OBSERVER_SPHEREX}), TIME_TYPE=UT"
)
# Horizons answers at most about 90,024 lines per request (astro-verifier, 7 Nov 2026); longer
# ranges are split into requests of at most this many samples, leaving room for the header.
MAX_LINES = 85_000


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
            # TLIST read as UT: recorded JD 2461119.856750 is answered as 2026-Mar-20 08:33:43.200
            "TIME_TYPE": "UT",
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


# --- Lighting geometry (R5.1): phase angle and Sun direction --------------------------------
# R5.1: phase angle from Horizons quantity 24 with observer SPHEREx (OBSERVER_SPHEREX above).
SUN_CENTER = "500@10"  # Sun body centre: the target's heliocentric vector (ICRF)


class NoEphemeris(UpstreamError):
    """Horizons answered, but has no ephemeris for this observer at the epoch."""


# What Horizons says when it has no data for a body at the epoch ("No ephemeris for target ...
# prior to A.D. ...") and the placeholder it prints in a quantity column it cannot compute.
_NO_EPHEMERIS = re.compile(r"no ephemeris for", re.IGNORECASE)
_NOT_AVAILABLE = "n.a."


def _is_no_ephemeris(body: bytes) -> bool:
    """True only for Horizons' own "no ephemeris" answers, not for any unparsable reply."""
    try:
        text = _result_text(body)
    except ValueError:
        return False
    if _NO_EPHEMERIS.search(text):
        return True
    try:
        return any(len(c) >= 6 and c[5] == _NOT_AVAILABLE for c in _soe_rows(body))
    except ValueError:
        return False


@dataclass(frozen=True)
class Geometry:
    """Lighting geometry of a moving target at ``time``.

    ``sun_vector`` is the unit vector from the target to the Sun in ICRF (equatorial J2000),
    ``-r/|r|`` for the heliocentric position r. ``observer`` is the centre the phase angle was
    computed for: SPHEREx, or the geocentre when Horizons has no SPHEREx ephemeris at the epoch.
    """

    phase_angle_deg: float
    sun_vector: tuple[float, float, float]
    r_au: float
    time: datetime
    observer: str


def _result_text(body: bytes) -> str:
    doc = json.loads(body)
    return str(doc.get("result", "")) if isinstance(doc, dict) else ""


def _soe_rows(body: bytes) -> list[list[str]]:
    text = _result_text(body)
    if "$$SOE" not in text:
        raise ValueError("Horizons result has no ephemeris block")
    block = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    return [[c.strip() for c in ln.split(",")] for ln in block.strip().splitlines() if ln.strip()]


def parse_phase_angle(body: bytes) -> float:
    """S-T-O angle in degrees: the column after RA/Dec in an OBSERVER row (QUANTITIES 1,24)."""
    for cols in _soe_rows(body):
        if len(cols) >= 6 and cols[5]:
            try:
                value = float(cols[5])
            except ValueError as exc:
                raise ValueError(f"bad phase angle {cols[5]!r}") from exc
            if not 0.0 <= value <= 180.0:
                raise ValueError(f"phase angle {value} outside 0..180")
            return value
    raise ValueError("Horizons result has no phase angle column")


def parse_vectors(body: bytes) -> tuple[float, float, float]:
    """Heliocentric X, Y, Z in au (ICRF) from a VEC_TABLE=1 CSV row: JD, date, X, Y, Z."""
    for cols in _soe_rows(body):
        if len(cols) >= 5 and cols[2] and cols[3] and cols[4]:
            try:
                x, y, z = float(cols[2]), float(cols[3]), float(cols[4])
            except ValueError as exc:
                raise ValueError("bad state vector") from exc
            return x, y, z
    raise ValueError("Horizons result has no state vector")


def sun_unit_vector(r: tuple[float, float, float]) -> tuple[tuple[float, float, float], float]:
    norm = math.sqrt(sum(c * c for c in r))
    if not math.isfinite(norm) or norm == 0.0:
        raise ValueError("zero-length heliocentric vector")
    return (-r[0] / norm, -r[1] / norm, -r[2] / norm), norm


def phase_key(spkid: str, jd: str, center: str) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, command=f"DES={spkid};", center=center, tlist=jd, quantities="1,24"
    )


def vectors_key(spkid: str, jd: str) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, command=f"DES={spkid};", center=SUN_CENTER, tlist=jd, ephem_type="VECTORS"
    )


def _fetch_phase(
    ctx: Context, spkid: str, jd: str, center: str, refresh: bool
) -> tuple[float, Served]:
    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'DES={spkid};'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'{center}'",
            "TLIST_TYPE": "JD",
            "TIME_TYPE": "UT",
            "TLIST": f"'{jd}'",
            "QUANTITIES": "'1,24'",
            "ANG_FORMAT": "DEG",
            "CSV_FORMAT": "YES",
            "EXTRA_PREC": "YES",
        }
        resp = ctx.http.get(ctx.settings.horizons_url, params)
        try:
            parse_phase_angle(resp.body)
        except ValueError as exc:
            if _is_no_ephemeris(resp.body):
                raise NoEphemeris(str(exc)) from exc
            raise UpstreamError(str(exc)) from exc
        return resp

    served = ctx.cache.fetch(phase_key(spkid, jd, center), live, refresh=refresh)
    return parse_phase_angle(served.entry.body), served


def _fetch_vectors(
    ctx: Context, spkid: str, jd: str, refresh: bool
) -> tuple[tuple[float, float, float], Served]:
    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'DES={spkid};'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "VECTORS",
            "CENTER": f"'{SUN_CENTER}'",
            "TLIST_TYPE": "JD",
            "TLIST": f"'{jd}'",
            "VEC_TABLE": "1",
            "REF_PLANE": "FRAME",  # ICRF equatorial, not the ecliptic default
            "OUT_UNITS": "AU-D",
            "CSV_FORMAT": "YES",
        }
        resp = ctx.http.get(ctx.settings.horizons_url, params)
        try:
            parse_vectors(resp.body)
        except ValueError as exc:
            raise UpstreamError(str(exc)) from exc
        return resp

    served = ctx.cache.fetch(vectors_key(spkid, jd), live, refresh=refresh)
    return parse_vectors(served.entry.body), served


def geometry(
    ctx: Context, spkid: str, time: datetime, *, refresh: bool = False
) -> tuple[Geometry, list[Served]]:
    """Phase angle (observer SPHEREx, else geocentre) and Sun direction at ``time``.

    Live, only Horizons' own "no ephemeris" answer for the SPHEREx observer (``NoEphemeris``:
    a "No ephemeris for ..." message or an ``n.a.`` phase column) falls back to the geocentre;
    an outage or an unparsable reply is raised, so the observer never depends on a transient
    error. Offline, a SPHEREx cache miss
    tries the recorded geocentre answer (what a live run that fell back left in the cache).

    The VECTORS call sends no TIME_TYPE, so its JD is read as TDB, about 69 s after the UT
    phase-angle epoch; negligible for a direction (Q-62).
    """
    jd = f"{utc_to_jd(time):.6f}"
    observer = OBSERVER_SPHEREX
    try:
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh)
    except CacheMissOffline:
        observer = GEOCENTRE
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh)
    except UpstreamUnavailable as exc:
        if not isinstance(exc.__cause__, NoEphemeris):
            raise
        observer = GEOCENTRE
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh)
    r, served_v = _fetch_vectors(ctx, spkid, jd, refresh)
    unit, norm = sun_unit_vector(r)
    return Geometry(phase, unit, norm, time, observer), [served_p, served_v]


# Moving-object frame search (issue #26, Q-21): one ephemeris over the data release window,
# sampled on a fixed grid, instead of one TLIST time per call.
RANGE_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def range_key(
    spkid: str, start: datetime, stop: datetime, step_min: int, center: str = OBSERVER_SPHEREX
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
    center: str = OBSERVER_SPHEREX,
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
            "TIME_TYPE": "UT",  # START/STOP read as UT, as for TLIST (recorded fixtures)
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
