from __future__ import annotations

import asyncio
import socket

import pytest

from app.adapters.http import Http, NetworkDisabled
from tests.conftest import NetworkBlocked, make_settings


def test_external_connect_is_blocked() -> None:
    with pytest.raises(NetworkBlocked):
        socket.getaddrinfo("irsa.ipac.caltech.edu", 443)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(NetworkBlocked):
            s.connect(("8.8.8.8", 53))
    finally:
        s.close()


def test_asyncio_loop_still_works() -> None:
    # Windows Proactor uses a loopback socket pair; the guard must allow it.
    async def answer() -> int:
        await asyncio.sleep(0)
        return 42

    assert asyncio.run(answer()) == 42


def test_http_client_refuses_when_offline(tmp_path) -> None:  # type: ignore[no-untyped-def]
    http = Http(make_settings(tmp_path, offline=True))
    with pytest.raises(NetworkDisabled):
        http.get("https://example.org/")
