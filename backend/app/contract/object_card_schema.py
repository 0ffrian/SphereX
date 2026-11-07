# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type Tag = Annotated[
    Literal["measured", "derived", "model_dependent", "inferred_from_analog", "artistic"],
    Field(..., description="The five provenance tags (R3.1, D-02).", title="Tag"),
]


type Tier = Annotated[
    Literal[1, 2, 3, 4, 5],
    Field(
        ...,
        description="Fallback tier of the rung that answered: 1 measured, 2 derived, 3 model_dependent, 4 inferred_from_analog, 5 artistic (D-32). Always agrees with the tag.",
        title="Tier",
    ),
]


type ObjectType = Annotated[
    Literal[
        "asteroid_shape",
        "asteroid_procedural",
        "comet",
        "brown_dwarf",
        "brown_dwarf_binary",
        "star_mira",
        "star_ttauri",
        "star",
        "candidate",
        "planet_rocky",
        "planet_water",
        "gas_giant",
        "nebula",
        "nova",
    ],
    Field(..., description="R3.2 and D-04.", title="ObjectType"),
]


type Pair = Annotated[list[float], Field(..., max_length=2, min_length=2, title="Pair")]


type Triple = Annotated[
    list[float],
    Field(
        ...,
        description="An RGB triple or a 3-vector.",
        max_length=3,
        min_length=3,
        title="Triple",
    ),
]


class TVNumber(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float | None = Field(..., description="null = unknown, never a guess.")
    err: float | Pair | None = None
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class TVString(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: str | None = Field(..., description="null = unknown, never a guess.")
    err: float | Pair | None = None
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class TVRgb(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Triple | None = Field(..., description="null = unknown, never a guess.")
    err: float | Pair | None = None
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class TVVec3(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Triple | None = Field(..., description="null = unknown, never a guess.")
    err: float | Pair | None = None
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class TVPair(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Pair | None = Field(..., description="null = unknown, never a guess.")
    err: float | Pair | None = None
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class LightcurvePoint(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    t_mjd: float
    flux: float
    sigma: float
    lambda_um: float
    flags: float


class GasQ(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    co2: TVNumber | None = None
    h2o: TVNumber | None = None
    co: TVNumber | None = None


type CometEpoch = Annotated[Literal["2025-08", "2025-12"], Field(..., title="CometEpoch")]


class ObjectCard(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., description="Stable id, e.g. sbdb:101955 (A5.1).", min_length=1)
    name: str
    type: ObjectType
    diameter_km: TVNumber | None = None
    radius_rjup: TVNumber | None = None
    radius_rsun: TVNumber | None = None
    shape_source: TVString | None = None
    rot_period_h: TVNumber | None = None
    lightcurve_amp_mag: TVNumber | None = None
    albedo: TVNumber | None = None
    gaia_rgb: TVRgb | None = None
    spherex_rgb: TVRgb | None = None
    spectral_class: TVString | None = None
    band_depth_1um: TVNumber | None = None
    band_depth_2um: TVNumber | None = None
    band_depth_3um: TVNumber | None = None
    slope_075_25: TVNumber | None = None
    ch4_depth_33: TVNumber | None = None
    flux_45um: TVNumber | None = None
    teff_K: TVNumber | None = None
    teq_K: TVNumber | None = None
    period_var_d: TVNumber | None = None
    lightcurve: list[LightcurvePoint] | None = None
    phase_angle_deg: TVNumber | None = None
    sun_vector: TVVec3 | None = None
    gas_Q: GasQ | None = None
    coma_radius_km: TVNumber | None = None
    nucleus_radius_km_max: TVNumber | None = None
    epochs: list[CometEpoch] | None = None
    pm_mas_yr: TVPair | None = None
