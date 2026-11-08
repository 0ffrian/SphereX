"""The composite for one object: frames -> Stage 2 verdicts -> band selection -> image -> cache.

- Stage 1 (``FrameService.get_frames``) is called once per request. Inside the API it downloads
  nothing itself: it starts or joins the object's job, which downloads the cutouts (issue #41,
  Q-111), and lists the rest as deferred, as for ``/frames``. Stage 2 and the composite read only
  cutouts already in the cache.
- Stage 2 (``SpectrumService``, served from its own derived cache when it can) says which frames
  are usable: a frame it refused (``saturated``, ``aperture_flags`` ...) is never used.
- The result (the response body and the PNG bytes) is a derived cache entry (D-25), keyed by the
  object's position and proper motion, the chosen frames (records and cutout SHA-256), the
  cutout size and every composite constant. It is stored only while Stage 1's frame list is
  complete and no frame was refused for an uncached cutout, as for the spectrum.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import statistics
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np

from app.cache.keys import CacheKey, norm_float
from app.cache.store import LiveResponse
from app.context import Context
from app.core.composite import config, grid
from app.core.composite.select import Candidate, Selection, select_bands
from app.core.find import wcs
from app.core.find.frames import (
    DEFERRED,
    TRUNCATED,
    FrameRecord,
    FrameService,
    FramesResult,
    has_proper_motion,
    is_complete,
    position_at,
)
from app.core.find.resolver import ResolvedObject
from app.core.find.version import DERIVATION_VERSION
from app.core.measure.spectrum import CUTOUT, STAGE2_REASONS, SpectrumService, cutout_key
from app.timefmt import iso_utc_z, parse_utc, utc_now

COMPOSITE_SOURCE = "derived.composite"
MOVING = "composite:moving_object"
NO_PROPER_MOTION = "composite:no_proper_motion"
NO_PIXEL_SCALE = "composite:pixel_scale"
TAG = "derived"


@dataclass
class CompositeResult:
    body: dict[str, Any]  # the response without cached_at
    png: bytes | None
    cached_at: datetime | None
    from_cache: bool


def png_version(png: bytes) -> str:
    return hashlib.sha256(png).hexdigest()[:12]


def candidates(fr: FramesResult, spectrum: dict[str, Any]) -> list[Candidate]:
    """One candidate per Stage 1 frame with Stage 2's verdict (a point, or a refusal)."""
    points = {p["frame_id"]: p for p in spectrum.get("spectrum", [])}
    refused: dict[str, str] = {}
    for m in spectrum.get("missing", []):
        reason, _, fid = str(m).partition(":")
        if reason in STAGE2_REASONS and fid:
            refused[fid] = reason
    out = []
    for f in fr.frames:
        p = points.get(f.frame_id)
        out.append(
            Candidate(
                frame_id=f.frame_id,
                time=parse_utc(f.time),
                wavelength_um=f.wavelength_um,
                usable=p is not None,
                flagged=bool(p and p.get("dropped_flags")),
                # Stage 2 accounts for every frame; "measure" only if it somehow did not.
                refusal=None if p is not None else refused.get(f.frame_id, "measure"),
            )
        )
    return out


def mean_time(times: list[datetime]) -> datetime:
    ts = sorted(t.timestamp() for t in times)
    return datetime.fromtimestamp(sum(ts) / len(ts), tz=UTC)


def centre_text(obj: ResolvedObject) -> str:
    if has_proper_motion(obj):
        return "catalogue position propagated linearly with its proper motion"
    if obj.resolver == "coords":
        return "the typed coordinates"
    return "the catalogue position, not propagated: no proper motion is known"


def formula(
    release: str, picks: list[dict[str, Any]], size: int, scale: float, epoch: datetime, obj: Any
) -> str:
    b, g, r = (p["wavelength_um"] for p in picks)
    days = sorted(p["time"][:10] for p in picks)
    return (
        f"false colour: B = {b:.3f} µm, G = {g:.3f} µm, R = {r:.3f} µm SPHEREx {release} frames "
        f"from {days[0]} to {days[-1]}; each band asinh-stretched separately: "
        f"v = clip((d - lo)/(hi - lo), 0, 1) with lo the {config.LOWER_PERCENTILE:g}th "
        f"percentile (median) of that band's resampled pixels and hi the larger of its "
        f"{config.UPPER_PERCENTILE:g}th percentile and median + {config.MIN_RANGE_SIGMA:g} "
        f"robust sigma (1.4826 MAD), "
        f"out = asinh(v/{config.ASINH_A:g})/asinh(1/{config.ASINH_A:g}); "
        f"reprojected by {config.INTERPOLATION} interpolation through each frame's FITS WCS onto "
        f"a north-up, east-left TAN grid of {size}x{size} px at {scale:.2f} arcsec/px, centred "
        f"on the object at {iso_utc_z(epoch)}, the mean time of the three frames "
        f"({centre_text(obj)}); pixels with a Stage 2 "
        f"reject flag are masked, and masked or missing pixels are black; channel wavelengths "
        f"near {config.TARGET_UM['blue']:g}, {config.TARGET_UM['green']:g} and "
        f"{config.TARGET_UM['red']:g} µm are a display choice"
    )


