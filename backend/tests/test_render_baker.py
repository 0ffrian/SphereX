"""Texture baker acceptance tests (R11, issue #6): determinism, seam, normal length, refusal.

Run at 256x128 to stay fast; ``test_full_size_budget`` bakes 2048x1024 once.
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from app.core.render import (
    BakeParams,
    BakeRefusal,
    bake,
    bake_to_cache,
    encode,
    params_from_card,
    texture_dir,
)
from app.core.render.noise import sphere_dirs
from app.core.render.normals import normals_from_height

CARDS = Path(__file__).parents[2] / "shared" / "fixtures" / "cards"
W, H = 256, 128


def card(name: str) -> dict[str, Any]:
    return json.loads((CARDS / f"{name}.json").read_text(encoding="utf-8"))


def asteroid_card(diameter_km: float) -> dict[str, Any]:
    c = card("asteroid_procedural")
    c["diameter_km"]["value"] = diameter_km
    return c


BAKED = [
    ("asteroid_procedural", 2),
    ("brown_dwarf", 4),
    ("brown_dwarf_binary", 5),
]
# One asteroid per style (R6.2): rubble, cratered, large_cratered.
CASES: list[tuple[str, dict[str, Any], int]] = [(f"{t}", card(t), s) for t, s in BAKED] + [
    ("rubble", asteroid_card(0.5), 7),
    ("large_cratered", asteroid_card(120.0), 8),
]


def sha(files: dict[str, bytes]) -> dict[str, str]:
    return {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}


@pytest.mark.parametrize(("name", "c", "seed"), CASES, ids=[x[0] for x in CASES])
def test_determinism_same_sha256(name: str, c: dict[str, Any], seed: int) -> None:
    p = params_from_card(c, seed)
    assert sha(encode(bake(p, W, H))) == sha(encode(bake(p, W, H)))


@pytest.mark.parametrize(("name", "c", "seed"), CASES, ids=[x[0] for x in CASES])
def test_seam_and_normal_length(name: str, c: dict[str, Any], seed: int) -> None:
    r = bake(params_from_card(c, seed), W, H)
    h = r.height
    if name.startswith("brown_dwarf"):
        assert np.all(h == 0)  # flat: no relief is measured or invented
    else:
        assert seam_ratio(h) < 1.1
    # The albedo must be seamless too: column 0 against W-1 is no worse than a neighbour pair.
    a = r.albedo.astype(float)
    assert np.abs(a[:, 0] - a[:, -1]).mean() <= np.abs(np.diff(a, axis=1)).mean() * 1.5 + 0.5
    n = r.normal.astype(float) / 255 * 2 - 1
    length = np.linalg.norm(n, axis=-1)
    assert np.all(np.abs(length - 1) <= 0.02)
    assert np.all(r.normal[..., 2] >= 127)  # tangent-space +Z never points into the surface


def seam_ratio(h: np.ndarray) -> float:
    """Mean |col 0 - col W-1| over the mean |neighbour difference| (about 1 when seamless).

    R11 compares the seam's mean with the *median* neighbour difference. Heavy-tailed relief
    (crater rims) puts the mean of any column pair above the median, so a seamless map can fail
    that. Mean against mean is the like-for-like form (Q-43).
    """
    return float(np.abs(h[:, 0] - h[:, -1]).mean() / np.abs(np.diff(h, axis=1)).mean())


def test_seam_check_detects_a_real_seam() -> None:
    ramp = np.tile(np.linspace(0.0, 0.05, W), (H, 1))  # does not wrap: column W-1 != column 0
    assert seam_ratio(ramp) > 10
    # Cutting a seamless map open and rolling it by half a turn must not matter...
    h = bake(params_from_card(card("asteroid_procedural"), 2), W, H).height
    assert seam_ratio(np.roll(h, W // 2, axis=1)) < 1.1
    # ...but shifting one half in height creates a seam the test must see.
    broken = h.copy()
    broken[:, W // 2 :] += 0.02
    assert seam_ratio(broken) > 1.1


def test_different_seed_gives_different_maps() -> None:
    c = card("asteroid_procedural")
    a = sha(encode(bake(params_from_card(c, 2), W, H)))
    b = sha(encode(bake(params_from_card(c, 3), W, H)))
    assert all(a[k] != b[k] for k in a)


def test_seeds_past_32_bits_do_not_overflow() -> None:
    p = params_from_card(card("asteroid_procedural"), 2**40 + 5)
    assert bake(p, 64, 32).height.shape == (32, 64)


def test_style_rules_match_r62() -> None:
    expected = {
        0.99: ("rubble", 7, 6.0, 0.04, 40, 1.0),
        1.0: ("cratered", 6, 3.0, 0.03, 250, 0.2),
        50.0: ("cratered", 6, 3.0, 0.03, 250, 0.2),
        50.1: ("large_cratered", 6, 2.0, 0.02, 500, 0.05),
    }
    for d, want in expected.items():
        p = params_from_card(asteroid_card(d), 1)
        got = (
            p.style,
            p.noise_octaves,
            p.noise_freq,
            p.relief_amp,
            p.crater_count,
            p.boulder_density,
        )
        assert got == want, d
        assert p.radius_m == pytest.approx(d * 500)


def test_brightness_hydration_redness() -> None:
    c = card("asteroid_procedural")  # albedo 0.1, band_depth_3um 0, slope 1.0 %/um
    p = params_from_card(c, 1)
    assert p.brightness == pytest.approx(0.28)
    assert not p.hydration
    assert p.redness == pytest.approx(0.01)
    c["albedo"]["value"] = 1.0
    c["band_depth_3um"]["value"] = 0.2
    c["slope_075_25"]["value"] = 50.0
    p = params_from_card(c, 1)
    assert p.brightness == 0.8  # clamped
    assert p.hydration
    assert p.redness == 0.08  # clamped


def test_gaia_rgb_overrides_class_palette() -> None:
    c = card("asteroid_procedural")
    c["gaia_rgb"] = {"value": [0.1, 0.2, 0.3], "tag": "derived", "source": "t", "formula": "t"}
    assert params_from_card(c, 1).base_rgb == (0.1, 0.2, 0.3)


# ---- refusal rather than invention -------------------------------------------------------


def test_missing_diameter_is_refused_not_crashed() -> None:
    c = card("asteroid_procedural")
    del c["diameter_km"]
    with pytest.raises(BakeRefusal) as e:
        params_from_card(c, 1)
    assert e.value.missing == ["diameter_km"]
    c["diameter_km"] = {"value": None, "tag": "measured", "source": "t"}
    with pytest.raises(BakeRefusal):
        params_from_card(c, 1)


def test_no_colour_source_is_refused() -> None:
    c = card("asteroid_procedural")
    c["spectral_class"]["value"] = "Q-unknown"
    with pytest.raises(BakeRefusal) as e:
        params_from_card(c, 1)
    assert e.value.missing == ["gaia_rgb or spectral_class"]


def test_type_without_baked_textures_is_refused() -> None:
    for t in ("comet", "star", "gas_giant", "candidate", "asteroid_shape"):
        with pytest.raises(BakeRefusal) as e:
            params_from_card(card(t), 1)
        assert e.value.missing == ["textures"]


def test_brown_dwarf_without_ch4_is_flat_and_says_so() -> None:
    c = card("brown_dwarf")
    del c["ch4_depth_33"]
    p = params_from_card(c, 4)
    assert p.band_contrast == 0.0
    assert p.missing == ("bands",)
    a = bake(p, 64, 32).albedo
    assert np.all(a == a[0, 0])  # one flat colour


def test_brown_dwarf_contrast_rule() -> None:
    c = card("brown_dwarf")  # ch4 0.25 -> 0.5
    assert params_from_card(c, 4).band_contrast == pytest.approx(0.5)
    c["ch4_depth_33"]["value"] = 0.01
    assert params_from_card(c, 4).band_contrast == 0.1
    c["ch4_depth_33"]["value"] = 0.9
    assert params_from_card(c, 4).band_contrast == 0.8


def test_negative_seed_rejected() -> None:
    with pytest.raises(ValueError):
        params_from_card(card("asteroid_procedural"), -1)


# ---- normal map convention (R12 #2) ------------------------------------------------------


def _expected_normals(h: np.ndarray) -> np.ndarray:
    """True normals of the displaced sphere r = 1 + h, in the (east, north, radial) frame.

    Built only from the R6.1 pixel mapping: u (columns) is dP/dphi, v-up (north) is -dP/dtheta,
    radial is the direction itself. That is the tangent frame three.js derives from the UVs of a
    SphereGeometry with flipY = true, and its normalMap reads +Y as +v (OpenGL convention).
    """
    rows, cols = h.shape
    dirs = sphere_dirs(rows, cols)
    pts = dirs * (1 + h)[..., None]
    t = np.roll(pts, -1, axis=1) - np.roll(pts, 1, axis=1)  # toward +u
    b = pts[:-2] - pts[2:]  # north: the previous row
    t, b = t[1:-1], b
    n = np.cross(t, b)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    d = dirs[1:-1]
    e_u = np.roll(dirs, -1, axis=1)[1:-1] - np.roll(dirs, 1, axis=1)[1:-1]
    e_u /= np.linalg.norm(e_u, axis=-1, keepdims=True)
    e_n = dirs[:-2] - dirs[2:]
    e_n /= np.linalg.norm(e_n, axis=-1, keepdims=True)
    # The frame must be right-handed with the outward normal: east x north = radial.
    assert np.allclose(np.cross(e_u, e_n), d, atol=1e-2)
    return np.stack([np.sum(n * e_u, -1), np.sum(n * e_n, -1), np.sum(n * d, -1)], -1)


def test_normal_green_channel_is_opengl_y_up() -> None:
    rows, cols = 128, 256
    dirs = sphere_dirs(rows, cols)
    h = (
        0.02
        * np.sin(3 * np.arccos(dirs[..., 1]))
        * np.cos(2 * np.arctan2(dirs[..., 2], -dirs[..., 0]))
    )
    # Radius 1 m so slopes are those of the unit sphere; strength 1.
    n = normals_from_height(h, 1.0).astype(float) / 255 * 2 - 1
    got = n[1:-1]
    want = _expected_normals(h)
    band = slice(10, -10)  # away from the pole rows, where the baker clamps cos(lat)
    err = np.degrees(np.arccos(np.clip(np.sum(got[band] * want[band], -1), -1, 1)))
    flipped = got.copy()
    flipped[..., 1] *= -1
    err_flipped = np.degrees(np.arccos(np.clip(np.sum(flipped[band] * want[band], -1), -1, 1)))
    assert err.mean() < 1.0
    assert err_flipped.mean() > 5 * err.mean()  # the opposite convention is clearly worse


def test_flat_surface_encodes_as_128_128_255() -> None:
    n = normals_from_height(np.zeros((8, 16)), 1.0)
    assert np.all(n == np.array([128, 128, 255], dtype=np.uint8))


# ---- output, caching, performance --------------------------------------------------------


def test_cache_layout_and_files(tmp_path: Path) -> None:
    p = params_from_card(card("asteroid_procedural"), 2)
    out = bake_to_cache(p, tmp_path, "sbdb:101955", "v1", 128, 64)
    assert out == tmp_path / "sbdb%3A101955" / "v1" / "2"
    assert sorted(f.name for f in out.iterdir()) == [
        "albedo.webp",
        "height.bin",
        "height.png",
        "normal.png",
    ]
    assert (out / "height.bin").stat().st_size == 128 * 64 * 2  # float16, W x H
    assert Image.open(out / "albedo.webp").size == (128, 64)
    assert Image.open(out / "normal.png").size == (128, 64)
    # The float16 file decodes to the height map, little-endian.
    raw = np.frombuffer((out / "height.bin").read_bytes(), dtype="<f2").reshape(64, 128)
    assert np.allclose(raw, bake(p, 128, 64).height, atol=2e-4)
    assert not any(x.name.startswith(".bake-") for x in out.parent.iterdir())


def test_cache_hit_does_not_rebake(tmp_path: Path) -> None:
    p = params_from_card(card("brown_dwarf"), 4)
    out = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    before = {f.name: f.stat().st_mtime_ns for f in out.iterdir()}
    again = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    assert again == out
    assert before == {f.name: f.stat().st_mtime_ns for f in out.iterdir()}


def test_incomplete_cache_dir_is_rebuilt(tmp_path: Path) -> None:
    p = params_from_card(card("brown_dwarf"), 4)
    out = texture_dir(tmp_path, "x", "v1", 4)
    out.mkdir(parents=True)
    (out / "albedo.webp").write_bytes(b"partial")
    bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    assert (out / "normal.png").is_file()
    assert (out / "albedo.webp").read_bytes() != b"partial"


def test_ids_cannot_escape_the_root(tmp_path: Path) -> None:
    for bad in ("..", ".", ""):
        with pytest.raises(ValueError):
            texture_dir(tmp_path, bad, "v1", 1)
    assert texture_dir(tmp_path, "../../etc", "v1", 1).is_relative_to(tmp_path)


def test_map_must_be_two_to_one() -> None:
    p = params_from_card(card("brown_dwarf"), 4)
    with pytest.raises(ValueError):
        bake(p, 100, 100)


def test_bake_params_are_immutable() -> None:
    p = params_from_card(card("asteroid_procedural"), 2)
    assert isinstance(p, BakeParams)
    with pytest.raises(AttributeError):
        p.seed = 3  # type: ignore[misc]
    assert copy.deepcopy(p) == p


def test_full_size_budget() -> None:
    """2048x1024 (D-05 desktop) is an offline pre-bake; it must stay in tens of seconds."""
    p = params_from_card(card("asteroid_procedural"), 2)
    t0 = time.perf_counter()
    r = bake(p, 2048, 1024)
    assert time.perf_counter() - t0 < 90
    assert r.albedo.shape == (1024, 2048, 3)
