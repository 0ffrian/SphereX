# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import object_card_schema


class Layer(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    tag: object_card_schema.Tag
    tier: object_card_schema.Tier
    description: str
    requires: list[str]
    formula: str | None = Field(
        None, description="Required, non-blank, when tag is derived or model_dependent."
    )
    assumed: dict[str, float | str] | None = Field(
        None,
        description="Inputs that were not measured, keyed by card field or rule input name, with the value used. Required when tag is model_dependent.",
        min_length=1,
    )


class DynamicsValue(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float
    tag: object_card_schema.Tag
    tier: object_card_schema.Tier
    source: str
    formula: str | None = Field(
        None, description="Required, non-blank, when tag is derived or model_dependent."
    )
    assumed: dict[str, float | str] | None = Field(
        None,
        description="Inputs that were not measured, keyed by card field or rule input name, with the value used. Required when tag is model_dependent.",
        min_length=1,
    )


type Speedup = Annotated[float, Field(..., gt=0.0)]


class Dynamics(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    spin_period_h: DynamicsValue | None = None
    diff_rotation: DynamicsValue | None = None
    jet_speed_ms: DynamicsValue | None = None
    spot_lifetime_d: DynamicsValue | None = None
    flare_rate_per_d: DynamicsValue | None = None
    pulsation_period_d: DynamicsValue | None = None
    speedup: dict[Literal["spin", "spots", "flares", "winds", "clouds", "pulsation"], Speedup] = (
        Field(
            ...,
            description="Time-lapse factor shown on screen for each animated process (D-33). {} when nothing moves.",
        )
    )


class RenderTextures(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    albedo: str
    height: str
    normal: str
    roughness: str | None = None
    height_bin: str | None = None


class RenderLighting(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    mode: Literal["sun", "self"]
    sun_dir: object_card_schema.Triple | None = None
    phase_angle_deg: float | None = None


class VisibleMode(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    available: bool
    badge: str
    rgb: object_card_schema.TVRgb | None
    source: Literal["gaia_rgb", "class_palette", "spherex_rgb"]
    channels_um: object_card_schema.Triple | None = None


type TextureHaptic = Annotated[
    Literal["height", "mesh", "bands", "terrain", "flow", "none"],
    Field(
        ...,
        description="terrain = height plus ocean and ice masks; flow = bands, jets, storms (D-12).",
        title="TextureHaptic",
    ),
]


type DataHaptic = Annotated[
    Literal[
        "field",
        "flux_pulse",
        "teq_pulse",
        "heartbeat",
        "dimming",
        "motion",
        "detections",
        "none",
    ],
    Field(..., title="DataHaptic"),
]


class HapticProfile(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    texture: TextureHaptic
    texture_tag: object_card_schema.Tag
    data: DataHaptic
    data_tag: object_card_schema.Tag
    params: dict[str, float] = Field(..., description="For example tau, k, softness, maxRateHz.")


class ViewModes(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visible: VisibleMode
    spherex_ir: VisibleMode | None = None


class RenderParams(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str = Field(..., min_length=1)
    type: object_card_schema.ObjectType
    generator_version: str
    seed: int = Field(
        ...,
        description="Seed = hash of (object id + generator version) (R1, A5.1). The hash is not specified yet (Q-35).",
        ge=0,
    )
    scale_m: float | None = Field(
        ...,
        description="Physical radius in metres. null when the size is unknown: the body is refused, never guessed (Q-33).",
    )
    layers: list[Layer] = Field(..., description="Ordered, each with a tag.")
    textures: RenderTextures | None = None
    lighting: RenderLighting
    view_modes: ViewModes
    haptics: HapticProfile
    dynamics: Dynamics | None = None
    alt_text: str = Field(..., description="R9.")
    missing: list[str] = Field(
        ..., description="Layers refused for missing data, shown to the user."
    )
