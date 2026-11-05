"""``/v1/objects/{id}/frames`` and ``/v1/objects/{id}/cutouts/{frame_id}.png`` (D-16, A4.1).

Routes are plain ``def`` so FITS and PNG work runs in FastAPI's threadpool. ``/card`` and
``/render-params`` join this module later (R10); ``/spectrum`` is issue #2.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from fastapi.responses import Response

from app.api.deps import get_ctx, get_frame_service
from app.api.models import ErrorResponse, Frame, FramesResponse, Provenance, Stretch
from app.context import Context
from app.core.find import png
from app.core.find.cutouts import CutoutUnavailable, render_frame_png
from app.core.find.frames import FrameService
from app.core.find.ids import ID_RE
from app.core.find.propagate import FORMULA as PM_FORMULA
from app.core.find.propagate import NEGLECTED as PM_NEGLECTED
from app.core.find.resolver import ResolvedObject, load_object
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


def _object(ctx: Context, object_id: str) -> ResolvedObject:
    obj = load_object(ctx, object_id)
    if obj is None:
        raise ApiError(404, "not_found", f"Unknown object '{object_id}'. Call /v1/resolve first.")
    return obj


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
