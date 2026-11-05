from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.adapters.http import Http, UpstreamError
from tests.conftest import make_settings


def make_http(tmp_path: Path, handler, retries: int = 3):  # type: ignore[no-untyped-def]
    sleeps: list[float] = []
    http = Http(
        make_settings(tmp_path, offline=False, http_retries=retries, http_backoff_s=1.0),
        transport=httpx.MockTransport(handler),
        sleep=sleeps.append,
    )
    return http, sleeps


def test_retries_504_with_exponential_backoff(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(504) if len(calls) < 3 else httpx.Response(200, content=b"ok")

    http, sleeps = make_http(tmp_path, handler)
    resp = http.get("https://irsa.example/SIA")
    assert resp.body == b"ok" and resp.status == 200
    assert sleeps == [1.0, 2.0]


def test_timeout_is_retried_then_fails(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    http, sleeps = make_http(tmp_path, handler, retries=2)
    with pytest.raises(UpstreamError, match="timeout"):
        http.get("https://irsa.example/SIA")
    assert sleeps == [1.0, 2.0]


def test_400_is_not_retried(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(400)

    http, sleeps = make_http(tmp_path, handler)
    with pytest.raises(UpstreamError, match="HTTP 400"):
        http.get("https://irsa.example/SIA")
    assert calls == [1] and sleeps == []


def test_accepted_non_200_is_returned(tmp_path: Path) -> None:
    http, _ = make_http(tmp_path, lambda r: httpx.Response(204))
    assert http.get("https://x.example", accept=frozenset({200, 204})).status == 204


def test_connect_error_not_retried_when_asked(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ConnectError("unreachable", request=request)

    http, sleeps = make_http(tmp_path, handler)
    with pytest.raises(UpstreamError, match="connection failed"):
        http.get("https://simbad.example", retry_connect=False)
    assert calls == [1] and sleeps == []
