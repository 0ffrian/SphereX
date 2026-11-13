# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class Visits(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tag: Literal["measured"]
    source: str
    formula: str


class Provenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visits: Visits


type LiveUtcTime = Annotated[
    str,
    Field(
        ...,
        description="ISO-8601 UTC with a trailing Z.",
        pattern="^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,6})?Z$",
        title="LiveUtcTime",
    ),
]


type LiveAreaId = Annotated[
    str,
    Field(..., max_length=200, pattern="^[A-Za-z0-9][A-Za-z0-9:_.-]*$", title="LiveAreaId"),
]


class LiveBox(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ra: float = Field(..., ge=0.0, lt=360.0)
    dec: float = Field(..., ge=-90.0, le=90.0)
    width_deg: float = Field(..., gt=0.0, le=2.0)
    height_deg: float = Field(..., gt=0.0, le=2.0)


class LiveVisit(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: LiveUtcTime
    end: LiveUtcTime
    n_frames: int = Field(..., ge=1)


class LiveVisitPair(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visits: list[LiveVisit] = Field(..., max_length=2, min_length=2)
    gap_h: float = Field(..., ge=0.0)


class LiveAreaPlan(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    area_id: LiveAreaId
    release: str = Field(..., min_length=1)
    box: LiveBox
    visits: list[LiveVisit] = Field(..., max_length=2, min_length=2)
    n_frames: int = Field(
        ...,
        description="Frames of the two visits over the box centre (the run may keep more over the whole box).",
        ge=2,
    )
    estimate_s: int = Field(
        ...,
        description="Rough run time: 60 s + 500 s per square degree, from the 13 Nov 2026 QR3 runs.",
        ge=1,
    )
    alternatives: list[LiveVisitPair] = Field(
        ...,
        description="Other visit pairs at most max_gap_h apart, closest first (for a visit pair picker).",
        max_length=10,
    )
    provenance: Provenance
