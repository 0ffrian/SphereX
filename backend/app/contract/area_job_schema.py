# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type LiveJobAreaId = Annotated[
    str,
    Field(
        ...,
        max_length=200,
        pattern="^[A-Za-z0-9][A-Za-z0-9:_.-]*$",
        title="LiveJobAreaId",
    ),
]


class LiveJobStep(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Literal["visits", "frames", "dots", "labels", "join", "known"]
    label: str
    state: Literal["done", "running", "todo"]
    done: int | None = Field(None, ge=0)
    total: int | None = Field(None, ge=0)


class LiveJobError(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: str = Field(..., pattern="^[a-z_]+(:[a-z0-9_]+)*$")
    detail: str


class LiveAreaJob(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    area_id: LiveJobAreaId
    state: Literal["queued", "running", "done", "failed"]
    step: str | None = Field(None, description="Id of the running step; null when not running.")
    steps: list[LiveJobStep]
    elapsed_s: int = Field(..., ge=0)
    eta_s: int | None = Field(
        ..., description="Rough time left; null when done, failed or unknown.", ge=0
    )
    queue_position: int | None = Field(None, description="1 = next; only while queued.", ge=1)
    error: LiveJobError | None = None
