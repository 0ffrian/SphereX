"""Issue #75: the pre-built demo pack (Q-164) never hides what SPHEREx measured (Q-206).

The pack has no spectrum (Q-164 (3)). With it enabled, an object whose frames are in the D-25
cache is built live and answers with its measured spectrum and layers; the pack answers only when
the live build has no spectrum, loses its catalogue type, or fails. Most tests build with the
pack switched off (``make_settings``); these switch it on.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, NoReturn
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.cache.store import ReadThroughCache
from app.core.card.assets import Asset, AssetStore
from app.core.card.service import ObjectPipeline, ObjectResult
from app.core.find.resolver import ResolvedObject, load_object, save_object
from app.main import create_app
from app.settings import BACKEND_DIR
from tests.conftest import make_settings
from tests.helpers import resolve_id
from tests.test_api_card import fixture_asset, get_both

PACK = BACKEND_DIR / "assets"

# Search-list rows (Q-161) whose frames are in the fixture cache, and their pack folder. The
# fixture lists are cut at MAXREC=3, so these spectra are short and the layers that need more
# points (emissive, flux_pulse) stay refused here; on the event cache (237 and 297 points) they
# are drawn. What is tested is that the pack changes nothing: the reply equals the pack-less one.
MEASURED_ROWS = {
    "WISE 0855": "brown_dwarf",
    "Epsilon Indi B": "brown_dwarf_binary",
    "Barnard's star": "star",
    "RW Aurigae": "star_ttauri",
    "R Draconis": "star_mira",
}


def pack_params(kind: str, oid: str) -> dict[str, Any]:
    doc = json.loads((PACK / kind / f"{quote(oid, safe='')}.json").read_text(encoding="utf-8"))
    return dict(doc["render_params"])


def write_pack(assets: Path, kind: str, oid: str) -> dict[str, Any]:
    """A pack asset for ``oid`` from the shared ``kind`` fixture, with no spectrum as in Q-164."""
    doc = fixture_asset(kind, oid)
    missing = doc["render_params"]["missing"]
    if "spectrum" not in missing:
        doc["render_params"]["missing"] = [*missing, "spectrum"]
    (assets / kind).mkdir(parents=True, exist_ok=True)
    (assets / kind / f"{quote(oid, safe='')}.json").write_text(json.dumps(doc), "utf-8")
    return doc


def pipeline_of(c: TestClient) -> ObjectPipeline:
    pipeline: ObjectPipeline = c.app.state.pipeline  # type: ignore[attr-defined]
    return pipeline


def broken_build(*_: Any, **__: Any) -> NoReturn:
    raise RuntimeError("bug in the live path")


@pytest.mark.parametrize(("name", "kind"), MEASURED_ROWS.items())
def test_pack_does_not_hide_the_measured_spectrum(
    fixture_cache: Path, tmp_path: Path, name: str, kind: str
) -> None:
    def replies(assets_dir: Path) -> tuple[str, Any, Any, ObjectResult | None]:
        with TestClient(create_app(make_settings(fixture_cache, assets_dir=assets_dir))) as c:
            oid = resolve_id(c, name)
            card_r, params_r = get_both(c, oid)
            pipeline = pipeline_of(c)
            obj = load_object(pipeline.ctx, oid)
            assert obj is not None
            return oid, card_r, params_r, pipeline.saved(obj)

    oid, card_r, params_r, shown = replies(PACK)
    assert "spectrum" in pack_params(kind, oid)["missing"]  # the committed pack holds the row
    assert card_r.headers["X-SX-Asset-Status"] == "generated"
    assert card_r.json()["type"] == kind
    assert "spectrum" not in params_r.json()["missing"]
    # Byte-equal to a build with the pack switched off.
    _, card_off, params_off, _ = replies(tmp_path / "no-pack")
    assert card_r.content == card_off.content
    assert params_r.content == params_off.content
    # The Gemini endpoints read `saved()`: it names the live build the viewer shows, not the pack.
    assert shown is not None and not shown.prebuilt and shown.params == params_r.json()


def test_pack_answers_when_the_live_build_loses_the_catalogue(
    fixture_cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Offline with no cached catalogue answer the live build is a `candidate` sketch; the pack's
    catalogue card is kept instead, and the rejected build bakes nothing."""
    bakes: list[str] = []
    monkeypatch.setattr(ObjectPipeline, "_bake", lambda self, r: bakes.append(r.card["id"]))
    assets = tmp_path / "assets"
    doc = write_pack(assets, "star", "simbad-ghost")
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=assets))) as c:
        obj = ResolvedObject("simbad-ghost", "ghost", 10.0, 10.0, False, "simbad", query="ghost")
        save_object(pipeline_of(c).ctx, obj, [])
        card_r, params_r = get_both(c, "simbad-ghost")
    assert card_r.headers["X-SX-Asset-Status"] == "saved"
    assert card_r.json() == doc["card"] and params_r.json() == doc["render_params"]
    assert bakes == []


