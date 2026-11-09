"""/v1/sky endpoints on a temp cache dir: index, equirect, HiPS files, path validation."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.sky.surveys import hips_dir, survey_dir, tile_relpath
from app.main import create_app
from tests.conftest import make_settings

PROPS = (
    "hips_frame = equatorial\nhips_order = 9\nhips_tile_width = 512\n"
    "hips_tile_format = jpeg\nhips_status = public mirror unclonable\n"
)
JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


@pytest.fixture
def cache(tmp_path: Path) -> Path:
    return tmp_path / "cache"


@pytest.fixture
def client(cache: Path) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(cache))) as c:
        yield c


def populate(cache: Path, complete: list[int], equirects: tuple[str, ...]) -> None:
    hdir = hips_dir(cache, "2mass_color")
    (hdir / "Norder3").mkdir(parents=True)
    (hdir / "properties").write_text(PROPS, encoding="utf-8")
    (hdir / "Norder3" / "Allsky.jpg").write_bytes(JPEG)
    tile = hdir / tile_relpath(4, 3071)
    tile.parent.mkdir(parents=True)
    tile.write_bytes(JPEG)
    sdir = survey_dir(cache, "2mass_color")
    (sdir / "mirror.json").write_text(json.dumps({"complete_orders": complete}))
    for name in equirects:
        (sdir / name).write_bytes(JPEG)


def test_index_is_empty_without_data(client: TestClient) -> None:
    r = client.get("/v1/sky/index.json")
    assert r.status_code == 200
    assert r.json() == {"surveys": []}


def test_index_lists_only_what_is_on_disk(client: TestClient, cache: Path) -> None:
    populate(cache, [0, 1, 2, 3, 4], ("equirect_8192x4096.jpg", "equirect_4096x2048.jpg"))
    (survey_dir(cache, "2mass_color") / "equirect_100x100.jpg").write_bytes(JPEG)  # not 2:1
    body = client.get("/v1/sky/index.json").json()
    assert len(body["surveys"]) == 1
    s = body["surveys"][0]
    assert s["id"] == "2mass_color"
    assert s["tag"] == "derived" and s["formula"].startswith("false colour:")
    assert s["frame"] == "icrs"
    assert s["convention"].startswith("RA = 360*(x+0.5)/W deg")
    assert s["credit"]
    urls = [e.pop("url") for e in s["equirect"]]
    assert s["equirect"] == [{"width": 4096, "height": 2048}, {"width": 8192, "height": 4096}]
    assert urls[0].startswith("/v1/sky/2mass_color/equirect_4096x2048.jpg?v=")
    assert urls[1].startswith("/v1/sky/2mass_color/equirect_8192x4096.jpg?v=")
    assert client.get(urls[0]).status_code == 200
    assert s["hips"] == {
        "url": "/v1/sky/2mass_color/hips",
        "max_order_local": 4,
        "tile_width": 512,
        "format": "jpeg",
    }


def test_a_rebake_changes_the_image_url(client: TestClient, cache: Path) -> None:
    # The image is served immutable under a fixed name; the index URL must change on a rebake.
    populate(cache, [0], ("equirect_4096x2048.jpg",))
    before = client.get("/v1/sky/index.json").json()["surveys"][0]["equirect"][0]["url"]
    (survey_dir(cache, "2mass_color") / "equirect_4096x2048.jpg").write_bytes(JPEG + b"rebaked")
    after = client.get("/v1/sky/index.json").json()["surveys"][0]["equirect"][0]["url"]
    assert before != after


def test_max_order_local_is_the_highest_contiguous_complete_order(
    client: TestClient, cache: Path
) -> None:
    populate(cache, [0, 1, 3], ())
    s = client.get("/v1/sky/index.json").json()["surveys"][0]
    assert s["hips"]["max_order_local"] == 1
    assert s["equirect"] == []


def test_hips_is_null_without_a_complete_order(client: TestClient, cache: Path) -> None:
    populate(cache, [], ("equirect_4096x2048.jpg",))
    s = client.get("/v1/sky/index.json").json()["surveys"][0]
    assert s["hips"] is None
    assert len(s["equirect"]) == 1


def test_files_are_served_with_long_cache(client: TestClient, cache: Path) -> None:
    populate(cache, [0], ("equirect_4096x2048.jpg",))
    for url, ctype in [
        ("/v1/sky/2mass_color/equirect_4096x2048.jpg", "image/jpeg"),
        ("/v1/sky/2mass_color/hips/Norder4/Dir0/Npix3071.jpg", "image/jpeg"),
        ("/v1/sky/2mass_color/hips/Norder3/Allsky.jpg", "image/jpeg"),
        ("/v1/sky/2mass_color/hips/properties", "text/plain; charset=utf-8"),
    ]:
        r = client.get(url)
        assert r.status_code == 200, url
        assert r.headers["content-type"] == ctype
        assert "immutable" in r.headers["cache-control"]
    assert client.get("/v1/sky/2mass_color/equirect_4096x2048.jpg").content == JPEG


@pytest.mark.parametrize(
    "url",
    [
        "/v1/sky/2mass_color/equirect_8192x4096.jpg",  # not baked
        "/v1/sky/2mass_color/hips/Norder4/Dir0/Npix3070.jpg",  # not mirrored
        "/v1/sky/2mass_color/hips/Norder4/Dir10000/Npix3071.jpg",  # wrong Dir
        "/v1/sky/2mass_color/hips/Norder0/Dir0/Npix12.jpg",  # beyond the order
        "/v1/sky/2mass_color/hips/Norder2/Allsky.jpg",
        "/v1/sky/allwise_color/equirect_4096x2048.jpg",  # survey not on disk
        "/v1/sky/unknown/equirect_4096x2048.jpg",
    ],
)
def test_missing_is_404_not_found(client: TestClient, cache: Path, url: str) -> None:
    populate(cache, [0], ("equirect_4096x2048.jpg",))
    r = client.get(url)
    assert r.status_code == 404, url
    assert r.json()["error"] == "not_found"
    assert r.json()["detail"]


@pytest.mark.parametrize(
    "url",
    [
        "/v1/sky/2mass_color/mirror.json",
        "/v1/sky/2mass_color/equirect_4096x2048.png",
        "/v1/sky/2mass_color/hips/Norder4/Dir0/..%2F..%2Fmirror.json",
        "/v1/sky/2mass_color/hips/Norder4/Dir0/Npix3071.jpg%00",
        "/v1/sky/..%2F..%2Fv1/equirect_4096x2048.jpg",
        "/v1/sky/2MASS_color/equirect_4096x2048.jpg",
        "/v1/sky/2mass_color/hips/Norder4/..%5CDir0/Npix3071.jpg",
    ],
)
def test_bad_paths_never_reach_the_disk(client: TestClient, cache: Path, url: str) -> None:
    populate(cache, [0], ("equirect_4096x2048.jpg",))
    r = client.get(url)
    assert r.status_code in (400, 404), url
    assert r.json()["error"] in ("bad_request", "not_found")
