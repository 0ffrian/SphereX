"""SPHEREx false-colour composite: band selection, WCS alignment, stretch, cache and API.

Synthetic cutouts (built here, nothing binary committed) carry rotated and mirrored TAN WCSs, a
point source at the object and a second source 10 px north and 6 px east of it. On the composite
both must land where a north-up, east-left grid puts them, in every band.
"""

from __future__ import annotations

import io
import json
import math
from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient
from PIL import Image

from app.adapters import irsa_cutout
from app.cache.store import LiveResponse
from app.context import Context, make_context
from app.core.composite import config, grid
from app.core.composite.select import (
    ALL_SATURATED,
    NO_COMMON_PASS,
    TOO_FEW_BANDS,
    Candidate,
    select_bands,
)
from app.core.composite.service import CompositeService, composite_key
from app.core.find.frames import FrameRecord, FrameService, frames_key
from app.core.find.ids import coord_id
from app.core.find.resolver import load_object
from app.main import create_app
from tests.conftest import make_settings
from tests.measure_synth import MP_BITS

T0 = datetime(2025, 11, 7, tzinfo=UTC)
SCALE = 6.15  # arcsec/px of the synthetic frames
RA0, DEC0 = 150.0, 2.0
NORTH_PX, EAST_PX = 10.0, 6.0  # offset of the second source


def cand(fid: str, wl: float, days: float = 0.0, **kw: Any) -> Candidate:
    return Candidate(fid, T0 + timedelta(days=days), wl, kw.pop("usable", True), **kw)


# --- band selection -------------------------------------------------------------------------


def test_nearest_wavelength_in_one_pass() -> None:
    sel = select_bands(
        [
            cand("b1", 1.25),
            cand("b2", 1.19),
            cand("g1", 2.21, 1),
            cand("g2", 2.35, 1),
            cand("r1", 4.48, 2),
            cand("x", 3.3, 2),  # no channel near 3.3 um
        ]
    )
    assert sel.ok and sel.missing == []
    assert [p.candidate.frame_id for p in sel.picks] == ["b2", "g1", "r1"]
    assert [p.channel for p in sel.picks] == ["blue", "green", "red"]


def test_unflagged_frame_preferred_and_refused_frame_never_used() -> None:
    sel = select_bands(
        [
            cand("b_sat", 1.20, usable=False, refusal="saturated"),
            cand("b_flag", 1.21, flagged=True),
            cand("b_ok", 1.26),
            cand("g", 2.2, 1),
            cand("r", 4.5, 2),
        ]
    )
    assert [p.candidate.frame_id for p in sel.picks] == ["b_ok", "g", "r"]
    assert sel.missing == ["composite:blue:skipped:saturated:b_sat"]


def test_all_three_from_one_pass() -> None:
    # Pass A (day 0-2) has no red; pass B (day 180-183) has all three but worse wavelengths.
    sel = select_bands(
        [
            cand("bA", 1.2, 0),
            cand("gA", 2.2, 1),
            cand("rB", 4.6, 181),
            cand("bB", 1.25, 180),
            cand("gB", 2.3, 183),
        ]
    )
    assert [p.candidate.frame_id for p in sel.picks] == ["bB", "gB", "rB"]


def test_no_common_pass() -> None:
    span = config.MAX_PASS_SPAN_DAYS
    sel = select_bands([cand("b", 1.2, 0), cand("g", 2.2, 0), cand("r", 4.5, span + 0.01)])
    assert not sel.ok and sel.missing == [NO_COMMON_PASS]
    ok = select_bands([cand("b", 1.2, 0), cand("g", 2.2, 0), cand("r", 4.5, span - 0.01)])
    assert ok.ok


def test_best_pass_then_earliest_on_a_tie() -> None:
    cands = [
        cand("b1", 1.2, 0),
        cand("g1", 2.2, 0),
        cand("r1", 4.5, 0),
        cand("b2", 1.2, 100),
        cand("g2", 2.2, 100),
        cand("r2", 4.5, 100),
    ]
    sel = select_bands(cands)
    assert [p.candidate.frame_id for p in sel.picks] == ["b1", "g1", "r1"]
    shuffled = select_bands(list(reversed(cands)))
    assert [p.candidate.frame_id for p in shuffled.picks] == ["b1", "g1", "r1"]


