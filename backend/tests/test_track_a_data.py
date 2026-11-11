"""Issue #68 Track A (Q-150 to Q-154), offline: card fields for planets, star Teff and radius,
the literature registry, the binary `components`, the comet Horizons command and name
resolution. Recorded replies only (the autouse guard blocks the network)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.adapters import gaia, horizons, simbad
from app.adapters.gaia import GaiaAstro
from app.adapters.simbad import TeffRow, VarRow
from app.cache.store import CacheMissOffline
from app.context import Context, make_context
from app.core.card import literature as lit
from app.core.card import stars
from app.core.card.assets import ASSET_VERSION
from app.core.card.build import build_card
from app.core.card.catalogue import (
    CatalogueData,
    apply_geometry,
    fetch_geometry,
    gather,
    nearest,
    with_star_data,
)
from app.core.card.stars import STAR_TYPES, StarCatalogue
from app.core.card.validate import errors
from app.core.classify import classify
from app.core.find.resolver import load_aliases, resolve
from app.core.render.card_to_params import card_to_params
from app.settings import BACKEND_DIR, Settings
from tests.conftest import TARGETS_FILE

CALC = "<a refstr=CALCULATED_VALUE href=/docs/pscp_calc.html target=_blank>Calculated Value</a>"
TABLE = stars.load_dwarf_table(BACKEND_DIR / "assets" / "pm13_dwarf_teff.toml")


@pytest.fixture
def ctx(offline_settings: Settings) -> Context:
    return make_context(offline_settings)


def card_of(ctx: Context, query: str) -> tuple[dict[str, Any], CatalogueData]:
    obj = resolve(ctx, query, load_aliases(TARGETS_FILE)).obj
    data = gather(ctx, obj)
    cls = classify(data.facts)
    if cls.type in STAR_TYPES:
        data = with_star_data(ctx, data, obj, cls.type)
    return build_card(obj, data, cls, None), data


def params_of(card: dict[str, Any]) -> dict[str, Any]:
    params = card_to_params(card)
    assert errors(params, "render-params.schema.json") == []
    return params


def layer(params: dict[str, Any], layer_id: str) -> dict[str, Any]:
    return next(x for x in params["layers"] if x["id"] == layer_id)


# --- Part 0.3: name resolution ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("spelling", "object_id", "planet"),
    [
        ("TRAPPIST-1 f", "simbad-trappist-1f", "TRAPPIST-1 f"),
        ("TRAPPIST-1f", "simbad-trappist-1f", "TRAPPIST-1 f"),
        ("Kepler-186 f", "simbad-kepler-186f", "Kepler-186 f"),
        ("Kepler-186f", "simbad-kepler-186f", "Kepler-186 f"),
    ],
)
def test_four_spellings_reach_the_archive_row(
    ctx: Context, spelling: str, object_id: str, planet: str
) -> None:
    """SIMBAD resolves both spellings (otype Pl) and `name_candidates` spaces the planet letter,
    so no alias is needed (Q-151). Recorded 9 Nov 2026."""
    obj = resolve(ctx, spelling, load_aliases(TARGETS_FILE)).obj
    assert obj.id == object_id
    data = gather(ctx, obj)
    assert data.facts.exoplanet is not None and data.facts.exoplanet["pl_name"] == planet
    assert data.missing == ()
    assert classify(data.facts).type == "planet_rocky"


# --- Part 1: planet fields ------------------------------------------------------------------------


NEW_PLANET_FIELDS = (
    "mass_mearth",
    "orbit_au",
    "orbital_period_d",
    "host_teff_K",
    "host_radius_rsun",
    "host_mass_msun",
    "host_age_gyr",
)


def test_trappist_1_f_fields_are_measured_with_their_references(ctx: Context) -> None:
    card, _ = card_of(ctx, "TRAPPIST-1 f")
    assert errors(card, "object-card.schema.json") == []
    values = {k: card[k]["value"] for k in NEW_PLANET_FIELDS}
    assert values == {
        "mass_mearth": 1.039,
        "orbit_au": 0.03849,
        "orbital_period_d": 9.20754,
        "host_teff_K": 2566.0,
        "host_radius_rsun": 0.1192,
        "host_mass_msun": 0.0898,
        "host_age_gyr": 7.6,
    }
    assert all(card[k]["tag"] == "measured" for k in NEW_PLANET_FIELDS)
    assert "Agol et al. 2021" in card["mass_mearth"]["source"]
    assert "Piaulet-Ghorayeb et al. 2025" in card["host_age_gyr"]["source"]
    assert card["mass_mearth"]["err"] == pytest.approx(0.031)


def test_kepler_186_f_mass_is_a_mass_radius_estimate_not_a_measurement(ctx: Context) -> None:
    card, _ = card_of(ctx, "Kepler-186 f")
    mass = card["mass_mearth"]
    assert mass["value"] == 1.71 and mass["tag"] == "model_dependent"
    assert "Chen & Kipping 2017" in mass["assumption"] and "err" not in mass
    assert card["host_age_gyr"]["value"] == 4.0 and card["host_age_gyr"]["tag"] == "measured"
    assert card["orbit_au"]["value"] == 0.432


def row(**kw: Any) -> dict[str, Any]:
    return {"pl_name": "X b", "pl_radj": 0.1, **kw}


def planet_card(r: dict[str, Any]) -> dict[str, Any]:
    from app.core.card.build import _planet_fields

    card: dict[str, Any] = {}
    _planet_fields(card, r)
    return card


@pytest.mark.parametrize(
    ("prov", "tag", "key"),
    [
        ("Mass", "measured", None),
        ("Msini", "model_dependent", "assumption"),
        ("Msin(i)/sin(i)", "derived", "formula"),
        ("M-R relationship", "model_dependent", "assumption"),
    ],
)
def test_mass_tag_follows_pl_bmassprov(prov: str, tag: str, key: str | None) -> None:
    mass = planet_card(row(pl_bmasse=5.0, pl_bmassprov=prov))["mass_mearth"]
    assert mass["value"] == 5.0 and mass["tag"] == tag
    if key:
        assert mass[key].strip()
    if prov == "Msini":
        assert "lower limit" in mass["assumption"]


@pytest.mark.parametrize(
    "reflink",
    [
        CALC,
        "<a refstr=DUCROT_ET_AL__2020 href=https://ui.adsabs.harvard.edu/abs/2020A&A...640A.112D/"
        "abstract target=ref>Ducrot et al. 2020</a>",
    ],
)
def test_pl_eqt_is_derived_with_its_assumption_never_measured(reflink: str) -> None:
    """#93 3.5: pl_eqt assumes an albedo and a heat redistribution, so it is ``derived`` with that
    assumption stated, whether the archive calculated it or a paper did."""
    teq = planet_card(row(pl_eqt=249.7, pl_eqt_reflink=reflink))["teq_K"]
    assert teq["value"] == 249.7 and teq["tag"] == "derived"
    assert teq["formula"].strip() and "albedo" in teq["assumption"]
    assert "not a measured one" in teq["assumption"]


def test_calculated_mass_is_never_measured_even_with_provenance_mass() -> None:
    mass = planet_card(row(pl_bmasse=5.0, pl_bmassprov="Mass", pl_bmasse_reflink=CALC))
    assert mass["mass_mearth"]["tag"] == "model_dependent"


def test_unknown_mass_provenance_and_missing_values_are_refused_with_a_reason() -> None:
    card = planet_card(row(pl_bmasse=5.0, pl_bmassprov=None, st_age=None, pl_orbsmax=-1))
    assert card["mass_mearth"]["value"] is None and "pl_bmassprov" in card["mass_mearth"]["source"]
    for k in ("host_age_gyr", "orbit_au", "host_teff_K"):
        assert card[k]["value"] is None and card[k]["source"].startswith("not available:")


def test_a_calculated_host_or_orbit_value_is_model_dependent_with_an_assumption() -> None:
    card = planet_card(row(pl_orbsmax=0.1, pl_orbsmax_reflink=CALC))
    assert card["orbit_au"]["tag"] == "model_dependent" and card["orbit_au"]["assumption"]


def test_card_schema_accepts_every_new_field() -> None:
    card = {"id": "x", "name": "x", "type": "planet_rocky", **planet_card(row(pl_bmasse=1.0))}
    assert errors(card, "object-card.schema.json") == []


def test_a_small_planet_takes_pl_rade_not_the_rounded_pl_radj() -> None:
    """Q-168: Kepler-186 f, 1.17 R_earth (Torres et al. 2015); pl_radj rounds to 0.104."""
    from app.core.render.gas_giant import R_EARTH_M, R_JUP_M

    r = planet_card(
        row(pl_rade=1.17, pl_radeerr1=0.04, pl_radeerr2=-0.05, pl_radj=0.104, pl_radjerr1=0.9)
    )["radius_rjup"]
    assert r["value"] == pytest.approx(1.17 * 6378.1366 / 71492)
    assert r["value"] == pytest.approx(0.10438, abs=5e-6) and r["tag"] == "measured"
    assert r["err"] == pytest.approx(0.05 * R_EARTH_M / R_JUP_M)
    assert "pl_rade" in r["source"] and "R_earth / R_Jup" in r["source"]


def test_a_giant_keeps_pl_radj_unchanged() -> None:
    r = planet_card(row(pl_rade=11.2, pl_radj=0.999, pl_radjerr1=0.01))["radius_rjup"]
    assert r["value"] == 0.999 and r["err"] == 0.01 and "pl_radj" in r["source"]
    assert planet_card(row(pl_rade=6.0, pl_radj=0.535))["radius_rjup"]["value"] == 0.535


def test_a_calculated_pl_rade_is_model_dependent_not_measured() -> None:
    r = planet_card(row(pl_rade=2.0, pl_rade_reflink=CALC))["radius_rjup"]
    assert r["tag"] == "model_dependent" and r["assumption"] and "pl_rade" in r["source"]
    assert r["value"] == pytest.approx(2.0 * 6378.1366 / 71492)


def test_a_small_planet_without_pl_rade_falls_back_to_pl_radj() -> None:
    assert planet_card(row())["radius_rjup"]["value"] == 0.1


def test_asset_version_is_bumped_for_the_new_fields() -> None:
    assert ASSET_VERSION == "12"  # 12: #93 3.5 (pl_eqt derived)


def test_jupiter_radius_is_the_equatorial_one_defined_once() -> None:
    from app.core.render import card_to_params as c2p
    from app.core.render import gas_giant as gg

    assert gg.R_JUP_M == 7.1492e7  # IAU 2015 nominal equatorial; the archive's R_Jup
    assert not hasattr(c2p, "R_JUP_M")
    card = {"id": "x", "type": "gas_giant", "radius_rjup": {"value": 1.0, "tag": "measured"}}
    assert c2p._scale_m(card) == pytest.approx(7.1492e7)


def test_gaia_tier_is_refused_without_a_simbad_proper_motion(ctx: Context) -> None:
    import dataclasses

    obj = resolve(ctx, "Barnard's star", load_aliases(TARGETS_FILE)).obj
    data = gather(ctx, obj)
    still = dataclasses.replace(
        data.simbad_hit,
        pmra_mas_yr=None,
        pmdec_mas_yr=None,  # type: ignore[type-var]
    )
    out = with_star_data(ctx, dataclasses.replace(data, simbad_hit=still), obj, "star")
    assert out.star is not None and out.star.gaia is None
    assert "no proper motion" in (out.star.gaia_reason or "")


def test_gaia_values_name_the_match_separation(ctx: Context) -> None:
    card, _ = card_of(ctx, "Barnard's star")
    assert card["radius_rsun"]["value"] == pytest.approx(0.2022)
    assert "arcsec from the SIMBAD position" in card["radius_rsun"]["source"]
    assert card["teff_K"]["source"].startswith("SIMBAD mesFe_h: median")


# --- Part 8c: star Teff, radius and period --------------------------------------------------------


def test_barnard_teff_is_the_simbad_median_and_radius_is_gaia_flame(ctx: Context) -> None:
    card, data = card_of(ctx, "Barnard's star")
    assert data.missing == ()
    teff = card["teff_K"]
    assert teff["value"] == 3243.0 and teff["tag"] == "derived" and teff["formula"].strip()
    assert "median of 55" in teff["source"] and "3083 to 3530 K" in teff["source"]
    assert "2022A&A...658A.194P" in teff["source"]
    radius = card["radius_rsun"]
    assert radius["value"] == pytest.approx(0.2022) and radius["tag"] == "model_dependent"
    assert "4472832130942575872" in radius["source"] and radius["assumption"]
    assert card["pm_mas_yr"]["value"][1] > 10000  # the motion trail input is untouched
    params = params_of(card)
    assert layer(params, "colour")["tag"] == "derived"
    assert layer(params, "motion_trail")["tag"] == "measured"
    assert "colour" not in params["missing"] and "visible" not in params["missing"]


def test_rw_aur_teff_comes_from_simbad_not_the_dwarf_table(ctx: Context) -> None:
    card, _ = card_of(ctx, "RW Aur")
    assert card["teff_K"]["value"] == 3885.0 and card["teff_K"]["tag"] == "derived"
    assert "2021ApJ...921...53L" in card["teff_K"]["source"]
    assert card["radius_rsun"]["value"] is None
    assert "no FLAME radius" in card["radius_rsun"]["source"]
    assert "colour" in {x["id"] for x in params_of(card)["layers"]}


def test_r_dra_period_is_the_mira_median_and_teff_is_the_msc_model_value(ctx: Context) -> None:
    card, _ = card_of(ctx, "R Dra")
    period = card["period_var_d"]
    # A median of three published periods is a derivation, like the Teff median (Q-152).
    assert period["value"] == 247.0 and period["tag"] == "derived" and "formula" in period
    assert "median of 3" in period["source"] and "2020ApJS..247...44A" in period["source"]
    # Only Gaia's Multiple Star Classifier answers for R Dra, as a model value (Q-220); no radius.
    teff = card["teff_K"]
    assert (teff["value"], teff["tag"]) == (3047.9, "model_dependent")
    assert "teff_msc1" in teff["source"] and "unresolved binary" in teff["assumption"]
    assert card["radius_rsun"]["value"] is None
    params = params_of(card)
    assert {"radius_pulsation", "colour"} <= {x["id"] for x in params["layers"]}
    assert "colour" not in params["missing"]


def test_simbad_rows_parse_recorded_replies() -> None:
    from tests.helpers import entry

    meta, body = entry("simbad", ident="Barnard's star", table="mesFe_h")
    rows = simbad.parse_teff(body)
    assert len(rows) == 55 and min(r.teff_k for r in rows) == 3083
    assert meta["key"]["query"]["table"] == "mesFe_h"
    _, body = entry("simbad", ident="R Dra", table="mesVar")
    assert [r.vartyp for r in simbad.parse_var(body)] == ["LPV", "LPV", "M"]


def test_the_measurement_queries_are_plain_joins() -> None:
    q = simbad.teff_adql("Barnard's star")
    assert "FROM ident JOIN mesFe_h ON ident.oidref = mesFe_h.oidref" in q
    assert "'Barnard''s star'" in q and "ORDER BY" not in q  # qualified ORDER BY is a TAP error
    assert "mesVar.period" in simbad.var_adql("R Dra")


def test_gaia_query_uses_the_irsa_and_esa_astrophysical_tables() -> None:
    irsa = gaia.astro_adql("gaia_dr3_source", "1.0", "2.0", "0.001")
    assert "gaia_dr3_astrophys_param" in irsa and "LEFT OUTER JOIN" in irsa
    esa = gaia.astro_adql("gaiadr3.gaia_source", "1.0", "2.0", "0.001")
    assert "gaiadr3.astrophysical_parameters" in esa


def test_gaia_match_takes_the_nearest_source_within_the_radius() -> None:
    near = GaiaAstro("1", 10.0, 20.0, 9.0, 3500, None, None, 0.3, None, None)
    far = GaiaAstro("2", 10.0, 20.001, 9.0, 3500, None, None, 0.3, None, None)  # 3.6 arcsec
    got, sep = nearest([far, near], 10.0, 20.0)
    assert got is near and sep == 0.0
    assert nearest([far], 10.0, 20.0) == (None, None)


def cat(**kw: Any) -> StarCatalogue:
    return StarCatalogue(sp_type=kw.pop("sp_type", "M4V"), **kw)


def astro(teff: float | None, radius: float | None = None) -> GaiaAstro:
    return GaiaAstro(
        "7", 0.0, 0.0, 10.0, teff, teff and teff - 5, teff and teff + 3, radius, None, None
    )


def test_median_picks_the_middle_value_and_never_an_average() -> None:
    rows = [TeffRow(3000, "2001A"), TeffRow(3300, "2010B"), TeffRow(3600, "2020C")]
    pick, n, lo, hi = stars.median_pick(rows, lambda r: r.teff_k, lambda r: r.bibcode)
    assert (pick.teff_k, n, lo, hi) == (3300, 3, 3000, 3600)
    # Even count: the two middle values tie, the more recent bibcode wins.
    even = [*rows, TeffRow(3900, "1999D")]
    assert stars.median_pick(even, lambda r: r.teff_k, lambda r: r.bibcode)[0].teff_k == 3600
    older = [
        TeffRow(3000, "2001A"),
        TeffRow(3300, "2020B"),
        TeffRow(3600, "2010C"),
        TeffRow(3900, "1999D"),
    ]
    assert stars.median_pick(older, lambda r: r.teff_k, lambda r: r.bibcode)[0].teff_k == 3300


def test_median_is_deterministic_under_row_order_and_equal_bibcodes() -> None:
    rows = [
        TeffRow(3100, "2022X"),
        TeffRow(3100, "2023Y"),
        TeffRow(3400, "2022X"),
        TeffRow(3000, "2000Z"),
    ]
    a = stars.median_pick(rows, lambda r: r.teff_k, lambda r: r.bibcode)[0]
    b = stars.median_pick(rows[::-1], lambda r: r.teff_k, lambda r: r.bibcode)[0]
    assert a == b


def test_teff_source_order_simbad_then_gaia_then_class_table() -> None:
    simbad_rows = (TeffRow(3300, "2020A"),)
    t = stars.teff_field(cat(teff_rows=simbad_rows, gaia=astro(5000)), "star", TABLE)
    assert (t["value"], t["tag"]) == (3300, "derived")
    t = stars.teff_field(cat(gaia=astro(5000)), "star", TABLE)
    assert (t["value"], t["tag"]) == (5000, "model_dependent") and t["assumption"]
    assert t["err"] == 5.0
    t = stars.teff_field(cat(sp_type="M4V"), "star", TABLE)
    assert (t["value"], t["tag"]) == (3210.0, "inferred_from_analog")
    assert "Table 5" in t["source"] and "2022.04.16" in t["source"] and "M4V" in t["source"]


def test_gspphot_at_or_below_4000_k_is_skipped_with_the_docs_reason() -> None:
    for teff in (3099.6, 4000.0):
        t = stars.teff_field(cat(gaia=astro(teff), sp_type=None), "star", TABLE)
        assert t["value"] is None and "Sec 11.4.4" in t["source"]
    assert stars.teff_field(cat(gaia=astro(4000.1)), "star", TABLE)["value"] == 4000.1


def test_class_table_is_for_main_sequence_dwarfs_only() -> None:
    for sp in ("M4III", "K1/5e+K5e", "M4.5-6+e", None, "M4V+M5V"):
        t = stars.teff_field(cat(sp_type=sp), "star", TABLE)
        assert t["value"] is None and t["source"].startswith("not available:")
    # A Mira or T Tauri star never reads the dwarf table, even with a dwarf-like type.
    assert stars.teff_field(cat(sp_type="M4V"), "star_mira", TABLE)["value"] is None
    assert stars.teff_field(cat(sp_type="M4V"), "star_ttauri", TABLE)["value"] is None


def test_all_sources_empty_refuses_without_inventing() -> None:
    c = StarCatalogue(sp_type=None, gaia_reason="Gaia DR3 not cached and offline")
    t = stars.teff_field(c, "star", None)
    assert t["value"] is None and "not cached and offline" in t["source"]
    assert stars.teff_field(None, "star", TABLE)["value"] is None
    assert stars.radius_field(None)["value"] is None
    assert stars.period_field(None)["value"] is None


def test_radius_is_gaia_flame_or_refused_never_a_class_value() -> None:
    r = stars.radius_field(cat(gaia=astro(3100, 0.2)))
    assert (r["value"], r["tag"]) == (0.2, "model_dependent")
    assert stars.radius_field(cat(gaia=astro(3100, None)))["value"] is None
    assert stars.radius_field(cat())["value"] is None


def test_mira_period_uses_only_lpv_and_m_rows() -> None:
    rows = (
        VarRow(148.6, "ROT", None, "2015MNRAS.452.2745S"),
        VarRow(1.004, "ROT", None, "2016ApJ...821...93N"),
        VarRow(250.0, "M", "V", "2019X"),
    )
    p = stars.period_field(cat(var_rows=rows))
    assert (p["value"], p["tag"]) == (250.0, "measured")
    only_rot = stars.period_field(cat(var_rows=rows[:2]))
    assert only_rot["value"] is None and "other variability types" in only_rot["source"]


def test_a_failed_star_query_keeps_the_card_unsaved_and_says_why(
    ctx: Context, monkeypatch: pytest.MonkeyPatch
) -> None:
    obj = resolve(ctx, "R Dra", load_aliases(TARGETS_FILE)).obj
    data = gather(ctx, obj)

    def boom(*a: Any, **k: Any) -> Any:
        raise CacheMissOffline("x")

    monkeypatch.setattr(simbad, "teff_rows", boom)
    monkeypatch.setattr(gaia, "astro_near", boom)  # Gaia answers R Dra's MSC Teff otherwise (Q-220)
    out = with_star_data(ctx, data, obj, "star_mira")
    assert "star_catalogue" in out.missing
    assert out.star is not None and out.star.teff_reason == "SIMBAD mesFe_h not cached and offline"
    card = build_card(obj, out, classify(out.facts), None)
    assert card["teff_K"]["value"] is None
    assert "mesFe_h not cached and offline" in card["teff_K"]["source"]


# --- Part 8b: the literature registry -------------------------------------------------------------


def test_oumuamua_takes_the_registry_values_with_their_tags(ctx: Context) -> None:
    card, data = card_of(ctx, "'Oumuamua")
    assert data.missing == ()
    amp, dia, alb = card["lightcurve_amp_mag"], card["diameter_km"], card["albedo"]
    assert (amp["value"], amp["tag"]) == (2.5, "measured")
    assert (dia["value"], dia["tag"]) == (0.204, "model_dependent")
    assert (alb["value"], alb["tag"]) == (0.04, "model_dependent")
    for tv in (amp, dia, alb):
        assert tv["source"].startswith("literature: Meech et al. 2017, Nature 552, 378")
    assert "0.04" in dia["assumption"] and "assumed" in dia["assumption"]
    # The 23 %/100 nm slope is optical and the field is 0.75 to 2.5 um: stays refused, with why.
    slope = card["slope_075_25"]
    assert slope["value"] is None and "optical" in slope["source"]
    assert errors(card, "object-card.schema.json") == []


def test_oumuamua_body_is_drawn_and_the_ellipsoid_says_c_is_open(ctx: Context) -> None:
    card, _ = card_of(ctx, "'Oumuamua")
    params = params_of(card)
    ids = {x["id"] for x in params["layers"]}
    assert {"ellipsoid", "relief", "displacement"} <= ids
    assert params["scale_m"] == pytest.approx(102.0)
    ellipsoid = layer(params, "ellipsoid")
    assert ellipsoid["tag"] == "model_dependent"
    assert (
        "disc" in ellipsoid["assumed"]["c_axis"]
        and "not constrained" in ellipsoid["assumed"]["c_axis"]
    )
    assert ellipsoid["assumed"]["diameter_km"] == 0.204


def test_a_catalogue_value_is_never_overwritten_by_the_registry(ctx: Context) -> None:
    card, _ = card_of(ctx, "'Oumuamua")
    # SBDB gives a rotation period (7.937 h); the registry has no such row, and a row for it
    # would still lose. Prove it with a registry that names every field.
    assert card["rot_period_h"]["source"].startswith("JPL SBDB")
    obj = resolve(ctx, "433 Eros", load_aliases(TARGETS_FILE)).obj
    eros = gather(ctx, obj)
    rows = {
        "diameter_km": lit.LiteratureValue(
            "20000433", "diameter_km", 99.0, "measured", "Someone 2000", "", ""
        ),
        "lightcurve_amp_mag": lit.LiteratureValue(
            "20000433", "lightcurve_amp_mag", 0.5, "measured", "Someone 2000", "", ""
        ),
    }
    eros = CatalogueData(
        **{**eros.__dict__, "literature": lit.Literature(rows, {})}  # type: ignore[arg-type]
    )
    eros_card = build_card(
        obj, apply_geometry(eros, fetch_geometry(ctx, obj)), classify(eros.facts), None
    )
    assert eros_card["diameter_km"]["value"] == 16.84  # catalogue wins
    assert eros_card["lightcurve_amp_mag"]["value"] == 0.5  # catalogue was null: filled
    assert eros_card["lightcurve_amp_mag"]["source"].startswith("literature: Someone 2000")


def test_a_registry_field_the_type_does_not_use_is_not_added(ctx: Context) -> None:
    obj = resolve(ctx, "TRAPPIST-1 e", load_aliases(TARGETS_FILE)).obj
    data = gather(ctx, obj)
    rows = {"albedo": lit.LiteratureValue("x", "albedo", 0.3, "measured", "P 2000", "", "")}
    data = CatalogueData(**{**data.__dict__, "literature": lit.Literature(rows, {})})  # type: ignore[arg-type]
    assert "albedo" not in build_card(obj, data, classify(data.facts), None)


def test_registry_loader_checks_every_rule_and_never_raises(tmp_path: Path) -> None:
    f = tmp_path / "literature.toml"
    f.write_text(
        """
