"""Done when (issue #2): the spectrum of each of the 5 targets is computed from cached cutouts,
offline with the network blocked.

Rule (user decision, Q-26): every frame comes back exactly once, as a measured point or a named
refusal. Barnard's Star, RW Aur and R Dra overflow the detector in every recorded frame, so they
must come back refused as ``saturated`` (plus ``spectrum:saturated``), never as an invented flux.
Epsilon Indi B and WISE 0855 must have at least one measured point.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from app.core.find.cutouts import load_cutout_hdul
from app.core.find.wcs import wavelength_at
from app.core.measure.spectrum import ALL_SATURATED, STAGE2_REASONS
from tests.test_api import resolve_id

MEASURED = ["Epsilon Indi B", "WISE 0855"]
SATURATED = ["Barnard's star", "RW Aurigae", "R Draconis"]


def spectrum_and_frames(client: TestClient, name: str) -> tuple[str, dict, dict]:  # type: ignore[type-arg]
    oid = resolve_id(client, name)
    frames = client.get(f"/v1/objects/{oid}/frames").json()
    r = client.get(f"/v1/objects/{oid}/spectrum")
    assert r.status_code == 200, r.text
    return oid, frames, r.json()


def accounting(frames: dict, body: dict) -> tuple[set[str], dict[str, str]]:  # type: ignore[type-arg]
    points = [p["frame_id"] for p in body["spectrum"]]
    assert len(points) == len(set(points))
    ids = {f["frame_id"] for f in frames["frames"]}
    refusals: dict[str, str] = {}
    for m in body["missing"]:
        reason, _, fid = m.partition(":")
        # Stage 1 also uses cutout:<id>, for frames that never reached its list.
        if reason in STAGE2_REASONS and fid in ids:
            assert fid not in refusals
            refusals[fid] = reason
    assert set(points) | set(refusals) == ids, "a frame was lost"
    assert not set(points) & set(refusals), "a frame is both a point and a refusal"
    return set(points), refusals


@pytest.mark.parametrize("name", MEASURED + SATURATED)
def test_every_frame_accounted_offline(client: TestClient, name: str) -> None:
    assert client.app.state.ctx.settings.offline  # type: ignore[attr-defined]
    _, frames, body = spectrum_and_frames(client, name)
    assert frames["frames"]
    accounting(frames, body)
    assert len(body["light_curve"]) == len(body["spectrum"])


@pytest.mark.parametrize("name", MEASURED)
def test_unsaturated_targets_have_measured_points(client: TestClient, name: str) -> None:
    oid, frames, body = spectrum_and_frames(client, name)
    assert body["spectrum"], body["missing"]
    assert ALL_SATURATED not in body["missing"]
    by_id = {f["frame_id"]: f for f in frames["frames"]}
    service = client.app.state.frames  # type: ignore[attr-defined]
    for p in body["spectrum"]:
        assert math.isfinite(p["flux"]) and math.isfinite(p["error"]) and p["error"] > 0
        # Nominal 0.75-5.0 um (A3.1); live QR2 frames reach 0.741 and 5.005 um at the object pixel.
        assert 0.7 <= p["wavelength_um"] <= 5.1
        f = by_id[p["frame_id"]]
        assert p["wavelength_um"] == f["wavelength_um"]
        fs = service.find(_obj(client, oid), p["frame_id"])
        with load_cutout_hdul(service, oid, p["frame_id"]) as hdul:
            wl = wavelength_at(hdul, fs.x_fits0, fs.y_fits0)
        assert wl is not None and p["wavelength_um"] == pytest.approx(wl[0], abs=2e-6)


@pytest.mark.parametrize("name", SATURATED)
def test_saturated_targets_are_refused_as_saturated(client: TestClient, name: str) -> None:
    _, frames, body = spectrum_and_frames(client, name)
    points, refusals = accounting(frames, body)
    assert not points
    assert set(refusals.values()) == {"saturated"}
    assert ALL_SATURATED in body["missing"]


def _obj(client: TestClient, oid: str):  # type: ignore[no-untyped-def]
    from app.core.find.resolver import load_object

    return load_object(client.app.state.ctx, oid)  # type: ignore[attr-defined]
