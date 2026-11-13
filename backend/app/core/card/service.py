"""Stages 3, 4, 5 and 7 for one object (A4.3-A4.5, A4.7; UML 16 and 17).

    asset = store.get(id)       -> "saved":     its card and render params
    else classify(catalogue)    -> "generated": card from catalogues + spectrum   (type known)
                                -> "sketch":    card from SPHEREx only            (candidate)
    then card_to_params, validate both against shared/schemas, save when the inputs are final.

A pre-built pack asset (Q-164) has no spectrum, so it is not "saved" in the sense above: the
object is built live, and the pack answers only when that build has no spectrum, loses its
catalogue type, or cannot run (issue #75).

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
from app.core.card.catalogue import (
    CatalogueData,
    apply_geometry,
    fetch_geometry,
    gather,
    with_star_data,
)
from app.core.card.reference import reference_card
from app.core.card.stars import STAR_TYPES
from app.core.card.validate import ContractViolation, check_card, check_params
from app.core.classify import Classification, classify
from app.core.find import moving
from app.core.find.frames import DEFERRED, FrameEvent, FrameService, FramesResult, is_complete
from app.core.find.resolver import ResolvedObject
from app.core.jobs import Job, JobRegistry
from app.core.measure.config import config_for, method_sha
from app.core.measure.pool import MeasurePool
from app.core.measure.spectrum import Premeasured, SpectrumService
from app.core.render.background import TextureBaker
from app.core.render.card_to_params import (
    GENERATOR_VERSION,
    MEASURING_PREFIX,
    card_to_params,
    seed_for,
)
from app.errors import ApiError
from app.timefmt import iso_utc_z, utc_now

log = logging.getLogger("shift_spectrum")


GEOMETRY_TYPES = frozenset({"comet", "asteroid_shape", "asteroid_procedural"})
MEASURING_SPECTRUM = MEASURING_PREFIX + "spectrum"
MEASURING_FRAMES = MEASURING_PREFIX + "frames"  # a partial answer: more frames are coming


def _missing(result: ObjectResult) -> list[str]:
    return list(result.params.get("missing", []))


def _stand_in(result: ObjectResult) -> bool:
    """A pre-built pack asset with no spectrum (issue #75, Q-164 (3)): it answers only when a
    live build cannot measure the object."""
    return result.prebuilt and "spectrum" in _missing(result)


# Catalogue answers a live build can lose offline (a cold D-25 cache) while keeping its type.
CATALOGUE_GAPS = frozenset({"catalogue", "star_catalogue", "exoplanet_archive"})


def _measured_beats_pack(live: ObjectResult, pack: ObjectResult) -> bool:
    """The live build replaces the pack when it has a measured spectrum, the same type and no
    catalogue gap the pack does not also have. A different type means the live build lost its
    catalogue answer (e.g. offline with only the frames cached: a ``candidate`` sketch); a
    catalogue gap of its own (issue #93 C1: offline with no cached Gaia cone, Barnard's star keeps
    the type ``star`` but loses its Gaia values) is the same loss in a quieter form. In both cases
    the pack's catalogue card is kept instead."""
    gaps = (set(_missing(live)) & CATALOGUE_GAPS) - set(_missing(pack))
    return (
        "spectrum" not in _missing(live)
        and not gaps
        and live.card.get("type") == pack.card.get("type")
    )


@dataclass(frozen=True)
class ObjectResult:
    card: dict[str, Any]
    params: dict[str, Any]
    status: AssetStatus
    cached_at: datetime | None
    classification: Classification | None  # None for a saved asset
    # Issue #41: what is still being measured (first-stage answer); empty when refined.
    measuring: tuple[str, ...] = ()
    # Issue #75: from the repo pack (Q-164), not built or saved by this backend.
    prebuilt: bool = False


@dataclass(frozen=True)
class _Built:
    """A live build and the asset to save for it (None unless its inputs are final)."""

    result: ObjectResult
    asset: Asset | None


class _Lookup:
    """Sentinel: ``ensure_job`` was not given the saved asset, so the job looks it up."""


_LOOKUP = _Lookup()


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
        if obj.resolver == "reference":
            return self._reference(obj)
        saved = self._saved(obj)
        if saved is not None and not _stand_in(saved):
            return saved
        job = self.ensure_job(obj, saved=saved)
        wait = self.ctx.settings.first_answer_wait_s
        if saved is None:
            return job.answer(wait)
        # A pack stand-in (issue #75): its job publishes no intermediate answer, so the reply is
        # the final one or the pack, never a first-stage card that could later flip back. Offline
        # nothing downloads, so wait for the final as for any offline object.
        try:
            final = job.wait_final(None if self.ctx.cache.offline else wait)
        except Exception:  # the job failed (e.g. shutting down): the pack is still valid
            log.exception("object %s: job failed, answering with the pack", obj.id)
            return saved
        return final if final is not None else saved

    def ensure_job(
        self,
        obj: ResolvedObject,
        *,
        restart_finished: bool = False,
        saved: ObjectResult | _Lookup | None = _LOOKUP,
    ) -> Job[ObjectResult]:
        """Start or join the object's job. ``restart_finished``: a finished job is not reused
        (``/frames`` found cutouts still to download, e.g. failures whose retry delay passed).
        ``saved``: the asset ``run`` already looked up; otherwise the job looks it up."""

        def run(job: Job[ObjectResult]) -> ObjectResult:
            found = self._saved(obj) if isinstance(saved, _Lookup) else saved
            return self._job(obj, job, found)

        return self.jobs.ensure(obj.id, run, reuse_finished=not restart_finished)

    def request_frames(self, obj: ResolvedObject) -> None:
        """``FrameService.on_request``: a web request found cutouts still to download."""
        self.ensure_job(obj, restart_finished=True)

    def close(self) -> None:
        self._closed.set()
        self.jobs.close()

    # --- the job --------------------------------------------------------------------------

    def saved(self, obj: ResolvedObject) -> ObjectResult | None:
        """The asset ``run`` answers with, without building: the saved or pre-built asset, or,
        for a pack stand-in whose job has finished, that job's answer (the live build when it
        won, issue #75). None when there is none or none passes the contract (``run`` then
        builds it). A reference object answers with its own asset (``_reference``), never a
        cached catalogue build."""
        if obj.resolver == "reference":
            try:
                return self._reference(obj)
            except ApiError:
                return None
        saved = self._saved(obj)
        if saved is not None and _stand_in(saved):
            job = self.jobs.get(obj.id)
            if job is not None and job.final is not None:
                return job.final
        return saved

    def _saved(self, obj: ResolvedObject) -> ObjectResult | None:
        """The best asset that passes the contract, generated before pre-built (issue #75): a
        generated asset saved under an older schema falls through to the pack."""
        for found in self.assets.layers(obj.id):
            asset = found.asset
            try:
                check_card(asset.card)
                check_params(asset.render_params)
            except ContractViolation as exc:
                # A hand-edited pre-baked file or an asset saved under an older schema: try the
                # next layer, else rebuild, instead of failing every request for this object.
                log.warning("ignoring saved asset for %s: %s", obj.id, exc)
                continue
            # A saved sketch keeps its "Sketch from SPHEREx only" label (UML 16, Q-57).
            status: AssetStatus = "sketch" if asset.card.get("type") == "candidate" else "saved"
            return ObjectResult(
                asset.card,
                asset.render_params,
                status,
                found.cached_at,
                None,
                prebuilt=found.prebuilt,
            )
        return None

    def _reference(self, obj: ResolvedObject) -> ObjectResult:
        """A reference object (Q-258) never runs the catalogue stages and is never cached: the
        pre-built pack's asset when it is current, else the same card built from
        ``reference_objects.toml`` by the code the baker uses (deterministic, no network).
        A stale or missing pack file would otherwise send ``ref-*`` through SIMBAD and cache a
        ``candidate`` for it (issue #71 review). The generated D-25 layer is never read here:
        a poisoned entry from before this guard would otherwise win over the pack (issue #75
        reads generated assets first)."""
        asset = self.assets.prebaked(obj.id)
        if asset is not None:
            try:
                check_card(asset.card)
                check_params(asset.render_params)
                return ObjectResult(
                    asset.card, asset.render_params, "saved", None, None, prebuilt=True
                )
            except ContractViolation as exc:
                log.warning("ignoring pre-baked reference asset for %s: %s", obj.id, exc)
        card = reference_card(self.ctx.settings.reference_file, obj.id)
        if card is None:
            raise ApiError(
                503,
                "reference_asset_missing",
                f"No current pre-built asset and no row in reference_objects.toml for {obj.id}. "
                "Re-bake: uv run python -m scripts.bake_reference_objects.",
            )
        log.warning("object %s: no current pre-built asset, built from reference_objects", obj.id)
        params = card_to_params(card, generator_version=GENERATOR_VERSION)
        check_card(card)
        check_params(params)
        return ObjectResult(card, params, "generated", None, None)

    def _job(
        self, obj: ResolvedObject, job: Job[ObjectResult], saved: ObjectResult | None
    ) -> ObjectResult:
        if obj.resolver == "reference":
            return self._reference(obj)  # no frames, no catalogues (Q-258)
        premeasured: dict[str, Premeasured] = {}
        if saved is None:
            return self._build(obj, job, premeasured).result
        if not _stand_in(saved):
            # The card is saved, but the flipbook, spectrum and composite still need the
            # cutouts: download them, then answer with the saved asset.
            with contextlib.suppress(CacheMissOffline, UpstreamUnavailable):
                frames = self._frames(obj, job, premeasured, measure=False)
                if obj.moving and is_complete(frames.missing):
                    # Track (A19.12, Q-468): a mover's spectrum is part of what Track opens,
                    # so the job stores it even when the card is saved (a cache hit after once).
                    job.update(stage="spectrum")
                    self._spectrum(obj, frames, premeasured)
            return saved
        # A pre-built pack asset has no spectrum (Q-164 (3)). Measure if this backend can (the
        # D-25 cache or the network has the frames); the pack answers only when it cannot. The
        # live build is quiet: nothing is published, baked or saved unless it wins.
        try:
            live = self._build(obj, job, premeasured, quiet=True)
        except Exception:  # never blank: any failure of the live path keeps the valid pack
            log.exception("object %s: live build failed, answering with the pack", obj.id)
            return saved
        if not _measured_beats_pack(live.result, saved):
            log.info("object %s: live build lost to the pack (spectrum, type or catalogue)", obj.id)
            return saved
        if live.asset is not None:
            self.assets.put(live.asset)
        self._bake(live.result)
        return live.result

    def _build(
        self,
        obj: ResolvedObject,
        job: Job[ObjectResult],
        premeasured: dict[str, Premeasured],
        *,
        quiet: bool = False,
    ) -> _Built:
        """Stages 1 to 7 from the catalogues and the frames (the fan-out above). ``quiet`` (a
        pack stand-in, issue #75): publish no first-stage or partial answer, and bake and save
        nothing; the caller does that only if the result replaces the pack."""
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
            elif cls.type in STAR_TYPES:
                data = with_star_data(self.ctx, data, obj, cls.type)
        finally:
            fan.shutdown(wait=False)

        if not quiet and not f_frames.done() and not self.ctx.cache.offline:
            first, _ = self._assemble(obj, data, cls, None, None, pending=True)
            self._bake(first)
            job.publish(first, "first")
            log.info("object %s: first-stage answer published, measuring", obj.id)

        frames = self._join_frames(f_frames)
        batch_only = False
        # Cutouts still to download, or (a moving object) a path search the first batch left to
        # this full run: publish the partial answer, then fetch the rest.
        still_to_come = (DEFERRED + ":", moving.SEARCH_DEFERRED + ":")
        if frames is not None and any(m.startswith(still_to_come) for m in frames.missing):
            if not quiet:
                job.update(stage="spectrum")
                spectrum, spectrum_at = self._spectrum(obj, frames, premeasured)
                partial, _ = self._assemble(
                    obj, data, cls, spectrum, spectrum_at, pending=False, more=True
                )
                job.publish(partial, "partial")
                n = len(frames.frames)
                log.info("object %s: partial answer published, %d frames", obj.id, n)
            # If the full run fails (e.g. the SIA search on the second call), keep the batch.
            full = self._join_frames_now(obj, job, premeasured)
            batch_only = full is None  # the rest could not be fetched: still not the full list
            frames = full or frames
        job.update(stage="spectrum")
        spectrum, spectrum_at = self._spectrum(obj, frames, premeasured)
        job.update(stage="card")
        result, asset = self._assemble(
            obj, data, cls, spectrum, spectrum_at, pending=False, more=batch_only
        )
        if not quiet:
            if asset is not None:
                self.assets.put(asset)
            self._bake(result)
        return _Built(result, asset)

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
            cfg = config_for(obj.moving)
            fut = self.measure_pool.submit(body, rec.x_fits0, rec.y_fits0, cfg)
            premeasured[rec.frame_id] = Premeasured(
                sha, rec.x_fits0, rec.y_fits0, fut, method_sha(cfg)
            )

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

    def assemble_without_spectrum(
        self, obj: ResolvedObject, data: CatalogueData, cls: Classification
    ) -> ObjectResult:
        """Stage 5 and 7 with no frames: the card and params a live build gives for an object
        that has no spectrum (used by ``scripts/bake_demo_pack.py``, Q-164)."""
        return self._assemble(obj, data, cls, None, None, pending=False)[0]

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
    ) -> tuple[ObjectResult, Asset | None]:
        """The answer, and the asset to save for it when its inputs are final (else None; the
        caller saves it). ``pending``: first stage, no spectrum yet. ``more``: partial, the
        spectrum is from the first batch of frames. Neither is ever saved."""
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
            return ObjectResult(card, params, status, cached_at, cls, measuring), None

        # Save only final inputs: a spectrum from a complete frame list and a catalogue answer.
        # A truncated search or a deferred cutout could still change the card. A type refusal
        # (`type:*`) is not saved either: it comes from a rule still under review (Q-63, the
        # thresholds are off) and a saved sketch would hide a later rule change. Refusals that
        # would survive that change (e.g. `type:exoplanet_envelope`) are rebuilt too; the cost
        # is a re-run of stages 3-7 from cached inputs.
        final = spectrum is not None and is_complete(list(spectrum.get("missing", [])))
        type_refused = any(m.startswith("type:") for m in cls.missing)
        asset = None
        if final and not data.missing and not type_refused:
            asset = Asset(
                card=card,
                render_params=params,
                textures=params.get("textures"),
                generator_version=version,
                seed=seed,
                created_at=iso_utc_z(utc_now()),
            )
        log.info("object %s: %s, type %s (%s)", obj.id, status, cls.type, cls.rule)
        return ObjectResult(card, params, status, cached_at, cls), asset
