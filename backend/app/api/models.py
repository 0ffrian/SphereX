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
    resolver: Literal["simbad", "sbdb", "coords", "reference"]
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


# Overlays (issue #12; Q-50). Contract shared with the frontend overlay UI: do not rename.
CatalogName = Literal["gaia", "wise"]


class CatalogSource(BaseModel):
    id: str
    ra: float
    dec: float
    mag: float | None
    pmra_mas_yr: float | None
    pmdec_mas_yr: float | None


class CatalogOverlay(BaseModel):
    catalog: CatalogName
    available: bool
    table: str
    epoch: str | None
    mag_band: str
    mag_limit: float | None
    sources: list[CatalogSource]


class Aperture(BaseModel):
    radius_px: float
    annulus_inner_px: float
    annulus_outer_px: float


class FlagGroupModel(BaseModel):
    group: Literal["saturation", "bad_pixel", "artefact", "source"]
    rgba: list[int]
    names: list[str]


class Marker(BaseModel):
    catalog: CatalogName
    id: str
    x: float
    y: float


class Contaminant(BaseModel):
    catalog: CatalogName
    id: str
    mag: float | None
    zone: Literal["aperture", "annulus"]
    sep_px: float


class StarMask(BaseModel):
    """A star mask near a mover's track (issue #95, A19.6); ``r_px`` from magnitude [verify]."""

    catalog: CatalogName
    id: str
    x: float
    y: float
    r_px: float


class FrameOverlay(BaseModel):
    frame_id: str
    flags_url: str
    markers: list[Marker]
    contamination: list[Contaminant]
    masks: list[StarMask]  # [] for fixed objects
    footprint: list[list[float]] | None
    cutout_box: list[list[float]]


class OverlaysResponse(BaseModel):
    id: str
    data_release: str
    cached_at: str | None
    catalogs: list[CatalogOverlay]
    aperture: Aperture
    flag_groups: list[FlagGroupModel]
    frames: list[FrameOverlay]
    missing: list[str]
    provenance: dict[str, Provenance]


class JobStatus(BaseModel):
    """``GET /v1/objects/{id}/job`` and each ``/job/events`` event (issue #41, Q-111).
    ``state`` is ``idle`` (no job; the other fields absent), ``running``, ``done`` or ``failed``."""

    id: str
    state: Literal["idle", "running", "done", "failed"]
    stage: Literal["queued", "catalogue", "frames", "spectrum", "card", "done"] | None = None
    frames_done: int | None = None
    frames_total: int | None = None
    answer: Literal["none", "first", "partial", "final"] | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    seq: int | None = None
