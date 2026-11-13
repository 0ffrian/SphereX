"""Forced aperture photometry on synthetic cutouts with analytic answers (A4.2, R11 refusal)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.core.measure import aperture, solid_angle
from app.core.measure.config import DEFAULT_CONFIG as CFG
from app.core.measure.config import mover_config
from app.core.measure.photometry import Measurement, Refusal, measure_frame
from tests.measure_synth import NX, NY, OUTER_PIXEL, SOURCE_TOTAL, VAR, X0, Y0, Synth

UJY_PER_MJY = 1e12


def scale(s: Synth) -> float:
    omega = solid_angle.pixel_solid_angle_sr(s.hdul()["IMAGE"].header, X0, Y0)
    assert omega is not None
    return UJY_PER_MJY * omega


def measured(s: Synth, x0: float = X0, y0: float = Y0) -> Measurement:
    m = measure_frame(s.hdul(), x0, y0)
    assert isinstance(m, Measurement), m
    return m


def refused(s: Synth, x0: float = X0, y0: float = Y0) -> Refusal:
    r = measure_frame(s.hdul(), x0, y0)
    assert isinstance(r, Refusal), r
    return r


def test_noise_free_flux_and_error_are_analytic() -> None:
    s = Synth().standard()
    m = measured(s)
    # Decoy 5 px to the right contributes nothing; the target block is fully inside the core.
    assert m.flux == pytest.approx(scale(s) * SOURCE_TOTAL, rel=1e-6)
    w = aperture.aperture_weights((NY, NX), X0, Y0, CFG.aperture_radius_px, CFG.subpixels)
    n_ann = int(
        aperture.annulus_mask((NY, NX), X0, Y0, CFG.annulus_inner_px, CFG.annulus_outer_px).sum()
    )
    var32 = float(np.float32(VAR))
    expected = scale(s) * math.sqrt(var32 * (w**2).sum() + w.sum() ** 2 * var32 / n_ann)
    assert m.error == pytest.approx(expected, rel=1e-6)
    assert not m.flagged and m.dropped_weight_fraction == 0.0
    assert m.n_annulus == n_ann


def test_swapped_coordinates_miss_the_target() -> None:
    """Guards the test itself: with x and y swapped the aperture lands on empty sky.

    Tiny seeded sky noise keeps the annulus MAD above zero, so the target's pixels, which fall in
    the swapped annulus, are clipped as they would be in real data. The decoy is at least 9.4 px
    from the swapped centre, outside the annulus."""
    s = Synth().standard()
    s.image = s.image + np.random.default_rng(3).normal(0.0, 1e-3, s.image.shape)
    m = measured(s, Y0, X0)
    assert abs(m.flux) < 0.05 * scale(s) * SOURCE_TOTAL


def test_decoy_is_measured_only_when_aimed_at() -> None:
    s = Synth().standard()
    m = measured(s, X0 + 5.0, Y0)
    assert m.flux > 3.0 * measured(s).flux


def test_noisy_error_bars_match_the_scatter() -> None:
    rng = np.random.default_rng(1234)
    yy, xx = np.mgrid[0:NY, 0:NX]
    psf = np.exp(-((xx - X0) ** 2 + (yy - Y0) ** 2) / (2 * 0.6**2))
    psf *= 20.0 / psf.sum()
    w = aperture.aperture_weights((NY, NX), X0, Y0, CFG.aperture_radius_px, CFG.subpixels)
    truth = float((w * psf).sum())
    fluxes, errors = [], []
    for _ in range(300):
        s = Synth()
        s.image = s.image + psf + rng.normal(0.0, math.sqrt(VAR), s.image.shape)
        m = measured(s)
        fluxes.append(m.flux)
        errors.append(m.error)
    sc = scale(Synth())
    f = np.array(fluxes)
    assert abs(f.mean() - sc * truth) < 3.0 * f.std(ddof=1) / math.sqrt(len(f))
    assert 0.9 < f.std(ddof=1) / float(np.mean(errors)) < 1.1


def test_flagged_outer_pixel_is_dropped_not_rescaled() -> None:
    x, y = OUTER_PIXEL
    s = Synth().standard().set_flag(x, y, "HOT")
    s.image[y, x] = 1.0e4
    m = measured(s)
    assert m.flagged and m.dropped_flags == ("HOT",)
    w = aperture.aperture_weights((NY, NX), X0, Y0, CFG.aperture_radius_px, CFG.subpixels)
    assert w[y, x] > 0
    assert m.dropped_weight_fraction == pytest.approx(w[y, x] / w.sum())
    assert m.flux == pytest.approx(scale(s) * SOURCE_TOTAL, rel=1e-6)


def test_nan_in_an_outer_pixel_does_not_poison_the_sum() -> None:
    x, y = OUTER_PIXEL
    s = Synth().standard()
    s.image[y, x] = np.nan
    m = measured(s)
    assert m.dropped_flags == ("NONFINITE",)
    assert math.isfinite(m.flux) and m.flux == pytest.approx(scale(s) * SOURCE_TOTAL, rel=1e-6)


def test_source_flag_everywhere_is_kept() -> None:
    s = Synth().standard()
    s.flags[:, :] |= 1 << 21  # SOURCE on every pixel, as near bright stars in QR2
    m = measured(s)
    assert not m.flagged
    assert m.flux == pytest.approx(scale(s) * SOURCE_TOTAL, rel=1e-6)


def test_overflow_in_the_core_is_saturated() -> None:
    r = refused(Synth().standard().set_flag(17, 12, "OVERFLOW", "SOURCE"))
    assert r.reason == "saturated" and "OVERFLOW" in r.detail


def test_nan_core_with_sur_error_nearby_is_saturated() -> None:
    x, y = OUTER_PIXEL
    s = Synth().standard().set_flag(x, y, "SUR_ERROR")
    s.image[12, 17] = np.nan
    assert refused(s).reason == "saturated"


@pytest.mark.parametrize("flag", ["HOT", "SUR_ERROR", "NONLINEAR"])
def test_other_bad_core_pixels_refuse_as_aperture_flags(flag: str) -> None:
    r = refused(Synth().standard().set_flag(18, 13, flag))
    assert r.reason == "aperture_flags" and flag in r.detail


def test_fixed_object_with_outlier_on_the_core_is_still_refused() -> None:
    """Q-139 is for movers only: the default config refuses OUTLIER in the core (A4.2)."""
    r = refused(Synth().standard().set_flag(18, 13, "OUTLIER"))
    assert r.reason == "aperture_flags" and "OUTLIER" in r.detail


def test_mover_outlier_on_the_core_is_kept_and_recorded() -> None:
    clean = measured(Synth().standard())
    s = Synth().standard().set_flag(18, 13, "OUTLIER")
    m = measure_frame(s.hdul(), X0, Y0, mover_config())
    assert isinstance(m, Measurement)
    assert m.core_flagged == ("OUTLIER",) and m.dropped_flags == ()
    assert m.flagged  # agrees with the API's `flagged`
    assert m.flux == pytest.approx(clean.flux, rel=1e-9)  # the pixel stays in the sum


@pytest.mark.parametrize("flag", ["HOT", "NONLINEAR", "PERSIST"])
def test_mover_hardware_flag_beside_outlier_on_the_core_still_refuses(flag: str) -> None:
    s = Synth().standard().set_flag(18, 13, "OUTLIER", flag)
    r = measure_frame(s.hdul(), X0, Y0, mover_config())
    assert isinstance(r, Refusal) and r.reason == "aperture_flags"


def test_mover_outlier_off_the_core_is_still_dropped() -> None:
    s = Synth().standard().set_flag(int(X0) + 2, int(Y0), "OUTLIER")  # 2 px out: aperture, not core
    m = measure_frame(s.hdul(), X0, Y0, mover_config())
    assert isinstance(m, Measurement)
    assert m.core_flagged == () and m.dropped_flags == ("OUTLIER",)


def test_nan_core_alone_is_aperture_flags() -> None:
    s = Synth().standard()
    s.image[13, 18] = np.nan
    r = refused(s)
    assert r.reason == "aperture_flags" and "NONFINITE" in r.detail


def test_edge_and_background_refusals() -> None:
    assert refused(Synth().standard(), 2.0, Y0).reason == "aperture_edge"
    small = Synth(nx=9, ny=9)
    assert refused(small, 4.0, 4.0).reason == "background"


@pytest.mark.parametrize(
    ("kwargs", "reason"),
    [
        ({"image_bunit": "Jy"}, "unit"),
        ({"image_bunit": None}, "unit"),
        ({"var_bunit": "MJy / sr"}, "unit"),
        ({"mp_keys": False}, "flags_header"),
    ],
)
def test_header_refusals(kwargs: dict[str, object], reason: str) -> None:
    assert refused(Synth(**kwargs).standard()).reason == reason  # type: ignore[arg-type]


def test_unit_spellings_accepted() -> None:
    m = measured(Synth(image_bunit="MJy/sr", var_bunit="MJy2/sr2").standard())
    assert m.flux > 0


def test_deterministic() -> None:
    a = measured(Synth().standard())
    b = measured(Synth().standard())
    assert a == b


def test_nonpositive_variance_outside_core_is_dropped() -> None:
    x, y = OUTER_PIXEL
    s = Synth().standard()
    s.variance[y, x] = 0.0
    m = measured(s)
    assert m.dropped_flags == ("NONPOSITIVE_VARIANCE",) and m.dropped_weight_fraction > 0


def test_nonpositive_variance_in_core_is_refused() -> None:
    s = Synth().standard()
    s.variance[12, 17] = -1.0
    r = refused(s)
    assert r.reason == "aperture_flags" and "NONPOSITIVE_VARIANCE" in r.detail


def test_overflow_outside_the_core_is_measured_and_flagged() -> None:
    x, y = OUTER_PIXEL
    m = measured(Synth().standard().set_flag(x, y, "OVERFLOW"))
    assert m.flagged and m.dropped_flags == ("OVERFLOW",) and m.dropped_weight_fraction > 0


@pytest.mark.parametrize("name", ["OVERFLOW", "SUR_ERROR"])
def test_header_without_saturation_bits_is_refused(name: str) -> None:
    """Review fix 2: without these bits a saturated core would be measured as flux."""
    s = Synth(mp_omit=(name,)).standard()
    r = refused(s)
    assert r.reason == "flags_header" and name in r.detail


def test_header_without_other_reject_bits_lists_them() -> None:
    m = measured(Synth(mp_omit=("HOT",)).standard())
    assert m.reject_flags_absent == ("HOT",)
