"""Asset store for stage 4 (A4.4, A5.4, D-22).

A saved asset holds the ObjectCard, the RenderParams, the texture URLs, ``generator_version``,
``seed`` and ``created_at``. Two layers are read, in order (issue #75):

1. **Generated:** assets this backend built and saved, kept as ``derived.asset`` entries in the
   D-25 cache. The key holds ``ASSET_VERSION``, the stage 7 ``GENERATOR_VERSION`` (which holds
   the baker's rules version) and the data release, so a rule or release change never serves a
   stale asset. Saved only from final inputs, so it carries the measured spectrum.
2. **Pre-baked:** JSON files in the repo, ``<assets_dir>/<type>/<id>.json`` (A5.4). Read only.
   The pack has no spectrum (Q-164 (3)); ``ObjectPipeline`` uses it only as a stand-in when a
   live build cannot measure one.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
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
# Bump when stage 3, 5 or 7 rules change. What each bump covers:
# 2 (D-32, PR #44): Layer.tier, formula and assumed.
# 3 (issue #40): stage 3 types Eros as asteroid_shape from the shape registry (Q-61) and runs the
#   exoplanet rule (Q-63); stage 5 fills phase_angle_deg and sun_vector from Horizons (Q-62).
# 4 (issue #62, Q-115..Q-117): stage 7 sends a different set of layers (gas giant bands, flattening,
#   colour, storms and turbulence instead of surface; brown dwarf limb_darkening; procedural
#   asteroid displacement and textures.relief_amp). CARD_TO_PARAMS_VERSION stays "1" so seeds are
#   stable.
# 5 (issue #68 Part 0.1, Q-63): the exoplanet type rule is on, so archive planets are typed
#   planet_rocky, planet_water or gas_giant instead of candidate.
# 6 (issue #68 Track A, Q-150..Q-154): the card gains mass, orbit and host-star fields; stars take
#   Teff, radius and Mira period from SIMBAD/Gaia/class table; 'Oumuamua takes literature values;
#   the binary brown dwarf's RenderParams gains `components`; the Horizons command for comets
#   changed.
# 7 (issue #68 review fixes, Q-167): Jupiter's radius is the equatorial 71,492 km (scale_m of
#   planets changes); the Horizons comet command is `CAP<JD` (Q-151); the Gaia match refuses a star
#   with no SIMBAD proper motion and the card source text gives the match separation (Q-152);
#   Eps Ind B's literature citation text changed (Q-153).
# 8 (issue #68, Q-168): a planet below the giant cut takes radius_rjup from
#   pl_rade x R_earth / R_Jup instead of the rounded pl_radj (Kepler-186 f becomes tidally locked
#   in the frontend rule);
#   Bennu is asteroid_shape from its registered mesh (Q-163).
# 9 (issue #26, Q-125, merged after 8; PR #70 review): stage 1 finds frames for moving objects and
#   stage 2 measures their spectrum (a card saved before had none: `frames:moving_object_search`
#   was final); the comet path search uses `CAP<JD` (Q-167); a Mira period that is a median of
#   several SIMBAD rows is `derived` (Q-152). Stage 1 and 2 changes count too.
# 10 (issue #71 stream A, Q-210): procedural asteroids bake a physics-based height field (shape
#   from strength against gravity, crater population by coverage, boulders by structure), so
#   textures, `relief_amp` and the relief and displacement layer text change.
# 11 (issue #71 review): crater depth 0.33 r (Pike d/D), rubble-pile relief limited by the angle
#   of repose instead of strength, the reachable crater cap in relief_range (relief_amp), the relief
#   layer text; Procyon A takes its interferometric radius from the literature registry.
ASSET_VERSION = "11"
AssetStatus = Literal["saved", "generated", "sketch"]
FIELDS = ("card", "render_params", "textures", "generator_version", "seed", "created_at")
OPTIONAL_FIELDS = ("asset_version", "inputs_sha256")


@dataclass(frozen=True)
class Asset:
    card: dict[str, Any]
    render_params: dict[str, Any]
    textures: dict[str, str] | None
    generator_version: str
    seed: int
    created_at: str  # ISO-8601 UTC with Z
    # Pre-built pack only (Q-167): the ASSET_VERSION and the hash of the reviewed inputs
    # (literature, dwarf Teff table, shape registry) the asset was baked with. Absent from
    # generated assets.
    asset_version: str | None = None
    inputs_sha256: str | None = None

    def to_json(self) -> dict[str, Any]:
        d = asdict(self)
        for k in OPTIONAL_FIELDS:
            if d[k] is None:
                del d[k]
        return d

    @classmethod
    def from_json(cls, d: Any) -> Asset | None:
        if not isinstance(d, dict) or not set(FIELDS) <= set(d) <= {*FIELDS, *OPTIONAL_FIELDS}:
            return None
        if any(d.get(k) is not None and not isinstance(d[k], str) for k in OPTIONAL_FIELDS):
            return None
        if not isinstance(d["card"], dict) or not isinstance(d["render_params"], dict):
            return None
        if not isinstance(d["seed"], int) or not isinstance(d["generator_version"], str):
            return None
        return cls(**d)


@dataclass(frozen=True)
class Found:
    """One layer's asset. ``prebuilt``: from the repo pack, not the D-25 cache (issue #75)."""

    asset: Asset
    cached_at: datetime | None
    prebuilt: bool


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
            if asset.asset_version != ASSET_VERSION:
                # A pack baked with other rules must never be served as `saved` (Q-167).
                log.warning(
                    "ignoring stale pre-baked asset %s: asset_version %r, this code is %r",
                    path,
                    asset.asset_version,
                    ASSET_VERSION,
                )
                continue
            return asset
        return None

    def prebaked(self, object_id: str) -> Asset | None:
        """The pre-built pack's asset for ``object_id`` with this ``ASSET_VERSION``, or None."""
        return self._prebaked(object_id)

    def layers(self, object_id: str) -> Iterator[Found]:
        """Every readable asset for ``object_id``, best first: the generated one, then the
        pre-built one (issue #75). A generated asset is saved only from final inputs, so it
        holds the measured spectrum, which the pack never has (Q-164 (3)). Lazy: the pack is
        read only when the caller asks for the next layer (e.g. the generated one failed the
        contract check)."""
        generated = self._generated(object_id)
        if generated is not None:
            yield Found(generated[0], generated[1], prebuilt=False)
        asset = self._prebaked(object_id)
        if asset is not None:
            yield Found(asset, None, prebuilt=True)

    def lookup(self, object_id: str) -> tuple[Asset, datetime | None] | None:
        """The best asset and, for a generated one, when it was cached (None if pre-built)."""
        found = next(self.layers(object_id), None)
        return (found.asset, found.cached_at) if found is not None else None

    def _generated(self, object_id: str) -> tuple[Asset, datetime] | None:
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