def test_missing_channel_is_refused() -> None:
    sel = select_bands([cand("b", 1.2), cand("g", 2.2), cand("far", 4.0)])  # 4.0 is 11 % off
    assert not sel.ok
    assert sel.missing == ["composite:red:no_frame", TOO_FEW_BANDS]


def test_saturated_channel_is_refused_not_used() -> None:
    sel = select_bands(
        [
            cand("b", 1.2, usable=False, refusal="saturated"),
            cand("g", 2.2, usable=False, refusal="aperture_flags"),
            cand("r", 4.5),
        ]
    )
    assert not sel.ok and sel.picks == []
    assert sel.missing == sorted(
        [
            "composite:blue:saturated",
            "composite:green:no_usable_frame",
            TOO_FEW_BANDS,
            ALL_SATURATED,
        ]
    )


# --- synthetic frames -----------------------------------------------------------------------


def frame_header(nx: int, ny: int, angle_deg: float, mirrored: bool) -> fits.Header:
    """TAN WCS centred on (RA0, DEC0), rotated by ``angle_deg``; east right when mirrored."""
    s = SCALE / 3600.0
    t = math.radians(angle_deg)
    rot = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    cd = rot @ np.diag([s if mirrored else -s, s])
    h = fits.Header()
    h["WCSAXES"] = 2
    h["CTYPE1"], h["CTYPE2"] = "RA---TAN", "DEC--TAN"
    h["CUNIT1"], h["CUNIT2"] = "deg", "deg"
    # Reference pixel off-centre, so a wrong centre shows up.
    h["CRPIX1"], h["CRPIX2"] = (nx - 1) / 2.0 + 1.0 + 1.3, (ny - 1) / 2.0 + 1.0 - 0.7
    h["CRVAL1"], h["CRVAL2"] = RA0, DEC0
    h["CD1_1"], h["CD1_2"], h["CD2_1"], h["CD2_2"] = cd[0, 0], cd[0, 1], cd[1, 0], cd[1, 1]
    h["RADESYS"] = "ICRS"
    return h


def second_source() -> tuple[float, float]:
    dec = DEC0 + NORTH_PX * SCALE / 3600.0
    ra = RA0 + EAST_PX * SCALE / 3600.0 / math.cos(math.radians(DEC0))
    return ra, dec


def star_image(
    h: fits.Header, nx: int, ny: int, amp: float = 50.0, sky: float = 0.3
) -> np.ndarray[Any, Any]:
    w = WCS(h)
    yy, xx = np.mgrid[0:ny, 0:nx].astype(np.float64)
    img = np.full((ny, nx), sky)
    for (ra, dec), a in (((RA0, DEC0), amp), (second_source(), amp / 2)):
        x0, y0 = (float(v) for v in w.world_to_pixel_values(ra, dec))
        img += a * np.exp(-((xx - x0) ** 2 + (yy - y0) ** 2) / (2 * 1.2**2))
    # Deterministic low-level texture so the percentiles are well defined.
    img += 0.01 * ((xx * 7 + yy * 13) % 5)
    return img


def cutout_bytes(
    angle: float, mirrored: bool, nx: int = 59, ny: int = 59, sat_core: bool = False
) -> bytes:
    h = frame_header(nx, ny, angle, mirrored)
    img_h, var_h, flag_h = h.copy(), h.copy(), h.copy()
    img_h["BUNIT"] = "MJy / sr"
    var_h["BUNIT"] = "MJy2 / sr2"
    for name, bit in MP_BITS.items():
        flag_h[f"HIERARCH MP_{name}"] = bit
    img = star_image(h, nx, ny)
    flags = np.zeros((ny, nx), dtype=np.int32)
    if sat_core:
        x0, y0 = (round(float(v)) for v in WCS(h).world_to_pixel_values(RA0, DEC0))
        flags[y0, x0] |= 1 << MP_BITS["OVERFLOW"]
    buf = io.BytesIO()
    fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.ImageHDU(img.astype(np.float32), img_h, name="IMAGE"),
            fits.ImageHDU(flags, flag_h, name="FLAGS"),
            fits.ImageHDU(np.full((ny, nx), 1e-3, dtype=np.float32), var_h, name="VARIANCE"),
        ]
    ).writeto(buf)
    return buf.getvalue()


