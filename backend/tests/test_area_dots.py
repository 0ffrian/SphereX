"""Dots (A17.2, Q-400): detection, centroids, placement, Stage 2 on stamps, ids, and the
recorded Eros cutouts. Network blocked (conftest)."""

from __future__ import annotations

import math
import shutil
from collections.abc import Iterator
from dataclasses import replace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.area import dots as area_dots
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig
from app.core.area.dots import Stamper, find_dots, full_measure, sky_many, wavelength_many
from app.core.area.geometry import AreaBox
from app.core.find import wcs
from app.core.measure.photometry import Measurement, Refusal, measure_frame
from app.main import create_app
from tests.area_consistency import sep_px
from tests.area_recorded import recorded_dots, recorded_frames
from tests.area_synth import AreaSynth, flag_value, frame_for, full_coverage, spec_for
from tests.conftest import FIXTURE_CACHE, make_settings, purge_derived
from tests.helpers import entries, resolve_id

CFG = DEFAULT_AREA_CONFIG


def _run(s: AreaSynth, cfg: AreaConfig = CFG, **spec_kw: float) -> area_dots.FrameDots:
    spec = spec_for(s, **spec_kw)
    return find_dots(s.body(), frame_for(s), AreaBox.of(spec), full_coverage(spec, cfg), cfg)


def _fits_xy(s: AreaSynth, d: area_dots.Dot) -> tuple[float, float]:
    return d.x, (s.ny - 1) - d.y


# ------------------------------------------------------------------- synthetic


def test_noiseless_centroids_at_25_phases() -> None:
    """First-moment centroids of a pixel-integrated Gaussian (sigma 1 px, about the SPHEREx PSF):
    the 5 x 5 box truncates the wings, so a sub-pixel phase pulls the centroid towards the peak
    pixel: measured at most 0.042 px per axis at phase 0.4. It is not in sigma_c (Q-401)."""
    errs = []
    phases = [(a, b) for a in np.linspace(-0.4, 0.4, 5) for b in np.linspace(-0.4, 0.4, 5)]
    for k, (px, py) in enumerate(phases):
        s = AreaSynth(nx=40, ny=40)
        x0, y0 = 19.0 + px, 20.0 + py
        s.add_gaussian(x0, y0, 10.0)
        fd = _run(s)
        assert len(fd.dots) == 1, k
        x, y = _fits_xy(s, fd.dots[0])
        errs.append(max(abs(x - x0), abs(y - y0)))
        assert (x - x0) * px <= 1e-12 and (y - y0) * py <= 1e-12  # towards the peak pixel
    assert max(errs) == pytest.approx(0.042, abs=0.002)
    assert min(errs) <= 0.002  # the centred phase has no bias


def test_sigma_c_is_the_closed_form_for_constant_variance() -> None:
    s = AreaSynth(nx=40, ny=40)
    s.add_gaussian(19.3, 20.0, 10.0)
    fd = _run(s)
    d = fd.dots[0]
    img = s.image - s.sky
    ys, xs = np.mgrid[18:23, 17:22]  # 5 x 5 at the peak pixel (19, 20)
    w = img[18:23, 17:22]
    w = np.where(w > 0, w, 0.0)
    f = w.sum()
    cx, cy = (w * xs).sum() / f, (w * ys).sum() / f
    sx2 = (((xs - cx) ** 2) * np.where(w > 0, s.var, 0.0)).sum() / f**2
    sy2 = (((ys - cy) ** 2) * np.where(w > 0, s.var, 0.0)).sum() / f**2
    assert d.sigma_c_px == pytest.approx(round(math.sqrt((sx2 + sy2) / 2), 4), abs=2e-4)


