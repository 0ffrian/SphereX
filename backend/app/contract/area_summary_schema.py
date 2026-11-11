# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema


class AreaSummaryFrame(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    frame_id: area_index_schema.AreaFrameId
    detector: area_index_schema.AreaDetector
    visit: area_index_schema.AreaVisit
    exposure: area_index_schema.AreaExposure
    time: area_index_schema.AreaUtcTime
    wavelength_min_um: float = Field(..., gt=0.0)
    wavelength_max_um: float = Field(..., gt=0.0)
    s_region: str = Field(..., min_length=1)


class AreaCoverage(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    polygon: list[area_index_schema.AreaRaDec] = Field(..., min_length=3)


class AreaSteps(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    n_dots: int = Field(..., ge=0)
    n_glitches: int = Field(..., ge=0)
    n_stars: int = Field(..., ge=0)
    n_fixed: int = Field(..., ge=0)
    n_static_one_visit: int = Field(..., ge=0)
    n_tracks: int = Field(..., ge=0)
    n_possible: int = Field(..., ge=0)
    n_found_blind: int = Field(..., ge=0)
    n_unexplained: int = Field(..., ge=0)
    n_unchecked: int = Field(..., ge=0)


class AreaSummaryProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    frames: area_index_schema.AreaProvenanceEntry
    coverage: area_index_schema.AreaProvenanceEntry
    steps: area_index_schema.AreaProvenanceEntry


class AreaSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    area_id: area_index_schema.AreaId
    ra: area_index_schema.AreaRa
    dec: area_index_schema.AreaDec
    width_deg: float = Field(..., gt=0.0)
    height_deg: float = Field(..., gt=0.0)
    data_release: str = Field(..., min_length=1)
    n_frames: int = Field(..., ge=0)
    n_visits: int = Field(..., ge=0)
    frames: list[AreaSummaryFrame]
    coverage: list[AreaCoverage]
    steps: AreaSteps
    method: area_index_schema.AreaMethod
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaSummaryProvenance
