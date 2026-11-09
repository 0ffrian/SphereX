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


@dataclass(frozen=True)
class EphemPoint:
    time: datetime
    ra: float
    dec: float


def command(spkid: str, comet: bool = False) -> str:
    """The Horizons ``COMMAND`` for a small body by SPK-ID.

    A comet that has been seen on several apparitions has one orbit record per apparition, so
    ``DES=<id>;`` alone answers with the small-body index table and no ephemeris (live 2026-11-09:
    67P is SPK-ID 1000012 and has a dozen records). The ``CAP`` flag (closest apparition) picks
    one record; Horizons' API documentation describes it under "unique comet selection". It also
    works for a comet with a single record, but an asteroid has no apparitions and ``CAP`` finds
    nothing there, so only comets get it (Q-62 amendment).
    """
    return f"DES={spkid};CAP;" if comet else f"DES={spkid};"


def jd_list(times: list[datetime]) -> list[str]:
    return [f"{utc_to_jd(t):.6f}" for t in times]


def horizons_key(spkid: str, jds: list[str], comet: bool = False) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, command=command(spkid, comet), center=CENTER, tlist=",".join(jds)
    )


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
    ctx: Context, spkid: str, times: list[datetime], *, comet: bool = False, refresh: bool = False
) -> tuple[list[EphemPoint], Served]:
    jds = jd_list(times)
    key = horizons_key(spkid, jds, comet)

    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'{command(spkid, comet)}'",
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


# --- Lighting geometry (R5.1): phase angle and Sun direction --------------------------------
# R5.1: phase angle from Horizons quantity 24 with observer SPHEREx (NAIF -163182).
OBSERVER_SPHEREX = "500@-163182"
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


def phase_key(spkid: str, jd: str, center: str, comet: bool = False) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, command=command(spkid, comet), center=center, tlist=jd, quantities="1,24"
    )


def vectors_key(spkid: str, jd: str, comet: bool = False) -> CacheKey:
    return CacheKey.make(
        SOURCE,
        None,
        command=command(spkid, comet),
        center=SUN_CENTER,
        tlist=jd,
        ephem_type="VECTORS",
    )


def _fetch_phase(
    ctx: Context, spkid: str, jd: str, center: str, refresh: bool, comet: bool
) -> tuple[float, Served]:
    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'{command(spkid, comet)}'",
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

    served = ctx.cache.fetch(phase_key(spkid, jd, center, comet), live, refresh=refresh)
    return parse_phase_angle(served.entry.body), served


def _fetch_vectors(
    ctx: Context, spkid: str, jd: str, refresh: bool, comet: bool
) -> tuple[tuple[float, float, float], Served]:
    def live() -> LiveResponse:
        params = {
            "format": "json",
            "COMMAND": f"'{command(spkid, comet)}'",
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

    served = ctx.cache.fetch(vectors_key(spkid, jd, comet), live, refresh=refresh)
    return parse_vectors(served.entry.body), served


def geometry(
    ctx: Context, spkid: str, time: datetime, *, comet: bool = False, refresh: bool = False
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
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh, comet)
    except CacheMissOffline:
        observer = GEOCENTRE
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh, comet)
    except UpstreamUnavailable as exc:
        if not isinstance(exc.__cause__, NoEphemeris):
            raise
        observer = GEOCENTRE
        phase, served_p = _fetch_phase(ctx, spkid, jd, observer, refresh, comet)
    r, served_v = _fetch_vectors(ctx, spkid, jd, refresh, comet)
    unit, norm = sun_unit_vector(r)
    return Geometry(phase, unit, norm, time, observer), [served_p, served_v]
