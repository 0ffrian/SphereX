"""The pre-built demo pack (issue #68 Track F, 7c and 7d; Q-164, A5.4).

Offline, no cache: ``--check`` falls back to the committed cards (see the script's docstring). The
catalogue half of the check (``--strict``) needs the D-25 cache and runs on the bake machine.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.cache.store import ReadThroughCache
from app.core.card.assets import Asset, AssetStore
from app.core.card.service import ObjectPipeline
from app.core.card.validate import check_card, check_params
from app.core.find.frames import FrameService
from app.core.find.resolver import ResolvedObject
from app.main import create_app
from app.settings import Settings
from scripts import bake_demo_pack as bp
from tests.conftest import make_settings

PACK_BUDGET_BYTES = 15 * 1024 * 1024  # 7c: at most 15 MB for the whole pack
NAMES = bp.type_names()


def committed_assets() -> list[tuple[Path, Asset]]:
    out = []
    for kind in NAMES:
        for path in sorted((bp.ASSETS_DIR / kind).glob("*.json")):
            asset = Asset.from_json(json.loads(path.read_text(encoding="utf-8")))
            assert asset is not None, path
            out.append((path, asset))
    return out


def pack_bytes() -> int:
    files = [p for p in bp.TEXTURES_DIR.rglob("*") if p.is_file()]
    files += [path for path, _ in committed_assets()]
    files.append(bp.DEMO_TARGETS_TS)
    return sum(p.stat().st_size for p in files)


def test_search_list_queries_are_targets() -> None:
    assert bp.missing_from_targets_toml(bp.REPO / "backend" / "targets.toml") == []


def test_every_search_row_has_a_committed_asset_that_passes_the_contract() -> None:
    by_id = {str(a.card["id"]): a for _, a in committed_assets()}
    assert len(by_id) == len(bp.SEARCH_LIST) == 16
    for _, asset in committed_assets():
        check_card(asset.card)
        check_params(asset.render_params)
        assert asset.card["id"] == asset.render_params["id"]
        assert asset.created_at == bp.PACK_EPOCH
        # No frames and no spectrum in the pack (Q-164).
        assert "spectrum" in asset.render_params["missing"]
        assert asset.card.get("spectrum") is None


def test_pack_stays_under_15_mb() -> None:
    assert pack_bytes() <= PACK_BUDGET_BYTES, pack_bytes()


def test_pack_holds_no_frames_or_spectra() -> None:
    suffixes = {p.suffix for p in bp.ASSETS_DIR.rglob("*") if p.is_file()}
    assert not suffixes & {".fits", ".fit", ".npy", ".npz", ".csv"}
    for path, asset in committed_assets():
        assert "cutout" not in path.read_text(encoding="utf-8"), path
        assert asset.card.get("spectrum") is None


def test_texture_urls_point_at_the_demo_mount_and_exist() -> None:
    n = 0
    for _, asset in committed_assets():
        if asset.textures is None:
            continue
        assert asset.textures == asset.render_params["textures"]
        for key, url in asset.textures.items():
            if not isinstance(url, str):
                continue  # relief_amp
            assert url.startswith(bp.DEMO_TEXTURE_URL_ROOT + "/"), url
            rel = url.removeprefix(bp.DEMO_TEXTURE_URL_ROOT + "/")
            assert (bp.TEXTURES_DIR / rel).is_file(), f"{key}: {url}"
            n += 1
    assert n >= 4


def test_rebake_is_byte_identical_and_check_passes(tmp_path: Path) -> None:
    """Same committed pack, rebuilt from its cards: every byte equal (``--check``, card only)."""
    settings = make_settings(tmp_path / "empty-cache")
    ts = tmp_path / "demoTargets.ts"
    shutil.copy(bp.DEMO_TARGETS_TS, ts)
    assets = tmp_path / "assets"
    shutil.copytree(bp.ASSETS_DIR, assets)
    args = ["--check"]
    assert bp.main(args, assets_dir=assets, ts_path=ts, settings=settings) == 0
    # The strict check wants the catalogues, which this empty cache does not have.
    assert bp.main([*args, "--strict"], assets_dir=assets, ts_path=ts, settings=settings) == 1


def test_check_reports_a_changed_byte(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "empty-cache")
    ts = tmp_path / "demoTargets.ts"
    shutil.copy(bp.DEMO_TARGETS_TS, ts)
    assets = tmp_path / "assets"
    shutil.copytree(bp.ASSETS_DIR, assets)
    victim = next(assets.rglob("height.bin"))
    data = victim.read_bytes()
    victim.write_bytes(bytes([data[0] ^ 0xFF]) + data[1:])
    assert bp.main(["--check"], assets_dir=assets, ts_path=ts, settings=settings) == 1


def test_check_reports_a_stale_class_label(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "empty-cache")
    ts = tmp_path / "demoTargets.ts"
    ts.write_text(bp.DEMO_TARGETS_TS.read_text("utf-8").replace("brown dwarf", "dwarf"), "utf-8")
    assert bp.main(["--check"], assets_dir=bp.ASSETS_DIR, ts_path=ts, settings=settings) == 1


def test_class_label_rule() -> None:
    star = {"type": "brown_dwarf", "spectral_class": {"value": "T1", "tag": "measured"}}
    assert bp.class_label(star, NAMES) == "brown dwarf · T1"
    assert bp.class_label({"type": "comet"}, NAMES) == "comet"
    assert bp.class_label({"type": "comet", "spectral_class": {"value": None}}, NAMES) == "comet"
    assert bp.class_label({"type": "candidate"}, NAMES) is None  # not a moving source (Q-164)
    assert bp.class_label({"type": "no_such_type"}, NAMES) is None


def test_generated_list_matches_the_committed_labels() -> None:
    text = bp.DEMO_TARGETS_TS.read_text(encoding="utf-8")
    for _, asset in committed_assets():
        label = bp.class_label(asset.card, NAMES)
        if label is not None:
            assert bp._q(label) in text


# --- the /data/demo-textures mount -----------------------------------------------------------


def _a_texture_url() -> str:
    for _, asset in committed_assets():
        if asset.textures:
            return str(asset.textures["albedo"])
    raise AssertionError("no textured asset in the pack")


@pytest.fixture
def pack_client(tmp_path: Path) -> TestClient:
    settings = make_settings(tmp_path / "cache")
    return TestClient(create_app(settings))


def test_demo_textures_are_served_offline(pack_client: TestClient) -> None:
    assert pack_client.app.state.ctx.settings.offline  # type: ignore[attr-defined]
    r = pack_client.get(_a_texture_url())
    assert r.status_code == 200
    assert r.content[:4] == b"RIFF"  # WebP


def test_demo_textures_path_safety(pack_client: TestClient) -> None:
    url = _a_texture_url()
    root = bp.DEMO_TEXTURE_URL_ROOT
    folder = url.rsplit("/", 1)[0]
    assert pack_client.get(folder + "/").status_code == 404  # no directory listing
    assert pack_client.get(root + "/").status_code == 404
    for bad in (
        f"{root}/../textures/x",
        f"{root}/%2e%2e/%2e%2e/settings.py",
        f"{root}/..%2f..%2fmain.py",
        f"{root}/%2e%2e%5c%2e%2e%5cmain.py",
        f"{root}//etc/passwd",
        f"{root}/{quote('../../../../etc/passwd', safe='')}",
    ):
        r = pack_client.get(bad)
        assert r.status_code in (400, 404), (bad, r.status_code)
        assert b"from __future__" not in r.content
    # Read only: no write verbs.
    assert pack_client.put(url, content=b"x").status_code in (404, 405)
    assert pack_client.delete(url).status_code in (404, 405)
    assert pack_client.post(url, content=b"x").status_code in (404, 405)


def test_the_live_textures_mount_is_unchanged(pack_client: TestClient) -> None:
    # Not the pack's files: /data/textures serves only what this backend baked.
    assert (
        pack_client.get(
            _a_texture_url().replace("/data/demo-textures", "/data/textures")
        ).status_code
        == 404
    )


# --- the asset store -------------------------------------------------------------------------


def _pack_store(tmp_path: Path, cache: Path) -> tuple[AssetStore, Path]:
    assets = tmp_path / "assets"
    shutil.copytree(bp.ASSETS_DIR, assets, ignore=shutil.ignore_patterns("textures", "shapes"))
    return AssetStore(ReadThroughCache(cache, offline=True), assets), assets


def _obj(asset: Asset) -> ResolvedObject:
    return ResolvedObject(str(asset.card["id"]), str(asset.card["name"]), 0.0, 0.0, False, "simbad")


def test_pack_asset_is_served_as_saved(fixture_cache: Path, tmp_path: Path) -> None:
    store, _ = _pack_store(tmp_path, fixture_cache)
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=bp.ASSETS_DIR))) as c:
        frames: FrameService = c.app.state.frames  # type: ignore[attr-defined]
        pipeline = ObjectPipeline(frames, store)
        seen = 0
        for _, asset in committed_assets():
            result = pipeline.saved(_obj(asset))
            assert result is not None, asset.card["id"]
            # A saved candidate stays a sketch (UML 16, Q-57); every other type is "saved".
            assert result.status == ("sketch" if asset.card["type"] == "candidate" else "saved")
            assert result.card == asset.card and result.params == asset.render_params
            seen += 1
        assert seen == 16


def test_pack_asset_failing_its_schema_is_ignored_with_a_warning(
    fixture_cache: Path, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    store, assets = _pack_store(tmp_path, fixture_cache)
    path, asset = next((p, a) for p, a in committed_assets() if a.card["type"] == "star")
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["card"]["spectral_class"] = {"value": "M4V"}  # no tag, no source
    (assets / path.relative_to(bp.ASSETS_DIR)).write_text(json.dumps(doc), "utf-8")
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        frames: FrameService = c.app.state.frames  # type: ignore[attr-defined]
        pipeline = ObjectPipeline(frames, store)
        with caplog.at_level(logging.WARNING, logger="shift_spectrum"):
            assert pipeline.saved(_obj(asset)) is None
    assert any("ignoring saved asset" in r.getMessage() for r in caplog.records)


def test_api_answers_a_pack_row_as_saved(fixture_cache: Path) -> None:
    """End to end through the API: resolve from the recorded SIMBAD answer, then card and
    render-params come from the pack, with `X-SX-Asset-Status: saved` and no frames job."""
    with TestClient(create_app(make_settings(fixture_cache, assets_dir=bp.ASSETS_DIR))) as c:
        oid = c.get("/v1/resolve", params={"q": "WISE 0855-0714"}).json()["id"]
        card, params = c.get(f"/v1/objects/{oid}/card"), c.get(f"/v1/objects/{oid}/render-params")
        assert card.headers["X-SX-Asset-Status"] == params.headers["X-SX-Asset-Status"] == "saved"
        assert params.json()["textures"]["albedo"].startswith("/data/demo-textures/")
        assert c.get(params.json()["textures"]["albedo"]).status_code == 200


# --- stale-pack guards (Q-167) ---------------------------------------------------------------


def _copy_pack(tmp_path: Path) -> tuple[Path, Path]:
    ts = tmp_path / "demoTargets.ts"
    shutil.copy(bp.DEMO_TARGETS_TS, ts)
    assets = tmp_path / "assets"
    shutil.copytree(bp.ASSETS_DIR, assets)
    return assets, ts


def _edit_asset(assets: Path, ts_type: str, change: object) -> None:
    path = next((assets / ts_type).glob("*.json"))
    doc = json.loads(path.read_text("utf-8"))
    change(doc)  # type: ignore[operator]
    path.write_text(json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n", "utf-8")


def test_every_committed_asset_carries_the_current_version_and_inputs_hash() -> None:
    from app.core.card.assets import ASSET_VERSION

    s = make_settings(Path("unused"))
    for _, a in committed_assets():
        assert a.asset_version == ASSET_VERSION
        assert a.inputs_sha256 == bp.inputs_sha256(s)


def test_check_fails_on_a_stale_asset_version_with_no_cache(tmp_path: Path) -> None:
    assets, ts = _copy_pack(tmp_path)
    _edit_asset(assets, "star", lambda d: d.update(asset_version="6"))
    settings = make_settings(tmp_path / "empty-cache")
    assert bp.main(["--check"], assets_dir=assets, ts_path=ts, settings=settings) == 1


def test_check_fails_when_a_reviewed_input_changed(tmp_path: Path) -> None:
    assets, ts = _copy_pack(tmp_path)
    lit_file = tmp_path / "literature.toml"
    lit_file.write_text(
        bp.BACKEND_DIR.joinpath("assets/literature.toml").read_text("utf-8") + "\n#"
    )
    settings = make_settings(tmp_path / "empty-cache", literature_file=lit_file)
    assert bp.inputs_sha256(settings) != bp.inputs_sha256(make_settings(tmp_path / "x"))
    assert bp.main(["--check"], assets_dir=assets, ts_path=ts, settings=settings) == 1


def test_check_fails_when_a_literature_field_of_the_card_drifted(tmp_path: Path) -> None:
    assets, ts = _copy_pack(tmp_path)

    def drift(d: dict) -> None:  # type: ignore[type-arg]
        d["card"]["component_teff_K"]["value"] = [1.0, 2.0]

    _edit_asset(assets, "brown_dwarf_binary", drift)
    settings = make_settings(tmp_path / "empty-cache")
    asset = Asset.from_json(
        json.loads(next((assets / "brown_dwarf_binary").glob("*.json")).read_text("utf-8"))
    )
    assert asset is not None
    assert any("component_teff_K" in m for m in bp.stale_inputs(asset, settings))
    assert bp.main(["--check"], assets_dir=assets, ts_path=ts, settings=settings) == 1


def test_store_refuses_a_pack_asset_of_another_version(
    fixture_cache: Path, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    store, assets = _pack_store(tmp_path, fixture_cache)
    path, asset = next((p, a) for p, a in committed_assets() if a.card["type"] == "star")
    assert store.get(str(asset.card["id"])) is not None
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["asset_version"] = "1"
    (assets / path.relative_to(bp.ASSETS_DIR)).write_text(json.dumps(doc), "utf-8")
    with caplog.at_level(logging.WARNING, logger="shift_spectrum"):
        assert store.get(str(asset.card["id"])) is None
    assert any("stale pre-baked asset" in r.getMessage() for r in caplog.records)
    del doc["asset_version"]  # an asset with no version at all is stale too
    (assets / path.relative_to(bp.ASSETS_DIR)).write_text(json.dumps(doc), "utf-8")
    assert store.get(str(asset.card["id"])) is None


def test_check_runs_offline_so_its_result_does_not_depend_on_upstream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR #70 review: `--check` must never fall through to a live call."""
    seen: list[bool] = []

    def stop(settings: Settings) -> Any:
        seen.append(settings.offline)
        raise SystemExit(0)

    monkeypatch.setattr(bp, "make_context", stop)
    monkeypatch.setattr(bp, "missing_from_targets_toml", lambda _p: [])
    with pytest.raises(SystemExit):
        bp.main(["--check"], settings=Settings(cache_dir=tmp_path, offline=False))
    assert seen == [True]
