# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema, area_job_schema

type RunId = Annotated[
    str, Field(..., pattern="^run-[0-9]{8}T[0-9]{6}-[0-9a-f]{6}$", title="RunId")
]


type RunKind = Annotated[
    Literal["discovery", "known"],
    Field(..., description="The tool that started the run.", title="RunKind"),
]


type RunState = Annotated[
    Literal["queued", "running", "paused", "done", "stopped", "failed"],
    Field(..., title="RunState"),
]


type RunSquareState = Annotated[
    Literal["todo", "running", "done", "skipped", "failed"],
    Field(..., title="RunSquareState"),
]


class RunRegion(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ra: float = Field(..., ge=0.0, lt=360.0)
    dec: float = Field(..., ge=-90.0, le=90.0)
    width_deg: float = Field(..., gt=0.0, le=12.0)
    height_deg: float = Field(..., gt=0.0, le=12.0)


class RunBox(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ra: float = Field(..., ge=0.0, lt=360.0)
    dec: float = Field(..., ge=-90.0, le=90.0)
    width_deg: float = Field(..., gt=0.0, le=2.0)
    height_deg: float = Field(..., gt=0.0, le=2.0)


type RunAreaId = Annotated[area_index_schema.AreaId | None, Field(..., title="RunAreaId")]


type RunTime = Annotated[area_index_schema.AreaUtcTime | None, Field(..., title="RunTime")]


class RunProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    known_positions: area_index_schema.AreaProvenanceEntry
    track_positions: area_index_schema.AreaProvenanceEntry


class RunSquare(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    index: int = Field(..., description="1 = top left; top row first, left to right.", ge=1, le=36)
    box: RunBox
    area_id: RunAreaId
    state: RunSquareState
    error: area_job_schema.LiveJobError | None = None


class RunTotals(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    known: int = Field(..., ge=0)
    found: int = Field(..., ge=0)
    unexplained: int = Field(..., ge=0)
    squares_done: int = Field(..., ge=0)
    squares_skipped: int = Field(..., ge=0)


class RunPosition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ra: area_index_schema.AreaRa
    dec: area_index_schema.AreaDec
    time: area_index_schema.AreaUtcTime


class RunObject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["known", "unexplained", "predicted"]
    designation: str | None = Field(None, min_length=1)
    track_id: area_index_schema.AreaTrackId | None = None
    square: int = Field(..., ge=1)
    positions: list[RunPosition]
    positions_tag: Literal["measured", "model_dependent"] = Field(
        ...,
        description="Provenance of positions: model_dependent (JPL Horizons, the Known row) or measured (the track's dots); see the run's provenance block.",
    )


class RunEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    t: float = Field(..., description="Seconds since started_at (ms precision).", ge=0.0)
    type: Literal[
        "run_started",
        "square_started",
        "square_done",
        "square_skipped",
        "square_failed",
        "found",
        "run_paused",
        "run_resumed",
        "run_done",
        "run_stopped",
    ]
    square: int | None = Field(None, ge=1)
    area_id: area_index_schema.AreaId | None = None
    object: RunObject | None = None


class RunProgress(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    square: int = Field(..., ge=1)
    area_id: area_index_schema.AreaId
    step: str | None
    steps: list[area_job_schema.LiveJobStep]


class Run(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: RunId
    kind: RunKind
    release: str = Field(..., min_length=1)
    region: RunRegion
    squares: list[RunSquare] = Field(..., max_length=36, min_length=1)
    state: RunState
    created_at: area_index_schema.AreaUtcTime
    started_at: RunTime
    finished_at: RunTime
    totals: RunTotals
    events: list[RunEvent]
    provenance: RunProvenance
    queue_position: int | None = Field(None, description="1 = next; only while queued.", ge=1)
    progress: RunProgress | None = None
