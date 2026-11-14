"""Adapters parse the recorded answers; nothing here is hand-written."""

from __future__ import annotations

import io
from pathlib import Path

import httpx
import numpy as np
import pytest
from astropy.io import fits

from app.adapters import horizons, irsa_cutout, irsa_sia, sbdb, simbad, skybot
from app.cache.store import UpstreamUnavailable
from app.context import make_context
from tests.conftest import make_settings
from tests.helpers import entries, entry


def test_simbad_parse_recorded() -> None:
    _, body = entry("simbad", ident="R Dra")
    hit = simbad.parse(body)
    assert hit is not None and hit.main_id == "V* R Dra"
    assert 248.0 < hit.ra < 248.3 and 66.6 < hit.dec < 66.9
    assert hit.otype == "Mi*"


def test_simbad_adql_escapes_quotes() -> None:
    assert "ident.id = 'Barnard''s star'" in simbad.adql("Barnard's  star")


def test_simbad_mirror_fallback(tmp_path: Path) -> None:
    _, body = entry("simbad", ident="R Dra")
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == "primary.example":
            raise httpx.ConnectError("unreachable", request=request)
        return httpx.Response(200, content=body)

    settings = make_settings(
        tmp_path,
        offline=False,
        http_retries=2,
        simbad_tap_urls="https://primary.example/tap,https://mirror.example/tap",
    )
    ctx = make_context(settings, transport=httpx.MockTransport(handler))
    hit, served = simbad.query(ctx, "R Dra")
    assert hit is not None and hit.main_id == "V* R Dra"
    assert seen == ["primary.example", "mirror.example"]  # no retry while a mirror remains
    assert served.entry.url.startswith("https://mirror.example/")


def test_sbdb_parse_recorded() -> None:
    _, body = entry("sbdb", sstr="433 Eros")
    ans = sbdb.parse(body)
    assert ans.hit is not None and ans.hit.spkid == "20000433" and ans.hit.kind == "an"


def test_sbdb_not_found_recorded() -> None:
    # Recorded by the pre-fetch: star names fall back to SBDB only on a SIMBAD miss, so a
    # miss may not exist; parse whatever SBDB answers were recorded without error.
    for _, body in entries("sbdb"):
        sbdb.parse(body)


def test_horizons_parse_recorded() -> None:
    meta, body = entry("horizons", tlist="2461358.500000")
    rows = horizons.parse(body)
    assert len(rows) == 1
    t, ra, dec = rows[0]
    assert t.startswith("2026-Nov-14 00:00")
    assert 0 <= ra < 360 and -90 <= dec <= 90
    assert meta["key"]["query"]["command"] == "DES=20000433;"


def test_skybot_parse_recorded() -> None:
    meta, body = entries("skybot")[0]
    bodies = skybot.parse(int(meta["status"]), body)
    assert bodies, "Eros field should list Eros itself"
    assert any(b.name == "Eros" for b in bodies)


def test_skybot_204_is_empty() -> None:
    assert skybot.parse(204, b"") == []


def test_skybot_object_without_data_is_not_an_empty_answer() -> None:
    # An error object answered with 200 must not read (and be cached) as "no known objects".
    with pytest.raises(ValueError):
        skybot.parse(200, b'{"error": "service busy"}')
    assert skybot.parse(200, b'{"data": []}') == []


def test_sia_parse_recorded_rows_and_overflow() -> None:
    fixed = [(m, b) for m, b in entries("irsa_sia") if m["maxrec"] == 3]
    assert len(fixed) == 8  # one cone per fixed target; the moving cones are checked below
    for meta, body in fixed:
        rows = irsa_sia.parse_rows(body)
        assert len(rows) == 3
        assert meta["maxrec"] == 3
        assert irsa_sia.query_status(body) == "OVERFLOW"
        for r in rows:
            assert r.access_url.startswith("https://irsa.ipac.caltech.edu/ibe/")
            assert 0.7 < r.em_min_um < r.em_max_um < 5.1
            assert r.t_max_mjd > r.t_min_mjd
            assert r.frame_id.startswith(r.obs_id + "_D")


def test_sia_key_has_no_maxrec() -> None:
    k = irsa_sia.sia_key("spherex_qr2", 1.0, 2.0, 0.001)
    assert "maxrec" not in dict(k.query)


def test_recorded_cutouts_have_no_psf_and_keep_science_hdus() -> None:
    recorded = entries("irsa_cutout")
    # 3 frames (MAXREC=3) x 8 fixed targets (5 test + 3 demo, D-31) + 16 frames of 433 Eros along
    # its path (issue #26)
    assert len(recorded) == 24 + 16
    for meta, body in recorded:
        with fits.open(io.BytesIO(body)) as h:
            names = [hdu.name for hdu in h]
        assert names == ["PRIMARY", "IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE"]
        assert meta["dropped_hdus"] == ["PSF"]
        assert meta["original_size"] > meta["body_size"]
        assert len(meta["original_sha256"]) == 64


