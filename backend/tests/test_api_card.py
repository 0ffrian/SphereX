"""Done when (issue #5): the 5 test targets and the fixture objects return valid cards and render
params, offline, validated against shared/schemas with jsonschema. Also stage 4 asset states."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.core.card.assets import Asset, AssetStore
from app.core.card.service import ObjectPipeline
from app.core.card.validate import errors
from app.core.find.frames import FrameService
from app.core.find.resolver import ResolvedObject, save_object
from app.core.render.card_to_params import GENERATOR_VERSION
from app.main import create_app
from app.settings import Settings
from tests.conftest import make_settings
from tests.test_api import resolve_id

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
TAGS = {"measured", "derived", "model_dependent", "inferred_from_analog", "artistic"}

TARGETS = {
    "Barnard's star": "star",
    "Epsilon Indi B": "brown_dwarf_binary",
    "WISE 0855": "brown_dwarf",
    "RW Aurigae": "star_ttauri",
    "R Draconis": "star_mira",
    "433 Eros": "asteroid_procedural",
}


def tagged_values(card: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for key, v in card.items():
        if key == "gas_Q" and isinstance(v, dict):
            out.extend(v.values())
        elif isinstance(v, dict):
            out.append(v)
    return out


def get_both(client: TestClient, oid: str) -> tuple[Any, Any]:
    card = client.get(f"/v1/objects/{oid}/card")
    params = client.get(f"/v1/objects/{oid}/render-params")
    assert card.status_code == 200, card.text
    assert params.status_code == 200, params.text
    return card, params


@pytest.mark.parametrize(("name", "kind"), TARGETS.items())
def test_targets_return_valid_card_and_params_offline(
    client: TestClient, name: str, kind: str
) -> None:
    assert client.app.state.ctx.settings.offline  # type: ignore[attr-defined]
    oid = resolve_id(client, name)
    card_r, params_r = get_both(client, oid)
    card, params = card_r.json(), params_r.json()
    assert errors(card, "object-card.schema.json") == []
    assert errors(params, "render-params.schema.json") == []
    assert card["id"] == params["id"] == oid
    assert card["type"] == params["type"] == kind
    for tv in tagged_values(card):
        assert tv["tag"] in TAGS and tv["source"].strip()
    assert card_r.headers["X-SX-Asset-Status"] in {"generated", "saved"}
    assert card_r.headers["X-SX-Cached-At"].endswith("Z")
    assert isinstance(params["missing"], list)


def test_nothing_is_guessed_for_the_targets(client: TestClient) -> None:
    """Values with no source in the pipeline stay null, with the reason in `source`."""
    star = get_both(client, resolve_id(client, "Barnard's star"))[0].json()
    assert star["teff_K"]["value"] is None and star["radius_rsun"]["value"] is None
    assert star["spectral_class"] == {
        "value": "M4V",
        "tag": "measured",
        "source": "SIMBAD NAME Barnard's star sp_type",
    }
    bd = get_both(client, resolve_id(client, "Epsilon Indi B"))
    card, params = bd[0].json(), bd[1].json()
    assert card["ch4_depth_33"]["value"] is None
    assert card["radius_rjup"]["tag"] == "model_dependent" and card["radius_rjup"]["assumption"]
    assert "bands" in params["missing"]
    eros = get_both(client, resolve_id(client, "433 Eros"))[0].json()
    assert eros["diameter_km"]["value"] == 16.84 and eros["diameter_km"]["err"] == 0.06
    assert eros["lightcurve_amp_mag"]["value"] is None


def test_replies_are_deterministic(client: TestClient) -> None:
    oid = resolve_id(client, "WISE 0855")
    first = get_both(client, oid)
    second = get_both(client, oid)
    assert first[0].content == second[0].content
    assert first[1].content == second[1].content


def test_final_inputs_are_saved_and_served_as_saved(client: TestClient) -> None:
    """Stage 4: Eros's inputs are final (its fixture path search is complete, issue #26), so the
    first call saves the asset and the next one is `saved` with identical content."""
    oid = resolve_id(client, "433 Eros")
    first = client.get(f"/v1/objects/{oid}/card")
    assert first.headers["X-SX-Asset-Status"] == "generated"
    again = client.get(f"/v1/objects/{oid}/card")
    assert again.headers["X-SX-Asset-Status"] == "saved"
    assert again.json() == first.json()
    # A saved generated asset is a D-25 cache entry, so it still reports when it was cached.
    assert again.headers["X-SX-Cached-At"].endswith("Z")
    # Truncated fixture searches (MAXREC=3) are not final, so stars are never saved.
    star = resolve_id(client, "R Dra")
    for _ in range(2):
        r = client.get(f"/v1/objects/{star}/card")
        assert r.headers["X-SX-Asset-Status"] == "generated"


def test_typed_coordinates_are_a_sketch_candidate(client: TestClient) -> None:
    oid = resolve_id(client, "10.5,-20.25")
    card_r, params_r = get_both(client, oid)
    assert card_r.headers["X-SX-Asset-Status"] == "sketch"
    assert card_r.json()["type"] == "candidate"
    params = params_r.json()
    assert errors(params, "render-params.schema.json") == []
    assert params["scale_m"] is None and params["layers"] == []
    assert "mesh" in params["missing"]
    # Once saved, a sketch keeps its sketch label on every later request (UML 16, Q-57).
    for _ in range(2):
        again = client.get(f"/v1/objects/{oid}/card")
        assert again.headers["X-SX-Asset-Status"] == "sketch"


def test_cors_exposes_the_custom_headers(fixture_cache: Path) -> None:
    """With SX_CORS_ORIGINS set (no Vite proxy) the browser can read cached_at and the status."""
    settings = make_settings(fixture_cache, cors_origins="https://example.test")
    with TestClient(create_app(settings)) as c:
        oid = resolve_id(c, "433 Eros")
        r = c.get(f"/v1/objects/{oid}/card", headers={"Origin": "https://example.test"})
    exposed = {h.strip().lower() for h in r.headers["access-control-expose-headers"].split(",")}
    assert {"x-sx-cached-at", "x-sx-asset-status"} <= exposed


def test_unknown_object_is_404(client: TestClient) -> None:
    for path in ("card", "render-params"):
        r = client.get(f"/v1/objects/simbad-nope/{path}")
        assert r.status_code == 404 and r.json()["error"] == "not_found"


# --- pre-baked fixture assets (A5.4) ----------------------------------------------------------


def fixture_asset(kind: str, object_id: str) -> dict[str, Any]:
    card = json.loads((FIXTURES / "cards" / f"{kind}.json").read_text(encoding="utf-8"))
    params = json.loads((FIXTURES / "params" / f"{kind}.json").read_text(encoding="utf-8"))
    card["id"] = params["id"] = object_id
    return {
        "card": card,
        "render_params": params,
        "textures": params.get("textures"),
        "generator_version": params["generator_version"],
        "seed": params["seed"],
        "created_at": "2026-11-06T00:00:00.000Z",
    }


@pytest.fixture
def prebaked(fixture_cache: Path, tmp_path: Path) -> tuple[Settings, list[tuple[str, str]]]:
    """Every shared fixture pair as a pre-baked asset. The ids are renamed from `fixture:<type>`
    to `fixture-<type>`, because `:` is not a valid id in the API path (ID_RE)."""
    assets = tmp_path / "assets"
    ids = []
    for path in sorted((FIXTURES / "cards").glob("*.json")):
        kind = path.stem
        oid = f"fixture-{kind}"
        (assets / kind).mkdir(parents=True)
        doc = fixture_asset(kind, oid)
        (assets / kind / f"{quote(oid, safe='')}.json").write_text(json.dumps(doc), "utf-8")
        ids.append((oid, kind))
    return make_settings(fixture_cache, assets_dir=assets), ids


def test_fixture_objects_are_served_as_saved_assets(
    prebaked: tuple[Settings, list[tuple[str, str]]],
) -> None:
    settings, ids = prebaked
    assert len(ids) == 14
    with TestClient(create_app(settings)) as c:
        ctx = c.app.state.ctx  # type: ignore[attr-defined]
        for oid, kind in ids:
            # Register the id in the object registry, as resolve would.
            save_object(ctx, ResolvedObject(oid, f"fixture {kind}", 0.0, 0.0, False, "simbad"), [])
            card_r, params_r = get_both(c, oid)
            # A saved candidate is still a sketch from SPHEREx only (UML 16, Q-57).
            status = "sketch" if kind == "candidate" else "saved"
            assert card_r.headers["X-SX-Asset-Status"] == status
            assert params_r.headers["X-SX-Asset-Status"] == status
            card, params = card_r.json(), params_r.json()
            assert errors(card, "object-card.schema.json") == []
            assert errors(params, "render-params.schema.json") == []
            assert card["type"] == params["type"] == kind


def test_asset_store_layers(fixture_cache: Path, tmp_path: Path) -> None:
    from app.cache.store import ReadThroughCache

    cache = ReadThroughCache(fixture_cache, offline=True)
    assets = tmp_path / "assets"
    store = AssetStore(cache, assets)
    assert store.get("x-1") is None  # no assets dir: nothing saved, no crash
    (assets / "star").mkdir(parents=True)
    (assets / "star" / "broken.json").write_text("{not json", "utf-8")
    assert store.get("broken") is None  # unreadable pre-baked file is ignored
    doc = fixture_asset("star", "x-1")
    store.put(Asset(**doc))
    got = store.get("x-1")
    assert got is not None and got.card == doc["card"] and got.seed == doc["seed"]
    # A pre-baked file wins over a generated one.
    pre = fixture_asset("star", "x-1")
    pre["seed"] = 99
    (assets / "star" / "x-1.json").write_text(json.dumps(pre), "utf-8")
    assert store.get("x-1").seed == 99  # type: ignore[union-attr]
    # Wrong shape (D-22 fields) is not an asset.
    assert Asset.from_json({"card": {}}) is None


def test_pipeline_without_catalogue_answer_is_a_sketch(fixture_cache: Path) -> None:
    """A SIMBAD object whose cached answer is gone offline: refused to candidate, no crash."""
    settings = make_settings(fixture_cache)
    with TestClient(create_app(settings)) as c:
        frames: FrameService = c.app.state.frames  # type: ignore[attr-defined]
        pipeline = ObjectPipeline(frames, AssetStore(frames.ctx.cache, None))
        obj = ResolvedObject("simbad-ghost", "ghost", 10.0, 10.0, False, "simbad", query="ghost")
        result = pipeline.run(obj)
    assert result.status == "sketch" and result.card["type"] == "candidate"
    assert "catalogue" in result.params["missing"]
    assert errors(result.params, "render-params.schema.json") == []


def test_asset_key_tracks_generator_version_and_release() -> None:
    """A stage 7 or baker rule change (GENERATOR_VERSION) or a new data release must not serve
    an asset saved under the old rules or data."""
    from app.core.card.assets import asset_key

    base = asset_key("x-1", "QR2")
    assert base != asset_key("x-1", "QR3")
    assert ("generator", GENERATOR_VERSION) in base.query


def test_mismatched_or_invalid_saved_assets_are_not_served(
    fixture_cache: Path, tmp_path: Path
) -> None:
    from app.cache.store import ReadThroughCache

    cache = ReadThroughCache(fixture_cache, offline=True)
    assets = tmp_path / "assets"
    (assets / "star").mkdir(parents=True)
    doc = fixture_asset("star", "x-2")
    doc["render_params"]["id"] = "someone-else"
    (assets / "star" / "x-2.json").write_text(json.dumps(doc), "utf-8")
    assert AssetStore(cache, assets).get("x-2") is None

    # A pre-baked file that no longer matches the schema is rebuilt, not a 500.
    oid = "simbad-ghost"
    bad = fixture_asset("star", oid)
    bad["card"]["spectral_class"] = {"value": "M4V"}  # no tag, no source
    (assets / "star" / f"{oid}.json").write_text(json.dumps(bad), "utf-8")
    settings = make_settings(fixture_cache)
    with TestClient(create_app(settings)) as c:
        frames: FrameService = c.app.state.frames  # type: ignore[attr-defined]
        pipeline = ObjectPipeline(frames, AssetStore(frames.ctx.cache, assets))
        obj = ResolvedObject(oid, "ghost", 10.0, 10.0, False, "simbad", query="ghost")
        result = pipeline.run(obj)
    assert result.status == "sketch"
    assert errors(result.card, "object-card.schema.json") == []


def test_nan_proper_motion_is_not_written() -> None:
    from app.core.card.build import build_card
    from app.core.card.catalogue import CatalogueData
    from app.core.classify import CatalogueFacts, classify

    facts = CatalogueFacts(simbad_otype="*", simbad_sp_type="G2V", simbad_id="x")
    obj = ResolvedObject(
        "simbad-x", "x", 1.0, 1.0, False, "simbad", pm_ra_mas_yr=float("nan"), pm_dec_mas_yr=1.0
    )
    card = build_card(obj, CatalogueData(facts), classify(facts), None)
    assert "pm_mas_yr" not in card
