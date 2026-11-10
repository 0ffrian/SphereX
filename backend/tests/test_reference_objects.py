"""Issue #71 stream E (Q-258): Jupiter and Saturn as reference objects, offline."""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from scripts.bake_demo_pack import ASSETS_DIR
from tests.conftest import make_settings


@pytest.fixture
def client(fixture_cache: Path) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=ASSETS_DIR))) as c:
        yield c


@pytest.mark.parametrize(
    ("q", "oid"),
    [("Jupiter", "ref-jupiter"), ("saturn", "ref-saturn"), ("ref-jupiter", "ref-jupiter")],
)
def test_resolve_card_frames(client: TestClient, q: str, oid: str) -> None:
    r = client.get("/v1/resolve", params={"q": q})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == oid and body["resolver"] == "reference" and body["moving"] is False
    assert body["provenance"]["ra"]["tag"] == "artistic"  # no sky position is claimed as measured

    card = client.get(f"/v1/objects/{oid}/card")
    assert card.status_code == 200
    assert card.headers["X-SX-Asset-Status"] == "saved"
    c = card.json()
    assert c["type"] == "gas_giant"
    for f in ("radius_rjup", "mass_mearth", "rot_period_h", "teq_K", "orbit_au"):
        assert c[f]["value"] > 0 and c[f]["tag"] in ("measured",) and "NASA" in c[f]["source"]

    fr = client.get(f"/v1/objects/{oid}/frames")
    assert fr.status_code == 200
    assert fr.json()["frames"] == []  # not a SPHEREx target: no flipbook, no crash


def test_values_match_the_nasa_fact_sheet(client: TestClient) -> None:
    client.get("/v1/resolve", params={"q": "Jupiter"})
    c = client.get("/v1/objects/ref-jupiter/card").json()
    assert c["radius_rjup"]["value"] == 1.0
    assert c["mass_mearth"]["value"] == pytest.approx(317.83, abs=0.01)
    assert c["rot_period_h"]["value"] == 9.925


def test_committed_assets_are_current() -> None:
    p = subprocess.run(
        [sys.executable, "-m", "scripts.bake_reference_objects", "--check"],
        capture_output=True,
        text=True,
        env={"PYTHONPATH": ".", "PATH": ""},
    )
    assert p.returncode == 0, p.stdout + p.stderr
