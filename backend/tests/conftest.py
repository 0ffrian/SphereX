"""Test setup: no network, ever (A12, D-25).

- An autouse guard blocks every socket connection and DNS lookup that is not loopback. Loopback
  stays open because asyncio on Windows (Proactor) uses a loopback socket pair internally.
- ``fixture_cache`` copies the recorded cache entries into a temp dir and removes any
  ``derived.*`` entries, so tests run the real SIA -> cutout -> WCS path.
"""

from __future__ import annotations

import ipaddress
import shutil
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import BACKEND_DIR, Settings

FIXTURES = Path(__file__).parent / "fixtures"
FIXTURE_CACHE = FIXTURES / "cache"
TARGETS_FILE = BACKEND_DIR / "targets.toml"
FIXTURE_CUTOUT_SIZE_ARCSEC = 360.0


class NetworkBlocked(RuntimeError):
    pass


def _is_loopback(host: Any) -> bool:
    if host is None:
        return True
    if isinstance(host, bytes):
        host = host.decode()
    h = str(host).strip("[]")
    if h in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(h.split("%")[0]).is_loopback
    except ValueError:
        return False


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def _check(address: Any) -> None:
        if isinstance(address, tuple) and not _is_loopback(address[0]):
            raise NetworkBlocked(f"test tried to reach {address!r}")

    def connect(self: socket.socket, address: Any) -> None:
        _check(address)
        return real_connect(self, address)

    def connect_ex(self: socket.socket, address: Any) -> int:
        _check(address)
        return real_connect_ex(self, address)

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not _is_loopback(host):
            raise NetworkBlocked(f"test tried to resolve {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


def purge_derived(root: Path) -> None:
    for d in (root / "v1").glob("derived.*"):
        shutil.rmtree(d)


@pytest.fixture
def fixture_cache(tmp_path: Path) -> Path:
    dst = tmp_path / "cache"
    shutil.copytree(FIXTURE_CACHE, dst)
    purge_derived(dst)
    return dst


def make_settings(cache_dir: Path, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "offline": True,
        "cache_dir": cache_dir,
        "targets_file": TARGETS_FILE,
        "cutout_size_arcsec": FIXTURE_CUTOUT_SIZE_ARCSEC,
        "http_retries": 0,
        "cors_origins": "",
        # Issue #41: measure in-thread and bake nothing in the background, unless a test asks.
        "measure_workers": 0,
        "bake_textures": False,
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def offline_settings(fixture_cache: Path) -> Settings:
    return make_settings(fixture_cache)


@pytest.fixture
def client(offline_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(offline_settings)) as c:
        yield c
