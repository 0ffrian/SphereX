"""The static register of the Discovery hunts (A22.2, A22.7.1; issue #221). Metadata only: the
``Hunt`` protocol and its methods are HN-1.

Values the spec does not state for an unbuilt hunt follow Q-529: version ``0.0.0``, reason
``hunt:<id>:not_built``, ``search`` for H2's kind, ``light`` for H2, H7, H9 and H10. A route is
listed only where the spec marks it verified and gives its URL.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

SCHEMA = "hunt-register.schema.json"
UNBUILT_VERSION = "0.0.0"
# H4 runs today as Discovery (A17); its version bumps when the method or thresholds change.
ASTEROIDS_VERSION = "1.0.0"


def _hunt(
    hunt_id: str,
    title: str,
    summary: str,
    *,
    kind: str,
    level: str,
    weight: str,
    releases: tuple[str, ...],
    routes: tuple[dict[str, str], ...] = (),
    version: str = UNBUILT_VERSION,
    available: bool = False,
    reason: str | None = None,
) -> dict[str, Any]:
    availability: dict[str, str] = {"state": "available"}
    if not available:
        availability = {"state": "disabled", "reason": reason or f"hunt:{hunt_id}:not_built"}
    return {
        "id": hunt_id,
        "title": title,
        "summary": summary,
        "kind": kind,
        "level": level,
        "weight": weight,
        "version": version,
        "releases": list(releases),
        "routes": [dict(r) for r in routes],
        "availability": availability,
        "calibration": None,
    }


_VSX = {
    "id": "vsx",
    "url": "https://www.aavso.org/new-vsx-manual-data-submissions",
    "verified_at": "2026-11-18",
}

# In the order of the A22.2 table.
_REGISTER: tuple[dict[str, Any], ...] = (
    _hunt(
        "variables",
        "Variable and eclipsing stars",
        "Periodic stars, checked against VSX, Chen 2020 and Gaia's variables.",
        kind="search",
        level="experimental",
        weight="light",
        releases=("ZTF DR24 light curves", "Gaia DR3"),
        routes=(_VSX,),
    ),
    _hunt(
        "cold_worlds",
        "Cold nearby worlds",
        "Brown dwarfs moving across a decade of WISE images.",
        kind="search",
        level="experimental",
        weight="light",
        releases=("CatWISE2020", "unWISE", "unTimely", "SPHEREx"),
    ),
    _hunt(
        "asteroids",
        "Known rocks: spectra and precovery",
        "Measures known asteroids on their predicted paths: 0.75 to 5 µm spectra.",
        kind="characterisation",
        level="characterisation",
        weight="heavy",
        releases=("SPHEREx spectral images", "JPL Horizons"),
        version=ASTEROIDS_VERSION,
        available=True,
    ),
    _hunt(
        "runaways",
        "Runaway stars",
        "Stars far faster than their neighbours, traced back.",
        kind="search",
        level="experimental",
        weight="light",
        releases=("Gaia DR3",),
    ),
    _hunt(
        "ir_excess",
        "Infrared excess: SPHEREx spectra of candidates",
        "SPHEREx spectra of WISE excess stars, with a galaxy test.",
        kind="characterisation",
        level="characterisation",
        weight="light",
        releases=("WISE", "2MASS", "Gaia", "SPHEREx"),
    ),
    _hunt(
        "dimmers",
        "Single transits and strange dimmers",
        "Lone dips and odd shapes in TESS light curves.",
        kind="search",
        level="experimental",
        weight="light",
        releases=("TESS light curves",),
    ),
    _hunt(
        "active_asteroids",
        "Active asteroids",
        "Asteroids with a faint tail or haze in archive images.",
        kind="search",
        level="experimental",
        weight="heavy",
        releases=("DECam archive images", "ZTF archive images"),
    ),
    _hunt(
        "slow_movers",
        "Slow movers in TESS stares",
        "Shift-and-stack for faint, distant bodies; usually a limit.",
        kind="search",
        level="experimental",
        weight="heavy",
        releases=("TESS full-frame images",),
    ),
    _hunt(
        "transients",
        "Alerts in this patch",
        "What ZTF, Rubin and TNS already report here. No candidates.",
        kind="context",
        level="context",
        weight="light",
        releases=("ZTF alerts", "Rubin alerts", "TNS"),
    ),
    _hunt(
        "dark_companions",
        "Gaia DR4 dark companions",
        "Cross-match with Gaia's own black-hole table.",
        kind="context",
        level="context",
        weight="light",
        releases=("Gaia DR4",),
        reason="hunt:dark_companions:needs_release:gaia_dr4",
    ),
)


def register() -> list[dict[str, Any]]:
    """Every hunt, as ``GET /v1/hunts`` replies. A copy, so callers cannot change the register."""
    return deepcopy(list(_REGISTER))
