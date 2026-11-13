"""Stage 2 output: spectrum and light curve for one object (A4.2, D-16).

Frames from Stage 1 -> cached cutouts -> one ``measure_frame`` each. The spectrum and the light
curve are two orderings of the **same** measurements. Every frame ends up exactly once, as a
point or as a refusal ``<reason>:<frame_id>`` in ``missing``.

Stage 2 never downloads: it reads only cutouts already in the cache (Stage 1 fetched them within
its per-request live cap). A frame whose cutout is not cached is refused as ``cutout:<frame_id>``,
Stage 1's own code, which also marks the result incomplete. Each cutout body is read once, and
the bytes that are measured are the bytes whose SHA-256 goes into the stored key.

The result is cached as a derived entry (D-25). The key holds the method, Stage 1's ``missing``,
every frame record and every cutout's body SHA-256 (from its cache meta). Only complete results
are stored, and a stored result is served only while the current frame list is complete.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Mapping
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.adapters import irsa_cutout
from app.cache.keys import CacheKey
from app.cache.store import LiveResponse
from app.context import Context
from app.core.find import wcs
from app.core.find.frames import FrameRecord, FrameService, FramesResult, is_complete
from app.core.find.resolver import ResolvedObject
from app.core.find.version import DERIVATION_VERSION
from app.core.measure import solid_angle
from app.core.measure.config import (
    DEFAULT_CONFIG,
    MEASURE_VERSION,
    MeasureConfig,
    config_for,
    method_dict,
    method_sha,
)
from app.core.measure.photometry import (
    ERROR_FORMULA,
    FLUX_FORMULA,
    OUTPUT_UNIT,
    Measurement,
    Refusal,
    measure_frame,
)
from app.core.measure.pool import MeasurePool, Outcome
from app.timefmt import iso_utc_z, parse_utc, utc_now

log = logging.getLogger("shift_spectrum")

SPECTRUM_SOURCE = "derived.spectrum"
SATURATED = "saturated"
ALL_SATURATED = "spectrum:saturated"
NO_PROPER_MOTION = "no_proper_motion"
CUTOUT = "cutout"
STAGE2_REASONS = (
    CUTOUT,
    "cutout_unreadable",
    "extension",
    "unit",
    "flags_header",
    "aperture_edge",
    SATURATED,
    "aperture_flags",
    "background",
    "pixel_area",
    "measure",
)


def provenance() -> dict[str, dict[str, str]]:
    return {
        "flux": {
            "tag": "measured",
            "source": "SPHEREx QR2 IMAGE, aperture photometry (this tool)",
            "formula": f"{FLUX_FORMULA}; {solid_angle.FORMULA}",
        },
        "error": {
            "tag": "measured",
            "source": "SPHEREx QR2 VARIANCE (this tool)",
            "formula": ERROR_FORMULA,
        },
        "wavelength_um": {
            "tag": "measured",
            "source": "WCS-WAVE lookup table (alternate WCS 'W') at the object pixel",
        },
        "time": {
            "tag": "measured",
            "source": "midpoint of the IRSA SIA t_min/t_max exposure bounds (UTC)",
        },
    }


@dataclass(frozen=True)
class Premeasured:
    """A frame measured while its cutout landed (issue #41). Used only if the cutout body
    the spectrum reads has this SHA-256, the frame record has this pixel position and the
    measurement used the same method (``method_sha`` of the config it ran with, Q-460)."""

    body_sha256: str
    x_fits0: float
    y_fits0: float
    future: Future[Outcome]
    method_sha: str = ""


@dataclass
class SpectrumResult:
    body: dict[str, Any]  # the response without cached_at
    cached_at: datetime | None
    from_cache: bool
    frame_ids: tuple[str, ...] = ()  # Stage 1's frame list this result accounts for


def cutout_key(ctx: Context, f: FrameRecord) -> CacheKey:
    """The cache key Stage 1 stored this frame's cutout under."""
    return irsa_cutout.key_for(ctx, f.sia_row(), f.ra, f.dec)


def frames_digest(fr: FramesResult, shas: dict[str, str]) -> str:
    """Stage 1's ``missing`` + every frame record + each cutout's body SHA-256."""
    doc = {
        "missing": sorted(fr.missing),
        "frames": [{**f.key_doc(), "cutout_sha256": shas.get(f.frame_id, "")} for f in fr.frames],
    }
    text = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def spectrum_key(release: str, object_id: str, frames_sha: str, cfg: MeasureConfig) -> CacheKey:
    return CacheKey.make(
        SPECTRUM_SOURCE,
        release,
        id=object_id,
        v=DERIVATION_VERSION,
        measure=MEASURE_VERSION,
        method=method_sha(cfg),
        frames=frames_sha,
    )


def _point(f: FrameRecord, m: Measurement) -> tuple[dict[str, Any], dict[str, Any]]:
    reasons = sorted(
        {
            *m.dropped_flags,
            *(f"{n.lower()}_core" for n in m.core_flagged),  # outlier_core (Q-139)
            *([NO_PROPER_MOTION] if NO_PROPER_MOTION in f.flags else []),
        }
    )
    flagged = bool(reasons)
    spec = {
        "wavelength_um": f.wavelength_um,
        "flux": m.flux,
        "error": m.error,
        "flagged": flagged,
        "frame_id": f.frame_id,
        "bandwidth_um": f.bandwidth_um,
        "dropped_flags": list(m.dropped_flags),
        "dropped_weight_fraction": m.dropped_weight_fraction,
        "flag_reasons": reasons,
    }
    light = {
        "time": f.time,
        "flux": m.flux,
        "error": m.error,
        "frame_id": f.frame_id,
        "wavelength_um": f.wavelength_um,
        "flagged": flagged,
    }
    return spec, light


class SpectrumService:
    def __init__(
        self,
        frames: FrameService,
        cfg: MeasureConfig = DEFAULT_CONFIG,
        pool: MeasurePool | None = None,
    ) -> None:
        self.frames = frames
        self.ctx = frames.ctx
        self.cfg = cfg
        self.pool = pool

    def get_spectrum(
        self,
        obj: ResolvedObject,
        frames: FramesResult | None = None,
        premeasured: Mapping[str, Premeasured] | None = None,
    ) -> SpectrumResult:
        """``frames``: Stage 1's result when the caller already has it (the composite), so the
        frame list (and its live cutout budget) is not fetched a second time.

        ``premeasured``: frames already sent to the photometry pool by the object job as their
        cutouts landed (issue #41), by frame id. Frames are measured in the pool when one is set,
        and the points are put in frame order afterwards, so finishing order never matters."""
        fr = frames if frames is not None else self.frames.get_frames(obj)
        cfg = config_for(obj.moving, self.cfg)  # Q-139: OUTLIER on a mover's core is a flag
        release = self.ctx.settings.data_release
        complete = is_complete(fr.missing)

        # Lookup: only a complete frame list may be served from the derived cache. The key comes
        # from the cutouts' cache meta, so a hit reads no cutout body.
        if complete:
            meta_shas: dict[str, str] = {}
            for f in fr.frames:
                meta = self.ctx.cache.get_meta(cutout_key(self.ctx, f))
                if meta is not None and isinstance(meta.get("body_sha256"), str):
                    meta_shas[f.frame_id] = meta["body_sha256"]
            if len(meta_shas) == len(fr.frames):
                key = spectrum_key(release, obj.id, frames_digest(fr, meta_shas), cfg)
                hit = self.ctx.cache.get(key)
                if hit is not None:
                    doc = json.loads(hit.body)
                    cached = doc.pop("sources_earliest_fetched_at", None)
                    when = parse_utc(cached) if cached else None
                    return SpectrumResult(doc, when, True, tuple(f.frame_id for f in fr.frames))

        # Measure. Each cutout body is read once; its own SHA-256 goes into the stored key.
        refusals: dict[str, str] = {}
        shas: dict[str, str] = {}
        absent: set[str] = set()
        spectrum: list[dict[str, Any]] = []
        light: list[dict[str, Any]] = []
        pending: dict[str, Future[Outcome] | Outcome] = {}
        for f in fr.frames:
            entry = self.ctx.cache.get(cutout_key(self.ctx, f))
            if entry is None:
                refusals[f.frame_id] = CUTOUT
                continue
            sha = str(entry.meta["body_sha256"])
            shas[f.frame_id] = sha
            pre = (premeasured or {}).get(f.frame_id)
            if pre is not None and (pre.body_sha256, pre.x_fits0, pre.y_fits0, pre.method_sha) == (
                sha,
                f.x_fits0,
                f.y_fits0,
                method_sha(cfg),
            ):
                pending[f.frame_id] = pre.future
            elif self.pool is not None:
                pending[f.frame_id] = self.pool.submit(entry.body, f.x_fits0, f.y_fits0, cfg)
            else:
                # one body in memory at a time
                pending[f.frame_id] = self._measure(entry.body, f, cfg)
        for f in fr.frames:
            job = pending.get(f.frame_id)
            if job is None:
                continue
            result = self._outcome(job, f, shas[f.frame_id], cfg)
            if isinstance(result, Refusal):
                refusals[f.frame_id] = result.reason
                continue
            absent.update(result.reject_flags_absent)
            s, lc = _point(f, result)
            spectrum.append(s)
            light.append(lc)
        spectrum.sort(key=lambda p: (p["wavelength_um"], p["frame_id"]))
        light.sort(key=lambda p: (p["time"], p["frame_id"]))

        missing = set(fr.missing) | {f"{r}:{fid}" for fid, r in refusals.items()}
        if (
            fr.frames
            and len(refusals) == len(fr.frames)
            and all(r == SATURATED for r in refusals.values())
        ):
            missing.add(ALL_SATURATED)
        body: dict[str, Any] = {
            "id": obj.id,
            "spectrum": spectrum,
            "light_curve": light,
            "flux_unit": OUTPUT_UNIT,
            "tag": "measured",
            "missing": sorted(missing),
            "data_release": release,
            "method": {**method_dict(cfg), "reject_flags_absent": sorted(absent)},
            "provenance": provenance(),
        }
        if complete and CUTOUT not in refusals.values():
            key = spectrum_key(release, obj.id, frames_digest(fr, shas), cfg)
            # ASSUMPTION: when every source was fetched live in this request (frames cached_at
            # is null), the stored entry dates itself now.
            earliest = fr.cached_at or utc_now()
            stored = {**body, "sources_earliest_fetched_at": iso_utc_z(earliest)}
            data = json.dumps(stored, sort_keys=True, separators=(",", ":")).encode("utf-8")
            self.ctx.cache.put(
                key,
                LiveResponse(data, "derived:spectrum", 200, "application/json"),
                if_changed=True,
            )
        return SpectrumResult(body, fr.cached_at, False, tuple(f.frame_id for f in fr.frames))

    def _outcome(
        self, job: Future[Outcome] | Outcome, f: FrameRecord, sha: str, cfg: MeasureConfig
    ) -> Outcome:
        if not isinstance(job, Future):
            return job
        try:
            return job.result()
        except Exception as exc:  # a dead worker: measure the same bytes here instead
            log.warning("photometry worker failed for %s, measuring in-thread: %s", f.frame_id, exc)
            entry = self.ctx.cache.get(cutout_key(self.ctx, f))
            if entry is None or entry.meta.get("body_sha256") != sha:
                # Only the bytes whose SHA-256 goes into the key may be measured.
                return Refusal(CUTOUT, "cutout changed or no longer cached")
            return self._measure(entry.body, f, cfg)

    def _measure(self, body: bytes, f: FrameRecord, cfg: MeasureConfig) -> Measurement | Refusal:
        try:
            hdul = wcs.open_fits(body)
        except (OSError, ValueError) as exc:
            return Refusal("cutout_unreadable", f"unreadable FITS: {exc}")
        with hdul:
            return measure_frame(hdul, f.x_fits0, f.y_fits0, cfg)


def report_targets(service: SpectrumService, objects: list[tuple[str, ResolvedObject]]) -> int:
    """Print one line per target; return the number of targets with neither a point nor an
    all-saturated refusal (the Done-when rule)."""
    bad = 0
    for name, obj in objects:
        result = service.get_spectrum(obj)
        body, ids = result.body, set(result.frame_ids)
        refusals: dict[str, int] = {}
        for m in body["missing"]:
            reason, _, fid = m.partition(":")
            # Stage 1 also writes cutout:<id> for frames that never reached its list.
            if reason in STAGE2_REASONS and fid in ids:
                refusals[reason] = refusals.get(reason, 0) + 1
        pts = body["spectrum"]
        waves = [p["wavelength_um"] for p in pts]
        span = f"{min(waves):.3f}-{max(waves):.3f} um" if waves else "-"
        flagged = sum(1 for p in pts if p["flagged"])
        sat = ALL_SATURATED in body["missing"]
        print(
            f"{name:<16} points={len(pts):<4} flagged={flagged:<4} refusals={refusals} "
            f"range={span}{' ALL SATURATED' if sat else ''}"
        )
        if not pts and not sat:
            bad += 1
    return bad
