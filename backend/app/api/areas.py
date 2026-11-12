"""``/v1/areas/...`` (A17.8): the precomputed Area search results, read from ``derived.area``
entries only (A17.10). Nothing is computed in a request (A16.2); under ``SX_OFFLINE=1`` an absent
area is 404 ``area_not_found``. Beyond D-16 (Q-146 (6)).

- ``GET /v1/areas``: the index (built from the stored summaries, checked against the schema).
- ``GET /v1/areas/{area_id}``, ``/known``, ``/dots``, ``/tracks``: the stored replies, byte for
  byte (they were checked against ``shared/schemas/area-*.schema.json`` when stored).
- ``GET /v1/areas/{area_id}/stamps/{dot_id}.png``: 15 x 15 px, made from the cutout when the
  area was prepared and stored with it as raw pixels (so it works offline without the cutouts);
  the PNG is encoded when serving.
- ``GET /v1/areas/{area_id}/export.ecsv``: the A17.7 file.

``/checks`` is not served: D4 and D5 are cut (Q-203 gate); ``summary.missing`` says
``checks:not_run``. Errors are ``{error, detail}``: 404 ``area_not_found``, 404 ``dot_not_found``,
503 ``stamp_unavailable``.
"""

from __future__ import annotations

import base64
import json
import math
from typing import Annotated, Any, cast

import numpy as np
from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import Response

from app.api.models import ErrorResponse
from app.context import Context
from app.core.area.config import AREA_ID
from app.core.area.store import AreaStore
from app.core.find.png import encode_png
from app.errors import ApiError

router = APIRouter(prefix="/v1/areas", tags=["areas"])

AreaIdPath = Annotated[str, Path(pattern=AREA_ID.pattern, max_length=200)]
DotIdPath = Annotated[
    str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*:[1-9][0-9]*$", max_length=200)
]
ERRORS: dict[int | str, dict[str, Any]] = {404: {"model": ErrorResponse}}
JSON = "application/json"
NO_STORE: dict[str, str] = {}


def get_area_store(request: Request) -> AreaStore:
    store = getattr(request.app.state, "areas", None)
    if store is None:
        ctx = cast(Context, request.app.state.ctx)
        store = AreaStore(ctx, ctx.settings.area_pack_dir)
        request.app.state.areas = store
    return cast(AreaStore, store)


def _stage(store: AreaStore, area_id: str, stage: str) -> bytes:
    entry = store.entry(area_id, stage)
    if entry is None:
        raise ApiError(
            404,
            "area_not_found",
            f"Area '{area_id}' is not prepared with the running code and settings.",
        )
    return entry.body


@router.get("", responses=ERRORS)
def get_index(store: Annotated[AreaStore, Depends(get_area_store)]) -> Response:
    body = json.dumps(store.index(), sort_keys=True, separators=(",", ":")).encode()
    return Response(content=body, media_type=JSON)


@router.get("/{area_id}", responses=ERRORS)
def get_summary(
    area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]
) -> Response:
    return Response(content=_stage(store, area_id, "summary"), media_type=JSON)


@router.get("/{area_id}/known", responses=ERRORS)
def get_known(
    area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]
) -> Response:
    return Response(content=_stage(store, area_id, "known"), media_type=JSON)


@router.get("/{area_id}/dots", responses=ERRORS)
def get_dots(area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]) -> Response:
    return Response(content=_stage(store, area_id, "dots"), media_type=JSON)


@router.get("/{area_id}/tracks", responses=ERRORS)
def get_tracks(
    area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]
) -> Response:
    return Response(content=_stage(store, area_id, "tracks"), media_type=JSON)


@router.get("/{area_id}/export.ecsv", responses=ERRORS)
def get_export(
    area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]
) -> Response:
    # ASSUMPTION: A17.8 names the file, not its media type; ECSV is plain text.
    return Response(
        content=_stage(store, area_id, "export"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{area_id}.ecsv"'},
    )


def _stamp_png(pixels: bytes) -> bytes:
    """Encode a stored stamp (square raw uint8 pixels, row 0 at the top) as PNG. Formatting
    only: the pixels were made at prepare time (A16.2)."""
    side = math.isqrt(len(pixels))
    img = np.frombuffer(pixels, dtype=np.uint8).reshape(side, side)
    return encode_png(np.flipud(img))  # encode_png flips FITS orientation back


@router.get(
    "/{area_id}/stamps/{dot_id}.png",
    responses={200: {"content": {"image/png": {}}}, **ERRORS, 503: {"model": ErrorResponse}},
)
def get_stamp(
    area_id: AreaIdPath,
    dot_id: DotIdPath,
    store: Annotated[AreaStore, Depends(get_area_store)],
) -> Response:
    dots = json.loads(_stage(store, area_id, "dots"))
    if not any(d["dot_id"] == dot_id for v in dots["visits"] for d in v["dots"]):
        raise ApiError(404, "dot_not_found", f"Area '{area_id}' has no dot '{dot_id}'.")
    stamp = json.loads(_stage(store, area_id, "stamps")).get(dot_id)
    if stamp is None:
        raise ApiError(
            503, "stamp_unavailable", f"The cutout of dot '{dot_id}' could not be stamped."
        )
    return Response(
        content=_stamp_png(base64.b64decode(stamp)),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
