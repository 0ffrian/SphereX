"""``GET /v1/objects/{id}/spectrum`` (D-16, A4.2): spectrum and light curve, tagged ``measured``.

Plain ``def`` route: the FITS work runs in FastAPI's threadpool. Response models live here until
``shared/schemas`` exists (D-18); optional additions are omitted when unset.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel

from app.api.deps import get_ctx, get_frame_service, get_measure_pool
from app.api.models import ErrorResponse, Provenance
from app.api.objects import AroundQuery, DaysQuery, track_window_of
from app.context import Context
from app.core.find.frames import FrameService
from app.core.find.ids import ID_RE
from app.core.find.resolver import load_object
from app.core.measure.pool import MeasurePool
from app.core.measure.spectrum import SpectrumService
from app.errors import ApiError
from app.timefmt import iso_utc_z

router = APIRouter(prefix="/v1/objects", tags=["spectrum"])

ObjectId = Annotated[str, Path(pattern=ID_RE, max_length=200)]


class SpectrumPoint(BaseModel):
    wavelength_um: float
    flux: float
    error: float
    flagged: bool
    frame_id: str
    # Optional additions
    bandwidth_um: float | None = None
    dropped_flags: list[str] | None = None
    dropped_weight_fraction: float | None = None
    flag_reasons: list[str] | None = None


class LightCurvePoint(BaseModel):
    time: str
    flux: float
    error: float
    frame_id: str
    # Optional additions (Q-24: each SPHEREx frame is a different band)
    wavelength_um: float | None = None
    flagged: bool | None = None


class SpectrumResponse(BaseModel):
    id: str
    spectrum: list[SpectrumPoint]
    light_curve: list[LightCurvePoint]
    flux_unit: str
    tag: Literal["measured"]
    cached_at: str | None
    missing: list[str]
    # Optional additions
    data_release: str | None = None
    method: dict[str, Any] | None = None
    provenance: dict[str, Provenance] | None = None
    # Track on demand (Q-468): the window the frames came from, ``[start, end]`` UTC.
    track_window: list[str] | None = None


@router.get(
    "/{object_id}/spectrum",
    response_model=SpectrumResponse,
    response_model_exclude_unset=True,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def get_spectrum(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    service: Annotated[FrameService, Depends(get_frame_service)],
    pool: Annotated[MeasurePool | None, Depends(get_measure_pool)],
    around: AroundQuery = None,
    days: DaysQuery = None,
) -> SpectrumResponse:
    """``around``/``days``: Track on demand (Q-468), the spectrum of that window's frames."""
    obj = load_object(ctx, object_id)
    if obj is None:
        raise ApiError(404, "not_found", f"Unknown object '{object_id}'. Call /v1/resolve first.")
    window = track_window_of(ctx, obj, around, days)
    frames = service.get_frames(obj, window=window) if window is not None else None
    result = SpectrumService(service, pool=pool).get_spectrum(obj, frames)
    cached_at = iso_utc_z(result.cached_at) if result.cached_at else None
    extra = (
        {"track_window": [iso_utc_z(window[0]), iso_utc_z(window[1])]} if window is not None else {}
    )
    return SpectrumResponse.model_validate({**result.body, "cached_at": cached_at, **extra})
