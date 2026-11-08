"""Stage 7 ``card_to_params`` (R3.4, R6.2, R7, R11) on the shared fixture cards and edge cases."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

import pytest

from app.core.card.validate import errors
from app.core.render.blackbody import teff_to_rgb
from app.core.render.card_to_params import GENERATOR_VERSION, card_to_params, seed_for
from app.core.render.spherex_rgb import CHANNELS_SMALL_BODY, spherex_rgb, window_median

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
TYPES = sorted(p.stem for p in (FIXTURES / "cards").glob("*.json"))
TAGS = {"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"}


def load(kind: str, what: str) -> dict[str, Any]:
    return json.loads((FIXTURES / what / f"{kind}.json").read_text(encoding="utf-8"))


def params_for(card: dict[str, Any], kind: str | None = None) -> dict[str, Any]:
    ref = load(kind or card["type"], "params")
    return card_to_params(card, seed=ref["seed"], generator_version=ref["generator_version"])


def test_every_object_type_has_a_fixture() -> None:
    assert len(TYPES) == 14


@pytest.mark.parametrize("kind", TYPES)
def test_fixture_card_gives_valid_params(kind: str) -> None:
    p = params_for(load(kind, "cards"))
    assert errors(p, "render-params.schema.json") == []
    assert all(layer["tag"] in TAGS for layer in p["layers"])


@pytest.mark.parametrize("kind", TYPES)
def test_fixture_card_matches_the_fixture_params(kind: str) -> None:
    """The hand-written fixtures encode the R7 rules; the code must give the same plan."""
    ref = load(kind, "params")
    p = params_for(load(kind, "cards"))

    def plan(layers: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
        return [
            (
                x["id"],
                x["tag"],
                x["tier"],
                x["requires"],
                x["description"],
                x.get("formula"),
                x.get("assumed"),
            )
            for x in layers
        ]

    # D-32: tier, formula text and assumed inputs too, so the fixture text cannot drift.
    assert plan(p["layers"]) == plan(ref["layers"])
    # Stage 6 (dynamics, a later ticket) is not built, so its refusals are not in the live output.
    assert p["missing"] == [m for m in ref["missing"] if not m.startswith("dynamics:")]
    assert p["haptics"] == ref["haptics"]
    if "sun_vector" in load(kind, "cards"):
        assert p["lighting"] == ref["lighting"]
    else:
        # The shader-kind fixtures hold a sun_dir with no sun_vector on the card; the code adds
        # no direction without data (the viewer then lights head-on, Q-49).
        assert p["lighting"]["mode"] == ref["lighting"]["mode"]
        assert "sun_dir" not in p["lighting"]
    assert ("textures" in p) == ("textures" in ref)
    assert set(p["view_modes"]) == set(ref["view_modes"])
    for mode, ref_mode in ref["view_modes"].items():
        got = p["view_modes"][mode]
        assert got["available"] == ref_mode["available"]
        assert got["source"] == ref_mode["source"]
        assert (got["rgb"] or {}).get("tag") == (ref_mode["rgb"] or {}).get("tag")
        assert (got["rgb"] or {}).get("formula") == (ref_mode["rgb"] or {}).get("formula")
        assert got.get("channels_um") == ref_mode.get("channels_um")
    if ref["scale_m"] is None:
        assert p["scale_m"] is None
    else:  # fixtures round the radius constants
        assert p["scale_m"] == pytest.approx(ref["scale_m"], rel=2e-3)


@pytest.mark.parametrize("kind", TYPES)
def test_deterministic_bytes(kind: str) -> None:
    card = load(kind, "cards")
    a = json.dumps(params_for(card), sort_keys=True).encode()
    b = json.dumps(params_for(copy.deepcopy(card)), sort_keys=True).encode()
    assert a == b


def test_seed_is_a_stable_32_bit_hash_of_id_and_version() -> None:
    s = seed_for("sbdb-20000433", GENERATOR_VERSION)
    assert s == seed_for("sbdb-20000433", GENERATOR_VERSION)
    assert 0 <= s < 2**32
    assert s != seed_for("sbdb-20000433", GENERATOR_VERSION + "x")
    assert s != seed_for("sbdb-20000434", GENERATOR_VERSION)
    p = card_to_params(load("star", "cards"))
    assert p["seed"] == seed_for(p["id"], p["generator_version"])


def test_r11_removing_the_diameter_refuses_the_mesh() -> None:
    card = load("asteroid_procedural", "cards")
    del card["diameter_km"]
    p = params_for(card)
    assert errors(p, "render-params.schema.json") == []
    assert "mesh" in p["missing"]
    assert p["scale_m"] is None
    assert p["layers"] == []
    assert "textures" not in p


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "16", True])
def test_unusable_diameter_is_refused_not_guessed(bad: Any) -> None:
    card = load("asteroid_procedural", "cards")
    card["diameter_km"]["value"] = bad
    p = params_for(card)
    assert "mesh" in p["missing"] and p["scale_m"] is None


@pytest.mark.parametrize(
    ("kind", "field", "layer"),
    [
        ("asteroid_shape", "shape_source", "mesh"),
        ("asteroid_shape", "rot_period_h", "spin"),
        ("asteroid_shape", "albedo", "material"),
        ("asteroid_procedural", "lightcurve_amp_mag", "ellipsoid"),
        ("brown_dwarf", "flux_45um", "emissive"),
        ("brown_dwarf", "ch4_depth_33", "bands"),
        ("comet", "coma_radius_km", "gas_shells"),
        ("comet", "nucleus_radius_km_max", "nucleus"),
        ("star", "teff_K", "colour"),
        ("star", "pm_mas_yr", "motion_trail"),
        ("star_mira", "period_var_d", "radius_pulsation"),
        ("star_mira", "lightcurve", "brightness_curve"),
        ("star_ttauri", "lightcurve", "dust_screen"),
        ("gas_giant", "teq_K", "teq_pulse"),
        ("nebula", "diameter_km", "point_cloud"),
    ],
)
def test_missing_field_refuses_its_layer(kind: str, field: str, layer: str) -> None:
    card = load(kind, "cards")
    if field == "lightcurve":
        card[field] = []
    else:
        card[field]["value"] = None
    p = params_for(card)
    assert errors(p, "render-params.schema.json") == []
    assert layer in p["missing"]
    assert layer not in [x["id"] for x in p["layers"]]


@pytest.mark.parametrize("kind", ["nebula", "nova"])
def test_volume_kinds_have_no_haptics(kind: str) -> None:
    """Q-103: drawn as volumes, so nothing is felt (what is felt must match what is drawn, D-34)."""
    p = params_for(load(kind, "cards"))
    assert p["haptics"]["texture"] == "none" and p["haptics"]["data"] == "none"
    assert errors(p, "render-params.schema.json") == []


def test_relief_amp_is_sent_for_the_procedural_asteroid_only() -> None:
    """Q-103, issue #62: the viewer displaces by textures.relief_amp (R7.2); the value is the R6.2
    style rule's peak relief, so it travels with an `artistic` `displacement` layer."""
    p = params_for(load("asteroid_procedural", "cards"))
    assert p["textures"]["relief_amp"] == 0.03  # style "cratered" for a 2 km body (R6.2)
    layer = next(x for x in p["layers"] if x["id"] == "displacement")
    assert (layer["tag"], layer["tier"]) == ("artistic", 5)
    assert errors(p, "render-params.schema.json") == []
    for kind in ("brown_dwarf", "brown_dwarf_binary"):
        assert "relief_amp" not in params_for(load(kind, "cards"))["textures"]
    p["textures"]["relief_amp"] = 0.03
    assert errors(p, "render-params.schema.json") == []
    p["textures"]["relief_amp"] = 0
    assert errors(p, "render-params.schema.json") != []


