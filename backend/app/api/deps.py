"""FastAPI dependencies: the shared context, frame service and aliases live on ``app.state``."""

from __future__ import annotations

from typing import cast

from fastapi import Request

from app.context import Context
from app.core.find.frames import FrameService


def get_ctx(request: Request) -> Context:
    return cast(Context, request.app.state.ctx)


def get_frame_service(request: Request) -> FrameService:
    return cast(FrameService, request.app.state.frames)


def get_aliases(request: Request) -> dict[str, str]:
    return cast(dict[str, str], request.app.state.aliases)
