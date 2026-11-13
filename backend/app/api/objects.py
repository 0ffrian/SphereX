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
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from typing import Annotated, Any
from urllib.parse import urlencode

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictFloat

from app.api.deps import get_ctx, get_frame_service, get_pipeline, require_object
from app.api.models import ErrorResponse, Frame, FramesResponse, JobStatus, Provenance, Stretch
from app.context import Context
from app.contract.object_card_schema import ObjectCard
from app.contract.render_params_schema import RenderParams
from app.contract.track_path_schema import TrackPath
from app.core.card.service import ObjectPipeline, ObjectResult, track_job_key
from app.core.find import moving, png
from app.core.find import path as track_path
from app.core.find.cutouts import CutoutUnavailable, render_frame_png
from app.core.find.frames import FrameService
from app.core.find.ids import ID_RE
from app.core.find.propagate import FORMULA as PM_FORMULA
from app.core.find.propagate import NEGLECTED as PM_NEGLECTED
from app.core.find.resolver import ResolvedObject
from app.core.find.track import TrackCheck
from app.core.find.wcs import NORTH_ANGLE_FORMULA
from app.core.jobs import Job, QueueFull
from app.errors import ApiError
from app.timefmt import iso_utc_z, parse_utc

router = APIRouter(prefix="/v1/objects", tags=["objects"])

ObjectId = Annotated[str, Path(pattern=ID_RE, max_length=200)]
FrameId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_.-]{1,120}$")]
ERRORS: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


# ISO-8601 time (UTC when no offset is given); a bad value is refused, never guessed.
TimeQuery = Annotated[str | None, Query(max_length=40)]
# Track on demand (issue #142, Q-468): ``around`` +- ``days`` on the Track readers.
AroundQuery = Annotated[
    str | None,
    Query(max_length=40, description="Track on demand: ISO-8601 time (UTC when no offset)"),
]
DaysQuery = Annotated[
    float | None,
    Query(
        ge=moving.TRACK_WINDOW_MIN_DAYS,
        le=moving.TRACK_WINDOW_MAX_DAYS,
        description="Track on demand: half-width of the window in days (default 3)",
    ),
]


