# 05 Data contract (classes)

The data contract between backend and frontend: `ObjectCard` (what we know) and `RenderParams` (how to draw and feel it). Drawn from `shared/schemas/`, rendering doc §3.1–3.4, §5.1–5.3, §8.8 and decisions D-02 (replaces the settings file), D-04 (type union), D-12 (extended `HapticProfile`, new `teq_K` field), D-23 (view-mode fields) and D-27 (`overrides` type).

## Diagram 1: tagged values and the ObjectCard

```mermaid
classDiagram
  direction LR
  class Tag {
    <<enumeration>>
    measured
    derived
    model_dependent
    inferred_from_analog
    artistic
  }
  class Badge {
    <<enumeration>>
    Measured
    Estimated
    Default
  }
  class TV~T~ {
    +value: T or null
    +err: number or pair, optional
    +tag: Tag
    +source: string
    +formula: string, required if derived
    +assumption: string, required if model_dependent
  }
  class ObjectType {
    <<enumeration>>
    asteroid_shape
    asteroid_procedural
    comet
    brown_dwarf
    brown_dwarf_binary
    star_mira
    star_ttauri
    star
    candidate
    planet_rocky
    planet_water
    gas_giant
    nebula
    nova
  }
  class ObjectCard {
    +id: string
    +name: string
    +type: ObjectType
    +diameter_km: TV, optional
    +radius_rjup: TV, optional
    +radius_rsun: TV, optional
    +shape_source: TV~string~, optional
    +rot_period_h: TV, optional
    +lightcurve_amp_mag: TV, optional
    +albedo: TV, optional
    +gaia_rgb: TV~rgb~, optional
    +spherex_rgb: TV~rgb~, optional
    +spectral_class: TV~string~, optional
    +band_depth_1um, 2um, 3um: TV, optional
    +slope_075_25: TV, optional
    +ch4_depth_33: TV, optional
    +flux_45um: TV, optional
    +teff_K: TV, optional
    +teq_K: TV, optional
    +mass_mearth, orbit_au, orbital_period_d: TV, optional
    +host_teff_K, host_radius_rsun, host_mass_msun, host_age_gyr: TV, optional
    +component_teff_K: TV~pair~, optional
    +period_var_d: TV, optional
    +lightcurve: LightcurvePoint list, optional
    +phase_angle_deg: TV, optional
    +sun_vector: TV~vec3~, optional
    +gas_Q: GasQ, optional
    +coma_radius_km: TV, optional
    +nucleus_radius_km_max: TV, optional
    +epochs: 2025-08 or 2025-12 list, optional
    +pm_mas_yr: TV~pair~, optional
  }
  class LightcurvePoint {
    +t_mjd: number
    +flux: number
    +sigma: number
    +lambda_um: number
    +flags: number
  }
  class GasQ {
    +co2: TV, optional
    +h2o: TV, optional
    +co: TV, optional
  }
  class Overrides {
    <<client-side, IndexedDB, D-22, D-27>>
    +SliderKey to number or boolean, partial
  }
  class SliderRegistry {
    <<D-27, one entry per allowed key>>
    +key: SliderKey
    +min: number
    +max: number
    +step: number
    +unit: string
    +appliesTo: ObjectType list
    +group: colour, lighting, spin, relief or physics
    +spec: A7 section
  }

  TV --> "1" Tag : tag
  Tag ..> Badge : shown as (D-02)
  ObjectCard --> "1" ObjectType : type
  ObjectCard "1" *-- "0..*" TV : tagged fields
  ObjectCard "1" *-- "0..*" LightcurvePoint : lightcurve
  ObjectCard "1" *-- "0..1" GasQ : gas_Q
  GasQ "1" *-- "0..3" TV
  Overrides "0..1" ..> "1" ObjectCard : overrides values, Reset clears
  Overrides ..> SliderRegistry : keys must be in the registry
  SliderRegistry --> ObjectType : appliesTo
```

## Diagram 2: RenderParams

