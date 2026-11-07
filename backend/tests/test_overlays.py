"""Overlays (issue #12, Q-50..Q-54): Gaia and CatWISE markers, contamination, FLAGS mask, field
of view and add/subtract, offline from the recorded cache.

Done when (issue #12): overlays show on the 5 test targets from cache.
"""

from __future__ import annotations

import csv
import io
import json
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient
from PIL import Image

from app.adapters import gaia, tap, wise
from app.adapters.http import UpstreamError
from app.adapters.irsa_sia import parse_s_region
from app.cache.store import UpstreamUnavailable
from app.core.find import combine, flagmask
from app.core.find import overlays as overlays_mod
from app.core.find.overlays import (
    TARGET_MATCH_PX,
    angular_sep_arcsec,
    cone_radius_arcsec,
    wrap_ra,
)
from app.main import create_app
from tests.conftest import make_settings

TARGETS = ["Barnard's star", "Epsilon Indi B", "WISE 0855", "RW Aurigae", "R Draconis"]
TAGS = {"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"}


def _oid(client: TestClient, name: str) -> str:
    r = client.get("/v1/resolve", params={"q": name})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def _overlays(client: TestClient, oid: str) -> dict[str, Any]:
    r = client.get(f"/v1/objects/{oid}/overlays")
    assert r.status_code == 200, r.text
    return dict(r.json())


# --- Done when: the 5 test targets, offline ------------------------------------------------


@pytest.mark.parametrize("name", TARGETS)
def test_overlays_on_test_targets_offline(client: TestClient, name: str) -> None:
    oid = _oid(client, name)
    body = _overlays(client, oid)
    frames = client.get(f"/v1/objects/{oid}/frames").json()

    # Overlay codes only: frame refusals (frames:truncated, saturated, ...) stay in /frames.
    assert body["missing"] == [], body["missing"]
    assert "frames:truncated" in frames["missing"]
    cats = {c["catalog"]: c for c in body["catalogs"]}
    assert set(cats) == {"gaia", "wise"}
    assert all(c["available"] for c in cats.values())
    assert cats["gaia"]["sources"], "Gaia must have sources near every test target"
    assert cats["gaia"]["mag_band"] == "G" and cats["wise"]["mag_band"] == "W1"

    assert [f["frame_id"] for f in body["frames"]] == [f["frame_id"] for f in frames["frames"]]
    ap = body["aperture"]
    for fo, fr in zip(body["frames"], frames["frames"], strict=True):
        png = Image.open(io.BytesIO(client.get(fr["cutout_url"]).content))
        w, h = png.size
        for m in fo["markers"]:
            assert -0.5 <= m["x"] < w - 0.5 and -0.5 <= m["y"] < h - 0.5
        for c in fo["contamination"]:
            if c["zone"] == "aperture":
                assert c["sep_px"] <= ap["radius_px"]
            else:
                assert ap["annulus_inner_px"] <= c["sep_px"] <= ap["annulus_outer_px"]
        seps = [c["sep_px"] for c in fo["contamination"]]
        assert seps == sorted(seps)
        assert fo["footprint"] and len(fo["footprint"]) >= 3
        assert len(fo["cutout_box"]) == 4

        mask = client.get(fo["flags_url"])
        assert mask.status_code == 200
        assert mask.headers["content-type"] == "image/png"
        img = Image.open(io.BytesIO(mask.content))
        assert img.mode == "RGBA" and img.size == (w, h)

    for key, p in body["provenance"].items():
        assert p["tag"] in TAGS, key
    assert body["provenance"]["flag_colours"]["tag"] == "artistic"
    assert body["provenance"]["markers"]["tag"] == "derived"


@pytest.mark.parametrize("name", TARGETS)
def test_combine_on_test_targets_offline(client: TestClient, name: str) -> None:
    oid = _oid(client, name)
    frames = client.get(f"/v1/objects/{oid}/frames").json()["frames"]
    assert len(frames) >= 2
    a, b = frames[0], frames[1]
    for op in ("add", "sub"):
        r = client.get(
            f"/v1/objects/{oid}/combine.png",
            params={"op": op, "a": a["frame_id"], "b": b["frame_id"]},
        )
        assert r.status_code == 200, r.text
        meta = json.loads(r.headers["x-sx-combine"])
        assert meta["op"] == op and meta["tag"] == "derived" and meta["unit"] == "MJy/sr"
        assert meta["wavelength_a_um"] == a["wavelength_um"]
        assert meta["wavelength_b_um"] == b["wavelength_um"]
        assert "X-SX-Combine" in r.headers["access-control-expose-headers"]
        Image.open(io.BytesIO(r.content)).verify()


