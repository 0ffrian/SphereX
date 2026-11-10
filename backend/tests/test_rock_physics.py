"""Asteroid physics and height-field tests (issue #71 stream A, D-36, Q-210 to Q-212)."""

from __future__ import annotations

import dataclasses
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.core.render import bake, params_from_card
from app.core.render import height as heights
from app.core.render.noise import sphere_dirs
from app.core.render.params import (
    G_NEWTON,
    SMOOTH_LUMP_FACTOR,
    lump_ratio,
    spin_barrier_h,
    structure_of,
    surface_gravity,
)

CARDS = Path(__file__).parents[2] / "shared" / "fixtures" / "cards"
W, H = 256, 128


def card(diameter_km: float = 2.0, **extra: float) -> dict[str, Any]:
    c = json.loads((CARDS / "asteroid_procedural.json").read_text(encoding="utf-8"))
    c["diameter_km"]["value"] = diameter_km
    for k, v in extra.items():
        c[k]["value"] = v
    return c


def test_gravity_matches_known_bodies() -> None:
    # Bennu-sized sphere: R 262 m, rho 1190 -> 8.7e-5 m/s^2, the order of the measured 2.5e-5 to
    # 8.5e-5 over its lumpy surface (Scheeres et al. 2019, Nat. Astron. 3, 352).
    g = surface_gravity(262.0, 1190.0)
    assert g == pytest.approx(4 / 3 * math.pi * G_NEWTON * 1190 * 262)
    assert g == pytest.approx(8.7e-5, rel=0.01)
    # Earth-like sphere sanity: R 6371 km, rho 5514 -> 9.82 m/s^2.
    assert surface_gravity(6.371e6, 5514.0) == pytest.approx(9.82, abs=0.02)


def test_spin_barrier_is_about_two_hours_for_rubble() -> None:
    # Pravec and Harris 2000: about 2.2 h for a typical density of 2000 to 2500.
    assert 2.0 < spin_barrier_h(2500.0) < 2.6
    assert spin_barrier_h(1190.0) > spin_barrier_h(2670.0)


def test_lump_ratio_is_clamped_and_falls_with_size() -> None:
    assert lump_ratio(100.0, 2000.0) == 0.3  # small body: clamped at the top
    assert lump_ratio(125_000.0, 2600.0) < 0.1  # 250 km body: strength cannot hold much
    assert lump_ratio(1.0e7, 2600.0) == 0.03  # planet sized: clamped at the bottom
    xs = [lump_ratio(r, 2000.0) for r in (1e3, 1e4, 1e5, 1e6)]
    assert xs == sorted(xs, reverse=True)


def test_structure_rules() -> None:
    assert structure_of(0.1, 2000.0, None) == "solid"  # tiny
    assert structure_of(0.5, 2000.0, 1.0) == "solid"  # spins faster than the barrier
    assert structure_of(0.5, 2000.0, 4.3) == "rubble"
    assert structure_of(17.0, 2670.0, 5.27) == "rubble"
    assert structure_of(250.0, 2600.0, 7.0) == "fractured"


def test_rocky_is_the_default_and_the_card_cannot_make_it_smooth() -> None:
    p = params_from_card(card(), 1)
    assert p.roughness == "rocky"
    assert p.crater_coverage > 0.2 and p.boulder_density > 0
    # Q-212: no card field carries roughness, so every card stays rocky.
    c = card()
    c["roughness"] = {"value": "smooth", "tag": "measured"}
    c["thermal_inertia"] = {"value": 5.0, "tag": "measured"}
    assert params_from_card(c, 1).roughness == "rocky"


def test_smooth_mode_is_calmer() -> None:
    p = params_from_card(card(), 3)
    q = dataclasses.replace(
        p,
        roughness="smooth",
        lump=p.lump * SMOOTH_LUMP_FACTOR,
        crater_coverage=0.012,
        boulder_density=0.0,
        fine_amp=p.fine_amp * 0.25,
    )
    hp = bake(p, W, H).height
    hq = bake(q, W, H).height
    assert hq.std() < 0.5 * hp.std()


def test_class_density_is_an_analog_not_a_measurement() -> None:
    c = card()
    c["spectral_class"]["value"] = "S"
    p = params_from_card(c, 1)
    assert (p.density_kg_m3, p.density_source) == (2670.0, "analog_s")
    c["spectral_class"]["value"] = "C"
    assert params_from_card(c, 1).density_kg_m3 == 1190.0
    c["spectral_class"]["value"] = "X"
    assert params_from_card(c, 1).density_source == "generic"


def test_axis_ratio_from_lightcurve() -> None:
    p = params_from_card(card(lightcurve_amp_mag=0.5), 1)
    assert p.axis_ratio == pytest.approx(10 ** (0.4 * 0.5))
    c = card()
    c["lightcurve_amp_mag"]["value"] = None
    assert params_from_card(c, 1).axis_ratio == 1.0


def test_determinism_two_runs_identical() -> None:
    p = params_from_card(card(), 9)
    a, b = bake(p, W, H), bake(p, W, H)
    assert np.array_equal(a.height, b.height)
    assert np.array_equal(a.albedo, b.albedo)
    assert np.array_equal(a.normal, b.normal)


def test_different_seeds_differ() -> None:
    a = bake(params_from_card(card(), 1), W, H).height
    b = bake(params_from_card(card(), 2), W, H).height
    assert not np.array_equal(a, b)


