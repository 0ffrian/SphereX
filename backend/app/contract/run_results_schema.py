# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema, run_schema

type Number = Annotated[int, Field(..., ge=1)]


type ObjectId = Annotated[str, Field(..., min_length=1)]


type Square = Annotated[int, Field(..., ge=1)]


type Designation = Annotated[str, Field(..., min_length=1)]


class RunTrackRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    square: int = Field(..., ge=1)
    area_id: area_index_schema.AreaId
    track_id: area_index_schema.AreaTrackId


class RunResultsProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    merge: area_index_schema.AreaProvenanceEntry
    known_positions: area_index_schema.AreaProvenanceEntry
    track_positions: area_index_schema.AreaProvenanceEntry


class RunResultSquare(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    index: int = Field(..., ge=1)
    area_id: run_schema.RunAreaId
    state: run_schema.RunSquareState


class RunKnownRow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    designation: str = Field(..., min_length=1)
    number: Number | None
    object_id: ObjectId | None
    kind: Literal["asteroid", "comet"]
    v_mag: float | None
    detected: bool = Field(
        ...,
        description="A merged track carries its designation; false = predicted only.",
    )
    track_available: bool
    squares: list[Square] = Field(..., min_length=1)
    visits: list[area_index_schema.AreaUtcTime] = Field(
        ..., description="Visit start times of the squares the row comes from."
    )
    positions: list[run_schema.RunPosition]


class RunTrackRow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["found", "unexplained"]
    designation: Designation | None
    squares: list[Square] = Field(..., min_length=1)
    tracks: list[RunTrackRef] = Field(..., min_length=1)
    visits: list[area_index_schema.AreaUtcTime] = Field(
        ..., description="Visit start times of the squares the row comes from."
    )
    positions: list[run_schema.RunPosition]


class RunResults(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: run_schema.RunId
    kind: run_schema.RunKind
    release: str = Field(..., min_length=1)
    region: run_schema.RunRegion
    state: run_schema.RunState
    squares: list[RunResultSquare]
    known: list[RunKnownRow]
    tracks: list[RunTrackRow]
    provenance: RunResultsProvenance