def _synthetic_fits() -> bytes:
    prim = fits.PrimaryHDU()
    img = fits.ImageHDU(np.arange(12, dtype=np.float32).reshape(3, 4), name="IMAGE")
    psf = fits.ImageHDU(np.ones((5, 7, 7), dtype=np.float32), name="PSF")
    tab = fits.BinTableHDU.from_columns(
        [fits.Column(name="V", format="E", array=np.array([1.5], dtype=np.float32))],
        name="WCS-WAVE",
    )
    buf = io.BytesIO()
    fits.HDUList([prim, img, psf, tab]).writeto(buf)
    return buf.getvalue()


def test_strip_hdus_byte_slices_at_boundaries() -> None:
    raw = _synthetic_fits()
    spans = irsa_cutout.hdu_spans(raw)
    assert [s.name for s in spans] == ["PRIMARY", "IMAGE", "PSF", "WCS-WAVE"]
    assert spans[-1].end == len(raw)
    out = irsa_cutout.strip_hdus(raw)
    with fits.open(io.BytesIO(out)) as h:
        assert [hdu.name for hdu in h] == ["PRIMARY", "IMAGE", "WCS-WAVE"]
        assert np.array_equal(h["IMAGE"].data, np.arange(12).reshape(3, 4))
        assert float(h["WCS-WAVE"].data["V"][0]) == 1.5
    # every kept byte is exactly as served
    img = spans[1]
    assert raw[img.start : img.end] in out


def _cutout_row(access_url: str) -> irsa_sia.SiaRow:
    return irsa_sia.SiaRow("F1", "O1", 1, access_url, 60000.0, 60000.01, 1.0, 1.1)


def test_cutout_rejects_off_host_access_url(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"no request should be made: {request.url}")

    settings = make_settings(tmp_path, offline=False, http_retries=0)
    ctx = make_context(settings, transport=httpx.MockTransport(handler))
    for url in (
        "https://irsa.ipac.caltech.edu.evil.example/ibe/x.fits",
        "https://irsa.ipac.caltech.edu@evil.example/ibe/x.fits",
        "http://irsa.ipac.caltech.edu/ibe/x.fits",
    ):
        with pytest.raises(UpstreamUnavailable, match="unexpected access_url host"):
            irsa_cutout.fetch_cutout(ctx, _cutout_row(url), 10.0, 20.0)


def test_cutout_rejects_redirect_off_host(tmp_path: Path) -> None:
    _, fits_body = next(iter(entries("irsa_cutout")))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "irsa.ipac.caltech.edu":
            return httpx.Response(302, headers={"location": "https://evil.example/x.fits"})
        return httpx.Response(200, content=fits_body)

    settings = make_settings(tmp_path, offline=False, http_retries=0)
    ctx = make_context(settings, transport=httpx.MockTransport(handler))
    row = _cutout_row("https://irsa.ipac.caltech.edu/ibe/data/x.fits")
    with pytest.raises(UpstreamUnavailable, match="redirected off the IRSA host"):
        irsa_cutout.fetch_cutout(ctx, row, 10.0, 20.0)
    assert ctx.cache.get(irsa_cutout.key_for(ctx, row, 10.0, 20.0)) is None  # nothing cached


# --- an answer that cannot be read is a failed call, never a cache entry (gap analysis, 14 Nov) ---


def test_skybot_error_page_is_not_cached_and_the_next_call_asks_again(tmp_path: Path) -> None:
    from datetime import UTC, datetime

    meta, good = entries("skybot")[0]
    answers = [
        httpx.Response(200, content=b"<html><body>Service unavailable</body></html>"),
        httpx.Response(int(meta["status"]), content=good),
    ]
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return answers[min(len(calls), len(answers)) - 1]

    ctx = make_context(
        make_settings(tmp_path, offline=False, http_retries=0),
        transport=httpx.MockTransport(handler),
    )
    when = datetime(2026, 3, 20, tzinfo=UTC)
    with pytest.raises(UpstreamUnavailable):
        skybot.conesearch(ctx, 91.1, 13.4, 0.5, when)
    # Nothing was kept: the same cone asks the service again and reads its real answer.
    bodies, served = skybot.conesearch(ctx, 91.1, 13.4, 0.5, when)
    assert len(calls) == 2 and not served.from_cache
    assert any(b.name == "Eros" for b in bodies)
    assert skybot.conesearch(ctx, 91.1, 13.4, 0.5, when)[1].from_cache


def test_sbdb_error_page_is_not_cached(tmp_path: Path) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"<html>Bad gateway</html>")

    ctx = make_context(
        make_settings(tmp_path, offline=False, http_retries=0),
        transport=httpx.MockTransport(handler),
    )
    for _ in range(2):
        with pytest.raises(UpstreamUnavailable):
            sbdb.query(ctx, "433 Eros")
    assert len(calls) == 2
    assert ctx.cache.get(sbdb.sbdb_key("433 Eros")) is None
