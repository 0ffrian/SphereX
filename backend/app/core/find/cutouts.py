"""Cached cutouts for one (object, frame). Public API for Stage 2 (#2) and the PNG endpoint."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.adapters import irsa_cutout
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.core.find import png, wcs
from app.core.find.frames import FrameRecord, FrameService
from app.core.find.resolver import load_object


class CutoutUnavailable(LookupError):
    """Unknown object or frame, or the cutout is not cached and cannot be fetched."""


def cutout_bytes(service: FrameService, frame: FrameRecord) -> bytes:
    """The cached cutout FITS bytes for a frame (fetched live only when online)."""
    try:
        served = irsa_cutout.fetch_cutout(service.ctx, frame.sia_row(), frame.ra, frame.dec)
    except (CacheMissOffline, UpstreamUnavailable) as exc:
        raise CutoutUnavailable(str(exc)) from exc
    return served.entry.body


def load_cutout_hdul(service: FrameService, object_id: str, frame_id: str) -> Any:
    """Open the cached cutout as an astropy ``HDUList`` (IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE).

    Raises ``CutoutUnavailable``. The caller closes the HDUList.
    """
    obj = load_object(service.ctx, object_id)
    if obj is None:
        raise CutoutUnavailable(f"unknown object {object_id}")
    frame = service.find(obj, frame_id)
    if frame is None:
        raise CutoutUnavailable(f"unknown frame {frame_id} for {object_id}")
    return wcs.open_fits(cutout_bytes(service, frame))


def render_frame_png(service: FrameService, frame: FrameRecord) -> bytes:
    with wcs.open_fits(cutout_bytes(service, frame)) as hdul:
        data = np.asarray(hdul["IMAGE"].data)
    out = png.render_png(data)
    if out is None:
        raise CutoutUnavailable(f"frame {frame.frame_id} has no finite pixels to stretch")
    return out
