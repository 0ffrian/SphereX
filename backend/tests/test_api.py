"""API shapes, the brief's contract rules, refusals and real-data sanity on the fixtures."""

from __future__ import annotations

import io
import re
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.adapters import irsa_cutout
from app.cache.store import ReadThroughCache
from app.core.find.cutouts import load_cutout_hdul
from app.core.find.resolver import ResolvedObject
from app.core.find.wcs import wavelength_at
from app.main import create_app
from tests.conftest import make_settings
from tests.helpers import entries

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
TAGS = {"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"}


def resolve_id(client: TestClient, q: str) -> str:
    r = client.get("/v1/resolve", params={"q": q})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def test_resolve_shape(client: TestClient) -> None:
    body = client.get("/v1/resolve", params={"q": "R Dra"}).json()
    for k in ("id", "name", "ra", "dec", "moving", "resolver", "cached_at"):
        assert k in body
    assert body["resolver"] == "simbad" and body["moving"] is False
    assert ISO_Z.match(body["cached_at"])
    assert all(p["tag"] in TAGS for p in body["provenance"].values())


def test_frames_shape_and_contract(client: TestClient) -> None:
    oid = resolve_id(client, "Barnard's star")
    body = client.get(f"/v1/objects/{oid}/frames").json()
    assert set(body) >= {
        "id",
        "frames",
        "stretch",
        "data_release",
        "cached_at",
        "missing",
        "north_up",
    }
    assert body["data_release"] == "spherex_qr2"
    assert body["north_up"] is False
    assert body["stretch"]["kind"] == "asinh"
    assert body["missing"] == ["frames:truncated"]  # fixtures use MAXREC=3
    assert ISO_Z.match(body["cached_at"])
    assert body["provenance"]["stretch"]["tag"] == "derived"
    assert body["provenance"]["stretch"]["formula"]
    assert body["provenance"]["cutout_pixels"]["tag"] == "measured"
    assert body["provenance"]["ra"]["tag"] == "derived"
    assert all(p["tag"] in TAGS for p in body["provenance"].values())
    assert len(body["frames"]) == 3
    times = [f["time"] for f in body["frames"]]
    assert times == sorted(times)
    for f in body["frames"]:
        assert ISO_Z.match(f["time"])
        assert f["cutout_url"] == f"/v1/objects/{oid}/cutouts/{f['frame_id']}.png"
        assert 0.7 < f["wavelength_um"] < 5.1
        assert 0 <= f["x"] < f["width"] and 0 <= f["y"] < f["height"]
        assert isinstance(f["flags"], list)


def test_x_y_match_the_star_on_real_cutouts(client: TestClient) -> None:
    """Bright targets: the flux centroid around (x, y) in the served orientation is within 1 px.
    Checks proper-motion propagation and the WCS on real SPHEREx data. It cannot prove the
    vertical flip: the cutouts are centred on the star, so a missing flip moves y by under 1 px.
    The flip proof is the synthetic test ``test_png_argmax_equals_api_xy``."""
    app = client.app
    for q in ("Barnard's star", "RW Aur", "R Dra"):
        oid = resolve_id(client, q)
        for f in client.get(f"/v1/objects/{oid}/frames").json()["frames"]:
            with load_cutout_hdul(app.state.frames, oid, f["frame_id"]) as h:  # type: ignore[attr-defined]
                d = np.array(h["IMAGE"].data, dtype=float)
            d = np.flipud(np.nan_to_num(d, nan=np.nanmax(d)))  # saturated cores are NaN
            x0, y0 = round(f["x"]), round(f["y"])
            box = d[y0 - 5 : y0 + 6, x0 - 5 : x0 + 6] - np.median(d)
            box[box < 0] = 0
            yy, xx = np.mgrid[y0 - 5 : y0 + 6, x0 - 5 : x0 + 6]
            cx, cy = (box * xx).sum() / box.sum(), (box * yy).sum() / box.sum()
            assert abs(cx - f["x"]) < 1.0 and abs(cy - f["y"]) < 1.0, (q, f["frame_id"])


def test_unpropagated_position_would_miss_barnard(client: TestClient) -> None:
    oid = resolve_id(client, "Barnard's star")
    f = client.get(f"/v1/objects/{oid}/frames").json()["frames"][0]
    from app.core.find.wcs import object_pixel

    with load_cutout_hdul(client.app.state.frames, oid, f["frame_id"]) as h:  # type: ignore[attr-defined]
        x0, y0 = object_pixel(h, 269.4520769586187, 4.693364966576667)  # SIMBAD J2000
    assert np.hypot(x0 - f["x"], (f["height"] - 1 - y0) - f["y"]) > 30


def test_wavelength_inside_the_detector_band(fixture_cache: Path) -> None:
    """Sanity of the WCS-WAVE lookup ('W' WCS, SIP dropped) on astropy 8.0.2 [verify]."""
    from app.adapters.irsa_sia import parse_rows
    from app.core.find.wcs import open_fits

    rows = {r.frame_id: r for _, body in entries("irsa_sia") for r in parse_rows(body)}
    for meta, body in entries("irsa_cutout"):
        row = rows[meta["key"]["query"]["frame_id"]]
        with open_fits(body) as h:
            ny, nx = h["IMAGE"].data.shape
            for x, y in ((0, 0), (nx - 1, ny - 1), (nx / 2, ny / 2)):
                wl = wavelength_at(h, x, y)
                assert wl is not None
                assert row.em_min_um - 0.01 <= wl[0] <= row.em_max_um + 0.01
                assert 0 < wl[1] < 0.2