def test_dependent_haptics_are_refused_with_their_layer() -> None:
    bd = load("brown_dwarf", "cards")
    bd["flux_45um"]["value"] = None
    p = params_for(bd)
    assert p["haptics"]["data"] == "none" and "flux_pulse" in p["missing"]
    star = load("star", "cards")
    del star["teff_K"]
    p = params_for(star)
    assert p["view_modes"]["visible"]["available"] is False
    assert "visible" in p["missing"]


def test_comet_with_both_epochs_refuses_the_shells() -> None:
    """Q-42: one-epoch gas_Q cannot be assigned when both epochs are listed."""
    card = load("comet", "cards")
    card["epochs"] = ["2025-08", "2025-12"]
    assert "gas_shells" in params_for(card)["missing"]


def test_gaia_colour_beats_the_palette() -> None:
    card = load("asteroid_procedural", "cards")
    card["gaia_rgb"] = {
        "value": [0.4, 0.3, 0.2],
        "tag": "derived",
        "source": "synthetic fixture: test",
        "formula": "test",
    }
    vis = params_for(card)["view_modes"]["visible"]
    assert vis["source"] == "gaia_rgb" and vis["rgb"]["value"] == [0.4, 0.3, 0.2]
    assert vis["rgb"]["tag"] == "derived"


def test_extra_missing_is_passed_through() -> None:
    card = load("candidate", "cards")
    p = card_to_params(card, seed=9, extra_missing=("type:exoplanet_thresholds",))
    assert p["missing"] == ["mesh", "visible", "type:exoplanet_thresholds"]


def test_texture_urls_follow_r67() -> None:
    p = card_to_params(load("asteroid_procedural", "cards"), seed=2, generator_version="v")
    tex = p["textures"]
    assert set(tex) == {"albedo", "height", "normal", "height_bin", "relief_amp"}
    # The id's ':' is the baker's %3A directory name, quoted once more for the URL.
    assert tex["albedo"] == (
        "/data/textures/fixture%253Aasteroid_procedural/v/2/2048x1024/albedo.webp"
    )


