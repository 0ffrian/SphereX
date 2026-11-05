"""Cache keys (D-25): source + data release + normalised query, hashed with SHA-256."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

NO_RELEASE = "-"
COORD_DP = 5  # 1e-5 deg = 0.036 arcsec


def norm_float(value: float, dp: int) -> str:
    """Fixed-point text; ``-0.0`` becomes ``0.0`` so equal positions share a key."""
    v = round(float(value), dp)
    if v == 0.0:
        v = 0.0
    return f"{v:.{dp}f}"


def norm_ra(ra: float, dp: int = COORD_DP) -> str:
    """RA in [0, 360) after rounding (359.999999 rounds to 0, not 360)."""
    v = round(float(ra) % 360.0, dp) % 360.0
    return norm_float(v, dp)


def norm_dec(dec: float, dp: int = COORD_DP) -> str:
    return norm_float(dec, dp)


def norm_name(name: str) -> str:
    """Collapse whitespace. Case is kept: some catalogue identifiers are case-sensitive."""
    return re.sub(r"\s+", " ", name).strip()


@dataclass(frozen=True)
class CacheKey:
    source: str
    release: str
    query: tuple[tuple[str, str], ...]

    @classmethod
    def make(cls, source: str, release: str | None, **query: str) -> CacheKey:
        return cls(source, release or NO_RELEASE, tuple(sorted(query.items())))

    def canonical(self) -> str:
        return json.dumps(
            {"source": self.source, "release": self.release, "query": dict(self.query)},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.canonical().encode("ascii")).hexdigest()
