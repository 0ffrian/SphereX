"""Issue #93 section 5 A-C: eccentricity, insolation, host luminosity, Gaia FLAME luminosity and
mass, and the curated rotation, flare and phase-curve rows of the literature registry."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.adapters import exoplanet_archive as ea
from app.adapters import gaia
from app.core.card import build, stars
from app.core.card import literature as lit
from app.core.card.validate import errors

ASSETS = Path(__file__).resolve().parent.parent / "assets"
REF = "<a refstr=X href=https://example.org target=ref>Someone et al. 2020</a>"
CALC = "<a refstr=CALCULATED_VALUE href=/docs/pscp_calc.html target=ref>Calculated Value</a>"


def test_archive_query_asks_for_the_new_columns() -> None:
    for c in (
        "pl_orbeccen",
        "pl_orbeccenerr1",
        "pl_orbeccenerr2",
        "pl_orbeccen_reflink",
        "pl_insol",
        "pl_insol_reflink",
        "st_lum",
        "st_lumerr1",
        "st_lum_reflink",
        "pl_eqt_reflink",
    ):
        assert c in ea.COLUMNS
    # The cache key carries the column version, so an older reply is never served (Q-150).
    assert ea.archive_key(["x"]).query == (("cols", "3"), ("pl_name", "x"))


def test_eccentricity_measured_zero_and_refused() -> None:
    ecc = build._eccentricity(
        {
            "pl_orbeccen": 0.05,
            "pl_orbeccenerr1": 0.03,
            "pl_orbeccenerr2": -0.03,
            "pl_orbeccen_reflink": REF,
        }
    )
    assert ecc["value"] == 0.05 and ecc["tag"] == "measured" and ecc["err"] == 0.03
    assert "Someone et al. 2020" in ecc["source"]
    # e = 0 with no uncertainty: a circular orbit assumed in the fit, not a measurement.
    zero = build._eccentricity({"pl_orbeccen": 0.0, "pl_orbeccen_reflink": REF})
    assert zero["value"] == 0.0 and zero["tag"] == "model_dependent" and zero["assumption"]
    calc = build._eccentricity({"pl_orbeccen": 0.1, "pl_orbeccen_reflink": CALC})
    assert calc["tag"] == "model_dependent"
    for bad in (None, 1.0, -0.1, "nan"):
        out = build._eccentricity({"pl_orbeccen": bad})
        assert out["value"] is None and out["source"].startswith("not available")


def test_insolation_is_derived_and_host_luminosity_unlogged() -> None:
    s = build._insolation({"pl_insol": 356.0, "pl_insolerr1": 13.0, "pl_insol_reflink": REF})
    assert s["value"] == 356.0 and s["tag"] == "derived" and "L_star" in s["formula"]
    assert build._insolation({})["value"] is None
    lum = build._host_luminosity(
        {"st_lum": -0.5, "st_lumerr1": 0.02, "st_lumerr2": -0.01, "st_lum_reflink": REF}
    )
    assert lum["tag"] == "measured" and lum["value"] == pytest.approx(10**-0.5)
    assert lum["err"] == pytest.approx(10**-0.48 - 10**-0.5)  # the larger side
    assert build._host_luminosity({})["value"] is None
    assert build._host_luminosity({"st_lum": 0.1, "st_lum_reflink": CALC})["tag"] == (
        "model_dependent"
    )


def test_planet_card_carries_the_new_fields_and_validates() -> None:
    card: dict[str, Any] = {"id": "x", "name": "x b", "type": "gas_giant"}
    build._planet_extras(card, {"pl_orbeccen": 0.2, "pl_orbeccen_reflink": REF})
    for f in ("orbit_ecc", "insolation_searth", "host_lum_lsun", *build.PHASE_CURVE_FIELDS):
        assert f in card
    for f in build.PHASE_CURVE_FIELDS:
        assert card[f]["value"] is None and "literature registry" in card[f]["source"]
    assert errors(card, "object-card.schema.json") == []


def _astro(**kw: Any) -> gaia.GaiaAstro:
    base: dict[str, Any] = {
        "source_id": "1",
        "ra": 1.0,
        "dec": 2.0,
        "g_mag": 5.0,
        "teff_gspphot_k": 5000.0,
        "teff_gspphot_lower_k": None,
        "teff_gspphot_upper_k": None,
        "radius_flame_rsun": 0.8,
        "radius_flame_lower_rsun": None,
        "radius_flame_upper_rsun": None,
    }
    return gaia.GaiaAstro(**{**base, **kw})


def test_flame_luminosity_and_mass_follow_the_radius_rule() -> None:
    cat = stars.StarCatalogue(
        gaia=_astro(
            lum_flame_lsun=0.34,
            lum_flame_lower_lsun=0.335,
            lum_flame_upper_lsun=0.345,
            mass_flame_msun=0.81,
            mass_flame_lower_msun=0.77,
            mass_flame_upper_msun=0.85,
        ),
        gaia_sep_arcsec=0.1,
    )
    lum = stars.luminosity_field(cat)
    assert lum["value"] == 0.34 and lum["tag"] == "model_dependent" and lum["assumption"]
    assert "lum_flame" in lum["source"] and lum["err"] == pytest.approx(0.005)
    mass = stars.mass_field(cat)
    assert (
        mass["value"] == 0.81 and mass["tag"] == "model_dependent" and "BaSTI" in mass["assumption"]
    )
    # No FLAME value, no Gaia match, no query: refused with the reason, never guessed.
    assert stars.mass_field(stars.StarCatalogue(gaia=_astro()))["value"] is None
    none = stars.luminosity_field(stars.StarCatalogue(gaia_reason="no Gaia DR3 source"))
    assert none["value"] is None and "no Gaia DR3 source" in none["source"]
    assert stars.luminosity_field(None)["value"] is None
    # A percentile range rounded to nothing gives no err (not a zero error).
    flat = stars.luminosity_field(
        stars.StarCatalogue(
            gaia=_astro(
                lum_flame_lsun=0.003, lum_flame_lower_lsun=0.003, lum_flame_upper_lsun=0.003
            )
        )
    )
    assert "err" not in flat


def test_gaia_astro_query_and_key_carry_the_flame_columns() -> None:
    for c in ("lum_flame", "lum_flame_lower", "mass_flame", "mass_flame_upper"):
        assert c in gaia.ASTRO_COLUMNS
    assert "a.lum_flame" in gaia.astro_adql("gaia_dr3_source", "1", "2", "0.001")
    assert dict(gaia.astro_key(1.0, 2.0).query)["cols"] == "msc1-flame2"


@pytest.mark.parametrize(
    ("key", "field", "value", "err"),
    [
        ("simbad-eps-eri", "rot_period_h", 278.88, 3.6),
        ("simbad-name-barnard-s-star", "rot_period_h", 3480.0, 360.0),
        ("simbad-trappist-1", "rot_period_h", 79.2, 3.36),
        ("simbad-trappist-1", "flare_rate_per_d", 0.26, None),
        ("simbad-hd-189733b", "dayside_temp_K", 1192.0, 9.0),
        ("simbad-hd-189733b", "nightside_temp_K", 928.0, 33.0),
        ("simbad-hd-189733b", "hotspot_offset_deg", 33.7, 2.5),
        ("simbad-wasp-39b", "dayside_temp_K", 1055.0, 65.0),
        ("simbad-rho01-cnc-e", "dayside_temp_K", 2700.0, 270.0),
        ("simbad-rho01-cnc-e", "nightside_temp_K", 1380.0, 400.0),
        ("simbad-rho01-cnc-e", "hotspot_offset_deg", 41.0, 12.0),
    ],
)
def test_registry_rows_load_measured_with_band_and_citation(
    key: str, field: str, value: float, err: float | None
) -> None:
    tv = lit.load_literature(ASSETS / "literature.toml", key).tv(field)
    assert tv is not None and tv["value"] == value and tv.get("err") == err
    assert tv["tag"] == "measured" and tv["source"].startswith("literature: ")
    if field.endswith("_K") or field == "hotspot_offset_deg":
        assert "4.5 um" in tv["source"]  # a brightness temperature names its band


def test_registry_refusals_keep_missing_values_refused() -> None:
    wasp = lit.load_literature(ASSETS / "literature.toml", "simbad-wasp-39b")
    assert "phase curve" in wasp.refusals["nightside_temp_K"]
    assert "hotspot_offset_deg" in wasp.refusals
    for key in ("simbad-eps-eri", "simbad-name-barnard-s-star"):
        assert "flare_rate_per_d" in lit.load_literature(ASSETS / "literature.toml", key).refusals
