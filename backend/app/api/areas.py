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
- ``GET /v1/areas/{area_id}/spectra``: the spectrum check of every track (A17.13, Q-474), its own
  ``derived.area`` stage written after the area; 404 ``spectra_not_prepared`` when the area is
  served but that stage is missing for the running spectrum version and settings.
- ``POST /v1/areas/live``, ``GET`` and ``DELETE /v1/areas/live/{area_id}`` (Q-462, issue #141):
  a box drawn anywhere. ``start=false`` answers the plan (one SIA cone at the box centre picks
  two visits); ``start=true`` queues a background job (``live_jobs``), which runs the pipeline
  and stores the area, then served by the routes above like a prepared one. The request never
  computes the area itself (A16.2). A started job is recorded as a run of one square
  (issue #156, Q-471; ``kind`` names the tool), listed by ``/v1/runs`` (``api/runs.py``).

``/checks`` is not served: D4 and D5 are cut (Q-203 gate); ``summary.missing`` says
``checks:not_run``. Errors are ``{error, detail}``: 404 ``area_not_found``, 404 ``dot_not_found``,
404 ``spectra_not_prepared``, 503 ``stamp_unavailable``.
"""

from __future__ import annotations

import base64
import json
import math
import threading
from typing import Annotated, Any, Literal, cast

import numpy as np
from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.adapters.http import UpstreamError
from app.api.models import ErrorResponse
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context
from app.core.area.config import AREA_ID
from app.core.area.live import LiveAreaError, Plan, plan_area, snap_box
from app.core.area.live_jobs import MAX_WAITING, LiveJobs, QueueFull, done_reply
from app.core.area.store import AreaStore
from app.core.card.validate import check
from app.core.find.png import encode_png
from app.errors import ApiError
from app.timefmt import parse_utc

router = APIRouter(prefix="/v1/areas", tags=["areas"])

AreaIdPath = Annotated[str, Path(pattern=AREA_ID.pattern, max_length=200)]
DotIdPath = Annotated[
    str, Path(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]*:[1-9][0-9]*$", max_length=200)
]
ERRORS: dict[int | str, dict[str, Any]] = {404: {"model": ErrorResponse}}
LIVE_ERRORS: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    429: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}
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


class LiveAreaRequest(BaseModel):
    """A drawn box (Q-462). ``visits`` picks a visit pair by the two visit starts (ISO UTC)."""

    ra: float
    dec: float
    width_deg: float
    height_deg: float
    start: bool = False
    visits: list[str] | None = Field(default=None, min_length=2, max_length=2)
    # Issue #156 (Q-471): the tool used; a job started with it is recorded as a run of one
    # square (its id is in the reply). No default: a client that does not say which tool it
    # is records no run, rather than one under the wrong tool (PR #160 review).
    kind: Literal["discovery", "known"] | None = None


_LIVE_JOBS_LOCK = threading.Lock()


def get_live_jobs(request: Request) -> LiveJobs:
    """The app's one ``LiveJobs`` (one worker, Q-462). Created under a lock: the routes are sync
    and run in a thread pool, so two first requests must not each make a queue."""
    with _LIVE_JOBS_LOCK:
        jobs = getattr(request.app.state, "live_jobs", None)
        if jobs is None:
            jobs = LiveJobs(cast(Context, request.app.state.ctx), store=get_area_store(request))
            request.app.state.live_jobs = jobs
    return cast(LiveJobs, jobs)


def _json(body: dict[str, Any], schema: str, status: int = 200) -> Response:
    check(body, schema)
    return Response(
        content=json.dumps(body, sort_keys=True, separators=(",", ":")).encode(),
        media_type=JSON,
        status_code=status,
    )


def _plan(request: Request, req: LiveAreaRequest) -> Plan:
    ctx = cast(Context, request.app.state.ctx)
    try:
        box = snap_box(req.ra, req.dec, req.width_deg, req.height_deg)
        pair = None
        if req.visits is not None:
            pair = (parse_utc(req.visits[0]), parse_utc(req.visits[1]))
        return plan_area(ctx, box, pair=pair)
    except LiveAreaError as exc:
        raise ApiError(422, exc.code, exc.detail) from exc
    except ValueError as exc:  # a visit start that is not an ISO time
        raise ApiError(422, "area:bad_box", f"Bad visit start: {exc}") from exc
    except CacheMissOffline as exc:
        raise ApiError(503, "offline", "Live areas need the network (SX_OFFLINE=1).") from exc
    except (UpstreamUnavailable, UpstreamError) as exc:
        raise ApiError(
            503, "upstream_unavailable", "The SPHEREx frame archive did not answer."
        ) from exc


@router.post("/live", responses={202: {}, **LIVE_ERRORS})
def post_live(
    req: LiveAreaRequest,
    request: Request,
    store: Annotated[AreaStore, Depends(get_area_store)],
    jobs: Annotated[LiveJobs, Depends(get_live_jobs)],
) -> Response:
    """The plan of a box (``start=false``), or its job (``start=true``). A box already stored
    answers ``done``; one already queued or running answers its job, whatever ``start`` is,
    except a scan's square with ``start=true``: that queues a job of its own behind the square,
    so stopping the scan never loses this request (PR #160 review, Q-470)."""
    plan = _plan(request, req)
    if store.entry(plan.area_id, "summary") is not None:
        return _json(done_reply(plan.area_id), "area-job.schema.json")
    job = jobs.get(plan.area_id)
    if job is not None and job.active and (job.joinable or not req.start):
        return _json(jobs.reply(job), "area-job.schema.json")
    if not req.start:
        return _json(plan.reply(), "area-live-plan.schema.json")
    if jobs.ctx.settings.offline:
        raise ApiError(503, "offline", "Live areas need the network (SX_OFFLINE=1).")
    try:
        job = jobs.submit(plan, kind=req.kind)
    except QueueFull as exc:
        raise ApiError(
            429,
            "queue_full",
            f"{MAX_WAITING} areas are already waiting. Try again in a few minutes.",
        ) from exc
    return _json(jobs.reply(job), "area-job.schema.json", status=202)


@router.get("/live/{area_id}", responses=LIVE_ERRORS)
def get_live(
    area_id: AreaIdPath,
    store: Annotated[AreaStore, Depends(get_area_store)],
    jobs: Annotated[LiveJobs, Depends(get_live_jobs)],
) -> Response:
    job = jobs.get(area_id)
    if job is not None and not (job.state == "failed" and store.entry(area_id, "summary")):
        return _json(jobs.reply(job), "area-job.schema.json")
    if store.entry(area_id, "summary") is not None:
        return _json(done_reply(area_id), "area-job.schema.json")
    raise ApiError(404, "job_not_found", f"No live area job '{area_id}'.")


@router.delete("/live/{area_id}", status_code=204, responses=LIVE_ERRORS)
def delete_live(area_id: AreaIdPath, jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    if not jobs.cancel(area_id):
        raise ApiError(404, "job_not_found", f"No queued or running job '{area_id}'.")
    return Response(status_code=204)


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


@router.get("/{area_id}/spectra", responses=ERRORS)
def get_spectra(
    area_id: AreaIdPath, store: Annotated[AreaStore, Depends(get_area_store)]
) -> Response:
    _stage(store, area_id, "summary")  # 404 area_not_found first, as the other routes
    entry = store.spectra_entry(area_id)
    if entry is None:
        raise ApiError(
            404,
            "spectra_not_prepared",
            f"Area '{area_id}' has no spectrum check for the running code and settings.",
        )
    return Response(content=entry.body, media_type=JSON)


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
