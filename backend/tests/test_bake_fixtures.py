"""Baked fixture textures (issue #62 part A): determinism and the URLs the fixtures name."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from scripts import bake_fixtures as bf
from tests.helpers import png_redeflate

PARAMS = sorted((bf.FIXTURES / "params").glob("*.json"))


def test_rebake_is_byte_identical(tmp_path: Path) -> None:
    """Same card + seed -> same bytes, twice in a row and through the script's own writer."""
    assert bf.fixture_files() == bf.fixture_files()
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    first = {p: p.read_bytes() for p in sorted(tmp_path.rglob("*")) if p.is_file()}
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    assert bf.main(["--check"], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    assert {p: p.read_bytes() for p in sorted(tmp_path.rglob("*")) if p.is_file()} == first


def test_check_reports_a_changed_file(tmp_path: Path) -> None:
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    victim = next(tmp_path.rglob("height.bin"))
    data = victim.read_bytes()
    victim.write_bytes(bytes([data[0] ^ 0xFF]) + data[1:])
    assert bf.main(["--check"], out_dir=tmp_path, params_dir=tmp_path / "params") == 1


def test_check_accepts_a_png_with_another_deflate_stream(tmp_path: Path) -> None:
    """Q-204 (2): a PNG map from another machine's zlib passes and is not rewritten."""
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    victim = next(tmp_path.rglob("normal.png"))
    other = png_redeflate(victim.read_bytes(), level=1, parts=3)
    assert other != victim.read_bytes()
    victim.write_bytes(other)
    assert bf.main(["--check"], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    assert victim.read_bytes() == other


def test_check_reports_a_changed_png_pixel(tmp_path: Path) -> None:
    assert bf.main([], out_dir=tmp_path, params_dir=tmp_path / "params") == 0
    victim = next(tmp_path.rglob("height.png"))
    with Image.open(victim) as img:
        px = img.copy()
    px.putpixel((0, 0), (px.getpixel((0, 0)) + 1) % 256)
    px.save(victim, "PNG")
    assert bf.main(["--check"], out_dir=tmp_path, params_dir=tmp_path / "params") == 1


def test_demo_planet_params_are_baked_from_their_cards() -> None:
    """Issue #68 Part 6: the demo params are `card_to_params` of the card (plus sun_dir)."""
    for name, text in bf.demo_planet_params().items():
        assert (bf.PARAMS_DIR / name).read_text(encoding="utf-8") == text
        params = json.loads(text)
        assert params["generator_version"] == bf.FIXTURE_GENERATOR_VERSION
        if name.removesuffix(".json") in bf.DEMO_PLANET_SEEDS:
            assert params["type"] == "planet_rocky"
            assert "dynamics" not in params  # a spin is not on the card, so none is invented
        else:  # Bennu (Part 8a): the real shape model, its real spin on the card
            assert params["type"] == "asteroid_shape"
            assert [x["id"] for x in params["layers"]] == ["mesh", "spin"]


def test_committed_textures_match_the_baker() -> None:
    """shared/fixtures/textures is what the script writes (rerun it after a baker change)."""
    assert bf.main(["--check"]) == 0


@pytest.mark.parametrize("path", PARAMS, ids=[p.stem for p in PARAMS])
def test_every_fixture_texture_url_resolves(path: Path) -> None:
    params = json.loads(path.read_text(encoding="utf-8"))
    for key, url in params.get("textures", {}).items():
        if not isinstance(url, str):
            continue  # relief_amp is a number (R7.2), not a file
        file = bf.OUT_DIR / bf.url_to_relpath(url)
        assert file.is_file(), f"{path.name} {key}: {url}"
        if file.suffix in {".png", ".webp"}:
            with Image.open(file) as img:
                assert img.size == (bf.FIXTURE_TEXTURE_WIDTH, bf.FIXTURE_TEXTURE_HEIGHT)
        else:  # height.bin: float16, W x H (R6.7)
            assert file.stat().st_size == 2 * bf.FIXTURE_TEXTURE_WIDTH * bf.FIXTURE_TEXTURE_HEIGHT


def test_url_mapping_matches_the_baker_directory_names() -> None:
    rel = bf.url_to_relpath("/data/textures/fixture:brown_dwarf/fixture-0/4/albedo.webp")
    assert rel == Path("fixture%3Abrown_dwarf/fixture-0/4/albedo.webp")
    encoded = bf.url_to_relpath("/data/textures/fixture%3Abrown_dwarf/fixture-0/4/albedo.webp")
    assert encoded == rel
    with pytest.raises(ValueError):
        bf.url_to_relpath("/data/textures/a/b/not-a-seed/albedo.webp")
