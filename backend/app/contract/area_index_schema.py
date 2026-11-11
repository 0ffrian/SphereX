# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type AreaUtcTime = Annotated[
    str,
    Field(
        ...,
        description="ISO-8601 UTC with a trailing Z (A17.8).",
        pattern="^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,6})?Z$",
        title="AreaUtcTime",
    ),
]


type AreaRa = Annotated[float, Field(..., ge=0.0, lt=360.0, title="AreaRa")]


type AreaDec = Annotated[float, Field(..., ge=-90.0, le=90.0, title="AreaDec")]


type AreaAngleDeg = Annotated[
    float,
    Field(
        ...,
        description="Position angle in degrees, east of north, in [0, 360).",
        ge=0.0,
        lt=360.0,
        title="AreaAngleDeg",
    ),
]


type AreaRaDec = Annotated[
    list[AreaRa | AreaDec],
    Field(
        ...,
        description="One polygon vertex: [ra, dec] in degrees.",
        max_length=2,
        min_length=2,
        title="AreaRaDec",
    ),
]


type AreaId = Annotated[str, Field(..., pattern="^[A-Za-z0-9][A-Za-z0-9:_.-]*$", title="AreaId")]


type AreaFrameId = Annotated[
    str, Field(..., pattern="^[A-Za-z0-9][A-Za-z0-9_.-]*$", title="AreaFrameId")
]


type AreaDotId = Annotated[
    str,
    Field(
        ...,
        description="<frame_id>:<n>, n from 1 by the rounded centroid row, then column (Q-208 (14)).",
        pattern="^[A-Za-z0-9][A-Za-z0-9_.-]*:[1-9][0-9]*$",
        title="AreaDotId",
    ),
]


type AreaTrackId = Annotated[str, Field(..., pattern="^T[1-9][0-9]*$", title="AreaTrackId")]


type AreaVisit = Annotated[int, Field(..., ge=1, title="AreaVisit")]


type AreaDetector = Annotated[int, Field(..., ge=1, le=6, title="AreaDetector")]


type AreaExposure = Annotated[int, Field(..., ge=1, title="AreaExposure")]


type AreaMissingCode = Annotated[
    str,
    Field(
        ...,
        description="A refusal code of A17.8 (register: A4.12).",
        pattern="^(checks:not_run|checks:d4_not_run|checks:d5_not_run|rate_grid:visits|area:visits|frames:cone_maxrec:[1-9][0-9]*|no_footprint:[A-Za-z0-9][A-Za-z0-9_.-]*|cutout:[A-Za-z0-9][A-Za-z0-9_.-]*|stars:(gaia|wise):[1-9][0-9]*|skybot:[1-9][0-9]*|horizons:.+|stamp:[A-Za-z0-9][A-Za-z0-9_.-]*:[1-9][0-9]*)$",
        title="AreaMissingCode",
    ),
]


type AreaTag = Annotated[
    Literal["measured", "derived", "model_dependent"],
    Field(
        ...,
        description="The tags Area search uses (A16.5); never inferred_from_analog or artistic.",
        title="AreaTag",
    ),
]


class AreaProvenanceEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    tag: AreaTag
    source: str | None = Field(None, min_length=1)
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


type AreaDotLabel = Annotated[
    Literal["glitch", "star", "fixed", "mover"], Field(..., title="AreaDotLabel")
]


type AreaVerdict = Annotated[
    Literal["found_blind", "unexplained", "unchecked", "possible"],
    Field(..., title="AreaVerdict"),
]


type AreaSedLabel = Annotated[
    Literal["smooth", "rough", "too_few", "not_informative"],
    Field(..., title="AreaSedLabel"),
]


type AreaLinker = Annotated[Literal["pairs", "rate_grid"], Field(..., title="AreaLinker")]


type AreaSettings = dict[str, int | float | str]


class AreaBin(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    min: float
    max: float | None


type Seed = Annotated[int, Field(..., ge=0)]


class AreaChecksMethod(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    seeds: list[Seed]
    n_per_cell: int = Field(..., ge=1)
    snr_bins: list[AreaBin]
    rate_bins: list[AreaBin]
    n_control_runs: int = Field(..., ge=1)
    psf: str = Field(..., min_length=1)
    distance_model: str = Field(..., min_length=1)


class AreaMethod(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    settings: AreaSettings
    checks: AreaChecksMethod | None = None


class AreaSkybotAnswer(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visit: AreaVisit
    fetched_at: AreaUtcTime | None


class AreaError(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    error: Literal["area_not_found", "dot_not_found", "stamp_unavailable"]
    detail: str = Field(..., min_length=1)


class AreaIndexEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    area_id: AreaId
    ra: AreaRa
    dec: AreaDec
    width_deg: float = Field(..., gt=0.0)
    height_deg: float = Field(..., gt=0.0)
    data_release: str = Field(..., min_length=1)
    n_frames: int = Field(..., ge=0)
    n_visits: int = Field(..., ge=0)
    computed_at: AreaUtcTime
    cached_at: AreaUtcTime


class AreaIndexProvenance(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    areas: AreaProvenanceEntry


class AreaIndex(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    areas: list[AreaIndexEntry]
    cached_at: AreaUtcTime | None
    computed_at: AreaUtcTime | None
    missing: list[AreaMissingCode]
    provenance: AreaIndexProvenance
