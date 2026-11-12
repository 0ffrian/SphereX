# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import object_card_schema

type EmissiveScale = Annotated[
    float,
    Field(
        ...,
        description="This body's brightness relative to the brighter body, (Teff / Teff_max)^4 at equal radius. null = no Teff for this system: the body uses the system brightness.",
        ge=0.0,
        le=1.0,
    ),
]


class Component(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    class_: str = Field(
        ...,
        alias="class",
        description="This body's spectral class, one half of the card's spectral_class, such as T1V.",
    )
    tint: object_card_schema.Triple
    tint_tag: object_card_schema.Tag
    emissive_scale: EmissiveScale | None = Field(
        ...,
        description="This body's brightness relative to the brighter body, (Teff / Teff_max)^4 at equal radius. null = no Teff for this system: the body uses the system brightness.",
    )
    emissive_tag: object_card_schema.Tag


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


class PositiveDynamicsValue(DynamicsValue):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float = Field(..., gt=0.0)


class NonNegativeDynamicsValue(DynamicsValue):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: float = Field(..., ge=0.0)


type Speedup = Annotated[float, Field(..., gt=0.0)]


class Dynamics(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    spin_period_h: PositiveDynamicsValue | None = None
    diff_rotation: DynamicsValue | None = None
    jet_speed_ms: DynamicsValue | None = None
    spot_lifetime_d: PositiveDynamicsValue | None = None
    flare_rate_per_d: NonNegativeDynamicsValue | None = None
    pulsation_period_d: PositiveDynamicsValue | None = None
    speedup: dict[Literal["spin", "spots", "flares", "winds", "clouds", "pulsation"], Speedup] = (
        Field(
            ...,
            description="Time-lapse factor shown on screen for each animated process (D-34). {} when nothing moves.",
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
    relief_amp: float | None = Field(
        None,
        description="Peak relief as a fraction of the body radius (R6.2 relief_amp): the scale of the displacement by the baked height map (R7.2). Optional (Q-103); the backend sends it for `asteroid_procedural` (issue #62), tagged `artistic` through its `displacement` layer.",
        gt=0.0,
    )


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


class Gate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    class_known: bool
    key_measurement: bool
    score_ok: bool
    passed: bool = Field(
        ...,
        description="All three. When false the viewer draws no 3D body and shows found and needed.",
    )


class ConfidenceInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: str
    label: str
    weight: float = Field(
        ...,
        description="Placeholder weight; the weights of one type sum to 100.",
        ge=0.0,
    )
    c: float = Field(..., description="How far the data narrows the class range.", ge=0.0, le=1.0)
    tag: Literal[
        "measured",
        "derived",
        "model_dependent",
        "inferred_from_analog",
        "artistic",
        "missing",
    ] = Field(..., description="The tag of the value that fed it, or missing.")
    points: float = Field(
        ...,
        description="This input's part of C, in percentage points.",
        ge=0.0,
        le=100.0,
    )
    fields: list[str] = Field(..., description="Card fields that fed it (or could).")


class ViewModes(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    visible: VisibleMode
    spherex_ir: VisibleMode | None = None


class Confidence(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    score: float = Field(..., description="C, 0 to 1.", ge=0.0, le=1.0)
    measured_share: float = Field(
        ..., description="Part of the score from measured values.", ge=0.0, le=1.0
    )
    estimated_share: float = Field(
        ...,
        description="Part of the score from derived and model-dependent values.",
        ge=0.0,
        le=1.0,
    )
    assumed_share: float = Field(
        ..., description="The rest: assumed, artistic or missing.", ge=0.0, le=1.0
    )
    threshold: float = Field(
        ...,
        description="Minimum C for a 3D body. Starts at 0.25 (D-36).",
        ge=0.0,
        le=1.0,
    )
    band: Literal["mostly_data", "part_data", "mostly_assumed", "too_little"]
    gate: Gate
    found: str = Field(..., description="Plain words: what the card has.")
    needed: str = Field(
        ...,
        description="Plain words: what is missing for a 3D body. Empty when the gate passed.",
    )
    raise_: str | None = Field(..., alias="raise", description="What would raise the score most.")
    inputs: list[ConfidenceInput]
    tag: Literal["derived"] = Field(..., description="The score is a formula of the card (D-02).")
    formula: str = Field(..., min_length=1)
    weights_note: str = Field(..., description="States that the weights are placeholders.")
    note: str = Field(
        ...,
        description="States that this is not the probability the picture is correct.",
    )


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
    components: list[Component] | None = Field(
        None,
        description="Per-body look of a brown_dwarf_binary, in the order of the card's spectral_class (A then B), when the class names two components (Q-154). Absent otherwise: both bodies then share the system look.",
        max_length=2,
        min_length=2,
    )
    lighting: RenderLighting
    view_modes: ViewModes
    haptics: HapticProfile
    dynamics: Dynamics | None = None
    confidence: Confidence | None = None
    alt_text: str = Field(..., description="R9.")
    missing: list[str] = Field(
        ..., description="Layers refused for missing data, shown to the user."
    )
