"""``/v1/objects/{id}/frames`` and ``/v1/objects/{id}/cutouts/{frame_id}.png`` (D-16, A4.1).

Issue #41: ``/card`` and ``/render-params`` join the object's background job and may return the
first-stage answer while the spectrum is measured (``X-SX-Measuring``, ``X-SX-Progress``).
``/job`` and ``/job/events`` report the job's progress for the build steps (Q-111).

Routes are plain ``def`` so FITS and PNG work runs in FastAPI's threadpool. ``/spectrum`` is
issue #2. ``/card`` and ``/render-params`` (issue #5, A4.5, A4.7) return the R3.2 and R3.4 shapes
exactly, validated against ``shared/schemas/``; the schemas forbid extra fields, so ``cached_at``
(D-16) and the stage 4 asset status travel as headers (Q-39).
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, Path
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.api.deps import get_ctx, get_frame_service, get_pipeline, require_object
from app.api.models import ErrorResponse, Frame, FramesResponse, JobStatus, Provenance, Stretch
from app.context import Context
from app.contract.object_card_schema import ObjectCard
from app.contract.render_params_schema import RenderParams
from app.core.card.service import ObjectPipeline, ObjectResult
from app.core.find import png
from app.core.find.cutouts import CutoutUnavailable, render_frame_png
from app.core.find.frames import FrameService
from app.core.find.ids import ID_RE
from app.core.find.propagate import FORMULA as PM_FORMULA
from app.core.find.propagate import NEGLECTED as PM_NEGLECTED
from app.core.find.resolver import ResolvedObject
from app.core.find.wcs import NORTH_ANGLE_FORMULA
from app.errors import ApiError
from app.timefmt import iso_utc_z

router = APIRouter(prefix="/v1/objects", tags=["objects"])

ObjectId = Annotated[str, Path(pattern=ID_RE, max_length=200)]
FrameId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_.-]{1,120}$")]
ERRORS: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


_object = require_object


def _provenance(obj: ResolvedObject, has_pm: bool) -> dict[str, Provenance]:
    if has_pm:
        pos = Provenance(
            tag="derived",
            formula=f"{PM_FORMULA}; {PM_NEGLECTED}",
            source="SIMBAD position and proper motion, at the frame time",
        )
    else:
        # No propagation: the frame position is the resolved position, with its own tag
        # (SIMBAD measured, Horizons model_dependent, typed coordinates per Q-25).
        pos = (
            Provenance.model_validate(obj.provenance["ra"])
            if "ra" in obj.provenance
            else Provenance(tag="derived", formula="resolved position, not propagated")
        )
    frame_time = Provenance(
        tag="measured", source="midpoint of the IRSA SIA t_min/t_max exposure bounds (UTC)"
    )
    wave = Provenance(
        tag="measured", source="WCS-WAVE lookup table (alternate WCS 'W') at the object pixel"
    )
    pixel = Provenance(
        tag="derived",
        formula="astropy WCS world_to_pixel on the cutout IMAGE header at (ra, dec); "
        "x = x_fits0, y = (height - 1) - y_fits0; integer = pixel centre",
    )
    return {
        "time": frame_time,
        "wavelength_um": wave,
        "bandwidth_um": wave,
        "flags": Provenance(tag="measured", source="FLAGS extension bits at the nearest pixel"),
        "x": pixel,
        "y": pixel,
        "ra": pos,
        "dec": pos,
        "north_angle_deg": Provenance(tag="derived", formula=NORTH_ANGLE_FORMULA),
        "mirrored": Provenance(tag="derived", formula=NORTH_ANGLE_FORMULA),
        "cutout_pixels": Provenance(tag="measured", source="SPHEREx Level-2 IMAGE (MJy/sr), IRSA"),
        "stretch": Provenance(tag="derived", formula=png.STRETCH_FORMULA),
    }


@router.get(
    "/{object_id}/frames",
    response_model=FramesResponse,
    response_model_exclude_unset=True,
    responses=ERRORS,
)
def get_frames(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
) -> FramesResponse:
    obj = _object(ctx, object_id)
    result = service.get_frames(obj)
    frames = [
        Frame(
            frame_id=f.frame_id,
            time=f.time,
            wavelength_um=f.wavelength_um,
            x=f.x,
            y=f.y,
            cutout_url=f"/v1/objects/{obj.id}/cutouts/{f.frame_id}.png",
            flags=f.flags,
            ra=round(f.ra, 7),
            dec=round(f.dec, 7),
            bandwidth_um=f.bandwidth_um,
            detector=f.detector,
            width=f.width,
            height=f.height,
            north_angle_deg=f.north_angle_deg,
            mirrored=f.mirrored,
        )
        for f in result.frames
    ]
    return FramesResponse(
        id=obj.id,
        frames=frames,
        stretch=Stretch(**png.STRETCH),
        data_release=ctx.settings.data_release,
        cached_at=iso_utc_z(result.cached_at) if result.cached_at else None,
        missing=result.missing,
        north_up=False,  # native orientation in M1; north_angle_deg/mirrored let the UI rotate
        provenance=_provenance(obj, result.has_proper_motion),
    )


@router.get(
    "/{object_id}/cutouts/{frame_id}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **ERRORS},
)
def get_cutout_png(
    object_id: ObjectId,
    frame_id: FrameId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
) -> Response:
    obj = _object(ctx, object_id)
    frame = service.find(obj, frame_id)
    if frame is None:
        raise ApiError(404, "frame_not_found", f"No frame '{frame_id}' for '{object_id}'.")
    try:
        data = render_frame_png(service, frame)
    except CutoutUnavailable as exc:
        raise ApiError(503, "cutout_unavailable", str(exc)) from exc
    return Response(
        content=data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"}
    )


# ASSUMPTION (Q-39): the R3 shapes have no cached_at and forbid extra fields, so D-16's
# cached_at and the A4.4 asset status (saved / generated / sketch) are response headers.
CACHED_AT_HEADER = "X-SX-Cached-At"
ASSET_STATUS_HEADER = "X-SX-Asset-Status"
# Issue #41 (Q-111 (3)): present only on a reply that still has `measuring:` items (first stage,
# partial, or a final built from the first batch only). MEASURING lists the `measuring:` items
# of RenderParams.missing; PROGRESS is "frames <done>/<total>" ("frames 0/?" before the search).
MEASURING_HEADER = "X-SX-Measuring"
PROGRESS_HEADER = "X-SX-Progress"
# A comment line every this many seconds keeps an idle event stream open through proxies.
KEEPALIVE_S = 15.0
# A stream ends after this long; EventSource reconnects by itself. Bounds how long a forgotten
# tab holds a waiting thread and how long it can delay a graceful shutdown.
STREAM_MAX_S = 300.0
# The blocking waits of all event streams share these threads, not the request thread pool, so
# open streams can never starve /card, /frames or the cutouts. A stream beyond the limit waits.
_EVENT_THREADS = anyio.CapacityLimiter(8)


def _contract_reply(
    body: dict[str, object], result: ObjectResult, pipeline: ObjectPipeline
) -> JSONResponse:
    headers: dict[str, str] = {ASSET_STATUS_HEADER: result.status}
    if result.cached_at is not None:
        headers[CACHED_AT_HEADER] = iso_utc_z(result.cached_at)
    if result.measuring:
        headers[MEASURING_HEADER] = ",".join(result.measuring)
        job = pipeline.jobs.get(str(body["id"]))
        snap = job.snapshot() if job is not None else None
        if snap is not None:
            total = "?" if snap["frames_total"] is None else snap["frames_total"]
            headers[PROGRESS_HEADER] = f"frames {snap['frames_done']}/{total}"
    return JSONResponse(content=body, headers=headers)


@router.get(
    "/{object_id}/card",
    response_class=JSONResponse,
    responses={200: {"model": ObjectCard}, **ERRORS},
)
def get_card(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
) -> JSONResponse:
    result = pipeline.run(_object(ctx, object_id))
    return _contract_reply(result.card, result, pipeline)


@router.get(
    "/{object_id}/render-params",
    response_class=JSONResponse,
    responses={200: {"model": RenderParams}, **ERRORS},
)
def get_render_params(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
) -> JSONResponse:
    result = pipeline.run(_object(ctx, object_id))
    return _contract_reply(result.params, result, pipeline)


def _idle(object_id: str) -> dict[str, Any]:
    return {"id": object_id, "state": "idle"}


@router.get("/{object_id}/job", responses={200: {"model": JobStatus}, **ERRORS})
def get_job(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
) -> JSONResponse:
    """The object's background job (Q-111): ``state`` running, done, failed, or idle when there is
    none (this route never starts one), its ``stage`` and frames n of N. No side effects."""
    obj = _object(ctx, object_id)
    job = pipeline.jobs.get(obj.id)
    return JSONResponse(job.snapshot() if job is not None else _idle(obj.id))


@router.get(
    "/{object_id}/job/events",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}, **ERRORS},
)
def get_job_events(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
) -> StreamingResponse:
    """Server-sent events: one ``data:`` line (the ``/job`` JSON) per change, ending after the
    job finishes. With no job, one ``idle`` event and the stream ends."""
    obj = _object(ctx, object_id)
    job = pipeline.jobs.get(obj.id)

    async def events() -> AsyncIterator[str]:
        if job is None:
            yield f"data: {json.dumps(_idle(obj.id))}\n\n"
            return
        end = time.monotonic() + STREAM_MAX_S
        snap = job.snapshot()
        while True:
            yield f"data: {json.dumps(snap)}\n\n"
            if snap["state"] != "running":
                return
            while True:
                if time.monotonic() >= end:
                    return
                nxt = await anyio.to_thread.run_sync(
                    job.wait_change, int(snap["seq"]), KEEPALIVE_S, limiter=_EVENT_THREADS
                )
                if nxt["seq"] != snap["seq"] or nxt["state"] != "running":
                    break
                yield ": keep-alive\n\n"
            snap = nxt

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"}
    )
