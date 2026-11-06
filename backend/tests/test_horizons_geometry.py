"""Phase angle and Sun vector from Horizons (Q-62, R5.1): offline, from recorded bodies."""

from __future__ import annotations

import json
import math
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import horizons
from app.cache.store import CacheMissOffline
from app.context import make_context
from app.core.card.catalogue import CatalogueData, with_geometry
from app.core.classify import CatalogueFacts
from app.core.find.resolver import ResolvedObject
from app.settings import Settings
from app.timefmt import parse_utc
from tests.conftest import make_settings
from tests.test_api import resolve_id

EPOCH = parse_utc("2026-11-14T00:00:00Z")
# Recorded live from JPL Horizons on 2026-11-07 (observer 500@-163182 and Sun-centred vectors).
EROS_PHASE_DEG = 18.6502
EROS_R_AU = 1.7554045781086962


def _body(rows: str) -> bytes:
    return json.dumps({"result": f"header\n$$SOE\n{rows}\n$$EOE\nfooter"}).encode()


PHASE_ROW = "2026-Nov-14 00:00:00.000, , , 265.248023177, -26.005517250,   18.6502,"
VEC_ROW = "2461358.500000000, A.D. 2026-Nov-14 00:00:00.0000, 4.0E-01, -1.5E+00, -7.0E-01,"


def test_parsers() -> None:
    assert horizons.parse_phase_angle(_body(PHASE_ROW)) == 18.6502
    assert horizons.parse_vectors(_body(VEC_ROW)) == (0.4, -1.5, -0.7)


@pytest.mark.parametrize("bad", [b'{"result": "No ephemeris for target"}', _body("x, y")])
def test_parsers_reject_bad_bodies(bad: bytes) -> None:
    with pytest.raises(ValueError):
        horizons.parse_phase_angle(bad)
    with pytest.raises(ValueError):
        horizons.parse_vectors(bad)


def test_sun_unit_vector_points_at_sun() -> None:
    unit, norm = horizons.sun_unit_vector((3.0, 0.0, 4.0))
    assert norm == 5.0 and unit == (-0.6, 0.0, -0.8)
    with pytest.raises(ValueError):
        horizons.sun_unit_vector((0.0, 0.0, 0.0))


def test_eros_geometry_offline(offline_settings: Settings) -> None:
    ctx = make_context(offline_settings)
    g, served = horizons.geometry(ctx, "20000433", EPOCH)
    assert g.observer == horizons.OBSERVER_SPHEREX and len(served) == 2
    assert g.phase_angle_deg == EROS_PHASE_DEG
    assert math.isclose(g.r_au, EROS_R_AU, rel_tol=1e-12)
    assert math.isclose(math.sqrt(sum(c * c for c in g.sun_vector)), 1.0, rel_tol=1e-12)


def test_geocentre_fallback_when_spherex_has_no_ephemeris(tmp_path: Path) -> None:
    centers: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        center = request.url.params["CENTER"]
        centers.append(center)
        if request.url.params.get("EPHEM_TYPE") == "VECTORS":
            return httpx.Response(200, content=_body(VEC_ROW))
        if "-163182" in center:
            return httpx.Response(200, content=b'{"result": "No ephemeris for target"}')
        return httpx.Response(200, content=_body(PHASE_ROW))

    ctx = make_context(
        make_settings(tmp_path, offline=False), transport=httpx.MockTransport(handler)
    )
    g, _ = horizons.geometry(ctx, "20000433", EPOCH)
    assert g.observer == horizons.GEOCENTRE
    assert centers[:2] == ["'500@-163182'", "'500@399'"]


def test_geometry_is_null_with_reason_on_cache_miss(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))  # empty cache, offline
    with pytest.raises(CacheMissOffline):
        horizons.geometry(ctx, "20000433", EPOCH)
    obj = ResolvedObject(
        "sbdb-20000433", "433 Eros", 0, 0, True, "sbdb", "2026-11-14T00:00:00Z", spkid="20000433"
    )
    data = with_geometry(ctx, CatalogueData(CatalogueFacts()), obj)
    assert data.geometry is None and "offline" in (data.geometry_reason or "")


def test_catalogue_without_sbdb_is_untouched(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))
    star = ResolvedObject("simbad-x", "x", 0, 0, False, "simbad")
    data = CatalogueData(CatalogueFacts())
    assert with_geometry(ctx, data, star) is data


def test_eros_card_and_params(client: TestClient) -> None:
    oid = resolve_id(client, "433 Eros")
    card = client.get(f"/v1/objects/{oid}/card").json()
    phase, sun = card["phase_angle_deg"], card["sun_vector"]
    assert phase["value"] == EROS_PHASE_DEG and phase["tag"] == "measured"
    assert "500@-163182" in phase["source"] and "2026-11-14T00:00:00.000Z" in phase["source"]
    assert sun["tag"] == "derived" and "ICRF" in sun["formula"]
    assert math.isclose(math.hypot(*sun["value"]), 1.0, abs_tol=1e-6)
    params = client.get(f"/v1/objects/{oid}/render-params").json()
    assert params["lighting"]["phase_angle_deg"] == EROS_PHASE_DEG
