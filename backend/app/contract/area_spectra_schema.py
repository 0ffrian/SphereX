# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import area_index_schema

type AreaSpectraVerdict = Annotated[
    Literal["rock", "very_red", "too_red", "too_blue", "flickers", "too_faint", "one_colour"],
    Field(
        ...,
        description="A17.13 step 7: the first row that applies.",
        title="AreaSpectraVerdict",
    ),
]


type AreaSpectraRSource = Annotated[
    Literal["parallax", "worst_case"],
    Field(
        ...,
        description="parallax: r from u_inv_au (derived); worst_case: the closest the line of sight comes to the Sun (model_dependent).",
        title="AreaSpectraRSource",
    ),
]


type AreaSpectraArm = Annotated[Literal["short", "long"], Field(..., title="AreaSpectraArm")]


type AreaSpectraLimit = Annotated[
    Literal["lower", "upper"] | None,
    Field(
        ...,
        description="null: a measured ratio; lower or upper: a limit, one dot below snr_min.",
        title="AreaSpectraLimit",
    ),
]


class AreaSpectraProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    points: area_index_schema.AreaProvenanceEntry
    rel: area_index_schema.AreaProvenanceEntry
    calibration: area_index_schema.AreaProvenanceEntry
    colour: area_index_schema.AreaProvenanceEntry
    distance: area_index_schema.AreaProvenanceEntry
    distance_worst_case: area_index_schema.AreaProvenanceEntry
    verdict: area_index_schema.AreaProvenanceEntry
    sun: area_index_schema.AreaProvenanceEntry


type Formulas = Annotated[str, Field(..., min_length=1)]


class AreaSpectraSun(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: str = Field(..., min_length=1)
    sha256: str = Field(..., pattern="^[0-9a-f]{64}$")
    join_um: float = Field(..., gt=0.0)


class AreaSpectraMethod(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    spectrum_version: str = Field(..., min_length=1)
    settings: area_index_schema.AreaSettings
    formulas: dict[str, Formulas]
    sun: AreaSpectraSun = Field(..., title="AreaSpectraSun")


class AreaSpectraCalibration(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    detector: area_index_schema.AreaDetector
    sigma_sys: float = Field(..., ge=0.0)
    n_pairs: int = Field(..., ge=0)
    source: Literal["stars", "default"]


type RhoErr = Annotated[float, Field(..., ge=0.0)]


class AreaSpectraPair(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    exposure: area_index_schema.AreaExposure
    time: area_index_schema.AreaUtcTime
    short_dot_id: area_index_schema.AreaDotId
    long_dot_id: area_index_schema.AreaDotId
    lambda_short_um: float = Field(..., gt=0.0)
    lambda_long_um: float = Field(..., gt=0.0)
    rho: float
    rho_err: RhoErr | None
    limit: AreaSpectraLimit
    rho_max: float = Field(..., gt=0.0)


class AreaSpectraStep(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: area_index_schema.AreaVisit
    detector: area_index_schema.AreaDetector
    dot_id_a: area_index_schema.AreaDotId
    dot_id_b: area_index_schema.AreaDotId
    time_a: area_index_schema.AreaUtcTime
    time_b: area_index_schema.AreaUtcTime
    change: float
    allowed: float = Field(..., ge=0.0)
    ok: bool


class AreaSpectraPoint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    dot_id: area_index_schema.AreaDotId
    visit: area_index_schema.AreaVisit
    detector: area_index_schema.AreaDetector
    exposure: area_index_schema.AreaExposure
    time: area_index_schema.AreaUtcTime
    lambda_um: float = Field(..., gt=0.0)
    flux_uJy: float
    flux_err: float = Field(..., ge=0.0)
    snr: float
    arm: AreaSpectraArm
    point: bool = Field(
        ..., description="snr >= snr_min; below it the dot is used only as a limit."
    )
    rel: float | None
    used: bool = Field(..., description="The dot entered a colour pair or a steadiness step.")


class AreaSpectraTrack(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    track_id: area_index_schema.AreaTrackId
    verdict: AreaSpectraVerdict
    heat_glow: bool | None = Field(
        ...,
        description="true: a parallax rock with a pair above r_max; null: the distance is unknown (worst case); false otherwise.",
    )
    r_au: float = Field(..., gt=0.0)
    r_source: AreaSpectraRSource
    phase_deg: float = Field(..., ge=0.0, le=180.0)
    pairs: list[AreaSpectraPair]
    steps: list[AreaSpectraStep]
    points: list[AreaSpectraPoint]


class AreaSpectra(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    area_id: area_index_schema.AreaId
    cached_at: area_index_schema.AreaUtcTime
    computed_at: area_index_schema.AreaUtcTime
    missing: list[area_index_schema.AreaMissingCode]
    provenance: AreaSpectraProvenance
    method: AreaSpectraMethod
    calibration: list[AreaSpectraCalibration]
    tracks: list[AreaSpectraTrack]
