# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema, run_schema


class RunSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: run_schema.RunId
    kind: run_schema.RunKind
    region: run_schema.RunRegion
    state: run_schema.RunState
    created_at: area_index_schema.AreaUtcTime
    duration_s: float | None = Field(
        ...,
        description="started_at to finished_at (or now); null before it starts.",
        ge=0.0,
    )
    totals: run_schema.RunTotals
    squares_done: int = Field(..., ge=0)
    squares_total: int = Field(..., ge=1)


class RunList(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    runs: list[RunSummary]