def composite_key(
    ctx: Context,
    obj: ResolvedObject,
    frames: list[FrameRecord],
    shas: list[str],
    selection_notes: list[str],
) -> CacheKey:
    """Every input of the stored body and PNG. ``selection_notes`` (the ``skipped`` notes) come
    from frames other than the three chosen ones, so they are keyed too."""
    doc = {
        "params": config.params_sha(),
        "object": [obj.ra, obj.dec, obj.pm_ra_mas_yr, obj.pm_dec_mas_yr, obj.resolver],
        "frames": [
            {**asdict(f), "cutout_sha256": sha} for f, sha in zip(frames, shas, strict=True)
        ],
        "selection_notes": sorted(selection_notes),
    }
    text = json.dumps(doc, sort_keys=True, separators=(",", ":"))
    return CacheKey.make(
        COMPOSITE_SOURCE,
        ctx.settings.data_release,
        id=obj.id,
        v=DERIVATION_VERSION,
        composite=config.COMPOSITE_VERSION,
        size_arcsec=norm_float(ctx.settings.cutout_size_arcsec, 1),
        inputs=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )


class CompositeService:
    def __init__(self, frames: FrameService) -> None:
        self.frames = frames
        self.ctx = frames.ctx

    def _base(self, obj: ResolvedObject, missing: list[str]) -> dict[str, Any]:
        return {
            "id": obj.id,
            "data_release": self.ctx.settings.data_release,
            "image_url": None,
            "width": None,
            "height": None,
            "scale_arcsec_px": None,
            "north_up": True,
            "x": None,
            "y": None,
            "bands": [],
            "tag": TAG,
            "formula": (
                "false colour: B, G, R = SPHEREx frames near "
                f"{config.TARGET_UM['blue']:g}, {config.TARGET_UM['green']:g} and "
                f"{config.TARGET_UM['red']:g} µm from one survey pass; not drawn (see missing)"
            ),
            "missing": sorted(set(missing)),
        }

    def get(self, obj: ResolvedObject, *, use_memo: bool = False) -> CompositeResult:
        if obj.moving:
            # Q-21: no frames for moving objects yet; and a mover is not on one patch anyway.
            return CompositeResult(self._base(obj, [MOVING]), None, None, False)
        fr = self.frames.get_frames(obj, use_memo=use_memo)
        spec = SpectrumService(self.frames).get_spectrum(obj, frames=fr)
        passthrough = [m for m in fr.missing if m == TRUNCATED or m.startswith(DEFERRED + ":")]
        no_pm = obj.resolver == "simbad" and not has_proper_motion(obj)
        notes = [NO_PROPER_MOTION] if no_pm else []

        selection = select_bands(candidates(fr, spec.body))
        if not selection.ok:
            body = self._base(obj, [*selection.missing, *passthrough])
            return CompositeResult(body, None, fr.cached_at, False)

        by_id = {f.frame_id: f for f in fr.frames}
        chosen = [by_id[p.candidate.frame_id] for p in selection.picks]
        metas = [self.ctx.cache.get_meta(cutout_key(self.ctx, f)) for f in chosen]
        shas = [str(m.get("body_sha256", "")) if m else "" for m in metas]
        storable = (
            is_complete(fr.missing)
            and all(shas)
            and not any(str(m).startswith(CUTOUT + ":") for m in spec.body.get("missing", []))
        )
        key = composite_key(self.ctx, obj, chosen, shas, selection.missing)
        if all(shas):
            hit = self.ctx.cache.get(key)
            if hit is not None:
                doc = json.loads(hit.body)
                cached_png = base64.b64decode(doc.pop("png_base64"))
                cached = doc.pop("sources_earliest_fetched_at", None)
                when = parse_utc(cached) if cached else None
                # Same frames, same image; the current list may still be incomplete (live).
                doc["missing"] = sorted({*doc["missing"], *passthrough})
                return CompositeResult(doc, cached_png, when, True)

        body, png, read_shas = self._build(obj, chosen, selection, [*notes, *passthrough])
        if png is not None and storable:
            # Keyed on the SHA-256 of the bytes actually resampled (as Stage 2 does), not the
            # meta read above, so a cutout replaced in between cannot be stored under old keys.
            key = composite_key(self.ctx, obj, chosen, read_shas, selection.missing)
            # ASSUMPTION (as for the spectrum): when every source was fetched live in this
            # request (frames cached_at is null), the stored entry dates itself now.
            earliest = fr.cached_at or utc_now()
            stored = {
                **body,
                "png_base64": base64.b64encode(png).decode("ascii"),
                "sources_earliest_fetched_at": iso_utc_z(earliest),
            }
            data = json.dumps(stored, sort_keys=True, separators=(",", ":")).encode("utf-8")
            self.ctx.cache.put(
                key,
                LiveResponse(data, "derived:composite", 200, "application/json"),
                if_changed=True,
            )
        return CompositeResult(body, png, fr.cached_at, False)

    def _build(
        self,
        obj: ResolvedObject,
        chosen: list[FrameRecord],
        selection: Selection,
        notes: list[str],
    ) -> tuple[dict[str, Any], bytes | None, list[str]]:
        """The body, the PNG (None when refused) and the SHA-256 of each cutout body read."""
        images: list[tuple[Any, Any]] = []
        scales: list[float] = []
        unmasked: list[str] = []
        read_shas: list[str] = []
        for f in chosen:
            entry = self.ctx.cache.get(cutout_key(self.ctx, f))
            if entry is None:
                return self._base(obj, [f"{CUTOUT}:{f.frame_id}", *notes]), None, read_shas
            read_shas.append(str(entry.meta.get("body_sha256", "")))
            unreadable = f"cutout_unreadable:{f.frame_id}"
            try:
                hdul = wcs.open_fits(entry.body)
            except (OSError, ValueError):
                return self._base(obj, [unreadable, *notes]), None, read_shas
            with hdul:
                if "IMAGE" not in hdul:
                    return self._base(obj, [unreadable, *notes]), None, read_shas
                header = hdul["IMAGE"].header.copy()
                data, masked = grid.masked_image(hdul)
                if not masked:
                    unmasked.append(f"composite:flags_unmasked:{f.frame_id}")
            images.append((data, header))
            scale = grid.local_scale_arcsec(header, f.x_fits0, f.y_fits0)
            if scale is not None:
                scales.append(scale)
        scale = round(statistics.median(scales), config.SCALE_DP) if scales else math.nan
        # A WCS whose scale rounds to 0 would divide by zero (or ask for a huge grid).
        if len(scales) != len(chosen) or not (math.isfinite(scale) and scale > 0):
            return self._base(obj, [NO_PIXEL_SCALE, *notes]), None, read_shas

        size = grid.grid_size(self.ctx.settings.cutout_size_arcsec, scale)
        epoch = mean_time([parse_utc(f.time) for f in chosen])
        ra, dec = position_at(obj, epoch)
        g = grid.Grid(ra, dec, scale, size)
        sky_ra, sky_dec = g.sky()

        bands_u8 = []
        bands: list[dict[str, Any]] = []
        for (data, header), f, pick in zip(images, chosen, selection.picks, strict=True):
            sampled = grid.resample(data, header, sky_ra, sky_dec)
            u8 = grid.stretch(sampled)
            if u8 is None:
                refusal = f"composite:{pick.channel}:stretch"
                return self._base(obj, [refusal, *notes]), None, read_shas
            bands_u8.append(u8)
            bands.append(
                {
                    "channel": pick.channel,
                    "frame_id": f.frame_id,
                    "wavelength_um": f.wavelength_um,
                    "time": f.time,
                    "bandwidth_um": f.bandwidth_um,
                    "nodata_px": int(np.count_nonzero(~np.isfinite(sampled))),
                }
            )
        blue, green, red = bands_u8
        png = grid.encode_rgb(red, green, blue)
        x, y = g.png_xy(ra, dec)
        body = self._base(obj, [*selection.missing, *unmasked, *notes])
        body.update(
            {
                "image_url": f"/v1/objects/{obj.id}/composite.png?v={png_version(png)}",
                "width": size,
                "height": size,
                "scale_arcsec_px": scale,
                "x": round(x, 3),
                "y": round(y, 3),
                "ra": round(ra, 7),
                "dec": round(dec, 7),
                "epoch": iso_utc_z(epoch),
                "bands": bands,
                "formula": formula(self.ctx.settings.data_release, bands, size, scale, epoch, obj),
            }
        )
        return body, png, read_shas
