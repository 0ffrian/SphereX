"""Stages 3, 4, 5 and 7 for one object (A4.3-A4.5, A4.7; UML 16 and 17).

    asset = store.get(id)       -> "saved":     its card and render params
    else classify(catalogue)    -> "generated": card from catalogues + spectrum   (type known)
                                -> "sketch":    card from SPHEREx only            (candidate)
    then card_to_params, validate both against shared/schemas, save when the inputs are final.

Stage 6 (physics, A4.6) adds no values yet. Every reply is checked with jsonschema (Q-40).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.core.card.assets import Asset, AssetStatus, AssetStore
from app.core.card.build import build_card
from app.core.card.catalogue import gather
from app.core.card.validate import ContractViolation, check_card, check_params
from app.core.classify import Classification, classify
from app.core.find.frames import FrameService, is_complete
from app.core.find.resolver import ResolvedObject
from app.core.measure.spectrum import SpectrumService
from app.core.render.card_to_params import GENERATOR_VERSION, card_to_params, seed_for
from app.timefmt import iso_utc_z, utc_now

log = logging.getLogger("shift_spectrum")


@dataclass(frozen=True)
class ObjectResult:
    card: dict[str, Any]
    params: dict[str, Any]
    status: AssetStatus
    cached_at: datetime | None
    classification: Classification | None  # None for a saved asset


class ObjectPipeline:
    def __init__(self, frames: FrameService, assets: AssetStore) -> None:
        self.frames = frames
        self.ctx = frames.ctx
        self.assets = assets

    def _spectrum(self, obj: ResolvedObject) -> tuple[dict[str, Any] | None, datetime | None]:
        try:
            result = SpectrumService(self.frames).get_spectrum(obj)
        except (CacheMissOffline, UpstreamUnavailable):
            return None, None  # no spectrum: SPHEREx-derived fields are null, never guessed
        return result.body, result.cached_at

    def run(self, obj: ResolvedObject) -> ObjectResult:
        found = self.assets.lookup(obj.id)
        if found is not None:
            saved, saved_at = found
            try:
                check_card(saved.card)
                check_params(saved.render_params)
            except ContractViolation as exc:
                # A hand-edited pre-baked file or an asset saved under an older schema: rebuild
                # from the catalogues instead of failing every request for this object.
                log.warning("ignoring saved asset for %s: %s", obj.id, exc)
            else:
                # A saved sketch keeps its "Sketch from SPHEREx only" label (UML 16, Q-57).
                saved_status: AssetStatus = (
                    "sketch" if saved.card.get("type") == "candidate" else "saved"
                )
                return ObjectResult(saved.card, saved.render_params, saved_status, saved_at, None)

        data = gather(self.ctx, obj)
        cls = classify(data.facts)
        status: AssetStatus = "sketch" if cls.type == "candidate" else "generated"
        spectrum, spectrum_at = self._spectrum(obj)
        card = build_card(obj, data, cls, spectrum)
        check_card(card)

        missing = tuple(m for m in (*cls.missing, *data.missing) if m != "spectral_class")
        if spectrum is None:
            missing = (*missing, "spectrum")
        version = GENERATOR_VERSION
        seed = seed_for(obj.id, version)
        params = card_to_params(card, seed=seed, generator_version=version, extra_missing=missing)
        check_params(params)

        times = [s.entry.fetched_at for s in data.served if s.from_cache]
        if spectrum_at is not None:
            times.append(spectrum_at)
        cached_at = min(times) if times else None

        # Save only final inputs: a spectrum from a complete frame list and a catalogue answer.
        # A truncated search or a deferred cutout could still change the card.
        final = spectrum is not None and is_complete(list(spectrum.get("missing", [])))
        if final and not data.missing:
            self.assets.put(
                Asset(
                    card=card,
                    render_params=params,
                    textures=params.get("textures"),
                    generator_version=version,
                    seed=seed,
                    created_at=iso_utc_z(utc_now()),
                )
            )
        log.info("object %s: %s, type %s (%s)", obj.id, status, cls.type, cls.rule)
        return ObjectResult(card, params, status, cached_at, cls)
