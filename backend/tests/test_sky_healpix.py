"""HEALPix NESTED maths (app.core.sky.healpix) and the synthetic HiPS -> equirect bake."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from app.core.sky import bake, healpix


def test_bits_round_trip() -> None:
    v = np.array([0, 1, 2, 3, 255, 511, 8191, (1 << 29) - 1], dtype=np.int64)
    assert np.array_equal(healpix.compress_bits(healpix.spread_bits(v)), v)
    assert int(healpix.spread_bits(0b111)) == 0b010101


@pytest.mark.parametrize("order", [0, 1, 2, 3, 4])
def test_every_pixel_centre_maps_back_to_its_pixel(order: int) -> None:
    pix = np.arange(12 * 4**order)
    theta, phi = healpix.pix2ang(order, pix)
    assert np.array_equal(healpix.ang2pix(order, theta, phi), pix)


@pytest.mark.parametrize("order", [9, 13, 20])
def test_random_pixel_centres_round_trip_at_deep_orders(order: int) -> None:
    pix = np.random.default_rng(order).integers(0, 12 * 4**order, 50_000)
    theta, phi = healpix.pix2ang(order, pix)
    assert np.array_equal(healpix.ang2pix(order, theta, phi), pix)


def test_base_pixel_centres() -> None:
    theta, phi = healpix.pix2ang(0, np.arange(12))
    z = np.cos(theta)
    assert np.allclose(z[:4], 2 / 3) and np.allclose(z[4:8], 0) and np.allclose(z[8:], -2 / 3)
    deg = np.degrees(phi)
    assert np.allclose(deg[:4], [45, 135, 225, 315])
    assert np.allclose(deg[4:8], [0, 90, 180, 270])
    assert np.allclose(deg[8:], [45, 135, 225, 315])


@pytest.mark.parametrize("order", [0, 3, 8])
def test_poles_are_the_north_and_south_face_corners(order: int) -> None:
    nside, npface = 1 << order, 4**order
    for k in range(4):
        phi = np.radians(45.0 + 90.0 * k)
        north = int(healpix.ang2pix(order, 0.0, phi))
        south = int(healpix.ang2pix(order, np.pi, phi))
        assert north == k * npface + int(healpix.xyf2nest(order, nside - 1, nside - 1, 0))
        assert south == (8 + k) * npface


def test_point_is_near_its_pixel_centre_and_hierarchy_is_nested() -> None:
    rng = np.random.default_rng(7)
    z = rng.uniform(-1, 1, 100_000)
    phi = rng.uniform(0, 2 * np.pi, 100_000)
    theta = np.arccos(z)
    for order in (2, 6, 11):
        p = healpix.ang2pix(order, theta, phi)
        tc, pc = healpix.pix2ang(order, p)
        cosd = np.cos(theta) * np.cos(tc) + np.sin(theta) * np.sin(tc) * np.cos(phi - pc)
        d = np.degrees(np.arccos(np.clip(cosd, -1, 1)))
        assert d.max() < 1.2 * healpix.pixel_size_deg(order)
        parent = healpix.ang2pix(order - 1, theta, phi)
        assert np.array_equal(p >> 2, parent)


def test_pixels_have_equal_area() -> None:
    rng = np.random.default_rng(3)
    n = 480_000
    theta = np.arccos(rng.uniform(-1, 1, n))
    phi = rng.uniform(0, 2 * np.pi, n)
    counts = np.bincount(healpix.ang2pix(2, theta, phi), minlength=192)
    mean = n / 192
    assert np.abs(counts - mean).max() < 5 * np.sqrt(mean)


def test_order_out_of_range_is_refused() -> None:
    with pytest.raises(ValueError):
        healpix.ang2pix(30, 0.0, 0.0)


# --- bake on a synthetic HiPS ---------------------------------------------------------------


def _colour(theta: np.ndarray, phi: np.ndarray) -> np.ndarray:
    """A smooth colour per direction: R from z, G from x, B from y."""
    x = np.sin(theta) * np.cos(phi)
    y = np.sin(theta) * np.sin(phi)
    z = np.cos(theta)
    return np.stack([128 + 120 * z, 128 + 120 * x, 128 + 120 * y], axis=-1)


def _synthetic_tile(order: int, n: int, width: int) -> bytes:
    """A lossless tile laid out like a HiPS JPEG (row = lx, col = ly)."""
    m = int(np.log2(width))
    lx, ly = np.meshgrid(np.arange(width), np.arange(width), indexing="ij")
    sub = n * width * width + healpix.spread_bits(lx) + (healpix.spread_bits(ly) << 1)
    theta, phi = healpix.pix2ang(order + m, sub)
    img = np.rint(_colour(theta, phi)).astype(np.uint8)  # img[row=lx, col=ly]
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return buf.getvalue()


def test_bake_follows_the_equirect_convention() -> None:
    order, width = 1, 16
    tiles = bake.load_tiles(lambda n: _synthetic_tile(order, n, width), order, width, width)
    img = bake.bake_equirect(tiles, order, 128, 64).astype(np.float64)
    ra, dec = bake.ra_dec_grid(128, 64, slice(0, 64))
    want = _colour(np.radians(90 - dec), np.radians(ra))
    # Order 5 pixels are ~1.8 deg; the colour changes by at most ~2 units per degree.
    assert np.abs(img - want).mean() < 2.0
    assert np.abs(img - want).max() < 12.0
    # North at the top (R from z), RA 90 deg at x = W/4 (B from y is highest there).
    assert img[0, :, 0].mean() > 240 and img[-1, :, 0].mean() < 16
    assert abs(int(np.argmax(img[32, :, 2])) - 31.5) <= 3  # not x = 96 (RA 270 deg)


def test_bake_is_deterministic() -> None:
    order, width = 1, 8
    tiles = bake.load_tiles(lambda n: _synthetic_tile(order, n, width), order, width, width)
    a = bake.encode_jpeg(bake.bake_equirect(tiles, order, 64, 32))
    b = bake.encode_jpeg(bake.bake_equirect(tiles, order, 64, 32))
    assert a == b


def test_bake_rejects_bad_inputs() -> None:
    tiles = np.zeros((12, 2, 2, 3), dtype=np.uint8)
    with pytest.raises(bake.BakeError):
        bake.bake_equirect(tiles, 0, 64, 64)
    with pytest.raises(bake.BakeError):
        bake.decode_tile(_synthetic_tile(0, 0, 8), 16)


def test_sub_width_matches_the_output_pixel() -> None:
    assert bake.choose_sub_width(4, 512, 8192) == 128
    assert bake.choose_sub_width(4, 512, 4096) == 64
    assert bake.choose_sub_width(3, 512, 4096) == 128


def test_orientation_to_local() -> None:
    img = np.arange(2 * 2 * 3, dtype=np.uint8).reshape(2, 2, 3)
    assert np.array_equal(bake.TILE_ORIENTATION.to_local(img), img)
    o = bake.Orientation(transpose=True, flip_row=True, flip_col=False)
    assert np.array_equal(o.to_local(img), img[::-1].swapaxes(0, 1))
    assert len(set(bake.ALL_ORIENTATIONS)) == 8
