"""Issue #103: the warm-start block of /v1/health and the demo preflight script's exit code.
Offline on the recorded fixture cache; the autouse socket guard plays the unplugged cable."""

from __future__ import annotations

import shutil
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.render import background, card_to_params
from app.main import create_app
from app.settings import Settings
from scripts import preflight
from scripts.bake_demo_pack import SEARCH_LIST
from tests.conftest import make_settings

WISE = preflight.Row("WISE 0855", "WISE J085510.83-071442.5")


def _targets(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "targets.toml"
    path.write_text(body, encoding="utf-8")
    return path


# --- /v1/health ---------------------------------------------------------------------------


def test_health_reports_warm_start_off_by_default(client: TestClient) -> None:
    body = client.get("/v1/health").json()
    assert body["status"] == "ok" and body["offline"] is True
    assert body["warm"] == {"state": "off", "total": 0, "done": 0, "failed": 0}


def test_health_reports_warm_start_finished(fixture_cache: Path, tmp_path: Path) -> None:
    targets = _targets(
        tmp_path,
        '[[target]]\nname = "WISE 0855"\nquery = "WISE J085510.83-071442.5"\ngroup = "demo"\n'
        '[[target]]\nname = "Nowhere"\nquery = "No Such Object 103"\ngroup = "demo"\n'
        '[[target]]\nname = "R Draconis"\nquery = "R Dra"\ngroup = "test"\n',
    )
    settings = make_settings(fixture_cache, prefetch_on_start=True, targets_file=targets)
    with TestClient(create_app(settings)) as client:
        warm = client.app.state.warm  # type: ignore[attr-defined]
        warm.join(timeout=60)
        assert client.get("/v1/health").json()["warm"] == {
            "state": "finished",
            "total": 2,  # demo group only
            "done": 1,
            "failed": 1,  # not in the cache: a miss offline, counted, not hidden
        }


def test_health_reports_warm_start_running_then_stopped(
    fixture_cache: Path, tmp_path: Path
) -> None:
    from app.core.warm import WarmCache

    settings = make_settings(fixture_cache)
    with TestClient(create_app(settings)) as client:
        app = client.app
        warm = WarmCache(app.state.ctx, app.state.pipeline, app.state.aliases, ["x"])  # type: ignore[attr-defined]
        assert warm.state == "idle"
        warm._thread = object()  # type: ignore[assignment]  # started, not finished
        app.state.warm = warm  # type: ignore[attr-defined]
        assert client.get("/v1/health").json()["warm"]["state"] == "running"
        warm.stop()
        assert client.get("/v1/health").json()["warm"]["state"] == "stopped"
        app.state.warm = None  # type: ignore[attr-defined]


# --- row list -----------------------------------------------------------------------------


def test_rows_come_from_search_list_and_targets_toml() -> None:
    rows = preflight.demo_rows(Settings().targets_file)
    queries = [r.query for r in rows]
    no_frames = {r.query for r in rows if not r.frames}
    assert no_frames == {"TRAPPIST-1 e", "K2-18 b"}  # targets.toml frames = false
    assert queries[: len(SEARCH_LIST)] == [r.query for r in SEARCH_LIST]  # search bar order
    assert "433 Eros" in queries  # the Track object, group "fixture"
    assert len(queries) == len(set(queries))
    assert "SIMP J013656.5+093347.3" in queries  # demo group, not in the search list


# --- exit code ----------------------------------------------------------------------------


def test_preflight_passes_on_a_cached_row(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Bake small (as the warm start does at full size) so the texture the params name exists.
    monkeypatch.setattr(background, "SIZES", ((64, 32),))
    monkeypatch.setattr(card_to_params, "TEXTURE_WIDTH", 64)  # the size the params' URLs name
    monkeypatch.setattr(card_to_params, "TEXTURE_HEIGHT", 32)
    settings = make_settings(fixture_cache, bake_textures=True, bake_workers=0)
    with TestClient(create_app(settings)) as client:
        # Cold: nothing baked yet. The params name the texture at once and the bake lands in the
        # background; the preflight's 404 retry waits for it (PR #105 review).
        assert preflight.run(client, [WISE]) == 0
    out = capsys.readouterr().out
    for label in ("resolve", "card", "render-params", "texture", "frames", "spectrum", "cutout"):
        assert label in out
    assert "preflight: PASS" in out


def test_preflight_fails_on_a_cache_miss(client: TestClient, capsys: object) -> None:
    miss = preflight.Row("Nowhere", "No Such Object 103")
    assert preflight.run(client, [WISE, miss], texture_wait_s=0) == 1
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "FAIL Nowhere" in out and "503" in out and "offline_cache_miss" in out


def test_preflight_fails_on_a_5xx_after_resolve(capsys: object) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/health":
            return httpx.Response(200, json={"status": "ok", "warm": {"state": "off"}})
        if path == "/v1/resolve":
            return httpx.Response(200, json={"id": "x"})
        if path.endswith("/card"):
            return httpx.Response(500, json={"error": "internal", "detail": "boom"})
        if path.endswith("/render-params"):
            return httpx.Response(200, json={}, headers={"X-SX-Measuring": "measuring:frames"})
        if path.endswith("/frames"):
            return httpx.Response(200, json={"frames": []})
        return httpx.Response(200, json={})

    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.run(c, [WISE]) == 1
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "!! card" in out and "skipped: no frames" in out
    assert "warning: still measuring (measuring:frames)" in out  # a warning, not a failure


def test_preflight_fails_when_backend_is_down(capsys: object) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.run(c, [WISE]) == 1


def test_wait_warm_fails_when_warm_start_is_off(client: TestClient) -> None:
    assert preflight.wait_warm(client, timeout_s=5, sleep=lambda _: None) is False
    assert preflight.run(client, [WISE], warm_timeout_s=5, texture_wait_s=0) == 1


def test_wait_warm_polls_until_finished() -> None:
    states = iter(["running", "running", "finished"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"warm": {"state": next(states)}})

    slept: list[float] = []
    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.wait_warm(c, timeout_s=60, sleep=slept.append) is True
    assert len(slept) == 2


# --- review fixes (PR #105) ---------------------------------------------------------------


def test_preflight_passes_frames_false_rows_on_the_fixture_cache(
    client: TestClient, capsys: object
) -> None:
    """TRAPPIST-1 e and K2-18 b have no frame list in the cache by design; /frames and /spectrum
    would answer 503 offline, so they are skipped, and the row passes."""
    rows = [r for r in preflight.demo_rows(Settings().targets_file) if not r.frames]
    assert len(rows) == 2
    assert preflight.run(client, rows, texture_wait_s=0) == 0
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert out.count(preflight.SKIPPED_NO_FRAMES) == 6  # frames, spectrum, cutout per row
    assert "preflight: PASS" in out


def _mock(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        for suffix, resp in routes.items():
            if path.endswith(suffix):
                return resp
        return httpx.Response(200, json={})

    return httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler))


def test_preflight_fetches_one_texture(capsys: object) -> None:
    textures = {"albedo": "/data/textures/x/albedo.webp", "height": "/h.png", "normal": "/n.png"}
    ok = {
        "/v1/health": httpx.Response(200, json={"warm": {"state": "off"}}),
        "/v1/resolve": httpx.Response(200, json={"id": "x"}),
        "/render-params": httpx.Response(200, json={"textures": textures}),
        "/frames": httpx.Response(200, json={"frames": []}),
    }
    with _mock({**ok, "albedo.webp": httpx.Response(200, content=b"RIFF")}) as c:
        assert preflight.run(c, [WISE]) == 0
    slept: list[float] = []
    with _mock({**ok, "albedo.webp": httpx.Response(404, json={"detail": "Not Found"})}) as c:
        assert preflight.run(c, [WISE], texture_wait_s=10, sleep=slept.append) == 1  # never landed
    assert len(slept) == 5  # 10 s at the 2 s poll, then it gives up
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "!! texture" in out and "still 404 after 10 s" in out


def test_preflight_texture_404_is_retried_until_the_bake_lands(
    capsys: pytest.CaptureFixture[str],
) -> None:
    textures = {"albedo": "/data/textures/x/albedo.webp", "height": "/h.png", "normal": "/n.png"}
    answers = iter([404, 404, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("albedo.webp"):
            code = next(answers)
            return httpx.Response(code, content=b"RIFF" if code == 200 else b"{}")
        if path == "/v1/resolve":
            return httpx.Response(200, json={"id": "x"})
        if path.endswith("/render-params"):
            return httpx.Response(200, json={"textures": textures})
        if path.endswith("/frames"):
            return httpx.Response(200, json={"frames": []})
        return httpx.Response(200, json={"warm": {"state": "off"}})

    slept: list[float] = []
    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.run(c, [WISE], sleep=slept.append) == 0
    assert len(slept) == 2
    assert "bake landed, 3 tries" in capsys.readouterr().out


def test_preflight_fails_on_a_bad_200_without_crashing(capsys: object) -> None:
    health = {"/v1/health": httpx.Response(200, json={"warm": {"state": "off"}})}
    with _mock({**health, "/v1/resolve": httpx.Response(200, text="<html>")}) as c:
        assert preflight.run(c, [WISE]) == 1
    with _mock({**health, "/v1/resolve": httpx.Response(200, json={"name": "no id"})}) as c:
        assert preflight.run(c, [WISE]) == 1
    frames_bad = {
        **health,
        "/v1/resolve": httpx.Response(200, json={"id": "x"}),
        "/frames": httpx.Response(200, json={"frames": [{"frame_id": "f"}]}),
    }
    with _mock(frames_bad) as c:
        assert preflight.run(c, [WISE]) == 1
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "200 but not a JSON object" in out and "200 without an id" in out
    assert "frame without a cutout_url" in out


class _NoJobs:
    def ensure_job(self, obj: object) -> object:
        raise RuntimeError("pool closed")


def test_warm_start_finishes_when_a_job_cannot_start(offline_settings: Settings) -> None:
    """ensure_job raising must not kill the thread: health would say running for ever."""
    from app.context import make_context
    from app.core.find.resolver import load_aliases
    from app.core.warm import WarmCache

    ctx = make_context(offline_settings)
    aliases = load_aliases(offline_settings.targets_file)
    warm = WarmCache(ctx, _NoJobs(), aliases, [WISE.query])  # type: ignore[arg-type]
    warm.start()
    warm.join(timeout=30)
    assert warm.status() == {"state": "finished", "total": 1, "done": 0, "failed": 1}
    assert warm.failed == [WISE.query]


def _run_smoke(
    cache: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, targets_toml: str
) -> int:
    from scripts import smoke_offline

    monkeypatch.setenv("SX_CACHE_DIR", str(cache))
    monkeypatch.setenv("SX_TARGETS_FILE", str(_targets(tmp_path, targets_toml)))
    monkeypatch.setenv("SX_ASSETS_DIR", str(cache / "no-prebaked-assets"))
    monkeypatch.setenv("SX_BAKE_TEXTURES", "0")
    monkeypatch.setattr(smoke_offline, "block_network", lambda: None)
    return smoke_offline.main(["--group", "demo"])


TRAPPIST_E = (
    '[[target]]\nname = "TRAPPIST-1 e"\nquery = "TRAPPIST-1 e"\ngroup = "demo"\nframes = false\n'
)


def test_smoke_offline_skips_frames_only_for_frames_false(
    fixture_cache: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert _run_smoke(fixture_cache, tmp_path, monkeypatch, TRAPPIST_E) == 0
    out = capsys.readouterr().out
    assert "OK   TRAPPIST-1 e" in out and "frames=skipped" in out


def test_smoke_offline_still_fails_a_frames_false_archive_gap(
    fixture_cache: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Skipping /frames must not skip the gap check: a lost Exoplanet Archive answer is exactly
    what matters for a catalogue-only exoplanet (PR #105 review)."""
    shutil.rmtree(fixture_cache / "v1" / "exoplanet_archive")
    assert _run_smoke(fixture_cache, tmp_path, monkeypatch, TRAPPIST_E) == 1
    out = capsys.readouterr().out
    assert "FAIL TRAPPIST-1 e" in out and "exoplanet_archive" in out
