"""Time helpers. Every time field in the API is ISO-8601 UTC with a trailing ``Z`` (brief).

Plain ``datetime`` arithmetic is used instead of ``astropy.time`` so nothing here can trigger an
IERS or leap-second download (SX_OFFLINE, D-25).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

UNIX_EPOCH_JD = 2440587.5
MJD_OFFSET = 2400000.5
# J2000.0 is 2000-01-01T12:00:00 TT, which is 11:58:55.816 UTC.
J2000_UTC = datetime(2000, 1, 1, 11, 58, 55, 816000, tzinfo=UTC)
JULIAN_YEAR_DAYS = 365.25


def iso_utc_z(dt: datetime) -> str:
    """ISO-8601 UTC, millisecond precision, trailing ``Z``."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_utc(text: str) -> datetime:
    """Parse ISO-8601; a value without an offset is taken as UTC (FITS ``TIMESYS='UTC'``)."""
    t = text.strip()
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    dt = datetime.fromisoformat(t)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def mjd_to_utc(mjd: float) -> datetime:
    return datetime(1858, 11, 17, tzinfo=UTC) + timedelta(days=mjd)


def utc_to_jd(dt: datetime) -> float:
    return UNIX_EPOCH_JD + dt.astimezone(UTC).timestamp() / 86400.0


def julian_years_since_j2000(dt: datetime) -> float:
    return (dt.astimezone(UTC) - J2000_UTC).total_seconds() / 86400.0 / JULIAN_YEAR_DAYS
