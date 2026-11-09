"""``/v1/objects/{id}/composite`` and ``/composite.png``: SPHEREx false-colour composite.

Beyond D-16 (Q-92). Tagged ``derived`` (false colour, Q-27): three SPHEREx frames
of one pass at a short, middle and long wavelength, reprojected onto one north-up, east-left TAN
grid and written as B, G, R. ``x``, ``y`` follow the frames convention (0-based PNG pixel, origin
top left, y down, integer = pixel centre). A refusal is a 200 reply with ``image_url: null`` and
the reasons in ``missing``. Plain ``def`` routes: the FITS work runs in the threadpool.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.deps import get_ctx, get_frame_service, require_object
from app.api.models import ErrorResponse
from app.context import Context
from app.core.composite.service import CompositeService, png_version
from app.core.find.frames import FrameService
from app.core.find.ids import ID_RE
from app.errors import ApiError
from app.timefmt import iso_utc_z

router = APIRouter(prefix="/v1/objects", tags=["composite"])

ObjectId = Annotated[str, Path(pattern=ID_RE, max_length=200)]
ERRORS: dict[int | str, dict[str, object]] = {
    404: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


class CompositeBand(BaseModel):
    channel: Literal["blue", "green", "red"]
    frame_id: str
    wavelength_um: float
    time: str
    # Optional additions
    bandwidth_um: float | None = None
    nodata_px: int | None = None  # output pixels with no data in this band (drawn black)


class CompositeResponse(BaseModel):
    id: str
    data_release: str
    image_url: str | None
    width: int | None
    height: int | None
    scale_arcsec_px: float | None
    north_up: Literal[True]
    x: float | None
    y: float | None
    bands: list[CompositeBand]
    tag: Literal["derived"]
    formula: str
    missing: list[str]
    cached_at: str | None
    # Optional additions: the grid centre and the epoch it refers to
    ra: float | None = None
    dec: float | None = None
    epoch: str | None = None


@router.get(
    "/{object_id}/composite",
    response_model=CompositeResponse,
    response_model_exclude_unset=True,
    responses=ERRORS,
)
def get_composite(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
) -> CompositeResponse:
    result = CompositeService(service).get(require_object(ctx, object_id))
    cached_at = iso_utc_z(result.cached_at) if result.cached_at else None
    return CompositeResponse.model_validate({**result.body, "cached_at": cached_at})


@router.get(
    "/{object_id}/composite.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **ERRORS},
)
def get_composite_png(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
    v: Annotated[str | None, Query(pattern=r"^[0-9a-f]{1,64}$")] = None,
) -> Response:
    """``v`` only makes a rebuilt image a new URL; the current image is always served. Only a
    ``v`` that names the bytes served may be cached by the browser, so a URL without ``v`` (or
    with an old one) never keeps a superseded image for a day."""
    result = CompositeService(service).get(require_object(ctx, object_id), use_memo=True)
    if result.png is None:
        why = ", ".join(result.body["missing"]) or "no composite"
        raise ApiError(404, "not_found", f"No composite for '{object_id}': {why}.")
    current = v == png_version(result.png)
    return Response(
        content=result.png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400" if current else "no-cache"},
    )
