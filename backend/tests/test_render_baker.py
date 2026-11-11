"""Texture baker acceptance tests (R11, issue #6): determinism, seam, normal length, refusal.

Run at 256x128 to stay fast; ``test_full_size_budget`` bakes 2048x1024 once.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import math
import sys
import threading
import time
import tracemalloc
import zlib
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from app.core.render import (
    BakeParams,
    BakeRefusal,
    bake,
    bake_dir,
    bake_to_cache,
    encode,
    params_from_card,
    texture_dir,
)
from app.core.render.bake import same_png, webp_rgb
from app.core.render.noise import sphere_dirs
from app.core.render.normals import normals_from_height
from tests.helpers import png_gray, png_join, png_redeflate, png_split, png_with_chunk

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
        assert seam_ratio(h) < 1.5  # 1.1 for the whole-map form; a real seam gives > 10
    # The albedo must be seamless too: column 0 against W-1 is no worse than a neighbour pair.
    a = r.albedo.astype(float)
    assert np.abs(a[:, 0] - a[:, -1]).mean() <= np.abs(np.diff(a, axis=1)).mean() * 1.5 + 0.5
    n = r.normal.astype(float) / 255 * 2 - 1
    length = np.linalg.norm(n, axis=-1)
    assert np.all(np.abs(length - 1) <= 0.02)
    assert np.all(r.normal[..., 2] >= 127)  # tangent-space +Z never points into the surface


def seam_ratio(h: np.ndarray, window: int = 8) -> float:
    """Mean |col 0 - col W-1| over the mean |neighbour difference| within ``window`` columns of
    the seam (about 1 when seamless).

    R11 compares the seam's mean with the *median* neighbour difference. Heavy-tailed relief
    (crater rims) puts the mean of any column pair above the median, so a seamless map can fail
    that. Mean against mean is the like-for-like form (Q-47). Issue #71 (Q-211): the neighbours
    are the ones next to the seam, not the whole map, because the new height field is dominated
    by a few smooth waves whose slope along a parallel varies by a factor of about 2 with
    longitude (a smooth field is not a seam).
    """
    wrapped = np.roll(h, window, axis=1)  # the seam now sits between columns window-1 and window
    d = np.abs(np.diff(wrapped[:, : 2 * window], axis=1))
    seam = d[:, window - 1].mean()
    others = np.delete(d, window - 1, axis=1).mean()
    return float(seam / others)


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


def test_seeds_past_32_bits_do_not_overflow_and_all_bits_count() -> None:
    """N7: seeds 0 and 2**32 must not give the same maps."""
    c = card("asteroid_procedural")
    assert bake(params_from_card(c, 2**40 + 5), 64, 32).height.shape == (32, 64)
    a = sha(encode(bake(params_from_card(c, 0), 64, 32)))
    b = sha(encode(bake(params_from_card(c, 2**32), 64, 32)))
    assert all(a[k] != b[k] for k in a)
    # Brown dwarf bands use only the hashed noise seed, so this catches a 32-bit fold on its own.
    d = card("brown_dwarf")
    a = sha(encode(bake(params_from_card(d, 0), 64, 32)))
    b = sha(encode(bake(params_from_card(d, 2**32), 64, 32)))
    assert a["albedo.webp"] != b["albedo.webp"]


def test_style_rules_match_r62() -> None:
    """Issue #71 (Q-210): the style now only sets the fine-detail noise; shape, craters and
    boulders come from physics (see test_rock_physics.py)."""
    expected = {
        0.99: ("rubble", 7, 6.0),
        1.0: ("cratered", 6, 3.0),
        50.0: ("cratered", 6, 3.0),
        50.1: ("large_cratered", 6, 2.0),
    }
    for d, want in expected.items():
        p = params_from_card(asteroid_card(d), 1)
        assert (p.style, p.noise_octaves, p.noise_freq) == want, d
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


def test_no_colour_source_bakes_relief_and_lists_albedo_map_missing() -> None:
    """B3: R7.2 makes colour optional, so only the albedo layer is lost."""
    c = card("asteroid_procedural")
    c["spectral_class"]["value"] = "B"  # no palette for B
    p = params_from_card(c, 1)
    assert "albedo_map" in p.missing
    r = bake(p, W, H)
    assert r.height.std() > 0 and np.all(
        np.abs(np.linalg.norm(r.normal / 255 * 2 - 1, axis=-1) - 1) <= 0.02
    )
    del c["spectral_class"]
    assert "albedo_map" in params_from_card(c, 1).missing
    assert "albedo_map" not in params_from_card(card("asteroid_procedural"), 1).missing


def test_missing_albedo_value_is_listed_not_silent() -> None:
    """N4: brightness 1.0 is outside the R6.2 range, so the card must be able to say so."""
    c = card("asteroid_procedural")
    del c["albedo"]
    p = params_from_card(c, 1)
    assert p.missing == ("brightness",)


NON_FINITE = [float("nan"), float("inf"), float("-inf")]


@pytest.mark.parametrize("bad", NON_FINITE, ids=str)
@pytest.mark.parametrize("field", ["albedo", "slope_075_25", "band_depth_3um"])
def test_non_finite_optional_value_is_treated_as_missing(field: str, bad: float) -> None:
    c = card("asteroid_procedural")
    c[field]["value"] = bad
    p = params_from_card(c, 1)
    assert math.isfinite(p.brightness) and math.isfinite(p.redness)
    if field == "albedo":
        assert p.missing == ("brightness",)
    elif field == "slope_075_25":
        assert p.redness == 0.0
    else:
        assert not p.hydration


@pytest.mark.parametrize("bad", [*NON_FINITE, 1e306, 0.0, -1.0], ids=str)
def test_non_finite_or_absurd_diameter_is_refused(bad: float) -> None:
    c = card("asteroid_procedural")
    c["diameter_km"]["value"] = bad
    with pytest.raises(BakeRefusal) as e:
        params_from_card(c, 1)
    assert e.value.missing == ["diameter_km"]


@pytest.mark.parametrize("bad", NON_FINITE, ids=str)
def test_non_finite_ch4_depth_means_no_bands(bad: float) -> None:
    c = card("brown_dwarf")
    c["ch4_depth_33"]["value"] = bad
    p = params_from_card(c, 4)
    assert p.band_contrast == 0.0 and p.missing == ("bands",)


@pytest.mark.parametrize(
    "rgb", [[float("nan")] * 3, [None] * 3, ["a", "b", "c"], [0.1, 0.2], [True, 0.1, 0.2]], ids=str
)
def test_bad_gaia_rgb_falls_back_instead_of_crashing(rgb: list[Any]) -> None:
    c = card("asteroid_procedural")
    c["gaia_rgb"] = {"value": rgb, "tag": "derived", "source": "t", "formula": "t"}
    assert params_from_card(c, 1).base_rgb == (0.26, 0.25, 0.24)  # class C palette


def test_normals_reject_non_finite_height() -> None:
    h = np.zeros((8, 16))
    h[2, 3] = np.nan
    with pytest.raises(ValueError):
        normals_from_height(h, 1.0)
    with pytest.raises(ValueError):
        normals_from_height(np.zeros((8, 16)), float("inf"))


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
    assert out == tmp_path / "sbdb%3A101955" / "v1" / "2" / "128x64"
    assert sorted(f.name for f in out.iterdir()) == [
        "albedo.webp",
        "bake.json",
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
    out = bake_dir(tmp_path, "x", "v1", 4, 64, 32)
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


# ---- cache validity and concurrency (B2, N2, N3, N5) -------------------------------------


def test_each_size_has_its_own_directory(tmp_path: Path) -> None:
    """B2 and N-A: sizes never replace each other, and each is served at its own size."""
    p = params_from_card(card("brown_dwarf"), 4)
    small = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    big = bake_to_cache(p, tmp_path, "x", "v1", 128, 64)
    assert small != big and small.name == "64x32" and big.name == "128x64"
    assert (small / "height.bin").stat().st_size == 64 * 32 * 2
    assert (big / "height.bin").stat().st_size == 128 * 64 * 2
    mt = (small / "bake.json").stat().st_mtime_ns
    assert bake_to_cache(p, tmp_path, "x", "v1", 64, 32) == small  # alternating: no rebake
    assert (small / "bake.json").stat().st_mtime_ns == mt


def test_two_sizes_concurrently_each_get_their_own_files(tmp_path: Path) -> None:
    p = params_from_card(card("brown_dwarf"), 4)
    bad: list[str] = []
    barrier = threading.Barrier(8)

    def work(i: int) -> None:
        w, h = (64, 32) if i % 2 else (128, 64)
        barrier.wait()
        out = bake_to_cache(p, tmp_path, "x", "v1", w, h)
        if (out / "height.bin").stat().st_size != w * h * 2:
            bad.append(f"{i}: wrong size")

    ts = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert bad == []


def test_changed_card_data_is_rebaked(tmp_path: Path) -> None:
    """N3: same id, version and seed but a different diameter must not return old bytes."""
    c = asteroid_card(0.5)
    out = bake_to_cache(params_from_card(c, 7), tmp_path, "b", "v1", 64, 32)
    before = (out / "height.bin").read_bytes()
    c["diameter_km"]["value"] = 120.0
    bake_to_cache(params_from_card(c, 7), tmp_path, "b", "v1", 64, 32)
    assert (out / "height.bin").read_bytes() != before


def test_corrupt_meta_is_rebaked(tmp_path: Path) -> None:
    p = params_from_card(card("brown_dwarf"), 4)
    out = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    for junk in ("not json", "null", "[]", '"s"', "7"):
        (out / "bake.json").write_text(junk)
        assert bake_to_cache(p, tmp_path, "x", "v1", 64, 32) == out
        assert json.loads((out / "bake.json").read_text())["key"]


def test_concurrent_bakes_of_one_key_all_succeed(tmp_path: Path) -> None:
    """N2: six workers on one key: no exception, one valid entry, no leftovers."""
    p = params_from_card(card("brown_dwarf"), 4)
    errors: list[BaseException] = []
    barrier = threading.Barrier(6)

    def work() -> None:
        try:
            barrier.wait()
            bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
        except BaseException as e:
            errors.append(e)

    threads = [threading.Thread(target=work) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    parent = texture_dir(tmp_path, "x", "v1", 4).parent
    assert [x.name for x in parent.iterdir()] == ["4"]


def test_windows_aliasing_ids_are_escaped(tmp_path: Path) -> None:
    segs = {
        i: texture_dir(tmp_path, i, "v1", 1).parent.parent.name for i in ("foo", "foo.", "foo ")
    }
    assert segs == {"foo": "foo", "foo.": "foo%2E", "foo ": "foo%20"}
    for dev in ("nul", "NUL", "com1", "nul.txt"):
        seg = texture_dir(tmp_path, dev, "v1", 1).parent.parent.name
        assert seg.split(".")[0].lower() not in {"nul", "com1"}
    assert texture_dir(tmp_path, "sbdb:101955", "v1", 1).parent.parent.name == "sbdb%3A101955"


# ---- golden hashes (N6) ------------------------------------------------------------------

GOLDEN: dict[str, dict[str, str]] = {
    "asteroid_procedural": {  # regenerated for issue #71 (BAKER_RULES_VERSION 3)
        "albedo.webp": "30398d894f58c9ca8080d689f1e7b4ed595e8e6cc7fccec48b51c2f7c1bf6de0",
        "height.png": "62f0f3503e8a9af94e80d1898dfd50155e791fe9ac629e7587a2c1eda4161808",
        "height.bin": "b3f7caafe5619e893c0b52a99bddb693b2786583bf3ae812fe22e4af3650824e",
        "normal.png": "1e84fc0ec8dedd673f077f97ceff11f51f04ced82c55906f0fd79f1924a263f9",
    },
    "brown_dwarf": {
        "albedo.webp": "e6f9fc0f3d6c472460ac1045df2361a4834af91a10bbd8de0086cd964e021274",
        "height.png": "0bf44f29f0ed386179ef48776cd6abe65387390db90beed489fa884e1663d494",
        "height.bin": "ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7",
        "normal.png": "64f853ff231c08ab920de83e4c7e103994204281c865d018195026fea52b7289",
    },
    "brown_dwarf_binary": {
        "albedo.webp": "b730a2a677e60765691aadb61fcd76e024235e7bf4304493caf81cee36db556c",
        "height.png": "0bf44f29f0ed386179ef48776cd6abe65387390db90beed489fa884e1663d494",
        "height.bin": "ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7",
        "normal.png": "64f853ff231c08ab920de83e4c7e103994204281c865d018195026fea52b7289",
    },
}


@pytest.mark.parametrize("name", [t for t, _ in BAKED])
def test_golden_hashes_at_64x32(name: str) -> None:
    """Fails if a rule, or numpy, libwebp or zlib, changes the bytes. Update on purpose only:
    bump BAKER_RULES_VERSION when the cause is a rule change."""
    seed = dict(BAKED)[name]
    got = sha(encode(bake(params_from_card(card(name), seed), 64, 32)))
    assert got == GOLDEN[name]


def test_a_valid_entry_published_by_another_worker_is_never_deleted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """N-D(c): the other worker finishes while this one is still encoding."""
    bake_mod = sys.modules["app.core.render.bake"]  # the package's `bake` is the function

    p = params_from_card(card("brown_dwarf"), 4)
    real_encode = bake_mod.encode
    state = {"first": True}
    mtimes: dict[str, int] = {}

    def racing_encode(r: Any) -> dict[str, bytes]:
        files = real_encode(r)
        if state["first"]:
            state["first"] = False
            other = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)  # the other worker
            mtimes["h"] = (other / "height.bin").stat().st_mtime_ns
        return files

    monkeypatch.setattr(bake_mod, "encode", racing_encode)
    out = bake_to_cache(p, tmp_path, "x", "v1", 64, 32)
    assert (out / "height.bin").stat().st_mtime_ns == mtimes["h"]  # same file, not a rebake


# ---- odd JSON numbers (N-B) --------------------------------------------------------------


def test_huge_json_integer_is_missing_not_a_crash() -> None:
    c = json.loads(
        '{"type": "asteroid_procedural", "id": "x", "diameter_km": {"value": 1' + "0" * 400 + "}}"
    )
    with pytest.raises(BakeRefusal):
        params_from_card(c, 1)
    c = card("asteroid_procedural")
    c["albedo"]["value"] = 10**400
    c["gaia_rgb"] = {"value": [10**400, 0.1, 0.1], "tag": "derived", "source": "t", "formula": "t"}
    p = params_from_card(c, 1)
    assert p.missing == ("gaia_rgb", "brightness")


def test_numpy_scalars_are_accepted() -> None:
    c = card("asteroid_procedural")
    c["diameter_km"]["value"] = np.float32(2.0)
    assert params_from_card(c, 1).radius_m == pytest.approx(1000.0)


def test_unusable_gaia_rgb_is_listed_so_the_colour_is_not_called_derived() -> None:
    c = card("asteroid_procedural")
    c["gaia_rgb"] = {
        "value": [0.3, float("nan"), 0.3],
        "tag": "derived",
        "source": "t",
        "formula": "t",
    }
    p = params_from_card(c, 1)
    assert "gaia_rgb" in p.missing and p.base_rgb == (0.26, 0.25, 0.24)


# --- same_png: the cross-machine PNG compare (Q-204) ---------------------------------------------


def _map_pixels() -> bytes:
    """A compressible 64x32 map, so that other deflate settings give other bytes."""
    return bytes(((x // 3) + y * 5) % 17 * 9 for y in range(32) for x in range(64))


def _pillow_png(pixels: bytes, size: tuple[int, int] = (64, 32), level: int = 9) -> bytes:
    buf = io.BytesIO()
    Image.frombytes("L", size, pixels).save(buf, "PNG", compress_level=level)
    return buf.getvalue()


def _base_png() -> bytes:
    return png_gray(64, 32, [0] * 32, _map_pixels())


def test_same_png_accepts_another_deflate_stream_and_idat_split() -> None:
    a = _base_png()
    b = png_redeflate(a, level=1, parts=3)
    assert a != b
    assert same_png(a, b) and same_png(b, a) and same_png(a, a)


def test_same_png_accepts_a_pillow_resave_at_another_level() -> None:
    a, b = _pillow_png(_map_pixels(), level=9), _pillow_png(_map_pixels(), level=1)
    assert a != b
    assert same_png(a, b)


def test_same_png_rejects_a_changed_pixel() -> None:
    px = bytearray(_map_pixels())
    px[100] ^= 1
    assert not same_png(_pillow_png(_map_pixels()), _pillow_png(bytes(px)))


def test_same_png_rejects_a_different_filter_byte() -> None:
    # The same pixels with row 3 stored with the Sub filter: stricter than a pixel compare.
    a = png_gray(64, 32, [0] * 32, _map_pixels())
    b = png_gray(64, 32, [0, 0, 0, 1, *([0] * 28)], _map_pixels())
    assert a != b
    assert not same_png(a, b)


def test_same_png_rejects_a_different_size_with_the_same_raw_bytes() -> None:
    assert not same_png(_pillow_png(_map_pixels(), (64, 32)), _pillow_png(_map_pixels(), (32, 64)))


def test_same_png_rejects_a_palette_image_with_the_same_grey_values() -> None:
    img = Image.frombytes("L", (64, 32), _map_pixels())
    pal = img.convert("P")
    pal.putpalette([v for i in range(256) for v in (i, i, i)])
    buf = io.BytesIO()
    pal.save(buf, "PNG", compress_level=9)
    assert not same_png(_pillow_png(_map_pixels()), buf.getvalue())


@pytest.mark.parametrize(
    ("kind", "body", "before"),
    [
        (b"tEXt", b"k\x00v", b"IEND"),  # text after the image data
        (b"tIME", bytes(7), b"IDAT"),  # a timestamp
        (b"prVt", b"private", b"IDAT"),  # a private ancillary chunk
    ],
)
def test_same_png_rejects_an_extra_chunk(kind: bytes, body: bytes, before: bytes) -> None:
    a = _base_png()
    b = png_with_chunk(a, kind, body, before)
    assert a != b
    assert not same_png(a, b) and not same_png(b, a)


def test_same_png_rejects_a_bad_crc() -> None:
    a = _base_png()
    idat_crc_at = a.index(b"IDAT") + 4 + len(png_split(a)[1][1])
    b = a[:idat_crc_at] + bytes([a[idat_crc_at] ^ 1]) + a[idat_crc_at + 1 :]
    assert not same_png(a, b)
    assert not same_png(b, png_redeflate(a))


def test_same_png_rejects_trailing_bytes_truncation_and_non_png() -> None:
    a = _base_png()
    assert not same_png(a, a + b"x")
    assert not same_png(a, a[: len(a) // 2])
    assert not same_png(png_redeflate(a), png_redeflate(a)[:-5])
    assert not same_png(a, webp_rgb(np.zeros((32, 64, 3), np.uint8)))
    assert not same_png(a, b"")


def _with_idats(
    png: bytes, idats: list[bytes], others: list[tuple[int, tuple[bytes, bytes]]]
) -> bytes:
    """``png`` rebuilt with the given IDAT payloads; ``others`` are (index, chunk) to insert."""
    chunks = [c for c in png_split(png) if c[0] not in (b"IDAT", b"IEND")]
    chunks += [(b"IDAT", d) for d in idats]
    for at, chunk in others:
        chunks.insert(at, chunk)
    return png_join([*chunks, (b"IEND", b"")])


def _idat_data(png: bytes) -> bytes:
    return b"".join(b for k, b in png_split(png) if k == b"IDAT")


def test_same_png_rejects_trailing_data_inside_idat() -> None:
    a = _base_png()
    hidden = _with_idats(a, [_idat_data(a) + b"hidden payload"], [])
    assert not same_png(hidden, a) and not same_png(a, hidden)


def test_same_png_rejects_a_chunk_moved_across_idat() -> None:
    a = _base_png()
    before = png_with_chunk(a, b"tEXt", b"k\x00v", b"IDAT")
    after = png_with_chunk(a, b"tEXt", b"k\x00v", b"IEND")
    assert before != after
    assert not same_png(before, after)


def test_same_png_rejects_idats_that_are_not_consecutive() -> None:
    a = png_with_chunk(_base_png(), b"tEXt", b"k\x00v", b"IEND")  # IHDR IDAT tEXt IEND
    data = _idat_data(a)
    half = len(data) // 2
    gap = (b"tEXt", b"k\x00v")
    broken = png_join(
        [
            *[c for c in png_split(a) if c[0] == b"IHDR"],
            (b"IDAT", data[:half]),
            gap,
            (b"IDAT", data[half:]),
            (b"IEND", b""),
        ]
    )
    assert not same_png(a, broken) and not same_png(broken, a)


def test_same_png_bounds_the_committed_side_by_the_fresh_side() -> None:
    fresh = _base_png()
    bomb = zlib.compress(bytes(200_000_000), 9)  # 200 MB of zeros in about 200 KB
    committed = _with_idats(fresh, [bomb], [])
    tracemalloc.start()
    try:
        assert not same_png(committed, fresh)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 50_000_000