```mermaid
classDiagram
  direction LR
  class RenderParams {
    +id: string
    +type: ObjectType
    +generator_version: string
    +seed: integer, minimum 0
    +scale_m: number or null
    +layers: Layer list
    +dynamics: Dynamics, optional
    +textures: Textures, optional
    +components: Component list of 2, optional
    +lighting: Lighting
    +view_modes: ViewModes
    +haptics: HapticProfile
    +alt_text: string
    +missing: string list
  }
  class Layer {
    +id: string
    +tag: Tag
    +description: string
    +requires: string list
    +tier: Tier, 1 to 5
    +formula: string, optional
    +assumed: map, optional
  }
  class DynamicsValue {
    +value: number
    +tag: Tag
    +tier: Tier, 1 to 5
    +source: string
    +formula: string, optional
    +assumed: map, optional
  }
  class Dynamics {
    +spin_period_h: DynamicsValue, optional, value > 0
    +diff_rotation: DynamicsValue, optional
    +jet_speed_ms: DynamicsValue, optional
    +spot_lifetime_d: DynamicsValue, optional, value > 0
    +flare_rate_per_d: DynamicsValue, optional, value >= 0
    +pulsation_period_d: DynamicsValue, optional, value > 0
    +speedup: map of process to number, above 0
  }
  class Textures {
    +albedo: url
    +height: url
    +normal: url
    +roughness: url, optional
    +height_bin: url, optional
    +relief_amp: number above 0, optional (fraction of the radius; sent for asteroid_procedural since issue #62, Q-103, Q-117)
  }
  class Lighting {
    +mode: LightMode
    +sun_dir: vec3, optional
    +phase_angle_deg: number, optional
  }
  class LightMode {
    <<enumeration>>
    sun
    self
  }
  class ViewModes {
    +visible: VisibleMode
    +spherex_ir: IRMode, optional
  }
  class VisibleMode {
    <<D-23>>
    +available: boolean
    +badge: string
    +rgb: TV~rgb~ or null
    +source: gaia_rgb or class_palette or spherex_rgb
  }
  class IRMode {
    <<D-23, same shape as VisibleMode>>
    +available: boolean
    +badge: string
    +rgb: TV~rgb~ or null
    +source: gaia_rgb or class_palette or spherex_rgb
    +channels_um: rgb, optional
  }
  class HapticProfile {
    +texture: TextureHaptic
    +texture_tag: Tag
    +data: DataHaptic
    +data_tag: Tag
    +params: name to number map
  }
  class TextureHaptic {
    <<enumeration>>
    height
    mesh
    bands
    terrain
    flow
    none
  }
  class DataHaptic {
    <<enumeration>>
    field
    flux_pulse
    heartbeat
    dimming
    motion
    detections
    teq_pulse
    none
  }
  class Component {
    +class: string
    +tint: rgb
    +tint_tag: Tag
    +emissive_scale: number or null
    +emissive_tag: Tag
  }
  RenderParams "1" o-- "0..2" Component
  class ObjectCard {
    <<see diagram 1>>
  }
  class Tag {
    <<enumeration, see diagram 1>>
  }

  ObjectCard ..> RenderParams : card_to_params (backend, deterministic)
  RenderParams "1" *-- "0..*" Layer : layers, ordered
  RenderParams "1" *-- "0..1" Dynamics : absent until stage 6
  Dynamics "1" *-- "0..6" DynamicsValue
  DynamicsValue --> "1" Tag
  RenderParams "1" *-- "0..1" Textures : baked types only
  RenderParams "1" *-- "1" Lighting
  RenderParams "1" *-- "1" ViewModes
  RenderParams "1" *-- "1" HapticProfile
  Lighting --> LightMode
  ViewModes --> VisibleMode
  ViewModes --> IRMode
  HapticProfile --> TextureHaptic
  HapticProfile --> DataHaptic
  HapticProfile --> "2" Tag : texture_tag, data_tag
  Layer --> "1" Tag
```

## Notes

- The demo fixtures `planet_trappist1f` and `planet_kepler186f` hold real archive values, each `source` starting "synthetic fixture: real <planet> value, " (Q-165).
- `TV~T~` is one schema definition per payload in code (`TVNumber`, `TVString`, `TVRgb`, `TVVec3`, `TVPair`), because JSON Schema has no generics; `TV<T>` is a hand-written view of them in `frontend/src/contract/tags.ts`. Generated code: `backend/app/contract/`, `frontend/src/contract/generated.ts` (D-18).
- `Layer.tier` and `DynamicsValue.tier` are fixed by the tag (1 measured, 2 derived, 3 model_dependent, 4 inferred_from_analog, 5 artistic). `formula` is required from tier 2 and `assumed` at tier 3 (D-32). A rate no rung answers is omitted and listed in `missing` as `dynamics:<key>`. `speedup` keys are `spin`, `spots`, `flares`, `winds`, `clouds`, `pulsation`.
- `scale_m` is null when the size is unknown, for example on a `candidate` (Q-33).
- `Textures` and `Lighting` are named `RenderTextures` and `RenderLighting` in the schema and the generated code. The schema has no `IRMode` definition: `spherex_ir` refers to `VisibleMode`, and `IRMode` is a type alias in `frontend/src/contract/index.ts` (D-23).
- `rgb` and `vec3` stand for `[number, number, number]`; `pair` stands for `[number, number]`. They are written in words because Mermaid class members cannot hold brackets reliably.
- Issue #68: the card gains the exoplanet orbit, mass and host-star fields and `component_teff_K` (Q-150, Q-154); `components` holds the two bodies' class tint and relative brightness of a `brown_dwarf_binary` (Q-154) and is absent when the class does not name two components.
- `textures` is present only for the baked types (D-01). Shader kinds (`planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`) get their field from the browser worker, so it is absent **[verify]**.
- `terrain`, `flow`, `teq_pulse` and the ObjectCard field `teq_K` are added by D-12 (Accepted). `teq_K` is in the rendering doc R3.2 listing: `measured` from Exoplanet Archive `pl_eqt`, otherwise `derived`. `teq_pulse` is refused and listed in `missing` when `teq_K` is null.
- `VisibleMode` and `IRMode` share one shape (D-23); `channels_um` is set on `IRMode` only. Their `rgb` field, drawn as `TV~rgb~ or null`, is `TV<[number, number, number]> | null`, the same type as `gaia_rgb` and `spherex_rgb` (D-23, Q-18). When a mode is not available, the reason goes in `missing`.
- `lighting.mode` is `sun` for solar-system bodies (`phase_angle_deg` from Horizons quantity 24) and `self` for stars and brown dwarfs (rendering doc §5.1).
- `Overrides` holds user slider edits on the client, separate from the card, so Reset restores the data values. It is `Partial<Record<SliderKey, number | boolean>>`, and an unknown key fails the type check (D-27). It stays in IndexedDB and is never sent to the server (D-22).
- Baked types allow only colour, lighting and spin sliders for the event; relief sliders exist only on the shader kinds (D-26).
- The one registry lives in `frontend/src/viewer/sliders.ts` and serves the viewer and the physics layer. Each entry adds `group` (so D-26 can be checked) and `spec` (the section it feeds) to the D-27 fields (see the note under D-27); `SliderKey` is the registry's keys. A value outside the range is ignored, never clamped. Bulk density for the asteroid spin barrier is filed under `spin` (Q-58).