def test_overlays_and_pngs_are_deterministic(client: TestClient) -> None:
    oid = _oid(client, "WISE 0855")
    first = client.get(f"/v1/objects/{oid}/overlays").json()
    client.app.state.overlays._memo.clear()  # type: ignore[attr-defined]
    assert client.get(f"/v1/objects/{oid}/overlays").json() == first
    url = first["frames"][0]["flags_url"]
    assert client.get(url).content == client.get(url).content
    fid = first["frames"][0]["frame_id"]
    params = {"op": "sub", "a": fid, "b": first["frames"][1]["frame_id"]}
    c1 = client.get(f"/v1/objects/{oid}/combine.png", params=params).content
    assert client.get(f"/v1/objects/{oid}/combine.png", params=params).content == c1


def test_subtract_frame_from_itself_is_mid_grey(client: TestClient) -> None:
    oid = _oid(client, "Barnard's star")
    fid = client.get(f"/v1/objects/{oid}/frames").json()["frames"][0]["frame_id"]
    r = client.get(f"/v1/objects/{oid}/combine.png", params={"op": "sub", "a": fid, "b": fid})
    assert r.status_code == 200
    px = np.asarray(Image.open(io.BytesIO(r.content)))
    finite = px != 0  # 0 = non-finite input pixel
    assert finite.any() and (px[finite] == combine.MID_GREY).all()


def test_moving_object_overlays_refused(client: TestClient) -> None:
    body = _overlays(client, _oid(client, "433 Eros"))
    assert body["frames"] == []
    assert body["missing"] == ["overlay:gaia", "overlay:wise"]
    assert all(not c["available"] and c["sources"] == [] for c in body["catalogs"])


def test_overlay_errors(client: TestClient) -> None:
    oid = _oid(client, "RW Aurigae")
    fid = client.get(f"/v1/objects/{oid}/frames").json()["frames"][0]["frame_id"]
    assert client.get(f"/v1/objects/{oid}/flags/nope.png").status_code == 404
    r = client.get(f"/v1/objects/{oid}/combine.png", params={"op": "add", "a": fid, "b": "nope"})
    assert r.status_code == 404
    r = client.get(f"/v1/objects/{oid}/combine.png", params={"op": "mul", "a": fid, "b": fid})
    assert r.status_code in (400, 422)


# --- TAP and catalogue adapters --------------------------------------------------------------


def test_read_csv_rejects_wrong_header() -> None:
    assert tap.read_csv(b"a,b\n1,2\n", ("a", "b")) == [{"a": "1", "b": "2"}]
    with pytest.raises(ValueError):
        tap.read_csv(b"<VOTABLE>error</VOTABLE>", ("a", "b"))
    with pytest.raises(ValueError):
        tap.read_csv(b"", ("a",))


def test_opt_float() -> None:
    assert tap.opt_float("") is None
    assert tap.opt_float(" NaN ") is None
    assert tap.opt_float("null") is None
    assert tap.opt_float("1.5") == 1.5


def test_cone_adql() -> None:
    q = tap.cone_adql("t", ("a", "b"), "1.0", "2.0", "0.1", where="m < 5", order_by="m", top=7)
    assert q == (
        "SELECT TOP 7 a, b FROM t WHERE 1=CONTAINS(POINT('ICRS',ra,dec),"
        "CIRCLE('ICRS',1.0,2.0,0.1)) AND m < 5 ORDER BY m"
    )


def test_query_csv_falls_back_to_second_mirror() -> None:
    calls: list[str] = []
    good = SimpleNamespace(body=b"a\n1\n", url="u2", status=200, content_type="text/csv")
    bad = SimpleNamespace(body=b"<VOTABLE/>", url="u1", status=200, content_type="text/xml")

    def get(url: str, params: Any, **_: Any) -> Any:
        calls.append(params["QUERY"])
        return bad if url == "u1" else good

    ctx: Any = SimpleNamespace(http=SimpleNamespace(get=get))
    live = tap.query_csv(
        ctx, [("u1", "t1"), ("u2", "t2")], lambda t: f"Q {t}", ("a",), read_timeout_s=None
    )
    assert calls == ["Q t1", "Q t2"]
    assert live.body == b"a\n1\n" and live.extra["table"] == "t2"


