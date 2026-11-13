# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema, run_schema


class ScanSquare(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    index: int = Field(..., ge=1, le=36)
    row: int = Field(..., description="0 = top.", ge=0)
    col: int = Field(..., description="0 = left on screen (east).", ge=0)
    box: run_schema.RunBox
    area_id: run_schema.RunAreaId


class ScanPlanProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    squares: area_index_schema.AreaProvenanceEntry


class ScanPlan(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    region: run_schema.RunRegion
    release: str = Field(..., min_length=1)
    kind: run_schema.RunKind
    cols: int = Field(..., ge=1, le=6)
    rows: int = Field(..., ge=1, le=6)
    squares: list[ScanSquare] = Field(..., max_length=36, min_length=1)
    estimate_s: int = Field(..., description="Rough total for the squares not stored yet.", ge=0)
    provenance: ScanPlanProvenance
