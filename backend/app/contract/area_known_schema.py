# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema

type Number = Annotated[int, Field(..., ge=1)]


type ObjectId = Annotated[str, Field(..., min_length=1)]


class AreaKnownPosition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    frame_id: area_index_schema.AreaFrameId
    time: area_index_schema.AreaUtcTime
    ra: area_index_schema.AreaRa
    dec: area_index_schema.AreaDec


class AreaKnownProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    positions: area_index_schema.AreaProvenanceEntry
    skybot: area_index_schema.AreaProvenanceEntry


class AreaKnownObject(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    designation: str = Field(..., min_length=1)
    number: Number | None
    object_id: ObjectId | None
    kind: Literal["asteroid", "comet"]
    v_mag: float | None
    n_frames: int = Field(..., ge=1)
    n_visits: int = Field(..., ge=1)
    positions: list[AreaKnownPosition]
    track_available: bool


class AreaKnown(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    known: list[AreaKnownObject]
    skybot: list[area_index_schema.AreaSkybotAnswer]
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaKnownProvenance
