"""``GET /v1/objects/{id}/spectrum``: the brief's shape, errors and the moving-object refusal."""

from __future__ import annotations

import re

from fastapi.testclient import TestClient

from tests.test_api import resolve_id

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
TAGS = {"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"}


def test_spectrum_shape(client: TestClient) -> None:
    oid = resolve_id(client, "eps Ind B")
    r = client.get(f"/v1/objects/{oid}/spectrum")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {
        "id",
        "spectrum",
        "light_curve",
        "flux_unit",
        "tag",
        "cached_at",
        "missing",
    }
    assert body["id"] == oid and body["tag"] == "measured" and body["flux_unit"] == "uJy"
    assert ISO_Z.match(body["cached_at"])
    assert all(isinstance(m, str) for m in body["missing"])
    assert body["spectrum"]
    for p in body["spectrum"]:
        assert set(p) >= {"wavelength_um", "flux", "error", "flagged", "frame_id"}
        assert isinstance(p["flagged"], bool)
    for p in body["light_curve"]:
        assert set(p) >= {"time", "flux", "error", "frame_id"}
        assert ISO_Z.match(p["time"])
    assert all(v["tag"] in TAGS for v in body["provenance"].values())
    assert body["provenance"]["flux"]["formula"]
    assert body["method"]["aperture_correction"] is None


def test_spectrum_is_cached_and_identical(client: TestClient) -> None:
    oid = resolve_id(client, "WISE 0855")
    a = client.get(f"/v1/objects/{oid}/spectrum").json()
    b = client.get(f"/v1/objects/{oid}/spectrum").json()
    assert a == b


def test_unknown_object_is_404(client: TestClient) -> None:
    r = client.get("/v1/objects/simbad-no-such-thing/spectrum")
    assert r.status_code == 404
    assert r.json()["error"] == "not_found" and r.json()["detail"]


def test_moving_object_is_refused_not_invented(client: TestClient) -> None:
    oid = resolve_id(client, "433 Eros")
    r = client.get(f"/v1/objects/{oid}/spectrum")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["spectrum"] == [] and body["light_curve"] == []
    assert "frames:moving_object_search" in body["missing"]
    assert "spectrum:saturated" not in body["missing"]