def test_seeded_noisy_source_and_pure_noise() -> None:
    s = AreaSynth(nx=48, ny=40).add_gaussian(23.2, 19.7, 3.0).add_noise(11)
    fd = _run(s)
    assert len(fd.dots) == 1
    x, y = _fits_xy(s, fd.dots[0])
    # S/N 17: the noise moves the centroid by about FWHM / SNR = 0.14 px.
    assert math.hypot(x - 23.2, y - 19.7) == pytest.approx(0.158, abs=0.002)
    assert fd.dots[0].snr == pytest.approx(16.7, abs=1.0)
    # Pure noise: P(N > 5 sigma) = 2.9e-7 per pixel, so 20 cutouts of 3840 pixels expect 0.02
    # false peaks; the count is pinned at its measured value.
    false = sum(len(_run(AreaSynth(nx=64, ny=60).add_noise(seed)).dots) for seed in range(20))
    assert false == 0


def test_separation_on_peaks_and_on_centroids() -> None:
    near = AreaSynth(nx=48, ny=40).add_gaussian(20.0, 20.0, 10.0).add_gaussian(22.0, 20.0, 10.0)
    assert len(_run(near).dots) == 1
    far = AreaSynth(nx=48, ny=40).add_gaussian(18.0, 20.0, 10.0).add_gaussian(26.0, 20.0, 10.0)
    assert len(_run(far).dots) == 2
    fd = recorded_dots()
    for f in fd:
        pts = [(d.x, d.y) for d in f.dots]
        for i, a in enumerate(pts):
            for b in pts[i + 1 :]:
                assert math.dist(a, b) >= CFG.min_sep_px - 1e-6, f.frame_id


def test_hot_pixel_is_masked_and_outlier_is_kept() -> None:
    hot = AreaSynth(nx=48, ny=40)
    hot.image[20, 20] += 5.0
    hot.flags[20, 20] |= flag_value("HOT")
    assert _run(hot).dots == ()

    clean = AreaSynth(nx=48, ny=40).add_gaussian(20.0, 20.0, 10.0)
    flagged = AreaSynth(nx=48, ny=40).add_gaussian(20.0, 20.0, 10.0)
    flagged.flags[19:22, 19:22] |= flag_value("OUTLIER")
    a, b = _run(clean).dots[0], _run(flagged).dots[0]
    assert "OUTLIER" in b.flags and "OUTLIER" not in a.flags
    assert (a.flux_uJy, a.flux_err, a.x, a.y) == (b.flux_uJy, b.flux_err, b.x, b.y)


def test_saturated_core_is_refused_and_counted() -> None:
    s = AreaSynth(nx=48, ny=40).add_gaussian(20.0, 20.0, 50.0)
    s.flags[20, 20] |= flag_value("OVERFLOW")
    fd = _run(s)
    assert fd.dots == () and dict(fd.refused) == {"saturated": 1}


def test_ids_by_rounded_row_then_column_with_ten_or_more() -> None:
    s = AreaSynth(nx=96, ny=80)
    for j in range(3):
        for i in range(4):
            s.add_gaussian(14.0 + 20 * i + 0.3 * j, 16.0 + 20 * j, 8.0)
    fd = _run(s)
    assert len(fd.dots) == 12
    assert [d.dot_id.rsplit(":", 1)[1] for d in fd.dots] == [str(n) for n in range(1, 13)]
    keys = [(math.floor(d.y + 0.5), math.floor(d.x + 0.5)) for d in fd.dots]
    assert keys == sorted(keys)
    assert fd.dots[8].dot_id.endswith(":9") and fd.dots[9].dot_id.endswith(":10")


def test_ra_wraps_and_wavelength_inside_the_band() -> None:
    s = AreaSynth(nx=64, ny=40, crval=(0.0, 1.0))
    s.add_gaussian(10.0, 20.0, 10.0).add_gaussian(52.0, 20.0, 10.0)
    fd = _run(s)
    ras = sorted(d.ra for d in fd.dots)
    assert len(ras) == 2 and 0.0 <= ras[0] < 1.0 and 359.0 < ras[1] < 360.0
    f = frame_for(s)
    assert all(f.wavelength_min_um <= d.wavelength_um <= f.wavelength_max_um for d in fd.dots)


