"""``track_available`` for a Known object (A17.5 step 4, A19.12): read the D-25 cache, never ask.

Track can open an object when its frame list, its path and its spectrum are final in the cache
for its ``object_id``. The keys are the ones the endpoints read: ``frames.object_frames_key``
(``/frames``), ``horizons.range_key`` over ``moving.range_chunks`` (``/path``, as
``path.build_path`` and the path search build them) and ``spectrum.cached_spectrum_key``
(``/spectrum``). "Final" means:

- **frames:** the stored list is complete (``frames.is_complete``) and holds at least one frame;
- **path:** every Horizons range answer of the path search is cached, with an ephemeris block;
- **spectrum:** the entry for that frame list is cached, under the API's measure settings with
  the mover rule of ``config_for`` (Q-139). The spectrum is stored only for a complete list
  whose every cutout is cached, so a hit is final.

Every read goes through an offline view of the cache (``offline=True`` on both the cache and the
settings), so a miss, including the SBDB lookup behind ``is_comet``, is a miss and never a live
call. The run uses only ``object_id``: the object comes from the cached resolver registry.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.adapters import horizons
from app.cache.store import CacheEntry, ReadThroughCache
from app.context import Context
from app.core.find import moving
from app.core.find.frames import is_complete, object_frames_key, stored_result
from app.core.find.resolver import is_comet, load_object
from app.core.measure.config import DEFAULT_CONFIG, MeasureConfig, config_for
from app.core.measure.spectrum import cached_spectrum_key

# Why Track is not available (for the precompute log and the tests; not a served code).
NOT_RESOLVED = "resolver:not_cached"
NOT_MOVING = "object:not_moving"
NO_SPKID = "object:no_spkid"
FRAMES_NOT_CACHED = "frames:not_cached"
FRAMES_INCOMPLETE = "frames:incomplete"
FRAMES_EMPTY = "frames:empty"
PATH_NOT_CACHED = "path:not_cached"
PATH_EPHEMERIS = "path:ephemeris"
SPECTRUM_NOT_CACHED = "spectrum:not_cached"


@dataclass(frozen=True)
class TrackCheck:
    """``available`` with the SHA-256 of every entry it read (sorted; for ``params_hash``), or
    the first reason it is not."""

    available: bool
    reason: str = ""
    digests: tuple[str, ...] = ()


def cache_only(ctx: Context) -> Context:
    """The same cache and settings, offline: a miss is ``CacheMissOffline``, never a request."""
    return Context(
        settings=ctx.settings.model_copy(update={"offline": True}),
        cache=ReadThroughCache(ctx.cache.root, offline=True),
        http=ctx.http,
    )


def _sha(entry: CacheEntry) -> str:
    return hashlib.sha256(entry.body).hexdigest()


def check(ctx: Context, object_id: str, cfg: MeasureConfig = DEFAULT_CONFIG) -> TrackCheck:
    """A19.12: frames, path and spectrum of ``object_id`` final in the cache. Never fetches."""
    view = cache_only(ctx)
    obj = load_object(view, object_id)
    if obj is None:
        return TrackCheck(False, NOT_RESOLVED)
    if not obj.moving:
        return TrackCheck(False, NOT_MOVING)  # Track is for movers (A19)
    if not obj.spkid:
        return TrackCheck(False, NO_SPKID)  # no Horizons path (as path:ephemeris in /path)

    frames_entry = view.cache.get(object_frames_key(view, obj))
    if frames_entry is None:
        return TrackCheck(False, FRAMES_NOT_CACHED)
    fr = stored_result(obj, frames_entry.body)
    if not is_complete(fr.missing):
        return TrackCheck(False, FRAMES_INCOMPLETE)
    if not fr.frames:
        return TrackCheck(False, FRAMES_EMPTY)
    digests = [_sha(frames_entry)]

    mcfg = moving.MovingConfig.from_context(view, obj.spkid)
    comet = is_comet(view, obj)
    for chunks in moving.range_chunks(mcfg):
        for a, b in chunks:
            key = horizons.range_key(obj.spkid, a, b, mcfg.ephem_step_min, comet=comet)
            e = view.cache.get(key)
            if e is None:
                return TrackCheck(False, PATH_NOT_CACHED)
            try:
                horizons.range_points(e.body)
            except ValueError:
                return TrackCheck(False, PATH_EPHEMERIS)
            digests.append(_sha(e))

    skey = cached_spectrum_key(view, obj.id, fr, config_for(obj.moving, cfg))
    spectrum = view.cache.get(skey) if skey is not None else None
    if spectrum is None:
        return TrackCheck(False, SPECTRUM_NOT_CACHED)
    digests.append(_sha(spectrum))
    return TrackCheck(True, "", tuple(sorted(set(digests))))
