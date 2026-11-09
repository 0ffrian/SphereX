"""Gemini artistic layer (R6.6, D-07, A6.2; issue #14). P3 stretch.

ASSUMPTION (not in D-16; see Q-122): three endpoints.

- ``POST /v1/admin/objects/{id}/gemini-repaint`` (admin token): bake if needed, ask Gemini,
  check the edge correlation, write the AI albedo on success. Always 200 with a status body:
  ``status`` is ``applied`` or ``code`` (the code colour stays, ``reason`` says why). The reply
  describes this attempt; an earlier verified repaint for the same bake stays applied (Q-122).
  Admin only and meant for ``curl``: CORS allows GET only, so a browser page cannot call it.
- ``GET /v1/objects/{id}/albedo-ai``: the same status body for the last repaint, checked
  against the bake the viewer shows. No card build, no bake, no Gemini call.
- ``GET /v1/objects/{id}/albedo-ai.webp``: the AI albedo, or 404 ``albedo_ai_unavailable``.

The viewer loads the code albedo from RenderParams first and swaps in the AI albedo only when
the status says ``applied`` (never blank). The API key never appears in any reply.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response

from app.api.deps import get_ctx, get_gemini, get_pipeline, require_admin, require_object
from app.api.models import ErrorResponse
from app.api.objects import ObjectId
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context
from app.core.card.service import ObjectPipeline
from app.core.find.resolver import ResolvedObject
from app.core.render.gemini_paint import GeminiPainter, PaintOutcome
from app.errors import ApiError

router = APIRouter(tags=["gemini"])
ERRORS: dict[int | str, dict[str, object]] = {
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
}


def albedo_url(object_id: str) -> str:
    return f"/v1/objects/{object_id}/albedo-ai.webp"


def _reply(outcome: PaintOutcome) -> JSONResponse:
    body: dict[str, Any] = outcome.to_json(albedo_url(outcome.object_id))
    return JSONResponse(content=body, headers={"Cache-Control": "no-store"})


def _shown_params(pipeline: ObjectPipeline, obj: ResolvedObject) -> Mapping[str, Any] | None:
    """RenderParams of the bake the viewer shows, from disk only: the saved or pre-baked asset
    ``pipeline.run`` would answer with (same contract check, so the repaint and the status
    agree on the seed), else None for the stage 7 defaults."""
    try:
        saved = pipeline.saved(obj)
    except (OSError, ValueError):
        return None
    return saved.params if saved is not None else None


def _status(
    ctx: Context,
    pipeline: ObjectPipeline,
    painter: GeminiPainter,
    oid: str,
    *,
    with_bytes: bool = False,
) -> PaintOutcome:
    obj = require_object(ctx, oid)  # 404 for an unknown id
    return painter.status(oid, _shown_params(pipeline, obj), with_bytes=with_bytes)


@router.post(
    "/v1/admin/objects/{object_id}/gemini-repaint",
    response_class=JSONResponse,
    responses=ERRORS,
    dependencies=[Depends(require_admin)],
)
def post_repaint(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
    painter: Annotated[GeminiPainter, Depends(get_gemini)],
    refresh: Annotated[bool, Query(description="Ask Gemini again instead of the cache")] = False,
) -> JSONResponse:
    obj = require_object(ctx, object_id)
    try:
        result = pipeline.run(obj)
    except (CacheMissOffline, UpstreamUnavailable) as exc:
        return _reply(painter.refuse(object_id, "card_unavailable", type(exc).__name__))
    if result.measuring:
        # Issue #41: a first-stage card (before the spectrum). The finished job rebakes with
        # the final params, which would orphan a paid repaint: refuse and let the admin retry.
        return _reply(
            painter.refuse(
                object_id,
                "measuring",
                f"the card is still being measured ({', '.join(result.measuring)}); try again",
            )
        )
    # The bake the viewer shows: RenderParams carry its seed and generator version.
    return _reply(painter.repaint(object_id, result.card, result.params, refresh=refresh))


@router.get("/v1/objects/{object_id}/albedo-ai", response_class=JSONResponse, responses=ERRORS)
def get_status(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
    painter: Annotated[GeminiPainter, Depends(get_gemini)],
) -> JSONResponse:
    return _reply(_status(ctx, pipeline, painter, object_id))


@router.get(
    "/v1/objects/{object_id}/albedo-ai.webp",
    response_class=Response,
    responses={200: {"content": {"image/webp": {}}}, **ERRORS},
)
def get_albedo(
    object_id: ObjectId,
    ctx: Annotated[Context, Depends(get_ctx)],
    pipeline: Annotated[ObjectPipeline, Depends(get_pipeline)],
    painter: Annotated[GeminiPainter, Depends(get_gemini)],
) -> Response:
    outcome = _status(ctx, pipeline, painter, object_id, with_bytes=True)
    if not outcome.applied or outcome.ai_bytes is None:
        raise ApiError(
            404, "albedo_ai_unavailable", f"No AI albedo ({outcome.reason}); the code colour shows."
        )
    return Response(
        content=outcome.ai_bytes,  # the bytes status() checked, not a second read
        media_type="image/webp",
        headers={"Cache-Control": "no-store", "X-SX-Layer-Tag": "artistic"},
    )
