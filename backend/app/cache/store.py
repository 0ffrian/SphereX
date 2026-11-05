"""Read-through disk cache for every external call (D-25).

Order: cache -> live call (timeout, retries with backoff) -> older cached entry -> refuse.
No expiry. ``SX_OFFLINE=1`` never calls the live function.

Layout: ``<root>/v1/<source>/<release>/<sha[:2]>/<sha>.body`` (raw bytes) and ``<sha>.json``
(meta). The body is written first and the meta last, each through a temp file in the same
directory and ``os.replace``; the meta file is the commit marker.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from app.cache.keys import CacheKey
from app.timefmt import iso_utc_z, parse_utc, utc_now

LAYOUT_VERSION = "v1"


class CacheMissOffline(Exception):
    """Not cached, and SX_OFFLINE forbids the network."""


class UpstreamUnavailable(Exception):
    """The live call failed and there is no older cached entry."""


@dataclass(frozen=True)
class LiveResponse:
    body: bytes
    url: str
    status: int
    content_type: str
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CacheEntry:
    key: CacheKey
    body: bytes
    meta: dict[str, Any]

    @property
    def fetched_at(self) -> datetime:
        return parse_utc(str(self.meta["fetched_at"]))

    @property
    def status(self) -> int:
        return int(self.meta["status"])

    @property
    def url(self) -> str:
        return str(self.meta["url"])


@dataclass(frozen=True)
class Served:
    entry: CacheEntry
    from_cache: bool
    stale: bool = False


REPLACE_ATTEMPTS = 6
LOCK_STRIPES = 64


def _replace_with_retry(src: str, dst: Path) -> None:
    """``os.replace`` with retries: on Windows it raises PermissionError while another thread or
    process has ``dst`` open for reading."""
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(0.01 * 2**attempt)


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        _replace_with_retry(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class ReadThroughCache:
    def __init__(self, root: Path, *, offline: bool) -> None:
        self.root = Path(root)
        self.offline = offline
        # A fixed set of striped locks: bounded, whatever ids users send.
        self._locks = tuple(threading.Lock() for _ in range(LOCK_STRIPES))

    def _paths(self, key: CacheKey) -> tuple[Path, Path]:
        d = self.root / LAYOUT_VERSION / key.source / key.release / key.digest[:2]
        return d / f"{key.digest}.body", d / f"{key.digest}.json"

    def _lock(self, key: CacheKey) -> threading.Lock:
        return self._locks[int(key.digest[:8], 16) % LOCK_STRIPES]

    def get(self, key: CacheKey) -> CacheEntry | None:
        body_path, meta_path = self._paths(key)
        if not meta_path.is_file() or not body_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except ValueError:  # corrupt or truncated meta (incl. bad UTF-8): treat as a miss
            return None
        if not isinstance(meta, dict):
            return None
        body = body_path.read_bytes()
        if meta.get("body_sha256") != hashlib.sha256(body).hexdigest():
            return None  # torn or tampered entry: treat as a miss
        return CacheEntry(key, body, meta)

    def put(
        self,
        key: CacheKey,
        live: LiveResponse,
        fetched_at: datetime | None = None,
        *,
        if_changed: bool = False,
    ) -> CacheEntry:
        """Store an entry. ``if_changed`` keeps an existing entry with the same body untouched
        (no rewrite, so readers on other threads never race a replace)."""
        body_path, meta_path = self._paths(key)
        if if_changed:
            existing = self.get(key)
            if (
                existing is not None
                and existing.meta.get("body_sha256") == hashlib.sha256(live.body).hexdigest()
            ):
                return existing
        meta: dict[str, Any] = {
            "key": json.loads(key.canonical()),
            "url": live.url,
            "status": live.status,
            "content_type": live.content_type,
            "fetched_at": iso_utc_z(fetched_at or utc_now()),
            "body_sha256": hashlib.sha256(live.body).hexdigest(),
            "body_size": len(live.body),
            **live.extra,
        }
        _atomic_write(body_path, live.body)
        _atomic_write(meta_path, json.dumps(meta, indent=1, sort_keys=True).encode("utf-8"))
        return CacheEntry(key, live.body, meta)

    def delete(self, key: CacheKey) -> None:
        for p in self._paths(key):
            p.unlink(missing_ok=True)

    def fetch(
        self, key: CacheKey, live_fn: Callable[[], LiveResponse], *, refresh: bool = False
    ) -> Served:
        """D-25 order. ``live_fn`` raises on failure; any exception counts as a failed call."""
        existing = self.get(key)
        if existing is not None and not refresh:
            return Served(existing, from_cache=True)
        if self.offline:
            if existing is not None:
                return Served(existing, from_cache=True, stale=True)
            raise CacheMissOffline(f"{key.source} not cached and SX_OFFLINE is set")
        with self._lock(key):
            if not refresh:
                again = self.get(key)
                if again is not None:
                    return Served(again, from_cache=True)
            try:
                live = live_fn()
            except Exception as exc:
                if existing is not None:
                    return Served(existing, from_cache=True, stale=True)
                raise UpstreamUnavailable(f"{key.source}: {exc}") from exc
            return Served(self.put(key, live), from_cache=False)

    def iter_meta(self, source: str | None = None) -> Iterator[tuple[Path, dict[str, Any]]]:
        base = self.root / LAYOUT_VERSION
        pattern = f"{source}/*/*/*.json" if source else "*/*/*/*.json"
        for meta_path in sorted(base.glob(pattern)):
            yield meta_path, json.loads(meta_path.read_text(encoding="utf-8"))


def earliest_cached_at(served: list[Served]) -> datetime | None:
    """``cached_at`` = earliest ``fetched_at`` of the entries that came from the cache."""
    times = [s.entry.fetched_at for s in served if s.from_cache]
    return min(times) if times else None