def test_query_csv_all_mirrors_fail() -> None:
    def get(url: str, params: Any, **_: Any) -> Any:
        raise UpstreamError(f"{url} down")

    ctx: Any = SimpleNamespace(http=SimpleNamespace(get=get))
    with pytest.raises(UpstreamError, match="u1 down; u2 down"):
        tap.query_csv(ctx, [("u1", "t"), ("u2", "t")], lambda t: t, ("a",), read_timeout_s=None)


def test_query_csv_parses_every_row_before_caching() -> None:
    # A good header with an unparsable number in a row must fail the call, not be cached.
    bad_row = SimpleNamespace(
        body=b"a\n1\nnot-a-number\n", url="u1", status=200, content_type="text/csv"
    )

    def get(url: str, params: Any, **_: Any) -> Any:
        return bad_row

    def parse(body: bytes) -> list[float]:
        return [float(r["a"]) for r in tap.read_csv(body, ("a",))]

    ctx: Any = SimpleNamespace(http=SimpleNamespace(get=get))
    with pytest.raises(UpstreamError, match="not the expected CSV"):
        tap.query_csv(ctx, [("u1", "t")], lambda t: t, ("a",), read_timeout_s=None, parse=parse)
    # Without a parser only the header is checked (the old behaviour).
    live = tap.query_csv(ctx, [("u1", "t")], lambda t: t, ("a",), read_timeout_s=None)
    assert live.body == bad_row.body


def test_gaia_parse_defaults_epoch_and_keeps_missing_motion() -> None:
    body = (",".join(gaia.COLUMNS) + "\n123,10.0,20.0,,1.0,,0.5,12.3\n").encode()
    (s,) = gaia.parse(body)
    assert s.source_id == "123" and s.ref_epoch == gaia.DR3_EPOCH_JYEAR
    assert s.pmra_mas_yr == 1.0 and s.pmdec_mas_yr is None and s.g_mag == 12.3


def test_wise_parse_refuses_rows_without_position_and_converts_motion() -> None:
    body = (
        ",".join(wise.COLUMNS) + "\nJ1,10.0,20.0,0.012,-0.5,9.1\nJ2,,20.0,0.0,0.0,9.2\n"
    ).encode()
    (s,) = wise.parse(body)
    assert s.source_name == "J1"
    assert s.pmra_mas_yr == pytest.approx(12.0) and s.pmdec_mas_yr == pytest.approx(-500.0)
    assert pytest.approx(2015.4, abs=0.01) == wise.EPOCH_JYEAR  # MJD 57170 = 2015-05-28


# --- Geometry helpers -----------------------------------------------------------------------


def test_cone_radius_covers_cutout_and_motion() -> None:
    # 360" cutout: half diagonal 254.56", + 10" motion + 30" margin, rounded up.
    assert cone_radius_arcsec(360.0, 10.0) == 295.0
    assert angular_sep_arcsec(10.0, 0.0, 10.0, 1.0 / 3600) == pytest.approx(1.0)
    assert TARGET_MATCH_PX == 2.0


# --- FLAGS mask ------------------------------------------------------------------------------


def _hdul_with_flags(data: np.ndarray, bits: dict[str, int]) -> fits.HDUList:
    hdr = fits.Header()
    for name, bit in bits.items():
        hdr[f"MP_{name}"] = bit
    return fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(data, header=hdr, name="FLAGS")])


@pytest.mark.filterwarnings("ignore::astropy.io.fits.verify.VerifyWarning")
def test_flag_mask_groups_priority_and_flip() -> None:
    bits = {"OVERFLOW": 0, "HOT": 1, "GHOST_A": 2, "SOURCE": 3, "OTHER": 4}
    data = np.array([[0b00001, 0b00010, 0b00100], [0b01000, 0b10000, 0b01011]], dtype=np.int32)
    hdul = _hdul_with_flags(data, bits)
    assert flagmask.available(hdul)
    out = flagmask.rgba(hdul)
    sat, bad, art, src = (g.rgba for g in flagmask.FLAG_GROUPS)
    assert tuple(out[0, 0]) == sat and tuple(out[0, 1]) == bad and tuple(out[0, 2]) == art
    assert tuple(out[1, 0]) == src
    assert tuple(out[1, 1]) == (0, 0, 0, 0)  # an ungrouped bit stays transparent
    assert tuple(out[1, 2]) == sat  # several groups: the first one wins

    img = np.asarray(Image.open(io.BytesIO(flagmask.render_png(hdul))))
    assert img.shape == (2, 3, 4)
    assert (img == np.flipud(out)).all()  # FITS row 0 is the bottom PNG row


