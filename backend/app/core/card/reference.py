"""Reference-object cards (issue #71 stream E, Q-258): Jupiter, Saturn, Titan and the Sun.

Built deterministically from ``backend/assets/reference_objects.toml`` (curated, read-only config).
``scripts/bake_reference_objects.py`` writes them into the pre-built pack; the object pipeline
builds the same card at run time when the pre-built asset is missing or stale, so a reference
object never falls through to the catalogue stages (it is not a SPHEREx target).
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

M_EARTH_1E24_KG = 5.9722  # NASA Planetary Fact Sheet, Earth mass
R_JUP_KM = 71492.0  # IAU 2015 B3 nominal equatorial radius, the card's radius_rjup unit
KM_PER_AU = 149_597_870.7  # IAU 2012 B2, exact


def _tv(
    value: float, source: str, tag: str = "measured", formula: str | None = None
) -> dict[str, Any]:
    out: dict[str, Any] = {"value": value, "tag": tag, "source": source}
    if formula:
        out["formula"] = formula
    return out


HUYGENS = (
    "Huygens Atmospheric Structure Instrument at the landing site, Fulchignoni et al. 2005, "
    "Nature 438, 785, as quoted by NASA NTRS 20240013879 (Vuitton et al., Titan's Atmospheric "
    "Structure, Composition, Haze, and Dynamics)"
)
CASSINI_LAKES = (
    "liquid methane (with ethane) lakes and seas seen by Cassini radar: Stofan et al. 2007, "
    "Nature 445, 61; Brown et al. 2008, Nature 454, 607 [verify: not fetched]"
)
R_SUN_KM = 695700.0  # IAU 2015 B3 nominal solar radius (the Sun fact sheet's 695,700 km)


def _tv_str(value: str, source: str) -> dict[str, Any]:
    return {"value": value, "tag": "measured", "source": source}


def titan_card(row: dict[str, Any]) -> dict[str, Any]:
    """A moon drawn by the rocky-world path (Q-280). The host is the Sun, the orbit is Saturn's."""
    src = f"{row['source']} (nssdc.gsfc.nasa.gov/planetary/factsheet/saturniansatfact.html)"
    host = f"{row['host_source']} (nssdc.gsfc.nasa.gov/planetary/factsheet)"
    conv = " converted to the card's unit"
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "radius_rjup": _tv(round(row["radius_km"] / R_JUP_KM, 5), f"{src}: radius{conv}"),
        "mass_mearth": _tv(
            round(row["mass_1e20_kg"] * 1e-4 / M_EARTH_1E24_KG, 5), f"{src}: mass{conv}"
        ),
        "rot_period_h": _tv(
            round(row["moon_orbital_period_d"] * 24, 3),
            f"{src}: orbital period, rotation marked S (synchronous)",
            tag="derived",
            formula="rotation period = orbital period x 24 h/d (the sheet marks Titan synchronous)",
        ),
        "orbit_au": _tv(
            round(row["semimajor_axis_1e6_km"] * 1e6 / KM_PER_AU, 4),
            f"{host}: Saturn's semimajor axis, the distance from the Sun{conv}",
        ),
        "surface_pressure_bar": _tv(row["surface_pressure_bar"], HUYGENS),
        "surface_temperature_K": _tv(row["surface_temperature_K"], HUYGENS),
        "surface_fluid": _tv_str(row["surface_fluid"], CASSINI_LAKES),
        "host_teff_K": _tv(row["host_teff_K"], f"{host}: Sun effective temperature"),
        "host_radius_rsun": _tv(
            round(row["host_radius_km"] / R_SUN_KM, 4), f"{host}: Sun volumetric mean radius{conv}"
        ),
    }


def sun_card(row: dict[str, Any]) -> dict[str, Any]:
    """A star from the Sun fact sheet (Q-307); spectral class G2V, the MK standard (measured)."""
    url = "nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html"
    src = f"{row['source']} ({url})"
    return {
        "id": row["id"],
        "name": row["name"],
        "type": "star",
        "radius_rsun": _tv(round(row["radius_km"] / R_SUN_KM, 4), f"{src}: volumetric mean radius"),
        "teff_K": _tv(row["teff_K"], f"{src}: effective temperature"),
        "rot_period_h": _tv(
            row["rot_period_h"], f"{src}: sidereal rotation period, adopted at 16 deg latitude"
        ),
        "spectral_class": _tv_str(row["spectral_class"], row["spectral_class_source"]),
    }


def card_of(row: dict[str, Any]) -> dict[str, Any]:
    if row.get("type") == "star":
        return sun_card(row)
    if row.get("type") == "planet_rocky":
        return titan_card(row)
    src = f"{row['source']} (nssdc.gsfc.nasa.gov/planetary/factsheet)"
    conv = " converted to the card's unit"
    return {
        "id": row["id"],
        "name": row["name"],
        "type": "gas_giant",
        "radius_rjup": _tv(
            round(row["radius_km"] / R_JUP_KM, 5), f"{src}: equatorial radius at 1 bar{conv}"
        ),
        "mass_mearth": _tv(round(row["mass_1e24_kg"] / M_EARTH_1E24_KG, 3), f"{src}: mass{conv}"),
        "rot_period_h": _tv(row["rot_period_h"], f"{src}: sidereal rotation period, System III"),
        "orbit_au": _tv(
            round(row["semimajor_axis_1e6_km"] * 1e6 / KM_PER_AU, 4), f"{src}: semimajor axis{conv}"
        ),
        "orbital_period_d": _tv(row["orbital_period_d"], f"{src}: sidereal orbit period"),
        "teq_K": _tv(row["teq_K"], f"{src}: blackbody temperature"),
    }


def reference_rows(path: Path) -> list[dict[str, Any]]:
    """The ``[[object]]`` rows of ``reference_objects.toml``; empty when the file is missing."""
    try:
        doc = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = doc.get("object", [])
    return [r for r in rows if isinstance(r, dict)]


def reference_card(path: Path, object_id: str) -> dict[str, Any] | None:
    """The card of reference object ``object_id``, or None when the file has no such row."""
    for row in reference_rows(path):
        if row.get("id") == object_id:
            return card_of(row)
    return None
