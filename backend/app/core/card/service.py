"""Stages 3, 4, 5 and 7 for one object (A4.3-A4.5, A4.7; UML 16 and 17).

    asset = store.get(id)       -> "saved":     its card and render params
    else classify(catalogue)    -> "generated": card from catalogues + spectrum   (type known)
                                -> "sketch":    card from SPHEREx only            (candidate)
    then card_to_params, validate both against shared/schemas, save when the inputs are final.

Stage 6 (physics, A4.6) adds no values yet. Every reply is checked with jsonschema (Q-40).

Issue #41 fan-out. Each object is built by one background job (``app.core.jobs``):

1. After Find, the catalogue (SIMBAD or SBDB, Exoplanet Archive, shape-model registry), the
   Horizons geometry and the frame list (SIA search, then cutouts in the shared bounded pool)
   start together. The catalogue and geometry join at the card.
2. Each cutout is measured in the photometry pool the moment it lands.
3. The first batch downloads at most ``SX_LIVE_CUTOUTS_PER_REQUEST`` cutouts (the frames the
   old per-request cap took, in time order). If it is not done when the card can be built and
   the backend is online, the job publishes a **first-stage** answer: card and render params
   from catalogue data, the SPHEREx fields and layers listed as ``measuring:``.
4. If frames remain after the first batch, a **partial** answer measured from that batch is
   published, with ``measuring:frames`` in ``RenderParams.missing``, and the rest download.
5. When the frame list is complete, the spectrum is assembled in frame order and the **final**
   answer is published (and saved when its inputs are final, as before).

Intermediate answers are never guessed and never saved. ``/card`` and ``/render-params`` join
the job: they return the final answer if it comes within ``SX_FIRST_ANSWER_WAIT_S``, else the
newest intermediate one. Offline (D-25) nothing downloads, so there is no intermediate answer.
Texture bakes are queued off the request path (``TextureBaker``).
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.core.card.assets import Asset, AssetStatus, AssetStore
from app.core.card.build import SPECTRUM_FIELDS, build_card
from app.core.card.catalogue import CatalogueData, apply_geometry, fetch_geometry, gather
from app.core.card.validate import ContractViolation, check_card, check_params
from app.core.classify import Classification, classify
from app.core.find import moving
from app.core.find.frames import DEFERRED, FrameEvent, FrameService, FramesResult, is_complete
from app.core.find.resolver import ResolvedObject
from app.core.jobs import Job, JobRegistry
from app.core.measure.pool import MeasurePool
from app.core.measure.spectrum import Premeasured, SpectrumService
from app.core.render.background import TextureBaker
from app.core.render.card_to_params import (
    GENERATOR_VERSION,
    MEASURING_PREFIX,
    card_to_params,
    seed_for,
)
from app.timefmt import iso_utc_z, utc_now

log = logging.getLogger("shift_spectrum")


GEOMETRY_TYPES = frozenset({"comet", "asteroid_shape", "asteroid_procedural"})
MEASURING_SPECTRUM = MEASURING_PREFIX + "spectrum"
MEASURING_FRAMES = MEASURING_PREFIX + "frames"  # a partial answer: more frames are coming


@dataclass(frozen=True)
class ObjectResult:
    card: dict[str, Any]
    params: dict[str, Any]
    status: AssetStatus
    cached_at: datetime | None
    classification: Classification | None  # None for a saved asset
    # Issue #41: what is still being measured (first-stage answer); empty when refined.
    measuring: tuple[str, ...] = ()


class ObjectPipeline:
    def __init__(
        self,
        frames: FrameService,
        assets: AssetStore,
        *,
        measure_pool: MeasurePool | None = None,
        baker: TextureBaker | None = None,
    ) -> None:
        self.frames = frames
        self.ctx = frames.ctx
        self.assets = assets
        self.measure_pool = measure_pool
        self.baker = baker
        s = self.ctx.settings
        self.jobs: JobRegistry[ObjectResult] = JobRegistry(s.job_ttl_s)
        # SX_MAX_JOBS slots for the long part only: downloading every frame after the first
        # batch. Catalogue, first stage and partial answer never wait for a slot, so every
        # visitor gets an answer quickly; a job waiting for a slot reports stage "queued".
        self._full_runs = threading.BoundedSemaphore(s.max_jobs) if s.max_jobs > 0 else None
        self._closed = threading.Event()

    # --- entry points ---------------------------------------------------------------------

    def run(self, obj: ResolvedObject) -> ObjectResult:
        """The answer for ``/card`` and ``/render-params``: saved, refined or first-stage."""
        saved = self._saved(obj)
        if saved is not None:
            return saved
        job = self.ensure_job(obj)
        return job.answer(self.ctx.settings.first_answer_wait_s)

    def ensure_job(
        self, obj: ResolvedObject, *, restart_finished: bool = False
    ) -> Job[ObjectResult]:
        """Start or join the object's job. ``restart_finished``: a finished job is not reused
        (``/frames`` found cutouts still to download, e.g. failures whose retry delay passed)."""
        return self.jobs.ensure(
            obj.id, lambda job: self._job(obj, job), reuse_finished=not restart_finished
        )

    def request_frames(self, obj: ResolvedObject) -> None:
        """``FrameService.on_request``: a web request found cutouts still to download."""
        self.ensure_job(obj, restart_finished=True)

    def close(self) -> None:
        self._closed.set()
        self.jobs.close()

    # --- the job --------------------------------------------------------------------------

    def _saved(self, obj: ResolvedObject) -> ObjectResult | None:
        found = self.assets.lookup(obj.id)
        if found is None:
            return None
        saved, saved_at = found
        try:
            check_card(saved.card)
            check_params(saved.render_params)
        except ContractViolation as exc:
            # A hand-edited pre-baked file or an asset saved under an older schema: rebuild
            # from the catalogues instead of failing every request for this object.
            log.warning("ignoring saved asset for %s: %s", obj.id, exc)
            return None
        # A saved sketch keeps its "Sketch from SPHEREx only" label (UML 16, Q-57).
        status: AssetStatus = "sketch" if saved.card.get("type") == "candidate" else "saved"
        return ObjectResult(saved.card, saved.render_params, status, saved_at, None)

    def _job(self, obj: ResolvedObject, job: Job[ObjectResult]) -> ObjectResult:
        premeasured: dict[str, Premeasured] = {}
        saved = self._saved(obj)
        if saved is not None:
            # The card is saved (or pre-baked), but the flipbook, spectrum and composite still
            # need the cutouts: download them, then answer with the saved asset.
            with contextlib.suppress(CacheMissOffline, UpstreamUnavailable):
                self._frames(obj, job, premeasured, measure=False)  # card saved: no spectrum
            return saved
        job.update(stage="catalogue")
        # shutdown(wait=False) never blocks the job on a branch it no longer needs (e.g. geometry
        # for a star). These are ordinary pool threads: at interpreter exit Python joins them, so
        # a stop can wait for one running call (at most one cutout's read timeout).
        batch = self.ctx.settings.live_cutouts_per_request
        fan = ThreadPoolExecutor(3, thread_name_prefix=f"sx-fan-{obj.id[:24]}")
        try:
            f_frames = fan.submit(self._frames, obj, job, premeasured, batch)
            f_data = fan.submit(gather, self.ctx, obj)
            f_geom = fan.submit(fetch_geometry, self.ctx, obj)
            data = f_data.result()
            cls = classify(data.facts)
            if cls.type in GEOMETRY_TYPES:
                data = apply_geometry(data, f_geom.result())
        finally:
            fan.shutdown(wait=False)

        if not f_frames.done() and not self.ctx.cache.offline:
            first = self._assemble(obj, data, cls, None, None, pending=True)
            self._bake(first)
            job.publish(first, "first")
            log.info("object %s: first-stage answer published, measuring", obj.id)

        frames = self._join_frames(f_frames)
        batch_only = False
        # Cutouts still to download, or (a moving object) a path search the first batch left to
        # this full run: publish the partial answer, then fetch the rest.
        still_to_come = (DEFERRED + ":", moving.SEARCH_DEFERRED + ":")
        if frames is not None and any(m.startswith(still_to_come) for m in frames.missing):
            job.update(stage="spectrum")
            spectrum, spectrum_at = self._spectrum(obj, frames, premeasured)
            partial = self._assemble(
                obj, data, cls, spectrum, spectrum_at, pending=False, more=True
            )
            job.publish(partial, "partial")
            log.info("object %s: partial answer published, %d frames", obj.id, len(frames.frames))
            # If the full run fails (e.g. the SIA search on the second call), keep the batch.
            full = self._join_frames_now(obj, job, premeasured)
            batch_only = full is None  # the rest could not be fetched: still not the full list
            frames = full or frames
        job.update(stage="spectrum")
        spectrum, spectrum_at = self._spectrum(obj, frames, premeasured)
        job.update(stage="card")
        result = self._assemble(
            obj, data, cls, spectrum, spectrum_at, pending=False, more=batch_only
        )
        self._bake(result)
        return result

    def _frames(
        self,
        obj: ResolvedObject,
        job: Job[ObjectResult],
        premeasured: dict[str, Premeasured],
        cap: int | None = None,
        *,
        measure: bool = True,
    ) -> FramesResult:
        """The frame list: at most ``cap`` live downloads (the first batch), or all of them.
        ``measure``: send each landed cutout to the photometry pool."""
        job.update(stage="frames")

        def landed(ev: FrameEvent) -> None:
            job.update(frames_done=ev.done, frames_total=ev.total)
            if not measure or self.measure_pool is None or ev.record is None or ev.served is None:
                return
            body = ev.served.entry.body
            sha = str(ev.served.entry.meta.get("body_sha256") or hashlib.sha256(body).hexdigest())
            rec = ev.record
            if rec.frame_id in premeasured:
                return  # measured in the first batch; the spectrum checks its bytes again
            fut = self.measure_pool.submit(body, rec.x_fits0, rec.y_fits0)
            premeasured[rec.frame_id] = Premeasured(sha, rec.x_fits0, rec.y_fits0, fut)

        if cap is None:
            result = self.frames.get_frames(obj, unlimited_live=True, on_frame=landed)
        else:
            result = self.frames.get_frames(obj, live_cap=cap, on_frame=landed)
        if job.frames_total is None:  # a stored list: no per-frame events
            job.update(frames_done=len(result.frames), frames_total=len(result.frames))
        return result

    def _join_frames_now(
        self, obj: ResolvedObject, job: Job[ObjectResult], premeasured: dict[str, Premeasured]
    ) -> FramesResult | None:
        slots = self._full_runs
        if slots is not None and not slots.acquire(blocking=False):
            job.update(stage="queued")
            while not slots.acquire(timeout=1.0):
                if self._closed.is_set():
                    return None  # shutting down: the answer stays partial
        try:
            return self._frames(obj, job, premeasured)
        except (CacheMissOffline, UpstreamUnavailable):
            return None
        finally:
            if slots is not None:
                slots.release()

    @staticmethod
    def _join_frames(f_frames: Future[FramesResult]) -> FramesResult | None:
        try:
            return f_frames.result()
        except (CacheMissOffline, UpstreamUnavailable):
            return None  # no frame list: SPHEREx-derived fields are null, never guessed

    def _spectrum(
        self,
        obj: ResolvedObject,
        frames: FramesResult | None,
        premeasured: dict[str, Premeasured],
    ) -> tuple[dict[str, Any] | None, datetime | None]:
        if frames is None:
            return None, None
        service = SpectrumService(self.frames, pool=self.measure_pool)
        try:
            result = service.get_spectrum(obj, frames, premeasured)
        except (CacheMissOffline, UpstreamUnavailable):
            return None, None
        return result.body, result.cached_at

    def _bake(self, result: ObjectResult) -> None:
        if self.baker is not None:
            self.baker.submit(result.card, result.params)

    # --- stages 5 and 7 -------------------------------------------------------------------

    def _assemble(
        self,
        obj: ResolvedObject,
        data: CatalogueData,
        cls: Classification,
        spectrum: dict[str, Any] | None,
        spectrum_at: datetime | None,
        *,
        pending: bool,
        more: bool = False,
    ) -> ObjectResult:
        """``pending``: first stage, no spectrum yet. ``more``: partial, the spectrum is from the
        first batch of frames. Neither is ever saved."""
        status: AssetStatus = "sketch" if cls.type == "candidate" else "generated"
        card = build_card(obj, data, cls, spectrum, spectrum_pending=pending)
        check_card(card)

        missing = tuple(m for m in (*cls.missing, *data.missing) if m != "spectral_class")
        if pending:
            missing = (*missing, MEASURING_SPECTRUM)
        elif spectrum is None:
            missing = (*missing, "spectrum")
        if more:
            missing = (*missing, MEASURING_FRAMES)
        version = GENERATOR_VERSION
        seed = seed_for(obj.id, version)
        waiting = SPECTRUM_FIELDS.intersection(card) if pending else frozenset()
        params = card_to_params(
            card, seed=seed, generator_version=version, extra_missing=missing, pending=waiting
        )
        check_params(params)

        times = [s.entry.fetched_at for s in data.served if s.from_cache]
        if spectrum_at is not None:
            times.append(spectrum_at)
        cached_at = min(times) if times else None
        if pending or more:
            measuring = tuple(m for m in params["missing"] if m.startswith(MEASURING_PREFIX))
            return ObjectResult(card, params, status, cached_at, cls, measuring)

        # Save only final inputs: a spectrum from a complete frame list and a catalogue answer.
        # A truncated search or a deferred cutout could still change the card. A type refusal
        # (`type:*`) is not saved either: it comes from a rule still under review (Q-63, the
        # thresholds are off) and a saved sketch would hide a later rule change. Refusals that
        # would survive that change (e.g. `type:exoplanet_envelope`) are rebuilt too; the cost
        # is a re-run of stages 3-7 from cached inputs.
        final = spectrum is not None and is_complete(list(spectrum.get("missing", [])))
        type_refused = any(m.startswith("type:") for m in cls.missing)
        if final and not data.missing and not type_refused:
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