def _max_column_jump(h: np.ndarray) -> float:
    return float(np.abs(np.diff(h, axis=1)).max())


def test_jump_detector_catches_a_needle() -> None:
    h = np.zeros((H, W))
    assert _max_column_jump(h) == 0.0
    h[60, 100] = 0.3
    assert _max_column_jump(h) == pytest.approx(0.3)


@pytest.mark.parametrize("diameter", [0.2, 2.0, 17.0, 250.0])
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_no_single_column_height_jumps(diameter: float, seed: int) -> None:
    """Issue #71: eroding the total height gave needle spikes. No pixel may differ from its
    east neighbour by more than a small part of the design range, and the field is bounded."""
    p = params_from_card(card(diameter, lightcurve_amp_mag=0.8), seed)
    h = bake(p, 512, 256).height
    assert np.isfinite(h).all()
    assert _max_column_jump(h) < 0.06 * p.relief_amp
    assert float(h.max() - h.min()) <= p.relief_amp * 1.05


def test_erosion_never_touches_the_shape_layer() -> None:
    """The overall shape does not depend on the craters at all, and the layers add up exactly."""
    p = params_from_card(card(17.0), 4)
    dirs = sphere_dirs(H, W)
    a = heights.asteroid_layers(p, dirs)
    bare = heights.asteroid_layers(dataclasses.replace(p, crater_coverage=0.0), dirs)
    more = heights.asteroid_layers(dataclasses.replace(p, crater_coverage=0.5), dirs)
    assert np.array_equal(a["shape"], bare["shape"])
    assert np.array_equal(a["shape"], more["shape"])
    assert not np.any(bare["craters"])
    total, _ = heights.asteroid_height(p, dirs)
    assert np.allclose(total, a["shape"] + a["craters"] + a["fine"] + a["boulders"], atol=1e-14)


def test_shape_rms_follows_lump() -> None:
    dirs = sphere_dirs(H, W)
    from app.core.render.craters import shape_layer

    rms = [float(np.sqrt(np.mean(shape_layer(dirs, 5, lump) ** 2))) for lump in (0.03, 0.3)]
    assert rms[1] / rms[0] == pytest.approx(10.0, rel=1e-6)
    assert 0.5 * 0.45 * 0.3 < rms[1] < 2.0 * 0.45 * 0.3  # about 0.45 lump on the sphere


def test_crater_population_follows_d_minus_2_and_saturates() -> None:
    from app.core.render.craters import crater_radii

    r, *_ = crater_radii(7, 0.239)
    assert 400 < len(r) <= 1500
    assert float(np.sum(r * r)) >= 0.239 * 4 * 0.98
    assert list(r) == sorted(r, reverse=True)
    # N(>D) ~ D^-2: the number above 2 x r_min is a quarter of the number above r_min.
    n1, n2 = np.sum(r >= 0.014), np.sum(r >= 0.028)
    assert n2 / n1 == pytest.approx(0.25, abs=0.06)
    assert len(crater_radii(7, 0.0)[0]) == 0
    assert len(crater_radii(7, 50.0)[0]) == 1500  # saturated: capped


def test_craters_stay_round_on_an_elongated_body() -> None:
    """One crater on a 10:1 body: its rim is at the same 3D distance in every direction."""
    from app.core.render import craters as cr

    axes = cr.ellipsoid_axes(10.0)
    assert float(np.prod(axes)) == pytest.approx(1.0)
    assert axes[0] / axes[1] == pytest.approx(10.0)
    dirs = sphere_dirs(256, 512)
    pos = cr.surface_points(dirs, axes)
    grid = cr._Grid(256, 512)
    theta, phi, rc = 1.3, 0.4, 0.2
    ix, dist, _ = cr._patch(grid, pos, axes, theta, phi, 2.4 * rc)
    # Every pixel whose 3D distance is under the reach is inside the patch (nothing is cut off).
    full = np.sqrt(np.sum((pos - cr._direction(theta, phi) * axes) ** 2, axis=-1))
    inside_full = full < 2.4 * rc
    mask = np.zeros_like(inside_full)
    mask[ix] = dist < 2.4 * rc
    assert np.array_equal(mask, inside_full)


def test_boulders_follow_structure_and_are_off_when_smooth() -> None:
    rub = params_from_card(card(0.5, rot_period_h=4.3), 1)
    solid = params_from_card(card(0.5, rot_period_h=0.5), 1)
    frac = params_from_card(card(250.0), 1)
    assert (rub.structure, solid.structure, frac.structure) == ("rubble", "solid", "fractured")
    assert rub.boulder_density > solid.boulder_density > frac.boulder_density


def test_height_png_uses_the_displacement_scale() -> None:
    p = params_from_card(card(), 2)
    r = bake(p, W, H)
    back = (r.height_png.astype(float) / 255 - 0.5) * p.relief_amp
    inside = np.abs(r.height) < 0.49 * p.relief_amp
    assert np.abs(back - r.height)[inside].max() < p.relief_amp / 255 + 1e-9


def test_missing_diameter_is_still_refused() -> None:
    from app.core.render import BakeRefusal

    c = card()
    c["diameter_km"]["value"] = None
    with pytest.raises(BakeRefusal):
        params_from_card(c, 1)