# --- grid and alignment ---------------------------------------------------------------------


def centroid(img: np.ndarray[Any, Any], x: float, y: float, r: int = 3) -> tuple[float, float]:
    x0, y0 = round(x), round(y)
    box = img[y0 - r : y0 + r + 1, x0 - r : x0 + r + 1].astype(np.float64)
    box = box - np.median(img)
    box[box < 0] = 0
    yy, xx = np.mgrid[y0 - r : y0 + r + 1, x0 - r : x0 + r + 1]
    return float((box * xx).sum() / box.sum()), float((box * yy).sum() / box.sum())


def test_grid_is_north_up_east_left() -> None:
    g = grid.Grid(RA0, DEC0, SCALE, 59)
    assert g.png_xy(RA0, DEC0) == pytest.approx((29.0, 29.0), abs=1e-9)
    x2, y2 = g.png_xy(*second_source())
    assert x2 == pytest.approx(29.0 - EAST_PX, abs=0.02)  # east is left
    assert y2 == pytest.approx(29.0 - NORTH_PX, abs=0.02)  # north is up


def test_grid_size_is_odd() -> None:
    assert grid.grid_size(360.0, 6.15) == 59
    assert grid.grid_size(360.0, 6.0) == 59
    assert grid.grid_size(10.0, 6.15) == 3


@pytest.mark.parametrize("mirrored", [False, True])
@pytest.mark.parametrize("angle", [0.0, 30.0, 137.0, -90.0])
def test_sources_land_where_the_grid_says(angle: float, mirrored: bool) -> None:
    """Whatever the input frame's rotation and handedness, both sources land at the grid's
    expected PNG positions (no flips, no doubled stars)."""
    nx, ny = 61, 57  # non-square, so an x/y swap would show
    h = frame_header(nx, ny, angle, mirrored)
    img = star_image(h, nx, ny)
    g = grid.Grid(RA0, DEC0, SCALE, 59)
    sra, sdec = g.sky()
    band = np.flipud(grid.resample(img, h, sra, sdec))  # PNG orientation
    for ra, dec in ((RA0, DEC0), second_source()):
        ex, ey = g.png_xy(ra, dec)
        cx, cy = centroid(np.nan_to_num(band), ex, ey)
        assert abs(cx - ex) < 0.15 and abs(cy - ey) < 0.15, (angle, mirrored, ra, dec, cx, cy)


def test_sip_distortion_is_applied() -> None:
    """A TAN-SIP frame: sources land where the grid says only if resampling applies the SIP
    polynomial (all_world2pix). The distortion moves the second source by about 0.9 px."""
    nx, ny = 61, 57
    h = frame_header(nx, ny, 30.0, False)
    h["CTYPE1"], h["CTYPE2"] = "RA---TAN-SIP", "DEC--TAN-SIP"
    h["A_ORDER"], h["B_ORDER"] = 2, 2
    h["A_2_0"], h["A_1_1"], h["B_0_2"], h["B_1_1"] = 1e-2, 5e-3, -1e-2, 2.5e-3
    img = star_image(h, nx, ny)  # sources placed through the same (SIP) WCS
    w = WCS(h)
    assert w.sip is not None
    ra2, dec2 = second_source()
    sip_xy = np.array(w.all_world2pix([ra2], [dec2], 0)).ravel()
    lin_xy = np.array(w.wcs_world2pix([ra2], [dec2], 0)).ravel()
    assert float(np.hypot(*(sip_xy - lin_xy))) > 0.5  # the test can tell the two apart
    g = grid.Grid(RA0, DEC0, SCALE, 59)
    sra, sdec = g.sky()
    band = np.flipud(grid.resample(img, h, sra, sdec))
    for ra, dec in ((RA0, DEC0), (ra2, dec2)):
        ex, ey = g.png_xy(ra, dec)
        cx, cy = centroid(np.nan_to_num(band), ex, ey)
        assert abs(cx - ex) < 0.15 and abs(cy - ey) < 0.15, (ra, dec, cx, cy)


