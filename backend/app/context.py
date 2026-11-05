"""Settings + cache + HTTP client, shared by the API, the adapters and the scripts."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.adapters.http import Http
from app.cache.store import ReadThroughCache
from app.offline import configure_libraries
from app.settings import Settings


@dataclass
class Context:
    settings: Settings
    cache: ReadThroughCache
    http: Http


def make_context(settings: Settings, *, transport: httpx.BaseTransport | None = None) -> Context:
    configure_libraries(settings)
    return Context(
        settings=settings,
        cache=ReadThroughCache(settings.cache_dir, offline=settings.offline),
        http=Http(settings, transport=transport),
    )