def test_flag_mask_unavailable_without_bit_names() -> None:
    hdul = _hdul_with_flags(np.zeros((2, 2), dtype=np.int32), {})
    assert not flagmask.available(hdul)
    with pytest.raises(flagmask.FlagMaskUnavailable):
        flagmask.rgba(hdul)
    no_ext = fits.HDUList([fits.PrimaryHDU()])
    assert not flagmask.available(no_ext)


# --- Combine ---------------------------------------------------------------------------------


def _image_hdul(data: np.ndarray, bunit: str = "MJy / sr", crpix: float = 3.0) -> fits.HDUList:
    hdr = fits.Header()
    hdr.update(
        CTYPE1="RA---TAN",
        CTYPE2="DEC--TAN",
        CRVAL1=10.0,
        CRVAL2=20.0,
        CRPIX1=crpix,
        CRPIX2=3.0,
        CDELT1=-1.0 / 3600,
        CDELT2=1.0 / 3600,
        CUNIT1="deg",
        CUNIT2="deg",
        BUNIT=bunit,
    )
    return fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(data, header=hdr, name="IMAGE")])


def test_combine_rejects_unit_mismatch() -> None:
    a = _image_hdul(np.ones((5, 5)))
    b = _image_hdul(np.ones((5, 5)), bunit="DN")
    with pytest.raises(combine.CombineError):
        combine.combine(a, b, "add", same_frame=False)


def test_resample_identity_and_shift() -> None:
    data = np.arange(25, dtype=np.float64).reshape(5, 5)
    a = _image_hdul(data)
    assert np.allclose(combine.resample_onto(a, _image_hdul(data)), data)
    # B's reference pixel one column to the right: B is A shifted by +1 px in x.
    shifted = combine.resample_onto(a, _image_hdul(data, crpix=4.0))
    assert np.allclose(shifted[:, :4], data[:, 1:], atol=1e-6)
    assert np.isnan(shifted[:, 4]).all()  # outside B: refused, never extrapolated


def test_stretch_sub_symmetric() -> None:
    assert (combine.stretch_sub(np.zeros((3, 3))) == combine.MID_GREY).all()  # type: ignore[union-attr]
    assert combine.stretch_sub(np.full((2, 2), np.nan)) is None
    u8 = combine.stretch_sub(np.array([[-1.0, 0.0, 1.0, np.nan]]))
    assert u8 is not None
    assert u8[0, 1] == combine.MID_GREY and u8[0, 3] == 0
    assert int(u8[0, 0]) + int(u8[0, 2]) == 2 * combine.MID_GREY


# --- Review fixes: RA range, s_region, flags status, waiting and sharing ----------------------


def test_wrap_ra_stays_below_360() -> None:
    assert wrap_ra(359.99999996, 7) == 0.0  # round() alone would give 360.0
    assert wrap_ra(-1e-17, 7) == 0.0  # -1e-17 % 360.0 is 360.0 in Python
    assert wrap_ra(-0.1, 7) == pytest.approx(359.9)
    assert wrap_ra(360.2, 7) == pytest.approx(0.2)
    assert str(wrap_ra(-0.0, 7)) == "0.0"
    assert wrap_ra(123.456789012, 8) == 123.45678901


def test_parse_s_region_refuses_non_finite_vertices() -> None:
    ok = parse_s_region("POLYGON ICRS 1 2 3 4 5 6 1 2")
    assert ok == ((1.0, 2.0), (3.0, 4.0), (5.0, 6.0))
    assert parse_s_region("POLYGON ICRS nan nan 3 4 5 6") is None
    assert parse_s_region("POLYGON ICRS 1 2 inf 4 5 6") is None
    assert parse_s_region("POLYGON ICRS 1 2 3 4 5 -inf") is None
    assert parse_s_region("CIRCLE ICRS 1 2 3") is None


