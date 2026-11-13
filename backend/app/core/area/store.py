"""The read side of ``derived.area`` (A17.8, A17.10): keys, the index and ``AreaStore``.

Imported by ``app/api/areas.py``. Light on purpose: no pipeline module (frames, dots, labels,
join, known check) is imported, so serving never pulls in the area computation (A16.2: no
computing in a web request; ``test_app_api_never_imports_the_area_pipeline``).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.cache.keys import CacheKey
from app.cache.store import CacheEntry, ReadThroughCache
from app.context import Context
from app.core.area.config import (
    AREA_SOURCE,
    AREA_VERSION,
    DEFAULT_AREA_CONFIG,
    Setting,
    area_key,
    method_settings,
)
from app.core.card.validate import check

STAGES = ("summary", "known", "dots", "tracks", "export", "stamps")
HEAD = "head"
INDEX_FORMULA = (
    "the prepared derived.area entries whose settings match the running code and settings "
    "(A17.10); n_frames and n_visits counted from each summary"
)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def settings_sha(settings: Mapping[str, Setting]) -> str:
    return hashlib.sha256(canonical(dict(settings))).hexdigest()


def head_key(release: str, area_id: str) -> CacheKey:
    return CacheKey.make(AREA_SOURCE, release, id=area_id, v=AREA_VERSION, stage=HEAD)


def index_entry(summary: Mapping[str, Any]) -> dict[str, Any]:
    keys = (
        "area_id",
        "ra",
        "dec",
        "width_deg",
        "height_deg",
        "data_release",
        "n_frames",
        "n_visits",
        "computed_at",
        "cached_at",
    )
    return {k: summary[k] for k in keys}


def index_reply(entries: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    ordered = sorted(entries, key=lambda e: str(e["area_id"]))
    reply = {
        "areas": [dict(e) for e in ordered],
        "cached_at": min((str(e["cached_at"]) for e in ordered), default=None),
        "computed_at": max((str(e["computed_at"]) for e in ordered), default=None),
        "missing": [],
        "provenance": {
            "areas": {
                "tag": "derived",
                "source": "derived.area entries of the D-25 cache and the committed pack",
                "formula": INDEX_FORMULA,
            }
        },
    }
    check(reply, "area-index.schema.json")
    return reply


class AreaStore:
    """Reads ``derived.area`` entries: the D-25 cache first, then the committed pack, the
    running release first, then any other release present (Q-463). An entry whose settings
    differ from the running code is not served (A17.10)."""

    def __init__(self, ctx: Context, pack_dir: Path | None) -> None:
        self.ctx = ctx
        self.roots: list[ReadThroughCache] = [ctx.cache]
        if pack_dir is not None and pack_dir.is_dir():
            self.roots.append(ReadThroughCache(pack_dir, offline=True))
        self.sha = settings_sha(method_settings(DEFAULT_AREA_CONFIG))

    def _releases(self, root: ReadThroughCache) -> list[str]:
        """The running release first, then every other release with area entries in ``root``
        (Q-463: the QR2 Eros pack and DR1 live areas are served side by side)."""
        base = root.root / "v1" / AREA_SOURCE
        found = sorted(p.name for p in base.iterdir() if p.is_dir()) if base.is_dir() else []
        first = self.ctx.settings.data_release
        return [first, *(r for r in found if r != first)]

    def _head(self, root: ReadThroughCache, release: str, area_id: str) -> dict[str, Any] | None:
        entry = root.get(head_key(release, area_id))
        if entry is None:
            return None
        try:
            head = json.loads(entry.body)
        except ValueError:
            return None
        if not isinstance(head, dict) or head.get("settings_sha") != self.sha:
            return None
        return head

    def entry(self, area_id: str, stage: str) -> CacheEntry | None:
        for root in self.roots:
            for release in self._releases(root):
                head = self._head(root, release, area_id)
                if head is None:
                    continue
                got = root.get(area_key(release, area_id, stage, str(head["params_hash"])))
                if got is not None:
                    return got
        return None

    def area_ids(self) -> list[str]:
        ids: set[str] = set()
        for root in self.roots:
            for release in self._releases(root):
                base = root.root / "v1" / AREA_SOURCE / release
                for meta_path in sorted(base.glob("*/*.json")) if base.is_dir() else []:
                    try:
                        q = json.loads(meta_path.read_text(encoding="utf-8"))["key"]["query"]
                    except (OSError, ValueError, KeyError, TypeError):
                        continue
                    if q.get("stage") == HEAD and q.get("v") == AREA_VERSION:
                        ids.add(str(q["id"]))
        return sorted(i for i in ids if self.entry(i, "summary") is not None)

    def index(self) -> dict[str, Any]:
        out = []
        for area_id in self.area_ids():
            got = self.entry(area_id, "summary")
            if got is not None:
                out.append(index_entry(json.loads(got.body)))
        return index_reply(out)
