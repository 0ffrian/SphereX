# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema

type Reason = Annotated[str, Field(..., min_length=1)]


type Flag = Annotated[str, Field(..., pattern="^[A-Z][A-Z0-9_]*$")]


type AreaIntervalItem = Annotated[float, Field(..., ge=0.0, le=1.0)]


type AreaInterval = Annotated[
    list[AreaIntervalItem],
    Field(
        ...,
        description="[low, high], both in [0, 1].",
        max_length=2,
        min_length=2,
        title="AreaInterval",
    ),
]


type TracksPerRunItem = Annotated[int, Field(..., ge=0)]


class AreaControl(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    n_runs: int = Field(..., ge=1)
    tracks_per_run: list[TracksPerRunItem]
    mean: float = Field(..., ge=0.0)
    max: int = Field(..., ge=0)


class AreaPlantedDot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
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


class AreaCompletenessCell(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    snr_bin: int = Field(..., ge=0)
    rate_bin: int = Field(..., ge=0)
    n: int = Field(..., ge=1)
    k: int = Field(..., ge=0)
    frac: float = Field(..., ge=0.0, le=1.0)
    wilson95: AreaInterval


class AreaChecksProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    test_mover: area_index_schema.AreaProvenanceEntry | None = None
    completeness: area_index_schema.AreaProvenanceEntry | None = None
    control: area_index_schema.AreaProvenanceEntry | None = None


class AreaTestMover(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    ra: area_index_schema.AreaRa
    dec: area_index_schema.AreaDec
    rate_deg_day: float = Field(..., ge=0.0)
    pa_deg: area_index_schema.AreaAngleDeg
    snr: float = Field(..., gt=0.0)
    dots: list[AreaPlantedDot]
    recovered: bool
    reason: Reason | None


class AreaCompleteness(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    snr_bins: list[area_index_schema.AreaBin]
    rate_bins: list[area_index_schema.AreaBin]
    cells: list[AreaCompletenessCell]


class AreaChecks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    test_mover: AreaTestMover | None = None
    completeness: AreaCompleteness | None = None
    control: AreaControl | None = None
    linker: area_index_schema.AreaLinker | None = None
    method: area_index_schema.AreaMethod
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaChecksProvenance
