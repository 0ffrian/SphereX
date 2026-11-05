"""``GET /v1/resolve?q=<name | "ra,dec">`` (D-16, D-19)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_aliases, get_ctx
from app.api.models import ErrorResponse, Provenance, ResolveResponse
from app.context import Context
from app.core.find.ids import BadQuery
from app.core.find.resolver import NotFound, resolve
from app.errors import ApiError
from app.timefmt import iso_utc_z

router = APIRouter(prefix="/v1", tags=["resolve"])

ERRORS: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


@router.get(
    "/resolve",
    response_model=ResolveResponse,
    response_model_exclude_unset=True,
    responses=ERRORS,
)
def get_resolve(
    q: Annotated[str, Query(min_length=1, max_length=200)],
    ctx: Annotated[Context, Depends(get_ctx)],
    aliases: Annotated[dict[str, str], Depends(get_aliases)],
) -> ResolveResponse:
    try:
        res = resolve(ctx, q, aliases)
    except BadQuery as exc:
        raise ApiError(400, "bad_query", str(exc)) from exc
    except NotFound as exc:
        raise ApiError(404, "not_found", str(exc)) from exc
    obj = res.obj
    out = ResolveResponse(
        id=obj.id,
        name=obj.name,
        ra=obj.ra,
        dec=obj.dec,
        moving=obj.moving,
        resolver=obj.resolver,  # type: ignore[arg-type]
        cached_at=iso_utc_z(res.cached_at) if res.cached_at else None,
    )
    if obj.epoch is not None:
        out.epoch = obj.epoch
    if obj.pm_ra_mas_yr is not None and obj.pm_dec_mas_yr is not None:
        out.pm_ra_mas_yr = obj.pm_ra_mas_yr
        out.pm_dec_mas_yr = obj.pm_dec_mas_yr
    if obj.provenance:
        out.provenance = {k: Provenance(**v) for k, v in obj.provenance.items()}  # type: ignore[arg-type]
    return out
