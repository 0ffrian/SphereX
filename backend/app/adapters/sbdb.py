"""JPL Small-Body Database lookup (A3.6)."""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.cache.keys import CacheKey, norm_name
from app.cache.store import LiveResponse, Served
from app.context import Context

SOURCE = "sbdb"


@dataclass(frozen=True)
class SbdbHit:
    spkid: str
    fullname: str
    shortname: str
    kind: str  # an, au, cn, cu (asteroid/comet, numbered/unnumbered)


@dataclass(frozen=True)
class SbdbAnswer:
    hit: SbdbHit | None
    ambiguous: bool


def sbdb_key(name: str) -> CacheKey:
    return CacheKey.make(SOURCE, None, sstr=norm_name(name), phys_par="1")


def parse(body: bytes) -> SbdbAnswer:
    doc = json.loads(body)
    obj = doc.get("object")
    if isinstance(obj, dict) and obj.get("spkid"):
        return SbdbAnswer(
            SbdbHit(
                spkid=str(obj["spkid"]),
                fullname=str(obj.get("fullname") or obj.get("des") or obj["spkid"]),
                shortname=str(obj.get("shortname") or obj.get("fullname") or obj["spkid"]),
                kind=str(obj.get("kind") or ""),
            ),
            ambiguous=False,
        )
    return SbdbAnswer(None, ambiguous="list" in doc)


def query(ctx: Context, name: str, *, refresh: bool = False) -> tuple[SbdbAnswer, Served]:
    def live() -> LiveResponse:
        # 300 = several matches, 404 = not found on some API versions; both are real answers.
        return ctx.http.get(
            ctx.settings.sbdb_url,
            {"sstr": norm_name(name), "phys-par": "1"},
            accept=frozenset({200, 300, 404}),
        )

    served = ctx.cache.fetch(sbdb_key(name), live, refresh=refresh)
    return parse(served.entry.body), served