def test_flagged_pixels_are_masked() -> None:
    hdul = fits.open(io.BytesIO(cutout_bytes(0.0, False)))
    hdul["FLAGS"].data[10, 12] |= 1 << MP_BITS["TRANSIENT"]
    data, masked = grid.masked_image(hdul)
    assert masked and np.isnan(data[10, 12])
    assert int(np.count_nonzero(np.isnan(data))) == 1
    # Header without any MASK_FLAGS bit (only unrelated MP_* keys): unmasked, and said so.
    flag_h = hdul["FLAGS"].header
    for name in MP_BITS:
        if name in config.MASK_FLAGS:
            del flag_h[f"MP_{name}"]
    flag_h["MP_SOURCE"] = 20
    data, masked = grid.masked_image(hdul)
    assert not masked and np.isfinite(data[10, 12])
    del hdul["FLAGS"]
    assert grid.masked_image(hdul)[1] is False


def test_bilinear_no_data_outside_and_next_to_nan() -> None:
    img = np.arange(16, dtype=np.float64).reshape(4, 4)
    img[0, 0] = np.nan
    x = np.array([1.5, -0.1, 3.0, 0.5, 3.2])
    y = np.array([1.5, 1.0, 3.0, 0.5, 0.0])
    out = grid.bilinear(img, x, y)
    assert out[0] == pytest.approx(7.5)
    assert np.isnan(out[1]) and np.isnan(out[4])  # outside
    assert out[2] == pytest.approx(15.0)  # the last pixel centre is inside
    assert np.isnan(out[3])  # a NaN neighbour is no data


def test_stretch_sky_black_peak_white() -> None:
    band = np.zeros((20, 20))
    band[::2, ::2] = 0.1  # noise-ish texture
    band[10, 10] = 100.0
    band[0, 0] = np.nan
    u8 = grid.stretch(band)
    assert u8 is not None
    assert u8[10, 10] == 255 and u8[0, 0] == 0 and u8[1, 1] == 0
    assert grid.stretch(np.full((5, 5), np.nan)) is None
    assert grid.stretch(np.ones((5, 5))) is None


# --- service, cache and API on a synthetic cache ---------------------------------------------

# (frame_id, wavelength, day, rotation, mirrored, saturated core)
SYNTH_FRAMES = [
    ("2025W45_2A_0001_1_D2", 1.21, 0.0, 20.0, False, False),
    ("2025W45_2A_0001_2_D2", 1.20, 0.1, 20.0, False, True),  # nearer, but saturated
    ("2025W46_2A_0002_1_D3", 2.19, 3.0, -35.0, True, False),
    ("2025W46_1A_0003_1_D6", 4.51, 5.0, 110.0, False, False),
]


def mjd(dt: datetime) -> float:
    return (dt - datetime(1858, 11, 17, tzinfo=UTC)).total_seconds() / 86400.0


def install_synthetic(ctx: Context) -> str:
    """A coordinate object with four synthetic frames, as a stored frame list + cached cutouts."""
    from app.timefmt import iso_utc_z

    oid = coord_id(RA0, DEC0)
    records = []
    for fid, wl, day, angle, mirrored, sat in SYNTH_FRAMES:
        when = T0 + timedelta(days=day)
        h = frame_header(59, 59, angle, mirrored)
        x0, y0 = (float(v) for v in WCS(h).world_to_pixel_values(RA0, DEC0))
        rec = FrameRecord(
            frame_id=fid,
            time=iso_utc_z(when),
            wavelength_um=wl,
            bandwidth_um=0.02,
            x=round(x0, 3),
            y=round(58 - y0, 3),
            x_fits0=round(x0, 3),
            y_fits0=round(y0, 3),
            width=59,
            height=59,
            ra=RA0,
            dec=DEC0,
            flags=[],
            detector=int(fid[-1]),
            north_angle_deg=0.0,
            mirrored=mirrored,
            em_min_um=wl - 0.01,
            em_max_um=wl + 0.01,
            access_url="https://irsa.ipac.caltech.edu/synthetic",
            t_min_mjd=mjd(when),
            t_max_mjd=mjd(when),
        )
        records.append(rec)
        key = irsa_cutout.key_for(ctx, rec.sia_row(), RA0, DEC0)
        ctx.cache.put(
            key,
            LiveResponse(cutout_bytes(angle, mirrored, sat_core=sat), "synthetic", 200, "fits"),
            fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
        )
    doc = {
        "frames": [asdict(r) for r in records],
        "missing": [],
        "sources_earliest_fetched_at": "2026-11-01T00:00:00.000Z",
    }
    ctx.cache.put(
        frames_key(ctx, oid),
        LiveResponse(json.dumps(doc).encode(), "derived:frames", 200, "application/json"),
    )
    return oid


@pytest.fixture
def synth_cache(tmp_path: Path) -> Path:
    root = tmp_path / "synth"
    install_synthetic(make_context(make_settings(root)))
    return root


def test_service_end_to_end_and_cached(synth_cache: Path) -> None:
    ctx = make_context(make_settings(synth_cache))
    obj = load_object(ctx, coord_id(RA0, DEC0))
    assert obj is not None
    first = CompositeService(FrameService(ctx)).get(obj)
    assert first.png is not None and not first.from_cache
    body = first.body
    assert [b["frame_id"] for b in body["bands"]] == [
        "2025W45_2A_0001_1_D2",
        "2025W46_2A_0002_1_D3",
        "2025W46_1A_0003_1_D6",
    ]
    assert "composite:blue:skipped:saturated:2025W45_2A_0001_2_D2" in body["missing"]
    assert body["tag"] == "derived" and body["north_up"] is True
    assert body["scale_arcsec_px"] == pytest.approx(SCALE, abs=0.01)
    assert (body["x"], body["y"]) == (29.0, 29.0)
    for b in body["bands"]:
        assert 0 <= b["nodata_px"] < 59 * 59
    assert list((synth_cache / "v1").glob("derived.composite/*/*/*.json"))

    again = CompositeService(FrameService(ctx)).get(obj)
    assert again.from_cache and again.png == first.png and again.body == body
    assert again.cached_at == datetime(2026, 11, 1, tzinfo=UTC)


def test_same_inputs_same_bytes(tmp_path: Path) -> None:
    pngs = []
    for name in ("a", "b"):
        ctx = make_context(make_settings(tmp_path / name))
        obj = load_object(ctx, install_synthetic(ctx))
        assert obj is not None
        pngs.append(CompositeService(FrameService(ctx)).get(obj).png)
    assert pngs[0] is not None and pngs[0] == pngs[1]


def test_cache_key_covers_every_input(synth_cache: Path) -> None:
    ctx = make_context(make_settings(synth_cache))
    obj = load_object(ctx, coord_id(RA0, DEC0))
    assert obj is not None
    frames = FrameService(ctx).get_frames(obj).frames[:3]
    shas = ["a" * 64, "b" * 64, "c" * 64]
    base = composite_key(ctx, obj, frames, shas, []).digest
    moved = replace(frames[0], x_fits0=frames[0].x_fits0 + 0.001)
    variants = [
        composite_key(ctx, obj, frames, ["d" * 64, *shas[1:]], []),
        composite_key(ctx, obj, [moved, *frames[1:]], shas, []),
        composite_key(ctx, obj, frames, shas, ["composite:blue:skipped:saturated:X"]),
        composite_key(ctx, replace(obj, pm_ra_mas_yr=1.0, pm_dec_mas_yr=0.0), frames, shas, []),
    ]
    assert len({base, *(k.digest for k in variants)}) == 1 + len(variants)


def test_frames_are_fetched_once_per_request(
    synth_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The live cutout budget is spent once: Stage 2 reuses the composite's frame list."""
    calls = []
    real = FrameService.get_frames

    def counting(self: FrameService, *a: Any, **kw: Any) -> Any:
        calls.append(1)
        return real(self, *a, **kw)

    monkeypatch.setattr(FrameService, "get_frames", counting)
    with TestClient(create_app(make_settings(synth_cache))) as c:
        assert c.get(f"/v1/objects/{coord_id(RA0, DEC0)}/composite").status_code == 200
    assert len(calls) == 1


def test_api_shape_and_png(synth_cache: Path) -> None:
    oid = coord_id(RA0, DEC0)
    with TestClient(create_app(make_settings(synth_cache))) as c:
        r = c.get(f"/v1/objects/{oid}/composite")
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) >= {
            "id",
            "data_release",
            "image_url",
            "width",
            "height",
            "scale_arcsec_px",
            "north_up",
            "x",
            "y",
            "bands",
            "tag",
            "formula",
            "missing",
            "cached_at",
        }
        assert body["id"] == oid and body["data_release"] == "spherex_qr2"
        assert body["image_url"].startswith(f"/v1/objects/{oid}/composite.png?v=")
        assert body["formula"].startswith("false colour: B = 1.210 µm, G = 2.190 µm, R = 4.510 µm")
        assert "north-up, east-left" in body["formula"]
        assert body["cached_at"] == "2026-11-01T00:00:00.000Z"
        assert [b["channel"] for b in body["bands"]] == ["blue", "green", "red"]
        for b in body["bands"]:
            assert set(b) >= {"channel", "frame_id", "wavelength_um", "time", "bandwidth_um"}
            assert b["time"].endswith("Z")
        png = c.get(body["image_url"])
        assert png.status_code == 200 and png.headers["content-type"] == "image/png"
        assert png.headers["cache-control"] == "public, max-age=86400"
        bare = c.get(f"/v1/objects/{oid}/composite.png")
        assert bare.content == png.content
        assert bare.headers["cache-control"] == "no-cache"  # no v: never cached for a day
    img = Image.open(io.BytesIO(png.content))
    assert img.mode == "RGB" and img.size == (body["width"], body["height"])
    arr = np.asarray(img)
    # Every band: the object at (x, y) and the second source 6 px east (left), 10 px north (up).
    for ch in range(3):
        band = arr[:, :, ch].astype(np.float64)
        cx, cy = centroid(band, body["x"], body["y"])
        assert abs(cx - body["x"]) < 0.3 and abs(cy - body["y"]) < 0.3, ch
        cx, cy = centroid(band, body["x"] - EAST_PX, body["y"] - NORTH_PX)
        assert abs(cx - (body["x"] - EAST_PX)) < 0.3, ch
        assert abs(cy - (body["y"] - NORTH_PX)) < 0.3, ch


# --- refusals on the recorded fixtures --------------------------------------------------------


def resolve_id(client: TestClient, q: str) -> str:
    r = client.get("/v1/resolve", params={"q": q})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def test_refused_composite_shape(client: TestClient) -> None:
    oid = resolve_id(client, "R Dra")  # three saturated fixture frames
    body = client.get(f"/v1/objects/{oid}/composite").json()
    assert body["image_url"] is None and body["bands"] == []
    assert body["width"] is None and body["x"] is None
    assert body["tag"] == "derived" and body["north_up"] is True
    assert TOO_FEW_BANDS in body["missing"]
    assert "frames:truncated" in body["missing"]  # fixtures hold MAXREC=3 rows
    r = client.get(f"/v1/objects/{oid}/composite.png")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_moving_object_is_refused(client: TestClient) -> None:
    oid = resolve_id(client, "433 Eros")
    body = client.get(f"/v1/objects/{oid}/composite").json()
    assert body["image_url"] is None and body["missing"] == ["composite:moving_object"]


def test_unknown_object_is_404(client: TestClient) -> None:
    r = client.get("/v1/objects/simbad-never-resolved/composite")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_offline_uncached_coordinates_is_503(client: TestClient) -> None:
    oid = resolve_id(client, "12.5, -30")
    r = client.get(f"/v1/objects/{oid}/composite")
    assert r.status_code == 503 and r.json()["error"] == "offline_cache_miss"
