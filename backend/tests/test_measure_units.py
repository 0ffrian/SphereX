"""Stage 2 building blocks: aperture weights, background, flags and pixel solid angle (A4.2)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.find import wcs
from app.core.measure import aperture, flags, solid_angle
from app.core.measure.config import REJECT_FLAGS, method_sha
from app.core.measure.config import MeasureConfig as Cfg
from tests.helpers import entries
from tests.measure_synth import NX, NY, X0, Y0, celestial_header

ARCSEC_SR = (math.pi / 180.0 / 3600.0) ** 2


def test_aperture_area_and_determinism() -> None:
    w = aperture.aperture_weights((NY, NX), X0, Y0, 3.0, 10)
    assert w.sum() == pytest.approx(math.pi * 9.0, rel=0.01)
    assert np.array_equal(w, aperture.aperture_weights((NY, NX), X0, Y0, 3.0, 10))
    assert w.max() == 1.0 and w.min() == 0.0
    # Weights are laid out [y, x]: the column of the centre is x, the row is y.
    xx, yy = aperture.pixel_centres((NY, NX))
    assert float((w * xx).sum() / w.sum()) == pytest.approx(X0, abs=0.02)
    assert float((w * yy).sum() / w.sum()) == pytest.approx(Y0, abs=0.02)


def test_aperture_inside_and_annulus() -> None:
    assert aperture.aperture_inside((NY, NX), X0, Y0, 3.0)
    assert not aperture.aperture_inside((NY, NX), 2.0, Y0, 3.0)
    assert not aperture.aperture_inside((NY, NX), X0, NY - 2.5, 3.0)
    ann = aperture.annulus_mask((NY, NX), X0, Y0, 6.0, 9.0)
    d = aperture.distance((NY, NX), X0, Y0)
    assert np.all((d[ann] >= 6.0) & (d[ann] < 9.0))
    assert ann.sum() == pytest.approx(math.pi * (81 - 36), rel=0.05)


def test_background_clips_a_neighbour_and_keeps_the_larger_variance() -> None:
    rng = np.random.default_rng(7)
    sky = 0.3 + rng.normal(0.0, 0.02, 200)
    var = np.full(200, 0.02**2)
    sky[:6] += 5.0  # a neighbour star in the annulus
    bg = aperture.clipped_background(sky, var, 3.0, 5, 20)
    assert bg is not None and bg.n <= 194
    assert bg.level == pytest.approx(0.3, abs=3 * math.sqrt(bg.variance))
    # Scatter 10x larger than VARIANCE: var(B) follows the scatter.
    noisy = 0.3 + rng.normal(0.0, 0.2, 200)
    bg2 = aperture.clipped_background(noisy, var, 3.0, 5, 20)
    assert bg2 is not None
    assert bg2.variance > 50 * float(var.sum()) / bg2.n**2
    assert aperture.clipped_background(sky[:10], var[:10], 3.0, 5, 20) is None


def test_flag_bits_from_a_real_header() -> None:
    _meta, body = entries("irsa_cutout")[0]
    with wcs.open_fits(body) as h:
        bits = flags.bits_by_name(h["FLAGS"].header)
    assert bits["HOT"] == 10 and bits["OVERFLOW"] == 1 and bits["SOURCE"] == 21
    assert "SOURCE" not in REJECT_FLAGS
    arr = np.array([[1 << 10, 1 << 21], [0, (1 << 1) | (1 << 21)]])
    mask, absent = flags.mask_of(arr, ["HOT", "OVERFLOW", "NOT_A_FLAG"], bits)
    assert mask.tolist() == [[True, False], [False, True]] and absent == ["NOT_A_FLAG"]
    assert flags.names_set(arr.ravel(), REJECT_FLAGS, bits) == ["HOT", "OVERFLOW"]


@pytest.mark.parametrize("dec", [0.0, 60.0, -89.0])
def test_solid_angle_tan(dec: float) -> None:
    h = celestial_header(crval=(150.0, dec))
    omega = solid_angle.pixel_solid_angle_sr(h, (NX - 1) / 2.0, (NY - 1) / 2.0)
    assert omega == pytest.approx(6.15**2 * ARCSEC_SR, rel=1e-6)


def test_solid_angle_across_ra_zero() -> None:
    """Reference pixel at RA 0: the +-0.5 px points straddle RA 0/360."""
    h = celestial_header(crval=(0.0, 10.0))
    cx, cy = (NX - 1) / 2.0, (NY - 1) / 2.0
    ra, _ = wcs.celestial_wcs(h).pixel_to_world_values([cx - 0.5, cx + 0.5], [cy, cy])
    assert max(ra) > 359.0 and min(ra) < 1.0  # the wrap really happens
    omega = solid_angle.pixel_solid_angle_sr(h, cx, cy)
    assert omega == pytest.approx(6.15**2 * ARCSEC_SR, rel=1e-6)


def test_solid_angle_matches_omega_median_on_fixtures() -> None:
    checked = 0
    for _, body in entries("irsa_cutout"):
        with wcs.open_fits(body) as h:
            hdr = h["IMAGE"].header
            if "OMEGA_MEDIAN" not in hdr:
                continue
            ny, nx = h["IMAGE"].data.shape
            omega = solid_angle.pixel_solid_angle_sr(hdr, (nx - 1) / 2.0, (ny - 1) / 2.0)
            assert omega is not None
            assert omega / ARCSEC_SR == pytest.approx(float(hdr["OMEGA_MEDIAN"]), rel=0.01)
            checked += 1
    assert checked >= 5


def test_fixture_cutouts_are_big_enough() -> None:
    """Stage 2 needs 2 * (annulus_outer + 1) + 1 = 21 px; fixtures are recorded at 360 arcsec."""
    for meta, body in entries("irsa_cutout"):
        with wcs.open_fits(body) as h:
            ny, nx = h["IMAGE"].data.shape
        assert nx >= 21 and ny >= 21, (
            f"fixture cutout {meta['key']['query']['frame_id']} is {nx}x{ny} px; Stage 2 needs "
            ">= 21 px (SX_CUTOUT_SIZE_ARCSEC >= 130, keep 180+). Re-record the fixtures."
        )


def test_method_hash_changes_with_settings() -> None:
    assert method_sha(Cfg()) == method_sha(Cfg())
    assert method_sha(Cfg(aperture_radius_px=2.5)) != method_sha(Cfg())
    assert method_sha(Cfg(reject_flags=("HOT",))) != method_sha(Cfg())


def test_background_with_zero_robust_width_is_the_plain_mean() -> None:
    """Review fix 4: 70 x 0.30 + 30 x 0.31 has MAD 0; clipping would keep only the 0.30s."""
    v = np.array([0.30] * 70 + [0.31] * 30)
    bg = aperture.clipped_background(v, np.full(100, 1e-4), 3.0, 5, 20)
    assert bg is not None and bg.n == 100
    assert bg.level == pytest.approx(0.303, abs=1e-12)


def test_background_with_zero_robust_width_still_rejects_a_star() -> None:
    """Zero MAD falls back to clipping with the sample std: star pixels do not pull B up."""
    v = np.array([0.30] * 70 + [0.31] * 30 + [5.0] * 4)
    bg = aperture.clipped_background(v, np.full(v.size, 1e-4), 3.0, 5, 20)
    assert bg is not None and bg.n == 100
    assert bg.level == pytest.approx(0.303, abs=1e-12)


def test_background_all_equal_values() -> None:
    bg = aperture.clipped_background(np.full(50, 0.3), np.full(50, 1e-4), 3.0, 5, 20)
    assert bg is not None and bg.n == 50 and bg.level == pytest.approx(0.3)
