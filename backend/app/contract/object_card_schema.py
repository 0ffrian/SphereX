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


class GasQEpoch(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    co2: TVNumber | None = None
    h2o: TVNumber | None = None
    co: TVNumber | None = None


type CometEpoch = Annotated[Literal["2025-08", "2025-12"], Field(..., title="CometEpoch")]


type ValueItem = Annotated[list[float], Field(..., max_length=7, min_length=7)]


type Value = Annotated[
    list[ValueItem],
    Field(..., description="null = unknown, never a guess.", min_length=2),
]


class TVTrack(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    value: Value | None = Field(..., description="null = unknown, never a guess.")
    tag: Tag
    source: str
    formula: str | None = Field(None, description="Required, non-blank, when tag is derived.")
    assumption: str | None = Field(
        None, description="Required, non-blank, when tag is model_dependent."
    )


class GasQ(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    co2: TVNumber | None = None
    h2o: TVNumber | None = None
    co: TVNumber | None = None
    field_2025_08: GasQEpoch | None = Field(None, alias="2025-08")
    field_2025_12: GasQEpoch | None = Field(None, alias="2025-12")


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
    lum_lsun: TVNumber | None = Field(
        None,
        description="Star luminosity in solar luminosities (Gaia DR3 FLAME lum_flame, model_dependent). Issue #93 B.",
    )
    mass_msun: TVNumber | None = Field(
        None,
        description="Star mass in solar masses (Gaia DR3 FLAME mass_flame, model_dependent). Issue #93 B.",
    )
    flare_rate_per_d: TVNumber | None = Field(
        None,
        description="Measured flare rate of a star, flares per day, from the literature registry. The band and the energy threshold or detection limit the rate refers to are stated in source (no common threshold exists across papers). Issue #93 C.",
    )
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
    mass_mearth: TVNumber | None = None
    orbit_au: TVNumber | None = None
    orbital_period_d: TVNumber | None = None
    host_teff_K: TVNumber | None = None
    host_radius_rsun: TVNumber | None = None
    host_mass_msun: TVNumber | None = None
    host_age_gyr: TVNumber | None = None
    orbit_ecc: TVNumber | None = Field(
        None,
        description="Orbital eccentricity, 0 to <1 (Exoplanet Archive pl_orbeccen). Issue #93 A.",
    )
    insolation_searth: TVNumber | None = Field(
        None,
        description="Stellar flux at the planet in units of the Earth's (Exoplanet Archive pl_insol). Issue #93 B.",
    )
    host_lum_lsun: TVNumber | None = Field(
        None,
        description="Host star luminosity in solar luminosities, 10^st_lum (Exoplanet Archive st_lum is log10 L/Lsun). Issue #93 B.",
    )
    dayside_temp_K: TVNumber | None = Field(
        None,
        description="Hemisphere-averaged brightness temperature of the day side (or of the hottest hemisphere, centred on the hotspot, when the source says so), K, from a secondary eclipse or phase curve. The bandpass is in source; a brightness temperature depends on it. Issue #93 C.",
    )
    nightside_temp_K: TVNumber | None = Field(
        None,
        description="Hemisphere-averaged brightness temperature of the night side, K, from a phase curve. The bandpass is in source. Issue #93 C.",
    )
    hotspot_offset_deg: TVNumber | None = Field(
        None,
        description="Longitude of the brightest point of a phase curve from the substellar point, degrees, positive east (in the direction of rotation). The bandpass is in source. Issue #93 C.",
    )
    surface_pressure_bar: TVNumber | None = None
    surface_temperature_K: TVNumber | None = None
    surface_fluid: TVString | None = None
    component_teff_K: TVPair | None = None
    period_var_d: TVNumber | None = None
    lightcurve: list[LightcurvePoint] | None = None
    phase_angle_deg: TVNumber | None = None
    sun_vector: TVVec3 | None = None
    gas_Q: GasQ | None = None
    coma_radius_km: TVNumber | None = None
    nucleus_radius_km_max: TVNumber | None = None
    epochs: list[CometEpoch] | None = None
    orbit_track: TVTrack | None = None
    pm_mas_yr: TVPair | None = None
