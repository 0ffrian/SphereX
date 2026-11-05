"""API response models (D-16, M1 brief). Hand-written until ``shared/schemas`` exists (D-18).

Required fields are always present (``null`` when unknown). Optional additions are omitted when
not set (routes use ``response_model_exclude_unset``).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Tag = Literal["measured", "derived", "model_dependent", "inferred_from_analog", "artistic"]


class Provenance(BaseModel):
    tag: Tag
    source: str | None = None
    formula: str | None = None
    assumption: str | None = None


class ErrorResponse(BaseModel):
    error: str
    detail: str


class ResolveResponse(BaseModel):
    id: str
    name: str | None
    ra: float
    dec: float
    moving: bool
    resolver: Literal["simbad", "sbdb", "coords"]
    cached_at: str | None
    # Optional additions
    # ISO-8601 UTC time the position refers to: 2000-01-01T11:58:55.816Z (J2000.0) for SIMBAD
    # catalogue positions, SX_EPHEMERIS_EPOCH for moving objects. Absent for typed coordinates.
    epoch: str | None = None
    pm_ra_mas_yr: float | None = None
    pm_dec_mas_yr: float | None = None
    provenance: dict[str, Provenance] | None = None


class Frame(BaseModel):
    frame_id: str
    time: str
    wavelength_um: float
    x: float
    y: float
    cutout_url: str
    flags: list[str]
    # Optional additions
    ra: float | None = None
    dec: float | None = None
    bandwidth_um: float | None = None
    detector: int | None = None
    width: int | None = None
    height: int | None = None
    north_angle_deg: float | None = None
    mirrored: bool | None = None


class Stretch(BaseModel):
    kind: str
    params: dict[str, Any]


class FramesResponse(BaseModel):
    id: str
    frames: list[Frame]
    stretch: Stretch
    data_release: str
    cached_at: str | None
    missing: list[str]
    north_up: bool
    provenance: dict[str, Provenance] | None = Field(default=None)
