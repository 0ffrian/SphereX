# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema

type Flag = Annotated[str, Field(..., pattern="^[A-Z][A-Z0-9_]*$")]


class AreaDot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    dot_id: area_index_schema.AreaDotId
    frame_id: area_index_schema.AreaFrameId
    detector: area_index_schema.AreaDetector
    exposure: area_index_schema.AreaExposure
    time: area_index_schema.AreaUtcTime
    x: float
    y: float
    ra: area_index_schema.AreaRa
    dec: area_index_schema.AreaDec
    flux_uJy: float
    flux_err: float = Field(..., ge=0.0)
    snr: float
    wavelength_um: float = Field(..., gt=0.0)
    bandwidth_um: float = Field(..., gt=0.0)
    flags: list[Flag]
    label: area_index_schema.AreaDotLabel


class AreaDotsProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    position: area_index_schema.AreaProvenanceEntry
    photometry: area_index_schema.AreaProvenanceEntry
    wavelength: area_index_schema.AreaProvenanceEntry
    label: area_index_schema.AreaProvenanceEntry


class AreaVisitDots(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    dots: list[AreaDot]


class AreaDots(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visits: list[AreaVisitDots]
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaDotsProvenance
