"""Helpers to read recorded cache entries (the fixtures are plain D-25 cache entries)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import FIXTURE_CACHE


def resolve_id(client: TestClient, q: str) -> str:
    """``/v1/resolve`` for ``q``; the object id."""
    r = client.get("/v1/resolve", params={"q": q})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def entries(source: str, root: Path = FIXTURE_CACHE) -> list[tuple[dict[str, Any], bytes]]:
    out = []
    for meta_path in sorted((root / "v1" / source).glob("*/*/*.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        out.append((meta, meta_path.with_suffix(".body").read_bytes()))
    return out


def entry(source: str, **query: str) -> tuple[dict[str, Any], bytes]:
    """The recorded entry whose key query is exactly ``query``; failing that, the first that
    contains it (a key with extra parts, such as the SIMBAD ``table`` of issue #68)."""
    found = entries(source)
    for meta, body in found:
        if meta["key"]["query"] == query:
            return meta, body
    for meta, body in found:
        q = meta["key"]["query"]
        if all(q.get(k) == v for k, v in query.items()):
            return meta, body
    raise LookupError(f"no recorded {source} entry for {query}")
