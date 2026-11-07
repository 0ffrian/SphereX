"""FastAPI dependencies: the shared context, frame service and aliases live on ``app.state``."""

from __future__ import annotations

import hmac
from typing import cast

from fastapi import Request

from app.context import Context
from app.core.card.service import ObjectPipeline
from app.core.find.frames import FrameService
from app.core.render.gemini_paint import GeminiPainter
from app.errors import ApiError
from app.settings import secret_text


def get_ctx(request: Request) -> Context:
    return cast(Context, request.app.state.ctx)


def get_frame_service(request: Request) -> FrameService:
    return cast(FrameService, request.app.state.frames)


def get_aliases(request: Request) -> dict[str, str]:
    return cast(dict[str, str], request.app.state.aliases)


def get_pipeline(request: Request) -> ObjectPipeline:
    return cast(ObjectPipeline, request.app.state.pipeline)


ADMIN_HEADER = "X-SX-Admin-Token"


def require_admin(request: Request) -> None:
    """Admin gate (R10: gemini_paint.py "behind the admin token").

    ASSUMPTION (no spec names the mechanism): the token is ``SX_ADMIN_TOKEN``, sent in the
    ``X-SX-Admin-Token`` header and compared in constant time. With no token configured the
    admin endpoints do not exist (404); a missing or wrong token gets 403.
    """
    settings = cast(Context, request.app.state.ctx).settings
    expected = secret_text(settings.admin_token)
    if not expected:
        raise ApiError(404, "not_found", "Not Found")
    # HTTP strips whitespace around header values; secret_text strips the configured token too.
    given = request.headers.get(ADMIN_HEADER, "").strip()
    if not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        raise ApiError(403, "forbidden", "Admin token missing or wrong.")


def get_gemini(request: Request) -> GeminiPainter:
    return cast(GeminiPainter, request.app.state.gemini)