def _time_param(name: str, value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return parse_utc(value)
    except (ValueError, OverflowError) as exc:  # OverflowError: year 1 with an offset
        raise ApiError(400, "bad_request", f"'{name}' is not an ISO-8601 time.") from exc


def track_window_of(
    ctx: Context, obj: ResolvedObject, around: str | None, days: float | None
) -> moving.Window | None:
    """Track on demand's window (Q-468) from ``around`` and ``days``, or ``None`` when
    ``around`` is absent (the base windows). Refuses what it cannot serve, never widens."""
    if around is None:
        if days is not None:
            raise ApiError(400, "bad_request", "'days' needs 'around'.")
        return None
    if not obj.moving:
        raise ApiError(404, "not_moving", f"'{obj.id}' does not move: it has no path.")
    if not obj.spkid:
        raise ApiError(404, "no_ephemeris", f"'{obj.id}' has no SPK id: Horizons has no path.")
    when = _time_param("around", around)
    assert when is not None  # a str parses or raises
    try:
        window = moving.track_window(when, moving.TRACK_WINDOW_DAYS if days is None else days)
    except OverflowError as exc:  # past year 1 or 9999: outside every search window anyway
        raise _outside() from exc
    if not moving.track_windows(ctx, obj.spkid, window):
        raise _outside()
    return window


def _outside() -> ApiError:
    return ApiError(
        400,
        "track_window_outside",
        "The window misses every search window of this object (its targets.toml windows or "
        "the data release).",
    )


def _window_reply(window: moving.Window) -> list[str]:
    return [iso_utc_z(window[0]), iso_utc_z(window[1])]


def _track_query(around: str | None, days: float | None) -> str:
    """The ``around``/``days`` part of a cutout URL, so it finds the frame in the same list."""
    if around is None:
        return ""
    q: dict[str, str] = {"around": around}
    if days is not None:
        q["days"] = repr(days)
    return "?" + urlencode(q)


PIXEL_FORMULA = (
    "astropy WCS world_to_pixel on the cutout IMAGE header at (ra, dec); "
    "x = x_fits0, y = (height - 1) - y_fits0; integer = pixel centre"
)


def _provenance(obj: ResolvedObject, has_pm: bool) -> dict[str, Provenance]:
    pixel = Provenance(tag="derived", formula=PIXEL_FORMULA)
    if obj.moving:
        # Issue #26 (Q-125): the per-frame position is the interpolated Horizons prediction, and
        # the pixel is computed from it, so both carry the ephemeris assumption.
        basis = moving.position_basis()
        pos = Provenance(
            tag="model_dependent", source="JPL Horizons, at the frame time", assumption=basis
        )
        pixel = Provenance(
            tag="model_dependent",
            formula=PIXEL_FORMULA,
            assumption=f"(ra, dec) is the Horizons prediction at the frame time: {basis}",
        )
    elif has_pm:
        pos = Provenance(
            tag="derived",
            formula=f"{PM_FORMULA}; {PM_NEGLECTED}",
            source="SIMBAD position and proper motion, at the frame time",
        )
    else:
        # No propagation: the frame position is the resolved position, with its own tag
        # (SIMBAD measured, typed coordinates per Q-25).
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
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> FramesResponse:
    """``around``/``days``: Track on demand (Q-468), the frames of that window only (cached or
    handed to the window's Track job), with ``track_window`` set."""
    obj = require_object(ctx, object_id)
    window = track_window_of(ctx, obj, around, days)
    result = service.get_frames(obj, window=window)
    query = _track_query(around, days)
    frames = [
        Frame(
            frame_id=f.frame_id,
            time=f.time,
            wavelength_um=f.wavelength_um,
            x=f.x,
            y=f.y,
            cutout_url=f"/v1/objects/{obj.id}/cutouts/{f.frame_id}.png{query}",
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
    extra = {"track_window": _window_reply(window)} if window is not None else {}
    return FramesResponse(
        **extra,
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
    "/{object_id}/path",
    response_class=JSONResponse,
    responses={200: {"model": TrackPath}, 400: {"model": ErrorResponse}, **ERRORS},
)
def get_path(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
    start: TimeQuery = None,
    end: TimeQuery = None,
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> JSONResponse:
    """A moving object's path seen from SPHEREx (A19.5, Q-141), from the cache only. The body
    is the ``shared/schemas/track-path.schema.json`` shape (issue #74). ``around``/``days``:
    Track on demand (Q-468); ``windows`` then holds that window, clipped."""
    obj = require_object(ctx, object_id)
    if not obj.moving:
        raise ApiError(404, "not_moving", f"'{object_id}' does not move: it has no path.")
    window = track_window_of(ctx, obj, around, days)
    lo, hi = _time_param("start", start), _time_param("end", end)
    try:
        body = track_path.build_path(ctx, service, obj, lo, hi, window)
    except track_path.PathRangeError as exc:
        raise ApiError(400, exc.code, str(exc)) from exc
    return JSONResponse(content=body)


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
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> Response:
    obj = require_object(ctx, object_id)
    frame = service.find(obj, frame_id, track_window_of(ctx, obj, around, days))
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
    result = pipeline.run(require_object(ctx, object_id))
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
    result = pipeline.run(require_object(ctx, object_id))
    return _contract_reply(result.params, result, pipeline)


def _idle(object_id: str) -> dict[str, Any]:
    return {"id": object_id, "state": "idle"}


def _job_of(
    ctx: Context,
    pipeline: ObjectPipeline,
    obj: ResolvedObject,
    around: str | None,
    days: float | None,
) -> tuple[Job[Any] | None, Callable[[dict[str, Any]], dict[str, Any]]]:
    """The job ``/job`` and ``/job/events`` report (the object job, or with ``around`` the
    window's Track job, Q-468) and how to turn one of its snapshots into the reply."""
    window = track_window_of(ctx, obj, around, days)
    if window is None:
        return pipeline.jobs.get(obj.id), lambda snap: snap
    job = pipeline.track_jobs.get(track_job_key(obj.id, window))
    return job, _track_view(obj, window, job)


def _track_view(
    obj: ResolvedObject, window: moving.Window, job: Job[TrackCheck] | None
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """A Track job's snapshot as the reply: the object's id (not the job key), the window, and
    once the job is done its ``track.check`` answer."""

    def view(snap: dict[str, Any]) -> dict[str, Any]:
        out = {**snap, "id": obj.id, "track_window": _window_reply(window)}
        final = job.final if job is not None and snap.get("state") == "done" else None
        if final is not None:
            out["track_available"] = final.available
            out["reason"] = final.reason or None
        return out

    return view


@router.get(
    "/{object_id}/job",
    responses={200: {"model": JobStatus}, 400: {"model": ErrorResponse}, **ERRORS},
)
def get_job(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> JSONResponse:
    """The object's background job (Q-111): ``state`` running, done, failed, or idle when there is
    none (this route never starts one), its ``stage`` and frames n of N. No side effects.
    ``around``/``days``: the Track on demand job of that window instead (Q-468)."""
    obj = require_object(ctx, object_id)
    job, view = _job_of(ctx, pipeline, obj, around, days)
    return JSONResponse(view(job.snapshot()) if job is not None else view(_idle(obj.id)))


class TrackRequest(BaseModel):
    """``POST /v1/objects/{id}/track`` body (issue #142, Q-468): Track for a mover limited to
    ``around`` +- ``days`` (clipped to the target's or the release's windows)."""

    model_config = ConfigDict(extra="forbid")

    around: str = Field(max_length=40, description="ISO-8601 time (UTC when no offset)")
    # Strict: ``true`` or ``"3"`` is refused, not read as a number (PR #150 review).
    days: StrictFloat = Field(
        default=moving.TRACK_WINDOW_DAYS,
        ge=moving.TRACK_WINDOW_MIN_DAYS,
        le=moving.TRACK_WINDOW_MAX_DAYS,
        description="half-width of the window, in days",
    )


@router.post(
    "/{object_id}/track",
    status_code=202,
    responses={
        202: {"model": JobStatus},
        400: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        **ERRORS,
    },
)
def post_track(
    object_id: ObjectId,
    body: TrackRequest,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
) -> JSONResponse:
    """Track on demand (issue #142, Q-468): start (or join) the Track job of this object for
    ``around`` +- ``days``: its path search, cutouts and spectrum, for that window only. Nothing
    is stored for other callers: the card, the areas and the readers without ``around`` keep
    the base windows. The reply is the ``/job`` JSON (``JobStatus``) with 202; follow it on
    ``/job`` or ``/job/events`` with the same two parameters, then read ``/frames``, ``/path``
    and ``/spectrum`` with them."""
    obj = require_object(ctx, object_id)
    window = track_window_of(ctx, obj, body.around, body.days)
    assert window is not None  # ``around`` is required by the body
    try:
        job = pipeline.ensure_track_job(obj, window)
    except QueueFull as exc:
        raise ApiError(
            429, "queue_full", "Too many Track jobs are running; try again in a minute."
        ) from exc
    return JSONResponse(_track_view(obj, window, job)(job.snapshot()), status_code=202)


@router.get(
    "/{object_id}/job/events",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"text/event-stream": {}}},
        400: {"model": ErrorResponse},
        **ERRORS,
    },
)
def get_job_events(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> StreamingResponse:
    """Server-sent events: one ``data:`` line (the ``/job`` JSON) per change, ending after the
    job finishes. With no job, one ``idle`` event and the stream ends. ``around``/``days``: the
    Track on demand job of that window (Q-468)."""
    obj = require_object(ctx, object_id)
    job, view = _job_of(ctx, pipeline, obj, around, days)

    async def events() -> AsyncIterator[str]:
        if job is None:
            yield f"data: {json.dumps(view(_idle(obj.id)))}\n\n"
            return
        end = time.monotonic() + STREAM_MAX_S
        snap = job.snapshot()
        while True:
            yield f"data: {json.dumps(view(snap))}\n\n"
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