def test_pack_answers_when_nothing_is_measured(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No spectrum from the live build (e.g. a `frames = false` row): the pack answers."""
    monkeypatch.setattr(ObjectPipeline, "_spectrum", lambda *a, **k: (None, None))
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=PACK))) as c:
        oid = resolve_id(c, "WISE 0855")
        card_r, params_r = get_both(c, oid)
    assert card_r.headers["X-SX-Asset-Status"] == "saved"
    assert params_r.json() == pack_params("brown_dwarf", oid)


def test_a_generated_asset_wins_over_the_pack(fixture_cache: Path, tmp_path: Path) -> None:
    """Eros's inputs are final in the fixtures, so the live build is saved; the next call answers
    from that saved asset (with its cache time), not from the pack."""
    assets = tmp_path / "assets"
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=assets))) as c:
        oid = resolve_id(c, "433 Eros")
        write_pack(assets, "asteroid_shape", oid)
        first = c.get(f"/v1/objects/{oid}/render-params")
        assert first.headers["X-SX-Asset-Status"] == "generated"
        assert "spectrum" not in first.json()["missing"]
        again = c.get(f"/v1/objects/{oid}/render-params")
    assert again.headers["X-SX-Asset-Status"] == "saved"
    assert again.headers["X-SX-Cached-At"].endswith("Z")  # generated, not the pack
    assert again.json() == first.json()


def test_a_rejected_live_build_is_not_saved(fixture_cache: Path, tmp_path: Path) -> None:
    """A live build with final inputs but another type than the pack (Eros's fixtures are final)
    loses to the pack and is not saved, so the pack still answers on the next request."""
    assets = tmp_path / "assets"
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=assets))) as c:
        oid = resolve_id(c, "433 Eros")
        doc = write_pack(assets, "star", oid)  # the live build is asteroid_shape
        for _ in range(2):
            r = c.get(f"/v1/objects/{oid}/card")
            assert r.headers["X-SX-Asset-Status"] == "saved"
            assert r.json() == doc["card"]
        found = next(pipeline_of(c).assets.layers(oid))
    assert found.prebuilt  # nothing generated was stored


def test_an_invalid_generated_asset_falls_through_to_the_pack(
    fixture_cache: Path, tmp_path: Path
) -> None:
    """A generated asset saved under an older schema fails the contract; the valid pack behind it
    answers instead of a rebuild with no stand-in."""
    assets = tmp_path / "assets"
    doc = write_pack(assets, "star", "x-1")
    store = AssetStore(ReadThroughCache(fixture_cache, offline=True), assets)
    bad = fixture_asset("star", "x-1")
    bad["render_params"]["missing"] = "not a list"
    store.put(Asset(**bad))
    found = store.lookup("x-1")
    assert found is not None and found[1] is not None  # the generated layer is read first
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        pipeline = ObjectPipeline(pipeline_of(c).frames, store)
        got = pipeline.saved(ResolvedObject("x-1", "x", 0.0, 0.0, False, "simbad"))
    assert got is not None and got.prebuilt and got.params == doc["render_params"]


def test_any_live_failure_keeps_the_pack(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Never blank: an error that is not a network one (a contract violation, a bug) in the live
    path answers with the pack, not a 5xx."""
    monkeypatch.setattr(ObjectPipeline, "_build", broken_build)
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=PACK))) as c:
        oid = resolve_id(c, "WISE 0855")
        card_r, params_r = get_both(c, oid)
    assert card_r.headers["X-SX-Asset-Status"] == "saved"
    assert params_r.json() == pack_params("brown_dwarf", oid)


def test_online_stand_in_answers_the_pack_and_publishes_nothing(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Online, a pack object whose live build is still running answers with the pack after
    `first_answer_wait_s`, never with a first-stage or partial card that could flip back. The
    live build runs quiet (it publishes, bakes and saves nothing itself)."""
    release = threading.Event()
    quiet_flags: list[bool] = []

    def slow_build(*_: Any, quiet: bool = False) -> NoReturn:
        quiet_flags.append(quiet)
        assert release.wait(30)
        raise RuntimeError("live build lost")

    settings = make_settings(fixture_cache, assets_dir=PACK, first_answer_wait_s=0.05)
    with TestClient(create_app(settings)) as c:
        oid = resolve_id(c, "WISE 0855")
        pipeline = pipeline_of(c)
        obj = load_object(pipeline.ctx, oid)
        assert obj is not None
        monkeypatch.setattr(ObjectPipeline, "_build", slow_build)
        monkeypatch.setattr(pipeline.ctx.cache, "offline", False)  # _build is faked: no network
        try:
            answer = pipeline.run(obj)
            assert answer.prebuilt and answer.params == pack_params("brown_dwarf", oid)
            job = pipeline.jobs.get(oid)
            assert job is not None and job.latest is None  # nothing intermediate published
        finally:
            release.set()
        final = job.wait_final(timeout=30)
    assert final is not None and final.prebuilt
    assert quiet_flags == [True]
