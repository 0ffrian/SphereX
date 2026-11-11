"""Helpers to read recorded cache entries (the fixtures are plain D-25 cache entries)."""

from __future__ import annotations

import json
import struct
import zlib
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


# --- PNG structure helpers (Q-204): stdlib only, so tests can build and damage PNGs ------------

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_split(png: bytes) -> list[tuple[bytes, bytes]]:
    """(type, body) of every chunk of a well-formed PNG."""
    assert png[:8] == PNG_SIGNATURE
    i, out = 8, []
    while i < len(png):
        (n,) = struct.unpack(">I", png[i : i + 4])
        out.append((png[i + 4 : i + 8], png[i + 8 : i + 8 + n]))
        i += 12 + n
    return out


def png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def png_join(chunks: list[tuple[bytes, bytes]]) -> bytes:
    return PNG_SIGNATURE + b"".join(png_chunk(k, b) for k, b in chunks)


def png_redeflate(png: bytes, level: int = 1, parts: int = 2) -> bytes:
    """The same PNG with its image data deflated by the stdlib and split into ``parts`` IDATs."""
    chunks = png_split(png)
    raw = zlib.decompress(b"".join(b for k, b in chunks if k == b"IDAT"))
    packed = zlib.compress(raw, level)
    step = -(-len(packed) // parts)
    idats = [(b"IDAT", packed[i : i + step]) for i in range(0, len(packed), step)]
    head = [c for c in chunks if c[0] not in (b"IDAT", b"IEND")]
    return png_join([*head, *idats, (b"IEND", b"")])


def png_with_chunk(png: bytes, kind: bytes, body: bytes, before: bytes) -> bytes:
    """``png`` with one more chunk placed just before the first chunk of type ``before``."""
    chunks = png_split(png)
    at = next(i for i, (k, _) in enumerate(chunks) if k == before)
    return png_join([*chunks[:at], (kind, body), *chunks[at:]])


def png_gray(width: int, height: int, filters: list[int], pixels: bytes, level: int = 9) -> bytes:
    """An 8-bit grey PNG built by hand. ``filters`` has one type per row: 0 None or 1 Sub."""
    rows = []
    for y, ftype in enumerate(filters):
        row = pixels[y * width : (y + 1) * width]
        if ftype == 1:
            row = bytes((row[x] - (row[x - 1] if x else 0)) & 255 for x in range(width))
        rows.append(bytes([ftype]) + row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return png_join(
        [(b"IHDR", ihdr), (b"IDAT", zlib.compress(b"".join(rows), level)), (b"IEND", b"")]
    )
