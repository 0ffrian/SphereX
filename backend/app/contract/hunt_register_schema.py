# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type HuntId = Annotated[
    Literal[
        "variables",
        "cold_worlds",
        "asteroids",
        "runaways",
        "ir_excess",
        "dimmers",
        "active_asteroids",
        "slow_movers",
        "transients",
        "dark_companions",
    ],
    Field(..., title="HuntId"),
]


class HuntRoute(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    url: str = Field(..., pattern="^https://")
    verified_at: str = Field(..., pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


class HuntAvailability(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: Literal["available", "disabled"]
    reason: str | None = Field(None, pattern="^hunt:[a-z_]+:[a-z0-9_:]+$")


class HuntCalibrationRef(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    measured_at: str = Field(
        ..., pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
    )


type Release = Annotated[str, Field(..., min_length=1)]


class HuntEntry(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: HuntId
    title: str = Field(..., min_length=1)
    summary: str = Field(..., min_length=1)
    kind: Literal["search", "characterisation", "context"]
    level: Literal["validated", "characterisation", "experimental", "context"]
    weight: Literal["light", "heavy"]
    version: str = Field(..., pattern="^[0-9]+\\.[0-9]+\\.[0-9]+$")
    releases: list[Release]
    routes: list[HuntRoute]
    availability: HuntAvailability
    calibration: HuntCalibrationRef | None


type HuntRegister = Annotated[
    list[HuntEntry],
    Field(
        ...,
        description="GET /v1/hunts (A22.7.1, issue #221): the static register of the Discovery hunts.",
        title="HuntRegister",
    ),
]