def test_flags_png_without_mask_is_a_permanent_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    oid = _oid(client, "RW Aurigae")
    url = _overlays(client, oid)["frames"][0]["flags_url"]
    monkeypatch.setattr(flagmask, "available", lambda hdul: False)
    r = client.get(url)
    assert r.status_code == 404
    assert r.json()["error"] == "flags_unavailable"


@pytest.fixture
def slow_client(fixture_cache: Path) -> Iterator[TestClient]:
    s = make_settings(fixture_cache, overlay_wait_s=0.3, catalog_failure_ttl_s=60.0)
    with TestClient(create_app(s)) as c:
        yield c


def test_slow_catalogue_is_pending_then_served(
    slow_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()
    real = overlays_mod.fetch_catalog
    calls: list[str] = []

    def slow(ctx: Any, cat: Any, cone: Any, **kw: Any) -> Any:
        calls.append(cat)
        if cat == "gaia":
            release.wait(10)
        return real(ctx, cat, cone, **kw)

    monkeypatch.setattr(overlays_mod, "fetch_catalog", slow)
    oid = _oid(slow_client, "WISE 0855")
    t0 = time.monotonic()
    body = _overlays(slow_client, oid)
    assert time.monotonic() - t0 < 5  # bounded by overlay_wait_s, not the fetch
    assert body["missing"] == ["overlay:gaia:pending"]
    cats = {c["catalog"]: c for c in body["catalogs"]}
    assert not cats["gaia"]["available"] and cats["wise"]["available"]

    # A second request while Gaia is still running joins that fetch instead of starting one.
    _overlays(slow_client, oid)
    assert calls.count("gaia") == 1

    release.set()
    deadline = time.monotonic() + 10
    while calls.count("gaia") == 1 and time.monotonic() < deadline:
        body = _overlays(slow_client, oid)
        if body["missing"] == []:
            break
        time.sleep(0.05)
    assert body["missing"] == []
    assert calls.count("gaia") <= 2


def test_failed_catalogue_is_not_retried_at_once(
    slow_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    real = overlays_mod.fetch_catalog

    def flaky(ctx: Any, cat: Any, cone: Any, **kw: Any) -> Any:
        calls.append(cat)
        if cat == "wise":
            raise UpstreamUnavailable("IRSA down")
        return real(ctx, cat, cone, **kw)

    monkeypatch.setattr(overlays_mod, "fetch_catalog", flaky)
    oid = _oid(slow_client, "RW Aurigae")
    for _ in range(3):
        body = _overlays(slow_client, oid)
        assert body["missing"] == ["overlay:wise"]
    assert calls.count("wise") == 1  # remembered for catalog_failure_ttl_s

    service = slow_client.app.state.overlays  # type: ignore[attr-defined]
    service._failed.clear()  # the TTL has passed
    _overlays(slow_client, oid)
    assert calls.count("wise") == 2


def test_unparsable_cached_catalogue_is_refused_not_500(
    slow_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = overlays_mod.fetch_catalog

    def broken(ctx: Any, cat: Any, cone: Any, **kw: Any) -> Any:
        if cat == "gaia":
            raise csv.Error("line contains NUL")
        return real(ctx, cat, cone, **kw)

    monkeypatch.setattr(overlays_mod, "fetch_catalog", broken)
    oid = _oid(slow_client, "RW Aurigae")
    body = _overlays(slow_client, oid)
    assert body["missing"] == ["overlay:gaia"]
    cats = {c["catalog"]: c for c in body["catalogs"]}
    assert not cats["gaia"]["available"] and cats["wise"]["available"]


def test_concurrent_requests_share_one_computation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    oid = _oid(client, "Epsilon Indi B")
    service = client.app.state.overlays  # type: ignore[attr-defined]
    real = service._compute
    started = threading.Event()
    gate = threading.Event()
    runs: list[int] = []

    def slow_compute(obj: Any) -> Any:
        runs.append(1)
        started.set()
        gate.wait(10)
        return real(obj)

    monkeypatch.setattr(service, "_compute", slow_compute)
    results: list[dict[str, Any]] = []

    def call() -> None:
        results.append(client.get(f"/v1/objects/{oid}/overlays").json())

    threads = [threading.Thread(target=call) for _ in range(4)]
    threads[0].start()
    assert started.wait(10)
    for t in threads[1:]:
        t.start()
    time.sleep(0.2)
    gate.set()
    for t in threads:
        t.join(20)
    assert len(runs) == 1
    assert len(results) == 4 and all(r == results[0] for r in results)
