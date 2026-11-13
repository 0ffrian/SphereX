"""``/v1/areas/...`` (A17.8, P7): contract, errors, stamps, the ECSV export, the committed Eros
pack under ``SX_OFFLINE=1``, and determinism (A17.10).

Every JSON reply is validated against ``shared/schemas/area-*.schema.json`` with the real
validator and then against the cross-reply rules of ``tests/area_consistency.py``. Network
blocked.
"""

from __future__ import annotations

import base64
import dataclasses
import io
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from astropy.table import Table
from fastapi.testclient import TestClient
from PIL import Image

from app.cache.store import LiveResponse, ReadThroughCache
from app.context import make_context
from app.core.area import service
from app.core.area.config import AREA_SOURCE, DEFAULT_AREA_CONFIG, area_key, method_settings
from app.core.area.service import run_area
from app.core.card.validate import errors
from app.main import create_app
from app.settings import BACKEND_DIR
from scripts import area_discovery
from tests import area_consistency as ac
from tests.area_recorded import recorded_dots, recorded_frames, recorded_star_cones
from tests.conftest import make_settings
from tests.test_area_join import eros_dot_ids, run_recorded

PACK = BACKEND_DIR / "assets" / "areas"
EROS = "eros-2026-03"
SCHEMA = {
    "": "area-summary.schema.json",
    "/known": "area-known.schema.json",
    "/dots": "area-dots.schema.json",
    "/tracks": "area-tracks.schema.json",
}


def _client(cache: Path, **kw: Any) -> TestClient:
    return TestClient(create_app(make_settings(cache, **kw)))


@pytest.fixture
def client(fixture_cache: Path) -> TestClient:
    """Offline, the fixture cache and the committed pack."""
    return _client(fixture_cache)


def _get(client: TestClient, path: str) -> dict[str, Any]:
    r = client.get(path)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/json")
    body: dict[str, Any] = r.json()
    return body


def _replies(client: TestClient) -> dict[str, dict[str, Any]]:
    out = {}
    for suffix, schema in SCHEMA.items():
        body = _get(client, f"/v1/areas/{EROS}{suffix}")
        assert errors(body, schema) == [], suffix
        out[suffix or "summary"] = body
    return out


# --- contract -----------------------------------------------------------------------------------


def test_index_lists_the_precomputed_eros_area_offline(client: TestClient) -> None:
    index = _get(client, "/v1/areas")
    assert errors(index, "area-index.schema.json") == []
    assert [a["area_id"] for a in index["areas"]] == [EROS]
    entry = index["areas"][0]
    assert entry["n_visits"] == 2 and entry["n_frames"] == 18
    assert index["cached_at"] == entry["cached_at"] and index["computed_at"] == entry["computed_at"]
    ac.check_provenance_rules(index)


def test_every_reply_passes_its_schema_and_the_cross_reply_rules(client: TestClient) -> None:
    r = _replies(client)
    index = _get(client, "/v1/areas")["areas"][0]
    checks = service.checks_not_run(r["summary"])
    ac.check_area(r["summary"], r["/known"], r["/dots"], r["/tracks"], checks, index)


def test_the_served_eros_track_is_found_blind(client: TestClient) -> None:
    r = _replies(client)
    tracks = [t for t in r["/tracks"]["tracks"] if t["status"] == "track"]
    assert len(tracks) == 1
    t = tracks[0]
    assert t["verdict"] == "found_blind" and t["match"]["designation"] == "433 Eros"
    assert t["match"]["object_id"] == "sbdb-20000433" and t["linker"] == "pairs"
    assert {i for tl in t["tracklets"] for i in tl["dot_ids"]} == eros_dot_ids()
    steps = r["summary"]["steps"]
    assert (steps["n_tracks"], steps["n_found_blind"], steps["n_unexplained"]) == (1, 1, 0)
    assert "checks:not_run" in r["summary"]["missing"]
    assert "rate_grid:visits" in r["/tracks"]["missing"]
    # Wording: nothing in a reply calls a track a discovery (A16.5).
    text = json.dumps(r).lower()
    assert "discover" not in text and '"new"' not in text
    labels = {d["label"] for v in r["/dots"]["visits"] for d in v["dots"]}
    assert labels <= {"glitch", "star", "fixed", "mover"}


def test_no_checks_route(client: TestClient) -> None:
    """D4 and D5 are cut (Q-203 gate): /checks is not served."""
    r = client.get(f"/v1/areas/{EROS}/checks")
    assert r.status_code == 404 and r.json()["error"] == "not_found"


# --- errors -------------------------------------------------------------------------------------


def _error(r: Any, status: int, code: str) -> None:
    assert r.status_code == status, r.text
    body = r.json()
    assert body["error"] == code
    from app.core.card import validate

    v = validate._validators()["area-index.schema.json"]
    assert list(v.evolve(schema={"$ref": "area-index.schema.json#/definitions/AreaError"})
                .iter_errors(body)) == []  # fmt: skip