def test_dots_outside_the_box_or_coverage_are_dropped_before_measuring() -> None:
    s = AreaSynth(nx=96, ny=40).add_gaussian(15.0, 20.0, 10.0).add_gaussian(80.0, 20.0, 10.0)
    fd = _run(s, width=40 * 6.15 / 3600.0)  # a box of the central 40 columns only
    assert len(fd.dots) == 0 and dict(fd.refused)["outside_box"] == 2
    spec = spec_for(s)
    cov = full_coverage(spec)
    cov.mask[:, : cov.mask.shape[1] // 2] = False  # the western half is not covered
    fd = find_dots(s.body(), frame_for(s), AreaBox.of(spec), cov, CFG)
    assert len(fd.dots) == 1 and dict(fd.refused)["coverage"] == 1
    assert fd.timings["measure_calls"] == 1.0


def test_mesh_follows_a_gradient() -> None:
    s = AreaSynth(nx=128, ny=96)
    yy, xx = np.mgrid[0:96, 0:128]
    s.image += 0.002 * xx + 0.001 * yy
    image, _, _, usable = area_dots.hardware_usable(s.hdul(), CFG)
    mesh = area_dots.mesh_background(image, usable, CFG)
    assert mesh is not None
    inner = (slice(16, 80), slice(16, 112))
    assert np.max(np.abs(mesh[0][inner] - image[inner]) / image[inner]) < 0.01


def test_noise_medians_are_reported() -> None:
    fd = _run(AreaSynth(nx=64, ny=64).add_noise(1))
    noise = dict(fd.noise)
    assert noise["sqrt_var_median"] == pytest.approx(math.sqrt(1e-3), rel=1e-6)
    assert noise["mesh_std_median"] == pytest.approx(math.sqrt(1e-3), rel=0.1)


# ------------------------------------------------------------------- vectorised WCS and stamps


def _recorded_hduls() -> Iterator[tuple[str, object]]:
    for meta, body in entries("irsa_cutout"):
        fid = meta["key"]["query"].get("frame_id")
        if fid and fid.startswith("2026W12_2A_0"):
            yield fid, wcs.open_fits(body)


def test_vectorised_wcs_equals_the_per_pixel_helpers() -> None:
    rng = np.random.default_rng(5)
    n = 0
    for _, h in _recorded_hduls():
        ny, nx = np.asarray(h["IMAGE"].data).shape  # type: ignore[index]
        x = rng.uniform(0, nx - 1, 15)
        y = rng.uniform(0, ny - 1, 15)
        wave = wavelength_many(h, x, y)
        ra, dec = sky_many(h, x, y)
        assert wave is not None
        w = wcs.celestial_wcs(h["IMAGE"].header)  # type: ignore[index]
        for i in range(len(x)):
            one = wcs.wavelength_at(h, float(x[i]), float(y[i]))
            assert one is not None
            assert abs(wave[0][i] - one[0]) <= 1e-12 and abs(wave[1][i] - one[1]) <= 1e-12
            r1, d1 = (float(v) for v in w.pixel_to_world_values(float(x[i]), float(y[i])))
            assert abs(ra[i] - r1 % 360.0) <= 1e-12 and abs(dec[i] - d1) <= 1e-12
            n += 1
    assert n >= 200


def test_stamp_gives_the_whole_cutout_outcome() -> None:
    rng = np.random.default_rng(9)
    trials = 0
    for _, h in _recorded_hduls():
        ny, nx = np.asarray(h["IMAGE"].data).shape  # type: ignore[index]
        stamper = Stamper(h, CFG)
        for _ in range(20):
            x, y = float(rng.uniform(-0.5, nx - 0.5)), float(rng.uniform(-0.5, ny - 0.5))
            a = full_measure(h, x, y, CFG)
            b, _ = stamper.measure(x, y)
            trials += 1
            assert type(a) is type(b)
            if isinstance(a, Refusal):
                assert isinstance(b, Refusal) and a.reason == b.reason
            else:
                assert isinstance(b, Measurement)
                assert abs(a.flux - b.flux) <= 1e-9 * a.error
                assert b.error == pytest.approx(a.error, rel=1e-12)
                assert b.omega_sr == pytest.approx(a.omega_sr, rel=1e-12)
                assert a.dropped_flags == b.dropped_flags
    assert trials >= 300


# ------------------------------------------------------------------- recorded Eros cutouts


@pytest.fixture(scope="module")
def eros_positions(tmp_path_factory: pytest.TempPathFactory) -> dict[str, tuple[float, float]]:
    """Horizons positions of Eros per frame, as Track serves them (PR #53 fixtures, offline)."""
    dst = tmp_path_factory.mktemp("eros") / "cache"
    shutil.copytree(FIXTURE_CACHE, dst)
    purge_derived(dst)
    with TestClient(create_app(make_settings(dst))) as c:
        oid = resolve_id(c, "433 Eros")
        body = c.get(f"/v1/objects/{oid}/frames").json()
    return {f["frame_id"]: (f["ra"], f["dec"]) for f in body["frames"]}


# Measured on the 16 recorded cutouts with AREA_MEASURE_CONFIG (OUTLIER kept, Q-139, Q-178).
EROS_FOUND = 14
EROS_MISSED = {"2026W12_2A_0158_4_D1", "2026W12_2A_0341_2_D4"}


def test_eros_is_one_dot_in_14_of_16_frames(eros_positions: dict[str, tuple[float, float]]) -> None:
    assert len(eros_positions) == 16
    found = set()
    for fd in recorded_dots():
        if fd.frame_id not in eros_positions:
            continue
        ra, dec = eros_positions[fd.frame_id]
        near = [d for d in fd.dots if sep_px(d.ra, d.dec, ra, dec) <= 2.0]
        assert len(near) <= 1, fd.frame_id
        if near:
            found.add(fd.frame_id)
            d = near[0]
            assert sep_px(d.ra, d.dec, ra, dec) <= 0.1
            assert 150.0 <= d.snr <= 340.0 and "OUTLIER" in d.flags
    assert len(found) == EROS_FOUND
    assert set(eros_positions) - found == EROS_MISSED


def test_the_two_missed_eros_frames_are_refused_by_stage_2(
    eros_positions: dict[str, tuple[float, float]],
) -> None:
    _, bodies = recorded_frames()
    for fid in sorted(EROS_MISSED):
        h = wcs.open_fits(bodies[fid])
        x, y = wcs.object_pixel(h, *eros_positions[fid])
        m = measure_frame(h, x, y, CFG.measure)
        assert isinstance(m, Refusal) and m.reason == "aperture_flags", fid


def test_track_default_config_would_refuse_eros_almost_everywhere(
    eros_positions: dict[str, tuple[float, float]],
) -> None:
    """Q-139's evidence: with OUTLIER masked (Track's Stage 2 list) Eros is refused in 15/16."""
    _, bodies = recorded_frames()
    refused = 0
    for fid, (ra, dec) in eros_positions.items():
        h = wcs.open_fits(bodies[fid])
        x, y = wcs.object_pixel(h, ra, dec)
        refused += isinstance(measure_frame(h, x, y), Refusal)
    assert refused == 15


def test_recorded_dots_are_in_coverage_and_in_band() -> None:
    frames, _ = recorded_frames()
    by_id = {f.frame_id: f for f in frames.frames}
    for fd in recorded_dots():
        f = by_id[fd.frame_id]
        for d in fd.dots:
            assert f.wavelength_min_um <= d.wavelength_um <= f.wavelength_max_um
            assert d.flux_err > 0 and d.sigma_c_px > 0
            assert (d.visit, d.exposure, d.detector, d.time) == (
                f.visit,
                f.exposure,
                f.detector,
                f.time,
            )
        assert "band" not in dict(fd.refused)


def test_a_changed_config_changes_the_dots() -> None:
    frames, bodies = recorded_frames()
    f = next(f for f in frames.frames if f.cutout_sha256)
    box = AreaBox.of(frames.spec)
    cov = {c.visit: c for c in frames.coverage}[f.visit]
    a = find_dots(bodies[f.frame_id], f, box, cov, CFG)
    b = find_dots(bodies[f.frame_id], f, box, cov, replace(CFG, k_detect=8.0))
    assert len(b.dots) < len(a.dots)
