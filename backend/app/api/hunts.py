"""``GET /v1/hunts`` (A22.7.1, issue #221): the register of the Discovery hunts. Static data, no
network; the reply is checked against its schema before it is sent (Q-40)."""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.card.validate import check
from app.core.hunts.register import SCHEMA, register

router = APIRouter(prefix="/v1", tags=["hunts"])


@router.get("/hunts")
def get_hunts() -> Response:
    body = register()
    check(body, SCHEMA)
    return Response(
        content=json.dumps(body, sort_keys=True, separators=(",", ":")).encode(),
        media_type="application/json",
    )