@pytest.mark.parametrize("kind", TYPES)
def test_alt_text_follows_r9(kind: str) -> None:
    card = load(kind, "cards")
    p = params_for(card)
    assert p["alt_text"].startswith(card["name"])
    if kind != "candidate":
        assert p["alt_text"].endswith(("illustrative.", "measured."))


def test_blackbody_colour() -> None:
    cool, sun, hot = teff_to_rgb(3000), teff_to_rgb(5778), teff_to_rgb(20000)
    assert cool and sun and hot
    assert cool[0] == 1.0 and cool[2] < 0.3  # red
    assert min(sun) > 0.75  # near white
    assert hot[2] == 1.0 and hot[0] < 0.6  # blue
    assert teff_to_rgb(3000) == cool  # deterministic
    for bad in (0.0, -5.0, math.nan, math.inf):
        assert teff_to_rgb(bad) is None


def test_spherex_rgb_window_rule() -> None:
    def pt(w: float, f: float, flagged: bool = False) -> dict[str, Any]:
        return {"wavelength_um": w, "flux": f, "flagged": flagged}

    pts = [pt(3.0, 4.0), pt(3.04, 6.0), pt(2.0, 2.0), pt(1.98, 2.0), pt(1.0, 1.0), pt(1.05, 1.0)]
    assert spherex_rgb(pts, CHANNELS_SMALL_BODY) == (1.0, 0.4, 0.2)
    # Fewer than 2 points in a window: no colour (R5.2). Flagged points do not count.
    assert spherex_rgb(pts[:-1], CHANNELS_SMALL_BODY) is None
    assert spherex_rgb([*pts[:-1], pt(1.01, 1.0, True)], CHANNELS_SMALL_BODY) is None
    assert window_median([pt(4.5, 1.0), pt(4.56, 9.0)], 4.5) is None


@pytest.mark.parametrize("value", [None, "", "   "])
def test_model_dependent_input_without_a_value_states_its_assumption(value: Any) -> None:
    """D-32: `assumed` names what was assumed; a null or blank input falls back to its R3.1
    assumption."""
    from app.core.render.card_to_params import _Plan

    card = {
        "albedo": {
            "value": value,
            "tag": "model_dependent",
            "source": "test",
            "assumption": "typical S-type albedo",
        }
    }
    plan = _Plan()
    plan.layer(True, "material", "model_dependent", "d", ["albedo"], card=card, formula="f")
    assert plan.layers[0]["assumed"] == {"albedo": "typical S-type albedo"}
    assert plan.layers[0]["tier"] == 3


def test_model_dependent_layer_with_nothing_assumed_is_a_bug_not_a_guess() -> None:
    """Measured inputs are never relabelled as assumed (D-32)."""
    from app.core.render.card_to_params import _Plan

    card = {"diameter_km": {"value": 10.0, "tag": "measured", "source": "test"}}
    with pytest.raises(ValueError, match="assumed"):
        _Plan().layer(True, "x", "model_dependent", "d", ["diameter_km"], card=card, formula="f")
    with pytest.raises(ValueError, match="formula"):
        _Plan().layer(True, "x", "derived", "d", ["diameter_km"], card=card)


def test_model_dependent_members_of_a_group_are_stated() -> None:
    """D-32: a model_dependent member of a group such as gas_Q is named in `assumed`."""
    card = load("comet", "cards")
    card["gas_Q"]["h2o"] = {
        "value": 1.0e26,
        "tag": "model_dependent",
        "source": "synthetic fixture: test",
        "formula": "test",
        "assumption": "typical H2O/CO2 ratio",
    }
    p = params_for(card)
    assert errors(p, "render-params.schema.json") == []
    shells = next(x for x in p["layers"] if x["id"] == "gas_shells")
    assert shells["assumed"]["gas_Q.h2o"] == 1.0e26
    assert "gas_Q.co2" not in shells["assumed"]  # measured members are not assumed
    assert list(shells["assumed"]) == ["density_exponent", "gas_Q.h2o"]  # rule inputs first


@pytest.mark.parametrize("kind", ["brown_dwarf", "brown_dwarf_binary"])
def test_brown_dwarf_limb_darkening_is_model_dependent_with_its_assumption(kind: str) -> None:
    """Issue #62: a self-lit disc fades toward its limb. The coefficient is the star's (R7.5);
    no brown-dwarf value is confirmed, so the layer is tier 3 and says what it assumed."""
    p = params_for(load(kind, "cards"))
    layer = next(x for x in p["layers"] if x["id"] == "limb_darkening")
    assert (layer["tag"], layer["tier"]) == ("model_dependent", 3)
    assert layer["formula"] == "I(mu) = 1 - u * (1 - mu), u = 0.6"
    assert layer["assumed"] == {"limb_darkening_u": 0.6}
    assert layer["requires"] == []


def test_ttauri_disc_stays_artistic() -> None:
    p = params_for(load("star_ttauri", "cards"))
    disc = next(x for x in p["layers"] if x["id"] == "disc")
    assert (disc["tag"], disc["tier"]) == ("artistic", 5)
    assert "flared" in disc["description"]
