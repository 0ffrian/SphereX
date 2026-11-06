"""Done when (issue #1): all 5 test targets, and the demo objects (D-31, issue #25), return their
frame list and cutouts with SX_OFFLINE=1 and the network unplugged (the autouse socket guard plays
the unplugged cable)."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

TARGETS = ["Barnard's star", "Epsilon Indi B", "WISE 0855", "RW Aurigae", "R Draconis"]
DEMO = ["SIMP 0136", "TWA 27", "IRAS 04302+2247"]


@pytest.mark.parametrize("name", TARGETS + DEMO)
def test_target_frames_and_cutouts_offline(client: TestClient, name: str) -> None:
    assert client.app.state.ctx.settings.offline  # type: ignore[attr-defined]
    r = client.get("/v1/resolve", params={"q": name})
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    frames = client.get(f"/v1/objects/{oid}/frames")
    assert frames.status_code == 200, frames.text
    body = frames.json()
    assert body["frames"], body["missing"]
    assert not [m for m in body["missing"] if m != "frames:truncated"]
    for f in body["frames"]:
        png = client.get(f["cutout_url"])
        assert png.status_code == 200
        img = Image.open(io.BytesIO(png.content))
        img.verify()
        assert 0 <= f["x"] < img.size[0] and 0 <= f["y"] < img.size[1]


@pytest.mark.parametrize(
    ("name", "alias"),
    [
        ("TWA 27", "2M1207"),
        ("TWA 27", "2M1207 A"),
        ("TWA 27", "2M1207A"),
        ("SIMP 0136", "SIMP 0136+0933"),
        ("SIMP 0136", "SIMP J0136+0933"),
        ("IRAS 04302+2247", "IRAS 04302"),
    ],
)
def test_demo_alias_resolves_to_the_same_object(client: TestClient, name: str, alias: str) -> None:
    # targets.toml maps short names to each demo object's SIMBAD query (D-31: TWA 27 = 2M1207 A).
    replies = [client.get("/v1/resolve", params={"q": q}) for q in (name, alias)]
    assert all(r.status_code == 200 for r in replies), [r.text for r in replies]
    assert len({r.json()["id"] for r in replies}) == 1