def test_unknown_area_is_404_area_not_found(client: TestClient) -> None:
    for path in ("", "/known", "/dots", "/tracks", "/export.ecsv", "/stamps/X_1:1.png"):
        _error(client.get(f"/v1/areas/nowhere{path}"), 404, "area_not_found")


def test_without_the_pack_eros_is_404_offline(fixture_cache: Path, tmp_path: Path) -> None:
    c = _client(fixture_cache, area_pack_dir=tmp_path / "no-pack")
    assert c.get("/v1/areas").json()["areas"] == []
    _error(c.get(f"/v1/areas/{EROS}"), 404, "area_not_found")


def test_unknown_dot_is_404_dot_not_found(client: TestClient) -> None:
    _error(
        client.get(f"/v1/areas/{EROS}/stamps/2026W12_2A_0158_1_D1:999.png"), 404, "dot_not_found"
    )


def test_stamps_are_served_offline_without_the_cutouts(tmp_path: Path) -> None:
    """A clean machine under SX_OFFLINE=1: the pack alone answers the stamps (Q-420 (11))."""
    c = _client(tmp_path / "empty-cache")
    dot = sorted(eros_dot_ids())[0]
    r = c.get(f"/v1/areas/{EROS}/stamps/{dot}.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_a_dot_without_a_stored_stamp_is_503(tmp_path: Path) -> None:
    pack = tmp_path / "pack"
    shutil.copytree(PACK, pack)
    root = ReadThroughCache(pack, offline=True)
    head = json.loads(root.get(service.head_key("spherex_qr2", EROS)).body)  # type: ignore[union-attr]
    key = area_key("spherex_qr2", EROS, "stamps", head["params_hash"])
    stamps = json.loads(root.get(key).body)  # type: ignore[union-attr]
    dot = sorted(eros_dot_ids())[0]
    del stamps[dot]
    root.put(key, LiveResponse(service.canonical(stamps), "test", 200, "application/json"))
    c = _client(tmp_path / "cache", area_pack_dir=pack)
    _error(c.get(f"/v1/areas/{EROS}/stamps/{dot}.png"), 503, "stamp_unavailable")


def test_the_head_names_the_settings_the_run_used(fixture_cache: Path, tmp_path: Path) -> None:
    """A run with non-default settings stores a head whose settings_sha is its own, so the API
    never serves it as the running code's (A17.10, PR #110 review)."""
    frames, bodies = recorded_frames()
    cfg = dataclasses.replace(DEFAULT_AREA_CONFIG, ambiguity_ratio=0.4)
    result = run_area(
        make_context(make_settings(fixture_cache)), frames, bodies, recorded_dots(), cfg,
        star_cones=recorded_star_cones(), inputs="recorded_eros_fixture",
    )  # fmt: skip
    pack = tmp_path / "pack"
    root = ReadThroughCache(pack, offline=True)
    service.store_area(root, result, service.prepare(result))
    head = json.loads(root.get(service.head_key("spherex_qr2", EROS)).body)  # type: ignore[union-attr]
    assert head["settings_sha"] == service.settings_sha(method_settings(cfg))
    assert head["settings_sha"] != service.settings_sha(method_settings(DEFAULT_AREA_CONFIG))
    c = _client(tmp_path / "cache", area_pack_dir=pack)
    _error(c.get(f"/v1/areas/{EROS}/tracks"), 404, "area_not_found")


def test_a_run_with_no_input_after_the_dots_step_is_dated_by_its_frame_cones(
    fixture_cache: Path,
) -> None:
    """Every star cone, vector, SkyBoT and Horizons call missed: the replies and the export are
    still built, dated by the frame cones the dots came from, never the wall clock (Q-420 (9))."""
    result = dataclasses.replace(run_recorded(fixture_cache), served=[])
    cones = result.frames.sia_fetched
    assert cones
    cached_at, computed_at = result.times()
    assert (cached_at, computed_at) == (cones[0], cones[-1])
    replies = service.build_replies(result)
    assert replies["summary"]["cached_at"] == cached_at
    assert service.export_ecsv(replies, result.params_hash()).startswith(b"# %ECSV 1.0")
    no_date = dataclasses.replace(result, frames=dataclasses.replace(result.frames, sia_fetched=()))
    with pytest.raises(ValueError, match="no date"):
        no_date.times()


# --- stamps and export --------------------------------------------------------------------------


def test_stamp_is_a_15_px_png_from_the_cutout(client: TestClient) -> None:
    dot = sorted(eros_dot_ids())[0]
    r = client.get(f"/v1/areas/{EROS}/stamps/{dot}.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (15, 15) and img.mode == "L"
    a = np.asarray(img)
    assert a[7, 7] == a.max() > 0  # Eros is the brightest pixel at the centre
    assert client.get(f"/v1/areas/{EROS}/stamps/{dot}.png").content == r.content


def test_the_stamps_stage_stores_raw_pixels_not_png(client: TestClient) -> None:
    """The stored stage holds each stamp's 225 raw uint8 pixels, so the pack is byte-identical
    on every platform (PNG bytes depend on the zlib build; PR #110 re-review). The served PNG
    decodes to exactly those pixels."""
    root = ReadThroughCache(PACK, offline=True)
    head = json.loads(root.get(service.head_key("spherex_qr2", EROS)).body)  # type: ignore[union-attr]
    key = area_key("spherex_qr2", EROS, "stamps", head["params_hash"])
    stamps = json.loads(root.get(key).body)  # type: ignore[union-attr]
    assert stamps and all(len(base64.b64decode(v)) == 15 * 15 for v in stamps.values())
    dot = sorted(eros_dot_ids())[0]
    stored = np.frombuffer(base64.b64decode(stamps[dot]), dtype=np.uint8).reshape(15, 15)
    r = client.get(f"/v1/areas/{EROS}/stamps/{dot}.png")
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(r.content))), stored)


def test_export_is_ecsv_with_tags_and_one_row_per_track_dot(client: TestClient) -> None:
    r = client.get(f"/v1/areas/{EROS}/export.ecsv")
    assert r.status_code == 200 and r.text.startswith("# %ECSV 1.0")
    t = Table.read(r.text, format="ascii.ecsv")
    tracks = _get(client, f"/v1/areas/{EROS}/tracks")["tracks"]
    n = sum(len(tl["dot_ids"]) for tr in tracks for tl in tr["tracklets"])
    assert len(t) == n
    cols = [c.name for c in service.EXPORT_COLUMNS]
    assert t.colnames == cols
    assert t.meta["column_tags"]["flux_ujy"] == "measured"
    assert t.meta["column_tags"]["ra_deg"] == "derived"
    assert "track_id" not in t.meta["column_tags"]
    assert t["flux_ujy"].unit == "uJy" and t["mjd_utc"].unit == "d"
    eros = t[t["verdict"] == "found_blind"]
    assert set(eros["match_designation"]) == {"433 Eros"} and len(eros) == 14
    assert all("OUTLIER" in f for f in eros["flags"])  # kept as a flag (Q-178, Q-139)
    assert set(t["status"]) <= {"track", "possible"}


# --- determinism and the committed pack (A17.10) ------------------------------------------------


def _tree(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_the_committed_pack_is_what_the_precompute_makes(tmp_path: Path) -> None:
    """Same recorded inputs and settings -> byte-identical entries (bodies and metas), so the
    committed pack can be checked and remade (``--recorded --pack``)."""
    out = tmp_path / "pack"
    code = area_discovery.main(
        ["--area", EROS, "--recorded", "--steps", "all", "--pack", str(out)],
        settings=make_settings(tmp_path / "unused"),
    )
    assert code == 0
    assert _tree(out) == _tree(PACK)


def test_two_runs_give_the_same_bytes(fixture_cache: Path, tmp_path: Path) -> None:
    a = service.prepare(run_recorded(fixture_cache))
    other = tmp_path / "again"
    shutil.copytree(fixture_cache, other)
    b = service.prepare(run_recorded(other))
    assert a.params_hash == b.params_hash and a.bodies == b.bodies


def test_the_pack_holds_every_stage_and_the_head(tmp_path: Path) -> None:
    """A17.10: ``summary``, ``known``, ``dots``, ``tracks``, ``export`` (and the internal
    ``stamps``), then the head that names the params_hash."""
    out = tmp_path / "pack"
    assert (
        area_discovery.main(
            ["--area", EROS, "--recorded", "--steps", "all", "--pack", str(out)],
            settings=make_settings(tmp_path / "unused"),
        )
        == 0
    )
    stages = set()
    for meta in (out / "v1" / AREA_SOURCE / "spherex_qr2").glob("*/*.json"):
        stages.add(json.loads(meta.read_text("utf-8"))["key"]["query"]["stage"])
    assert stages == {*service.STAGES, service.HEAD}


def test_steps_must_be_in_order(tmp_path: Path) -> None:
    s = make_settings(tmp_path)
    assert area_discovery.main(["--area", EROS, "--steps", "frames,labels"], settings=s) == 2
    assert area_discovery.main(["--area", EROS, "--record"], settings=s) == 2


def test_record_purge_keeps_the_committed_derived_fixtures(tmp_path: Path) -> None:
    """``--record`` removes only the ``derived.*`` files the run wrote, never the committed
    ``derived.object`` registry fixtures."""
    old = tmp_path / "v1" / "derived.object" / "-" / "ab" / "old.json"
    old.parent.mkdir(parents=True)
    old.write_text("{}")
    keep = area_discovery.derived_files(tmp_path)
    new = tmp_path / "v1" / "derived.area" / "spherex_qr2" / "cd" / "new.json"
    new.parent.mkdir(parents=True)
    new.write_text("{}")
    area_discovery.purge_derived(tmp_path, keep=keep)
    assert old.is_file() and not new.exists()
