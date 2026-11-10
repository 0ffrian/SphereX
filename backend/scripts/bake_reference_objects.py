"""Bake the reference-object assets (issue #71 stream E, Q-258): Jupiter, Saturn and Titan.

    uv run python -m scripts.bake_reference_objects          # write assets/reference/ref-*.json
    uv run python -m scripts.bake_reference_objects --check  # exit 1 if a committed byte differs

Adds new assets only; the rest of the demo pack is untouched (re-baked once at integration).
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from typing import Any

from app.core.card.assets import Asset
from app.core.render.card_to_params import GENERATOR_VERSION, card_to_params
from app.settings import BACKEND_DIR, Settings
from scripts.bake_demo_pack import ASSETS_DIR, _asset, asset_path

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


def card_of(row: dict[str, Any]) -> dict[str, Any]:
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


def build(settings: Settings) -> list[Asset]:
    doc = tomllib.loads(
        (BACKEND_DIR / "assets" / "reference_objects.toml").read_text(encoding="utf-8")
    )
    out: list[Asset] = []
    for row in doc["object"]:
        card = card_of(row)
        params = card_to_params(card, generator_version=GENERATOR_VERSION)
        out.append(_asset(card, params, settings))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    bad = 0
    for asset in build(Settings()):
        path = ASSETS_DIR / "reference" / asset_path(asset).name
        text = json.dumps(asset.to_json(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                print(f"differs: {path}")
                bad += 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            print(f"wrote {path}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
