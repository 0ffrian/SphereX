"""Asset store for stage 4 (A4.4, A5.4, D-22).

A saved asset holds the ObjectCard, the RenderParams, the texture URLs, ``generator_version``,
``seed`` and ``created_at``. Two layers are read, in order:

1. **Pre-baked:** JSON files in the repo, ``<assets_dir>/<type>/<id>.json`` (A5.4). Read only.
2. **Generated:** assets this backend built and saved, kept as ``derived.asset`` entries in the
   D-25 cache. The key holds ``ASSET_VERSION``, the stage 7 ``GENERATOR_VERSION`` (which holds
   the baker's rules version) and the data release, so a rule or release change never serves a
   stale asset.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from app.cache.keys import CacheKey
from app.cache.store import LiveResponse, ReadThroughCache
from app.core.render.card_to_params import GENERATOR_VERSION

log = logging.getLogger("shift_spectrum")

ASSET_SOURCE = "derived.asset"
# Bump when stage 3, 5 or 7 rules change. 2: Layer.tier, formula and assumed (D-32, PR #44).
# 3 (issue #40): stage 3 types Eros as asteroid_shape from the shape registry (Q-61) and runs the
# exoplanet rule (Q-63); stage 5 fills phase_angle_deg and sun_vector from Horizons (Q-62).
# 4 (issue #62, Q-115..Q-117): stage 7 sends a different set of layers (gas giant bands, flattening,
# colour, storms and turbulence instead of surface; brown dwarf limb_darkening; procedural asteroid
# displacement and textures.relief_amp). CARD_TO_PARAMS_VERSION stays "1" so seeds are stable.
# 5 (issue #68 Part 0.1, Q-63): the exoplanet type rule is on, so archive planets are typed
# planet_rocky, planet_water or gas_giant instead of candidate.
# 6 (issue #26, Q-125): stage 1 finds frames for moving objects and stage 2 measures their
# spectrum; a card saved before had none (`frames:moving_object_search` was final). Stage 1 and 2
# changes count too.
ASSET_VERSION = "6"
AssetStatus = Literal["saved", "generated", "sketch"]
FIELDS = ("card", "render_params", "textures", "generator_version", "seed", "created_at")


@dataclass(frozen=True)
class Asset:
    card: dict[str, Any]
    render_params: dict[str, Any]
    textures: dict[str, str] | None
    generator_version: str
    seed: int
    created_at: str  # ISO-8601 UTC with Z

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, d: Any) -> Asset | None:
        if not isinstance(d, dict) or set(d) != set(FIELDS):
            return None
        if not isinstance(d["card"], dict) or not isinstance(d["render_params"], dict):
            return None
        if not isinstance(d["seed"], int) or not isinstance(d["generator_version"], str):
            return None
        return cls(**d)


def asset_key(object_id: str, release: str | None = None) -> CacheKey:
    return CacheKey.make(
        ASSET_SOURCE, release, id=object_id, v=ASSET_VERSION, generator=GENERATOR_VERSION
    )


def _matches(asset: Asset, object_id: str) -> bool:
    """The card and the render params both belong to ``object_id`` and agree on the type."""
    card, params = asset.card, asset.render_params
    return (
        card.get("id") == object_id
        and params.get("id") == object_id
        and card.get("type") == params.get("type")
    )


class AssetStore:
    def __init__(
        self, cache: ReadThroughCache, prebaked_dir: Path | None, release: str | None = None
    ) -> None:
        self.cache = cache
        self.prebaked_dir = prebaked_dir
        self.release = release

    def _prebaked(self, object_id: str) -> Asset | None:
        if self.prebaked_dir is None or not self.prebaked_dir.is_dir():
            return None
        name = quote(object_id, safe="") + ".json"
        for path in sorted(self.prebaked_dir.glob(f"*/{name}")):
            try:
                asset = Asset.from_json(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                asset = None
            if asset is None or not _matches(asset, object_id):
                log.warning("ignoring unreadable pre-baked asset %s", path)
                continue
            return asset
        return None

    def lookup(self, object_id: str) -> tuple[Asset, datetime | None] | None:
        """The saved asset and, for a generated one, when it was cached (None if pre-baked)."""
        asset = self._prebaked(object_id)
        if asset is not None:
            return asset, None
        entry = self.cache.get(asset_key(object_id, self.release))
        if entry is None:
            return None
        try:
            asset = Asset.from_json(json.loads(entry.body))
        except ValueError:
            return None
        if asset is None or not _matches(asset, object_id):
            return None
        return asset, entry.fetched_at

    def get(self, object_id: str) -> Asset | None:
        found = self.lookup(object_id)
        return found[0] if found is not None else None

    def put(self, asset: Asset) -> None:
        data = json.dumps(asset.to_json(), sort_keys=True, separators=(",", ":")).encode()
        self.cache.put(
            asset_key(str(asset.card["id"]), self.release),
            LiveResponse(data, "derived:asset", 200, "application/json"),
            if_changed=True,
        )
