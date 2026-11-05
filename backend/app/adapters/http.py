"""Shared HTTP client: timeout, retries with exponential backoff, hard stop when offline (D-25)."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping

import httpx

from app.cache.store import LiveResponse
from app.settings import Settings

RETRY_STATUS = frozenset({429, 502, 503, 504})
USER_AGENT = "ShiftSpectrum/0.1 (NASA Space Apps 2026)"


class NetworkDisabled(RuntimeError):
    """SX_OFFLINE=1: the network must never be touched."""


class UpstreamError(RuntimeError):
    """The live call failed (timeout, connection, unexpected status or bad body)."""


class Http:
    """Lazy ``httpx.Client``. Creating it while offline raises ``NetworkDisabled``."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._sleep = sleep
        self._client: httpx.Client | None = None
        self._lock = threading.Lock()

    def _ensure(self) -> httpx.Client:
        if self._settings.offline:
            raise NetworkDisabled("SX_OFFLINE=1: refusing to open a network connection")
        with self._lock:
            if self._client is None:
                s = self._settings
                self._client = httpx.Client(
                    timeout=httpx.Timeout(s.http_read_timeout_s, connect=s.http_connect_timeout_s),
                    transport=self._transport,
                    headers={"User-Agent": USER_AGENT},
                    follow_redirects=True,
                )
            return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def get(
        self,
        url: str,
        params: Mapping[str, str] | None = None,
        *,
        accept: frozenset[int] = frozenset({200}),
        read_timeout_s: float | None = None,
        retry_connect: bool = True,
    ) -> LiveResponse:
        """GET with retries. Returns only when the status is in ``accept``.

        ``retry_connect=False`` gives up at once on a connection failure, so a caller with
        another mirror can move on.
        """
        client = self._ensure()
        s = self._settings
        timeout = (
            httpx.Timeout(read_timeout_s, connect=s.http_connect_timeout_s)
            if read_timeout_s is not None
            else None
        )
        attempts = 1 + max(0, s.http_retries)
        last = "no attempt"
        for attempt in range(attempts):
            if attempt:
                self._sleep(s.http_backoff_s * 2 ** (attempt - 1))
            try:
                if timeout is not None:
                    resp = client.get(url, params=params, timeout=timeout)
                else:
                    resp = client.get(url, params=params)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                last = f"connection failed: {exc!r}"
                if not retry_connect:
                    break
                continue
            except httpx.TimeoutException as exc:
                last = f"timeout: {exc!r}"
                continue
            except httpx.TransportError as exc:
                last = f"transport error: {exc!r}"
                continue
            if resp.status_code in accept:
                return LiveResponse(
                    body=resp.content,
                    url=str(resp.url),
                    status=resp.status_code,
                    content_type=resp.headers.get("content-type", ""),
                )
            last = f"HTTP {resp.status_code}"
            if resp.status_code not in RETRY_STATUS:
                break
        raise UpstreamError(f"{url}: {last}")
