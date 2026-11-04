# 05 Data contract (classes)

The data contract between backend and frontend: `ObjectCard` (what we know) and `RenderParams` (how to draw and feel it). Drawn from rendering doc §3.1–3.4, §5.1–5.3, §8.8 and decisions D-02 (replaces the settings file), D-04 (type union) and D-12 (extended `HapticProfile`, new `teq_K` field).

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
    <<client-side, D-02>>
    +field to value map
  }

  TV --> "1" Tag : tag
  Tag ..> Badge : shown as (D-02)
  ObjectCard --> "1" ObjectType : type
  ObjectCard "1" *-- "0..*" TV : tagged fields
  ObjectCard "1" *-- "0..*" LightcurvePoint : lightcurve
  ObjectCard "1" *-- "0..1" GasQ : gas_Q
  GasQ "1" *-- "0..3" TV
  Overrides "0..1" ..> "1" ObjectCard : overrides values, Reset clears
```

## Diagram 2: RenderParams

```mermaid
classDiagram
  direction LR
  class RenderParams {
    +id: string
    +type: ObjectType
    +generator_version: string
    +seed: number
    +scale_m: number
    +layers: Layer list
    +textures: Textures, optional
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
  }
  class Textures {
    +albedo: url
    +height: url
    +normal: url
    +roughness: url, optional
    +height_bin: url, optional
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
    <<fields not defined in spec>>
  }
  class IRMode {
    <<fields not defined in spec>>
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
  class ObjectCard {
    <<see diagram 1>>
  }
  class Tag {
    <<enumeration, see diagram 1>>
  }

  ObjectCard ..> RenderParams : card_to_params (backend, deterministic)
  RenderParams "1" *-- "0..*" Layer : layers, ordered
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

- `rgb` and `vec3` stand for `[number, number, number]`; `pair` stands for `[number, number]`. They are written in words because Mermaid class members cannot hold brackets reliably.
- `textures` is present only for the baked types (D-01). Shader kinds (`planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`) get their field from the browser worker, so it is absent **[verify]**.
- `terrain`, `flow`, `teq_pulse` and the ObjectCard field `teq_K` are added by D-12, which is still Proposed. `teq_K` is in D-12 and in `frontend/src/contract/objectCard.ts`, but not yet in the rendering doc R3.2 listing. `teq_pulse` is refused and listed in `missing` when `teq_K` is null.
- `lighting.mode` is `sun` for solar-system bodies (`phase_angle_deg` from Horizons quantity 24) and `self` for stars and brown dwarfs (rendering doc §5.1).
- `Overrides` holds user slider edits on the client, separate from the card, so Reset restores the data values. Which sliders apply to baked bodies is Q-03 open.
