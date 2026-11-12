# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema

type RateDegDay = Annotated[float, Field(..., ge=0.0)]


type UInvAu = Annotated[float, Field(..., ge=0.0)]


class AreaTracklet(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    dot_ids: list[area_index_schema.AreaDotId] = Field(..., min_length=1)
    v_in_deg_day: float = Field(..., ge=0.0)
    pa_in_deg: area_index_schema.AreaAngleDeg
    rms_px: float = Field(..., ge=0.0)


type Number = Annotated[int, Field(..., ge=1)]


type ObjectId = Annotated[str, Field(..., min_length=1)]


class AreaMatch(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    designation: str = Field(..., min_length=1)
    number: Number | None
    object_id: ObjectId | None
    v_mag: float | None
    median_sep_px: float = Field(..., ge=0.0)
    fetched_at: area_index_schema.AreaUtcTime


type Chi2Red = Annotated[float, Field(..., ge=0.0)]


class AreaSed(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    label: area_index_schema.AreaSedLabel
    chi2_red: Chi2Red | None
    n_dots: int = Field(..., ge=0)
    sigma_floor: float = Field(..., ge=0.0)


class AreaTracksProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tracks: area_index_schema.AreaProvenanceEntry
    match: area_index_schema.AreaProvenanceEntry
    sed: area_index_schema.AreaProvenanceEntry | None = None


class AreaTrack(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    track_id: area_index_schema.AreaTrackId
    visits: list[area_index_schema.AreaVisit]
    tracklets: list[AreaTracklet] = Field(..., min_length=1)
    rate_deg_day: RateDegDay | None
    pa_deg: area_index_schema.AreaAngleDeg | None
    u_inv_au: UInvAu | None
    status: Literal["track", "possible"]
    reason: Literal["ambiguous", "no_partner", "one_visit"] | None
    verdict: area_index_schema.AreaVerdict
    match: AreaMatch | None
    linker: area_index_schema.AreaLinker
    unchecked_by: list[area_index_schema.AreaMissingCode]
    sed: AreaSed | None = None


class AreaTracks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tracks: list[AreaTrack]
    skybot: list[area_index_schema.AreaSkybotAnswer]
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaTracksProvenance
