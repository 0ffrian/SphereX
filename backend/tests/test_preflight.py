"""Issue #103: the warm-start block of /v1/health and the demo preflight script's exit code.
Offline on the recorded fixture cache; the autouse socket guard plays the unplugged cable."""

from __future__ import annotations

from pathlib import Path

import httpx
from fastapi.testclient import TestClient

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
    assert queries[: len(SEARCH_LIST)] == [r.query for r in SEARCH_LIST]  # search bar order
    assert "433 Eros" in queries  # the Track object, group "fixture"
    assert len(queries) == len(set(queries))
    assert "SIMP J013656.5+093347.3" in queries  # demo group, not in the search list


# --- exit code ----------------------------------------------------------------------------


def test_preflight_passes_on_a_cached_row(client: TestClient, capsys: object) -> None:
    assert preflight.run(client, [WISE]) == 0
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    for label in ("resolve", "card", "render-params", "frames", "spectrum", "cutout"):
        assert label in out
    assert "preflight: PASS" in out


def test_preflight_fails_on_a_cache_miss(client: TestClient, capsys: object) -> None:
    miss = preflight.Row("Nowhere", "No Such Object 103")
    assert preflight.run(client, [WISE, miss]) == 1
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
        if path.endswith("/frames"):
            return httpx.Response(200, json={"frames": []})
        return httpx.Response(200, json={})

    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.run(c, [WISE]) == 1
    out = capsys.readouterr().out  # type: ignore[attr-defined]
    assert "!! card" in out and "skipped: no frames" in out


def test_preflight_fails_when_backend_is_down(capsys: object) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.run(c, [WISE]) == 1


def test_wait_warm_fails_when_warm_start_is_off(client: TestClient) -> None:
    assert preflight.wait_warm(client, timeout_s=5, sleep=lambda _: None) is False
    assert preflight.run(client, [WISE], warm_timeout_s=5) == 1


def test_wait_warm_polls_until_finished() -> None:
    states = iter(["running", "running", "finished"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"warm": {"state": next(states)}})

    slept: list[float] = []
    with httpx.Client(base_url="http://sx", transport=httpx.MockTransport(handler)) as c:
        assert preflight.wait_warm(c, timeout_s=60, sleep=slept.append) is True
    assert len(slept) == 2