def test_every_cutout_png_is_valid_and_deterministic(client: TestClient) -> None:
    oid = resolve_id(client, "R Dra")
    frames = client.get(f"/v1/objects/{oid}/frames").json()["frames"]
    for f in frames:
        a = client.get(f["cutout_url"])
        b = client.get(f["cutout_url"])
        assert a.status_code == 200 and a.headers["content-type"] == "image/png"
        assert a.content == b.content
        img = Image.open(io.BytesIO(a.content))
        assert img.mode == "L" and img.size == (f["width"], f["height"])


def test_unknown_object_and_frame_are_404(client: TestClient) -> None:
    r = client.get("/v1/objects/simbad-never-resolved/frames")
    assert r.status_code == 404 and r.json()["error"] == "not_found"
    oid = resolve_id(client, "R Dra")
    r = client.get(f"/v1/objects/{oid}/cutouts/NOPE_D1.png")
    assert r.status_code == 404 and r.json()["error"] == "frame_not_found"


def test_offline_uncached_name_is_503(client: TestClient) -> None:
    r = client.get("/v1/resolve", params={"q": "Vega"})
    assert r.status_code == 503
    assert r.json()["error"] == "offline_cache_miss" and r.json()["detail"]


def test_offline_uncached_coordinates_frames_is_503(client: TestClient) -> None:
    oid = resolve_id(client, "12.5, -30")
    r = client.get(f"/v1/objects/{oid}/frames")
    assert r.status_code == 503 and r.json()["error"] == "offline_cache_miss"


def test_bad_query_is_400(client: TestClient) -> None:
    r = client.get("/v1/resolve", params={"q": "400, 95"})
    assert r.status_code == 400 and r.json()["error"] == "bad_query"


def test_moving_object_frames_come_from_the_path_search(client: TestClient) -> None:
    """Issue #26 (Q-21): a moving object's frames come from the ephemeris-driven cone search,
    not a refusal. Details are in tests/test_moving.py."""
    body = client.get("/v1/resolve", params={"q": "433 Eros"}).json()
    assert body["moving"] is True and body["resolver"] == "sbdb"
    assert body["provenance"]["ra"]["tag"] == "model_dependent"
    frames = client.get(f"/v1/objects/{body['id']}/frames").json()
    assert frames["frames"] and "frames:moving_object_search" not in frames["missing"]


def test_missing_cutout_is_listed_not_invented(fixture_cache: Path) -> None:
    """Refusal: delete one recorded cutout; that frame is dropped and named in `missing`."""
    meta, _ = next(
        (m, b)
        for m, b in entries("irsa_cutout", fixture_cache)
        if m["key"]["query"]["frame_id"].startswith("2025W52_2A_0161_2_D3")
    )
    q = meta["key"]["query"]
    key = irsa_cutout.cutout_key(
        "spherex_qr2", q["frame_id"], float(q["ra"]), float(q["dec"]), float(q["size_arcsec"])
    )
    ReadThroughCache(fixture_cache, offline=False).delete(key)
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        oid = resolve_id(c, "R Dra")
        body = c.get(f"/v1/objects/{oid}/frames").json()
    assert f"cutout:{q['frame_id']}" in body["missing"]
    assert len(body["frames"]) == 2


def test_truncated_frames_are_not_stored_as_derived(
    client: TestClient, fixture_cache: Path
) -> None:
    oid = resolve_id(client, "RW Aur")
    client.get(f"/v1/objects/{oid}/frames")
    assert not list((fixture_cache / "v1").glob("derived.frames"))


def test_complete_frames_are_stored_with_source_cached_at(fixture_cache: Path) -> None:
    """When the SIA answer is not truncated, the frame list is stored as a derived entry and
    later served with cached_at = the earliest source fetched_at."""
    import json

    for meta_path in (fixture_cache / "v1" / "irsa_sia").glob("*/*/*.json"):
        meta = json.loads(meta_path.read_text())
        meta["maxrec"] = 500  # pretend the full search fitted (rows < MAXREC) ...
        meta_path.write_text(json.dumps(meta))
        body_path = meta_path.with_suffix(".body")
        body = body_path.read_bytes().replace(b'value="OVERFLOW"', b'value="OK"')  # ... and say so
        body_path.write_bytes(body)
        meta["body_sha256"] = __import__("hashlib").sha256(body).hexdigest()
        meta_path.write_text(json.dumps(meta))
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        oid = resolve_id(c, "R Dra")
        first = c.get(f"/v1/objects/{oid}/frames").json()
    assert first["missing"] == []
    assert list((fixture_cache / "v1").glob("derived.frames/*/*/*.json"))
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        c.get("/v1/resolve", params={"q": "R Dra"})
        again = c.get(f"/v1/objects/{oid}/frames").json()
    assert again["frames"] == first["frames"]
    assert again["cached_at"] is not None and again["cached_at"] <= first["cached_at"]


def test_registry_round_trip_type() -> None:
    o = ResolvedObject("x", None, 1.0, 2.0, False, "coords")
    assert ResolvedObject.from_json(o.to_json()) == o
