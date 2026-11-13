"""Overlay endpoints (issue #12, Q-50): catalogue markers and contamination, the FLAGS mask PNG
and a two-frame combination PNG. Plain ``def`` routes: the FITS work runs in the threadpool.
"""

from __future__ import annotations

import json
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from app.api.deps import get_ctx, get_frame_service, require_object
from app.api.models import ErrorResponse, OverlaysResponse
from app.api.objects import AroundQuery, DaysQuery, FrameId, ObjectId, track_window_of
from app.context import Context
from app.core.find import combine, flagmask, wcs
from app.core.find.cutouts import CutoutUnavailable, cutout_bytes
from app.core.find.frames import FrameRecord, FrameService
from app.core.find.overlays import OverlayService
from app.errors import ApiError

router = APIRouter(prefix="/v1/objects", tags=["overlays"])

FrameQuery = Annotated[str, Query(pattern=r"^[A-Za-z0-9_.-]{1,120}$")]
ERRORS: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}
PNG_HEADERS = {"Cache-Control": "public, max-age=86400"}
COMBINE_HEADER = "X-SX-Combine"


def get_overlay_service(request: Request) -> OverlayService:
    return cast(OverlayService, request.app.state.overlays)


def _frame(
    service: FrameService,
    ctx: Context,
    object_id: str,
    frame_id: str,
    around: str | None = None,
    days: float | None = None,
) -> FrameRecord:
    obj = require_object(ctx, object_id)
    frame = service.find(obj, frame_id, track_window_of(ctx, obj, around, days))
    if frame is None:
        raise ApiError(404, "frame_not_found", f"No frame '{frame_id}' for '{object_id}'.")
    return frame


def _cutout(service: FrameService, frame: FrameRecord) -> bytes:
    try:
        return cutout_bytes(service, frame)
    except CutoutUnavailable as exc:
        raise ApiError(503, "cutout_unavailable", str(exc)) from exc


@router.get(
    "/{object_id}/overlays",
    response_model=OverlaysResponse,
    response_model_exclude_unset=True,
    responses=ERRORS,
)
def get_overlays(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    overlays: Annotated[OverlayService, Depends(get_overlay_service)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> OverlaysResponse:
    """``around``/``days``: Track on demand (Q-468), the overlays of that window's frames."""
    obj = require_object(ctx, object_id)
    window = track_window_of(ctx, obj, around, days)
    return OverlaysResponse.model_validate(overlays.get_overlays(obj, window).body)


@router.get(
    "/{object_id}/flags/{frame_id}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **ERRORS},
)
def get_flags_png(
    object_id: ObjectId,
    frame_id: FrameId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> Response:
    frame = _frame(service, ctx, object_id, frame_id, around, days)
    with wcs.open_fits(_cutout(service, frame)) as hdul:
        try:
            data = flagmask.render_png(hdul)
        except flagmask.FlagMaskUnavailable as exc:
            # The cutout is there; its mask is not, and never will be: a permanent 404, not a
            # retryable 503. The overlays reply lists the same frame as ``flags_mask:<id>``.
            raise ApiError(404, "flags_unavailable", str(exc)) from exc
    return Response(content=data, media_type="image/png", headers=PNG_HEADERS)


@router.get(
    "/{object_id}/combine.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **ERRORS},
)
def get_combine_png(
    object_id: ObjectId,
    op: Annotated[Literal["add", "sub"], Query()],
    a: FrameQuery,
    b: FrameQuery,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> Response:
    fa = _frame(service, ctx, object_id, a, around, days)
    fb = _frame(service, ctx, object_id, b, around, days)
    body_a = _cutout(service, fa)
    body_b = body_a if a == b else _cutout(service, fb)
    with wcs.open_fits(body_a) as ha, wcs.open_fits(body_b) as hb:
        try:
            data, stretch = combine.combine(ha, hb, op, same_frame=a == b)
        except combine.CombineError as exc:
            raise ApiError(400, "bad_request", str(exc)) from exc
    meta = {
        "op": op,
        "a": a,
        "b": b,
        "wavelength_a_um": fa.wavelength_um,
        "wavelength_b_um": fb.wavelength_um,
        "unit": "MJy/sr",
        "stretch": stretch,
        "tag": "derived",
        "formula": combine.formula(op),
    }
    header = json.dumps(meta, separators=(",", ":"), sort_keys=False, ensure_ascii=True)
    headers = {
        **PNG_HEADERS,
        COMBINE_HEADER: header,
        "Access-Control-Expose-Headers": COMBINE_HEADER,
    }
    return Response(content=data, media_type="image/png", headers=headers)
