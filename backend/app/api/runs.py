"""Scans and runs (Q-470, Q-471, issue #156): a region scanned square by square, and the record
of every run (a scan, or a single live area) with its timeline for replay.

- ``POST /v1/scans``: ``start=false`` answers the plan (the squares, in order; no SIA call);
  ``start=true`` queues the scan on the live-area worker (one queue slot) and answers its run.
- ``GET /v1/runs``: every run, newest first. ``GET /v1/runs/{run_id}``: the full record.
- ``POST /v1/runs/{run_id}/pause`` and ``/resume`` (409 when they do not apply);
  ``DELETE /v1/runs/{run_id}`` stops it (204).
- ``GET /v1/runs/{run_id}/results``: the finished squares' stored results, duplicates merged.

Nothing is computed in a request (A16.2): the plan is arithmetic, the results are read from the
stored areas. Every reply is checked against its schema before it is sent. Errors are
``{error, detail}``: 422 ``scan:too_large`` and ``area:bad_box``; 429
``queue_full``; 503 ``offline``; 404 ``run_not_found``; 409 ``run_not_pausable``,
``run_not_paused``, ``run_finished``.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.areas import LIVE_ERRORS, _json, get_area_store, get_live_jobs
from app.api.models import ErrorResponse
from app.core.area.live import LiveAreaError
from app.core.area.live_jobs import MAX_WAITING, LiveJobs, QueueFull, RunConflict
from app.core.area.runs import RUN_ID, RunNotFound, merge, read_square, results_reply
from app.core.area.scan import ScanPlan, plan_scan
from app.core.area.store import AreaStore
from app.errors import ApiError

router = APIRouter(prefix="/v1", tags=["runs"])

RunIdPath = Annotated[str, Path(pattern=RUN_ID.pattern, max_length=40)]
RUN_ERRORS: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
}


class ScanRequest(BaseModel):
    """A drawn region (Q-470); ``kind`` is the tool used."""

    ra: float
    dec: float
    width_deg: float
    height_deg: float
    kind: Literal["discovery", "known"] = "discovery"
    start: bool = False


def _stored(store: AreaStore, release: str, scan: ScanPlan) -> dict[int, str]:
    by_box = store.areas_by_box(release)
    out = {}
    for s in scan.squares:
        b = s.box
        got = by_box.get((b.ra, b.dec, b.width_deg, b.height_deg))
        if got is not None:
            out[s.index] = got
    return out


@router.post("/scans", responses={202: {}, **LIVE_ERRORS})
def post_scan(
    req: ScanRequest,
    store: Annotated[AreaStore, Depends(get_area_store)],
    jobs: Annotated[LiveJobs, Depends(get_live_jobs)],
) -> Response:
    """The plan of a region (``start=false``), or its queued run (``start=true``, 202)."""
    try:
        scan = plan_scan(req.ra, req.dec, req.width_deg, req.height_deg)
    except LiveAreaError as exc:
        raise ApiError(422, exc.code, exc.detail) from exc
    release = jobs.ctx.settings.data_release
    stored = _stored(store, release, scan)
    if not req.start:
        return _json(scan.reply(release, req.kind, stored), "scan-plan.schema.json")
    if jobs.ctx.settings.offline:
        raise ApiError(503, "offline", "Scans need the network (SX_OFFLINE=1).")
    try:
        run_id = jobs.submit_scan(scan, req.kind, release, stored)
    except QueueFull as exc:
        raise ApiError(
            429,
            "queue_full",
            f"{MAX_WAITING} runs are already waiting. Try again in a few minutes.",
        ) from exc
    return _json(jobs.run_reply(run_id), "run.schema.json", status=202)


def _not_found(run_id: str) -> ApiError:
    return ApiError(404, "run_not_found", f"No run '{run_id}'.")


@router.get("/runs")
def get_runs(jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    return _json({"runs": jobs.runs.summaries()}, "run-list.schema.json")


@router.get("/runs/{run_id}", responses=RUN_ERRORS)
def get_run(run_id: RunIdPath, jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    try:
        return _json(jobs.run_reply(run_id), "run.schema.json")
    except RunNotFound as exc:
        raise _not_found(run_id) from exc


def _act(jobs: LiveJobs, run_id: str, action: str) -> Response:
    try:
        getattr(jobs, action)(run_id)
    except RunNotFound as exc:
        raise _not_found(run_id) from exc
    except RunConflict as exc:
        raise ApiError(409, exc.code, exc.detail) from exc
    if action == "stop":
        return Response(status_code=204)
    return _json(jobs.run_reply(run_id), "run.schema.json")


@router.post("/runs/{run_id}/pause", responses=RUN_ERRORS)
def post_pause(run_id: RunIdPath, jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    """Pause a running scan after its current square."""
    return _act(jobs, run_id, "pause")


@router.post("/runs/{run_id}/resume", responses=RUN_ERRORS)
def post_resume(run_id: RunIdPath, jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    return _act(jobs, run_id, "resume")


@router.delete("/runs/{run_id}", status_code=204, responses=RUN_ERRORS)
def delete_run(run_id: RunIdPath, jobs: Annotated[LiveJobs, Depends(get_live_jobs)]) -> Response:
    return _act(jobs, run_id, "stop")


@router.get("/runs/{run_id}/results", responses=RUN_ERRORS)
def get_results(
    run_id: RunIdPath,
    store: Annotated[AreaStore, Depends(get_area_store)],
    jobs: Annotated[LiveJobs, Depends(get_live_jobs)],
) -> Response:
    """The finished squares' stored replies, merged (Q-471). Nothing is computed."""
    try:
        run = jobs.runs.get(run_id)
    except RunNotFound as exc:
        raise _not_found(run_id) from exc

    def read(area_id: str, stage: str) -> dict[str, Any] | None:
        got = store.entry(area_id, stage)
        if got is None:
            return None
        body: dict[str, Any] = json.loads(got.body)
        return body

    finished = [
        read_square(s["index"], s["area_id"], read)
        for s in run["squares"]
        if s["state"] == "done" and s["area_id"] is not None
    ]
    return _json(results_reply(run, merge(run["region"], finished)), "run-results.schema.json")