[[value]]
key = "1"
field = "diameter_km"
value = 1.0
tag = "model_dependent"
citation = "A 2000"

[[value]]
key = "1"
field = "albedo"
value = 0.1
tag = "measured"
citation = ""

[[value]]
key = "1"
field = "rot_period_h"
value = 2.0
tag = "derived"
citation = "B 2001"

[[value]]
key = "1"
field = "lightcurve_amp_mag"
value = 1.0
tag = "guess"
citation = "B 2001"

[[value]]
key = "1"
field = "gas_Q"
value = nan
tag = "measured"
citation = "B 2001"

[[value]]
key = "1"
field = "band_depth_3um"
value = 0.1
tag = "measured"
citation = "C 2002"
table = "Table 2"
note = "n"
"""
    )
    got = lit.load_literature(f, "1")
    assert set(got.values) == {"band_depth_3um"}  # the other five each break one rule
    tv = got.tv("band_depth_3um")
    assert (
        tv is not None
        and tv["source"].startswith("literature: C 2002, Table 2")
        and tv["tag"] == "measured"
    )
    assert lit.load_literature(f, "2") is lit.EMPTY and lit.load_literature(f, None) is lit.EMPTY
    assert lit.load_literature(tmp_path / "missing.toml", "1") is lit.EMPTY
    f.write_text("not [valid toml")
    assert lit.load_literature(f, "1") is lit.EMPTY


def test_the_committed_registry_loads_and_every_row_has_a_citation() -> None:
    doc = (BACKEND_DIR / "assets" / "literature.toml").read_text(encoding="utf-8")
    import tomllib

    rows = tomllib.loads(doc)["value"]
    loaded = [
        lit.load_literature(BACKEND_DIR / "assets" / "literature.toml", r["key"]) for r in rows
    ]
    assert sum(len(x.values) for x in {id(x): x for x in loaded}.values()) == len(rows)
    assert all(r["citation"].strip() for r in rows)


def test_a_registry_radius_goes_before_gaia_flame(ctx: Context) -> None:
    obj = resolve(ctx, "Barnard's star", load_aliases(TARGETS_FILE)).obj
    data = with_star_data(ctx, gather(ctx, obj), obj, "star")
    interferometric = lit.LiteratureValue(
        obj.id, "radius_rsun", 0.2, "measured", "Test 2001", "", "synthetic test row"
    )
    data = CatalogueData(
        **{**data.__dict__, "literature": lit.Literature({"radius_rsun": interferometric}, {})}  # type: ignore[arg-type]
    )
    card = build_card(obj, data, classify(data.facts), None)
    assert card["radius_rsun"]["value"] == 0.2 and card["radius_rsun"]["tag"] == "measured"


# --- Part 8d: binary components -------------------------------------------------------------------


def test_eps_indi_b_components_split_the_class_and_use_published_teff(ctx: Context) -> None:
    card, _ = card_of(ctx, "eps Ind B")
    teff = card["component_teff_K"]
    assert teff["value"] == [1312.0, 972.0] and teff["tag"] == "model_dependent"
    assert teff["err"] == [13.0, 13.0] and "Chen et al. 2022" in teff["source"]
    params = params_of(card)
    a, b = params["components"]
    assert (a["class"], b["class"]) == ("T1V", "T6V")
    assert a["emissive_scale"] == 1.0
    assert b["emissive_scale"] == pytest.approx((972 / 1312) ** 4, abs=1e-4)
    assert a["tint_tag"] == b["tint_tag"] == "inferred_from_analog"
    assert a["emissive_tag"] == b["emissive_tag"] == "model_dependent"
    # T1 and T6 share the T palette letter (Q-47 has no subclass colours): the same tint.
    assert a["tint"] == b["tint"]
    assert layer(params, "components")["assumed"] == {"class_a": "T1V", "class_b": "T6V"}
    bright = layer(params, "component_brightness")
    assert bright["tag"] == "model_dependent" and bright["assumed"]["radius_ratio"] == 1.0


def test_components_are_deterministic_and_validate() -> None:
    card = {
        "id": "x",
        "name": "x",
        "type": "brown_dwarf_binary",
        "spectral_class": {"value": "T1+Y0", "tag": "measured", "source": "s"},
        "radius_rjup": {"value": 1.0, "tag": "model_dependent", "source": "s", "assumption": "a"},
        "component_teff_K": {"value": [900.0, 450.0], "tag": "measured", "source": "s"},
    }
    p1, p2 = card_to_params(card, seed=1), card_to_params(card, seed=1)
    assert json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True)
    t, y = p1["components"]
    assert t["tint"] != y["tint"]  # T and Y have different palette entries
    assert y["emissive_scale"] == pytest.approx(0.0625)
    # A measured Teff still makes a model_dependent brightness: equal radii are assumed.
    assert {x["id"]: x["tag"] for x in p1["layers"]}["component_brightness"] == "model_dependent"
    assert errors(p1, "render-params.schema.json") == []


def test_without_component_teff_the_brightness_is_null_and_listed_missing() -> None:
    card = {
        "id": "x",
        "name": "x",
        "type": "brown_dwarf_binary",
        "spectral_class": {"value": "T1V+T6V", "tag": "measured", "source": "s"},
        "component_teff_K": {
            "value": None,
            "tag": "model_dependent",
            "source": "s",
            "assumption": "a",
        },
    }
    p = card_to_params(card, seed=1)
    assert [c["emissive_scale"] for c in p["components"]] == [None, None]
    assert [c["emissive_tag"] for c in p["components"]] == ["artistic", "artistic"]
    assert "component_brightness" in p["missing"]
    assert "components" in {x["id"] for x in p["layers"]}
    assert errors(p, "render-params.schema.json") == []


@pytest.mark.parametrize("cls", ["T1V", "T1V+T6V+Y0", "L1+T6", "", "T1V+"])
def test_a_class_that_does_not_name_two_palette_components_gets_none(cls: str) -> None:
    card = {
        "id": "x",
        "name": "x",
        "type": "brown_dwarf_binary",
        "spectral_class": {"value": cls, "tag": "measured", "source": "s"},
    }
    p = card_to_params(card, seed=1)
    assert "components" not in p and "components" in p["missing"]


def test_a_single_brown_dwarf_has_no_components() -> None:
    card = {
        "id": "x",
        "name": "x",
        "type": "brown_dwarf",
        "spectral_class": {"value": "Y2", "tag": "measured", "source": "s"},
    }
    assert "components" not in card_to_params(card, seed=1)


# --- Extra 1: comets need the CAP flag in the Horizons COMMAND ----------------------------------


def test_command_adds_cap_only_for_comets() -> None:
    # CAP alone means "before the current date" (Horizons manual): the epoch makes it deterministic.
    assert (
        horizons.command("1000012", comet=True, jd="2461358.500000") == "DES=1000012;CAP<2461358;"
    )
    with pytest.raises(ValueError):
        horizons.command("1000012", comet=True)
    assert horizons.command("20000433") == "DES=20000433;"


def test_67p_resolves_and_gets_its_geometry_from_recorded_replies(ctx: Context) -> None:
    """Live on 9 Nov 2026 `DES=1000012;` answered with the small-body index table (a dozen
    apparition records) and no ephemeris block; `DES=1000012;CAP<2461358;` answers (Horizons manual:
    "returns last apparition before the specified Julian Day Number"). These are the recorded
    replies of the CAP calls."""
    # No aliases: the replies were recorded for the query "67P". With targets.toml loaded, Track D's
    # alias sends "67P" to "67P/Churyumov-Gerasimenko", a different cache key (the alias is covered
    # by the search tests).
    obj = resolve(ctx, "67P", {}).obj
    assert obj.id == "sbdb-1000012" and obj.resolver == "sbdb" and obj.spkid == "1000012"
    answer = fetch_geometry(ctx, obj)
    assert answer is not None and answer.geometry is not None, answer
    assert 0.0 <= answer.geometry.phase_angle_deg <= 180.0
    assert abs(sum(c * c for c in answer.geometry.sun_vector) - 1.0) < 1e-6
    keys = [s.entry.key.query for s in answer.served]  # type: ignore[attr-defined]
    assert all(dict(q)["command"] == "DES=1000012;CAP<2461358;" for q in keys)


def test_an_asteroid_never_gets_cap(ctx: Context) -> None:
    obj = resolve(ctx, "433 Eros", load_aliases(TARGETS_FILE)).obj
    answer = fetch_geometry(ctx, obj)
    assert answer is not None and answer.geometry is not None
    assert all(dict(s.entry.key.query)["command"] == "DES=20000433;" for s in answer.served)  # type: ignore[attr-defined]


def test_the_comet_flag_comes_from_the_sbdb_kind() -> None:
    from app.adapters.sbdb import SbdbHit

    assert SbdbHit("1", "f", "s", "cn").is_comet and SbdbHit("1", "f", "s", "cu").is_comet
    assert not SbdbHit("1", "f", "s", "an").is_comet and not SbdbHit("1", "f", "s", "au").is_comet


# --- Extra 2: the start-up warm cache honours `frames = false` ----------------------------------


def test_demo_queries_skip_catalogue_only_targets(tmp_path: Path) -> None:
    from app.core.warm import demo_queries, frames_wanted

    f = tmp_path / "targets.toml"
    f.write_text(
        """
