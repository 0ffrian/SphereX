# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type TrackPathUtcTime = Annotated[
    str,
    Field(
        ...,
        description="ISO-8601 UTC with milliseconds and a trailing Z.",
        pattern="^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
        title="TrackPathUtcTime",
    ),
]


type TrackPathUtcTimeOrNull = Annotated[
    TrackPathUtcTime | None, Field(..., title="TrackPathUtcTimeOrNull")
]


type TrackPathRa = Annotated[
    float,
    Field(
        ...,
        description="Right ascension in degrees, ICRF.",
        ge=0.0,
        lt=360.0,
        title="TrackPathRa",
    ),
]


type TrackPathDec = Annotated[
    float,
    Field(
        ...,
        description="Declination in degrees, ICRF.",
        ge=-90.0,
        le=90.0,
        title="TrackPathDec",
    ),
]


class TrackPathWindow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: TrackPathUtcTime
    end: TrackPathUtcTime


class TrackPathPoint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    time: TrackPathUtcTime
    ra: TrackPathRa
    dec: TrackPathDec


class TrackPathFramePoint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    frame_id: str = Field(..., min_length=1)
    time: TrackPathUtcTime
    ra: TrackPathRa
    dec: TrackPathDec
    ra_3sigma_arcsec: float | None = Field(
        ...,
        description="Horizons 3-sigma RA uncertainty (quantity 36); null until it is asked for (cut for the event, issue #74).",
        ge=0.0,
    )
    dec_3sigma_arcsec: float | None = Field(
        ...,
        description="Horizons 3-sigma Dec uncertainty (quantity 36); null until it is asked for.",
        ge=0.0,
    )


type TrackPathMissingCode = Annotated[
    Literal[
        "path:deferred",
        "path:not_cached",
        "path:observer",
        "path:ephemeris",
        "path:window",
        "path:frames_incomplete",
    ],
    Field(
        ...,
        description="A19.5, A19.10: path:deferred (poll), path:not_cached, path:observer, path:ephemeris, path:window, path:frames_incomplete (the frame list is not final; poll).",
        title="TrackPathMissingCode",
    ),
]


class TrackPath(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    observer: Literal["500@-163182"] = Field(
        ...,
        description="Horizons CENTER of every position: the SPHEREx spacecraft (A3.4, Q-138).",
    )
    step_min: int = Field(
        ..., description="Minutes between two samples (SX_MOVING_EPHEM_STEP_MIN).", ge=1
    )
    windows: list[TrackPathWindow] = Field(
        ...,
        description="The spans served, each inside one search window; never joined across a gap.",
    )
    points: list[TrackPathPoint] = Field(
        ..., description="Horizons samples inside the windows, in time order."
    )
    frame_points: list[TrackPathFramePoint] = Field(
        ...,
        description="The exact Horizons TLIST position at each frame midpoint inside the windows (the /frames positions).",
    )
    tag: Literal["model_dependent"]
    assumption: str = Field(..., min_length=1)
    formula: str = Field(..., min_length=1)
    interp_error_arcsec: float | None = Field(
        ...,
        description="Largest separation between the interpolated path and the exact TLIST position over frame_points; null without frame points.",
        ge=0.0,
    )
    missing: list[TrackPathMissingCode]
    fetched_at: TrackPathUtcTimeOrNull
    cached_at: TrackPathUtcTimeOrNull
