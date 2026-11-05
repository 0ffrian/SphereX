"""The D-25 order: cache -> live -> older entry -> refuse; offline never calls live."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.cache.keys import CacheKey
from app.cache.store import (
    CacheMissOffline,
    LiveResponse,
    ReadThroughCache,
    UpstreamUnavailable,
    earliest_cached_at,
)
from app.timefmt import parse_utc

KEY = CacheKey.make("test_source", "spherex_qr2", q="x")


def live_ok(body: bytes = b"hello") -> LiveResponse:
    return LiveResponse(body, "https://example.org/x", 200, "text/plain", {"extra": 1})


def boom() -> LiveResponse:
    raise RuntimeError("504")


def test_miss_then_live_then_hit(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=False)
    calls: list[int] = []

    def live() -> LiveResponse:
        calls.append(1)
        return live_ok()

    first = cache.fetch(KEY, live)
    assert not first.from_cache and first.entry.body == b"hello"
    assert first.entry.meta["url"] == "https://example.org/x"
    assert first.entry.meta["extra"] == 1
    assert first.entry.meta["fetched_at"].endswith("Z")
    second = cache.fetch(KEY, live)
    assert second.from_cache and not second.stale
    assert calls == [1]


def test_offline_miss_never_calls_live(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=True)

    def live() -> LiveResponse:
        raise AssertionError("live call in offline mode")

    with pytest.raises(CacheMissOffline):
        cache.fetch(KEY, live)


def test_offline_hit_is_served(tmp_path: Path) -> None:
    ReadThroughCache(tmp_path, offline=False).fetch(KEY, live_ok)
    served = ReadThroughCache(tmp_path, offline=True).fetch(KEY, boom)
    assert served.from_cache and served.entry.body == b"hello"


def test_refresh_failure_falls_back_to_older_entry(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=False)
    cache.fetch(KEY, live_ok)
    served = cache.fetch(KEY, boom, refresh=True)
    assert served.stale and served.from_cache and served.entry.body == b"hello"


def test_failure_without_entry_refuses(tmp_path: Path) -> None:
    with pytest.raises(UpstreamUnavailable):
        ReadThroughCache(tmp_path, offline=False).fetch(KEY, boom)
    assert ReadThroughCache(tmp_path, offline=False).get(KEY) is None  # failures not cached


def test_entry_without_meta_is_invisible(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=False)
    cache.fetch(KEY, live_ok)
    body_path, meta_path = cache._paths(KEY)
    meta_path.unlink()
    assert cache.get(KEY) is None
    assert body_path.exists()


def test_corrupt_body_is_a_miss(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=False)
    cache.fetch(KEY, live_ok)
    body_path, _ = cache._paths(KEY)
    body_path.write_bytes(b"torn")
    assert cache.get(KEY) is None


def test_no_temp_files_left(tmp_path: Path) -> None:
    ReadThroughCache(tmp_path, offline=False).fetch(KEY, live_ok)
    assert not list(tmp_path.rglob("*.tmp"))


def test_earliest_cached_at_only_counts_cache_hits(tmp_path: Path) -> None:
    cache = ReadThroughCache(tmp_path, offline=False)
    k2 = CacheKey.make("test_source", None, q="y")
    cache.put(KEY, live_ok(), fetched_at=parse_utc("2026-11-01T00:00:00Z"))
    hit = cache.fetch(KEY, live_ok)
    fresh = cache.fetch(k2, live_ok)
    assert earliest_cached_at([hit, fresh]) == parse_utc("2026-11-01T00:00:00Z")
    assert earliest_cached_at([fresh]) is None