[[target]]
name = "Star"
query = "star q"
group = "demo"

[[target]]
name = "Planet"
query = "planet q"
group = "demo"
frames = false

[[target]]
name = "Planet as text"
query = "planet q2"
group = "demo"
frames = "false"

[[target]]
name = "Explicit true"
query = "star q2"
group = "demo"
frames = true

[[target]]
name = "Other group"
query = "other q"
group = "test"
"""
    )
    assert demo_queries(f, ["demo"]) == ["star q", "star q2"]
    assert demo_queries(f, ["demo", "test"]) == ["star q", "star q2", "other q"]
    assert demo_queries(tmp_path / "missing.toml", ["demo"]) == []
    assert frames_wanted({}) and not frames_wanted({"frames": False})


# --- Q-162: the comet shape and nucleus radius from the registered mesh -------------------------


def test_67p_card_gets_shape_source_and_the_mesh_bounding_radius(ctx: Context) -> None:
    obj = resolve(ctx, "67P", {}).obj
    data = gather(ctx, obj)
    card = build_card(obj, data, classify(data.facts), None)
    assert card["type"] == "comet"
    src = card["shape_source"]
    assert src["tag"] == "measured" and src["value"].startswith("/data/shapes/")
    assert "10.26007/34vg-8s07" in src["source"]
    nuc = card["nucleus_radius_km_max"]
    assert nuc["value"] == pytest.approx(3.527) and nuc["tag"] == "derived"
    assert "SHAP5" in nuc["source"] and "SHAP5".lower() not in nuc["formula"]
    assert "bounding" in nuc["source"] and "scaling" in nuc["source"]
    assert nuc["formula"]
    assert errors(card, "object-card.schema.json") == []
    # The mesh layer is offered, and the alt text does not call the scale a limit.
    params = params_of(card)
    assert any(layer["id"] == "mesh" for layer in params["layers"])
    assert "upper limit" not in params["alt_text"]


def test_a_comet_without_a_mesh_is_unchanged(ctx: Context) -> None:
    """No recorded 3I/ATLAS replies exist, so take 67P's data and remove the registry row: the card
    must then be what a mesh-less comet (3I/ATLAS) always got."""
    import dataclasses

    obj = resolve(ctx, "67P", {}).obj
    data = gather(ctx, obj)
    bare = dataclasses.replace(
        data, shape=None, facts=dataclasses.replace(data.facts, shape_model=None)
    )
    card = build_card(obj, bare, classify(bare.facts), None)
    assert card["type"] == "comet"
    assert "shape_source" not in card
    assert card["nucleus_radius_km_max"] == {
        "value": None,
        "tag": "measured",
        "source": "not available: published values not loaded (R7.3)",
    }
    assert not any(layer["id"] == "mesh" for layer in params_of(card)["layers"])
