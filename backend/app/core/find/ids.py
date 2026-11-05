"""Object ids and query parsing for Stage 1 (A4.1, D-19)."""

from __future__ import annotations

import re

from app.cache.keys import norm_dec, norm_ra
from app.core.find.constellations import is_flamsteed

COORD_RE = re.compile(r"^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$")
COORD_ID_RE = re.compile(r"^radec-(\d+\.\d+)([+-]\d+\.\d+)$")
ID_RE = r"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$"

# D-19: names that look like small bodies go to SBDB first.
SMALL_BODY_PATTERNS = (
    re.compile(r"^\d+(\s+\S.*)?$"),  # numbered asteroid: 433, 433 Eros
    re.compile(r"^\d{4}\s?[A-Z]{2}\d{0,3}$"),  # provisional designation: 2024 AB, 2024 AB12
    re.compile(r"^[PCDXAI]/"),  # comet or interstellar by prefix: C/2025 N1
    re.compile(r"^\d+[PCDI](/|-|$)"),  # numbered periodic or interstellar: 1P/Halley, 3I/ATLAS
)


class BadQuery(ValueError):
    pass


def parse_coords(q: str) -> tuple[float, float] | None:
    """``"ra,dec"`` in degrees, or ``None`` if ``q`` is not a coordinate pair."""
    m = COORD_RE.match(q)
    if not m:
        return None
    ra, dec = float(m.group(1)), float(m.group(2))
    if not (0.0 <= ra < 360.0) or not (-90.0 <= dec <= 90.0):
        raise BadQuery("RA must be in [0, 360) and Dec in [-90, 90] degrees.")
    return ra, dec


def coord_id(ra: float, dec: float) -> str:
    d = norm_dec(dec)
    return f"radec-{norm_ra(ra)}{d if d.startswith('-') else '+' + d}"


def parse_coord_id(object_id: str) -> tuple[float, float] | None:
    m = COORD_ID_RE.match(object_id)
    if not m:
        return None
    ra, dec = float(m.group(1)), float(m.group(2))
    if not (0.0 <= ra < 360.0) or not (-90.0 <= dec <= 90.0):
        return None
    return ra, dec


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def looks_like_small_body(name: str) -> bool:
    """D-19 shape test. Flamsteed star names (``61 Cyg``, ``51 Pegasi``) share the numbered-
    asteroid shape but go to SIMBAD first."""
    if is_flamsteed(name):
        return False
    return any(p.match(name.strip()) for p in SMALL_BODY_PATTERNS)
