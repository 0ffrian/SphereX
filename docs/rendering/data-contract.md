# Data contract: TV, ObjectCard, RenderParams

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R3, R3.1–R3.4 · **Implements:** D-02, D-04, D-12, D-16, D-18, D-23 ([decisions](../decisions.md))

## R3. Data contract

The types below are the spec. In code, `shared/schemas/*.json` is the single source: the backend's Pydantic models (`backend/app/contract/`) and `frontend/src/contract/generated.ts` are generated from it, and CI fails on drift (D-18). Endpoints: D-16.

### R3.1 Tagged value

```ts
type Tag = 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic';

interface TV<T = number> {
  value: T | null;          // null = unknown, never a guess
  err?: number | [number, number];
  tag: Tag;
  source: string;           // e.g. "JPL SBDB", "SPHEREx QR2 (this tool)", "Lisse et al. 2026 ApJL 1000 L52"
  formula?: string;         // required when tag === 'derived'
  assumption?: string;      // required when tag === 'model_dependent'
}
```

JSON Schema has no generics, so the schema has one definition per payload: `TVNumber`, `TVString`, `TVRgb`, `TVVec3`, `TVPair`. `TV<T>` stays as a hand-written generic view of them in `frontend/src/contract/tags.ts`; `typeParity.test.ts` proves it equals each one. The `formula` and `assumption` rules are `if`/`then` in the schema and must be non-blank. The generators drop them, so fixtures are checked with a real validator on both sides. What enforces them on live replies is open (Q-40).

### R3.2 ObjectCard (produced by the backend: `GET /v1/objects/{id}/card`)

```ts
type ObjectType =
  | 'asteroid_shape'        // has a real shape model (DAMIT / NASA mission)
  | 'asteroid_procedural'   // known small body, no shape model
  | 'comet'                 // 3I/ATLAS for the demo
  | 'brown_dwarf'
  | 'brown_dwarf_binary'    // Eps Indi Ba + Bb
  | 'star_mira'             // R Dra
  | 'star_ttauri'           // RW Aur
  | 'star'                  // Barnard's Star and generic stars
  | 'candidate'             // unknown moving source: no 3D body
  // D-04: from the Exoplanet Archive or user sliders, not SPHEREx detections. P2 or lower.
  // Drawn by browser shaders, not backend bakes (D-01); haptics from a shared CPU field (§7.7).
  | 'planet_rocky'
  | 'planet_water'
  | 'gas_giant'
  | 'nebula'
  | 'nova';

interface ObjectCard {
  id: string; name: string; type: ObjectType;
  // geometry
  diameter_km?: TV; radius_rjup?: TV; radius_rsun?: TV;   // radius_rsun: Gaia FLAME → 'model_dependent', else null (Q-152)
  shape_source?: TV<string>;          // URL/DOI of mesh, or null
  rot_period_h?: TV; lightcurve_amp_mag?: TV;
  // appearance inputs
  albedo?: TV; gaia_rgb?: TV<[number, number, number]>;
  spherex_rgb?: TV<[number, number, number]>;   // from §5.2
  spectral_class?: TV<string>;        // 'S'|'C'|'V'|'X'|'T1'|'T6'|'Y'|'M4V'...
  band_depth_1um?: TV; band_depth_2um?: TV; band_depth_3um?: TV;
  slope_075_25?: TV;                  // spectral slope, %/µm
  ch4_depth_33?: TV; flux_45um?: TV;  // brown dwarfs
  teff_K?: TV;                        // stars (Q-152): SIMBAD mesFe_h median → 'derived'; else Gaia GSP-Phot (> 4000 K only) →
                                      // 'model_dependent'; else a main-sequence class table → 'inferred_from_analog'; else null
  teq_K?: TV;                         // planet equilibrium temperature (D-12): Exoplanet Archive pl_eqt → 'measured',
                                      // otherwise 'derived' (architecture spec §7.1). null → teq_pulse refused, listed in missing
  // exoplanet orbit, mass and host star (issue #68, Q-150), from the Exoplanet Archive row (A3.8):
  mass_mearth?: TV;                   // 'measured' only when pl_bmassprov = 'Mass'; 'Msini' is a lower limit (model_dependent);
                                      // 'M-R relationship' (Chen & Kipping 2017) is model_dependent; 'Msin(i)/sin(i)' is derived
  orbit_au?: TV; orbital_period_d?: TV;
  host_teff_K?: TV; host_radius_rsun?: TV; host_mass_msun?: TV; host_age_gyr?: TV;
                                      // a measured column cites its *_reflink; a CALCULATED_VALUE is never 'measured'; a missing
                                      // value is null with the reason in `source`
  component_teff_K?: TV<[number, number]>;  // brown_dwarf_binary only: Teff of body A then B (literature registry, Q-154)
  // variability
  period_var_d?: TV;                  // Mira period: SIMBAD mesVar median over rows typed LPV or M → 'measured' (Q-152)
  lightcurve?: { t_mjd: number; flux: number; sigma: number; lambda_um: number; flags: number }[];
  // geometry of observation (solar-system bodies)
  phase_angle_deg?: TV; sun_vector?: TV<[number, number, number]>;   // sun_vector: unit vector target -> Sun,
                                      // ICRF equatorial J2000 (Horizons, Q-62)
  // comet
  gas_Q?: { co2?: TV; h2o?: TV; co?: TV };   // molecules/s, per epoch (the shape holds one epoch: Q-42)
  coma_radius_km?: TV; nucleus_radius_km_max?: TV;
  epochs?: ('2025-08' | '2025-12')[];
  // motion
  pm_mas_yr?: TV<[number, number]>;
}
```

### R3.3 Type selection (backend)

1. JPL SBDB says comet → `comet`.
2. JPL SBDB says asteroid → `asteroid_shape` if a DAMIT or NASA model exists, otherwise `asteroid_procedural`.
3. SIMBAD object type:
   - brown dwarf → `brown_dwarf`, or `brown_dwarf_binary` if the system has known components
   - Mira variable → `star_mira`
   - T Tauri → `star_ttauri`
   - any other star → `star`
4. NASA Exoplanet Archive match → `planet_rocky`, `planet_water` or `gas_giant`.
   - Classification thresholds: **proposed** values in `PROPOSED_EXOPLANET_THRESHOLDS` in `backend/app/core/classify/rules.py` (Q-63: radius cuts, true mass, Zeng 2019 mass-radius curves), chosen by Moon on 7 Nov 2026. The live thresholds are these values since issue #68: Moon signed off Q-63 on 9 Nov 2026 after the values were checked against their sources (D-17 amended); a value set back to `None` refuses with `type:exoplanet_thresholds`. Archive values marked `CALCULATED_VALUE` are never used to classify (Q-63). Open item, [§12](layout-tests-open-items.md#r12-open-items-verify).
   - The Exoplanet Archive service is tested ([architecture spec §3.8](../architecture/README.md)).
5. `nebula` and `nova` come from user sliders only. They have no catalogue rule; they are slider-only showcase bodies, and every value is tagged `artistic` (D-12).
6. Anything else → `candidate`.

### R3.4 RenderParams (produced by the backend: `GET /v1/objects/{id}/render-params`)

The backend converts an ObjectCard into RenderParams with deterministic rules ([§6.2](surface-generation.md#r62-card--generator-parameters-deterministic-rules)). The frontend renders RenderParams only.

```ts
interface RenderParams {
  id: string; type: ObjectType; generator_version: string; seed: number;   // seed: integer >= 0 (Q-35)
  scale_m: number | null;              // physical radius in metres; null = size unknown, body refused (Q-33)
  layers: Layer[];                     // ordered, each with a tag
  // relief_amp: peak relief, fraction of the radius (R6.2); scales the displacement (R7.2). Optional (Q-103); the backend sends it for `asteroid_procedural` (issue #62, Q-117), with an `artistic` `displacement` layer
  textures?: { albedo: string; height: string; normal: string; roughness?: string; height_bin?: string; relief_amp?: number };
  // brown_dwarf_binary only (issue #68, Q-154): the look of body A then body B, in the order of the card's spectral_class.
  // Absent when the class does not name two components with a palette: both bodies then share the system look.
  components?: [Component, Component];
  lighting: { mode: 'sun' | 'self'; sun_dir?: [number, number, number]; phase_angle_deg?: number };
                                       // sun_dir: today a copy of the card's ICRF sun_vector; the viewer reads it
                                       // as scene space. Frame conversion open (Q-62); phase_angle_deg wins
  view_modes: { visible: VisibleMode; spherex_ir?: IRMode };
  dynamics?: Dynamics;                 // D-32, D-34. Absent until stage 6: the body stays still (except R7.1 spin)
  haptics: HapticProfile;              // §8
  alt_text: string;                    // §9
  missing: string[];                   // layers refused for missing data, shown to the user
}
interface Component {
  class: string;                       // this body's class, one half of spectral_class, e.g. 'T1V'
  tint: [number, number, number];      // linear RGB from this body's class through the single-brown-dwarf palette
  tint_tag: Tag;                       // 'inferred_from_analog' (the palette is a placeholder, R6.4/Q-47)
  emissive_scale: number | null;       // 0..1, (Teff / Teff_max)^4 at equal radius; null = no Teff, use the system brightness
  emissive_tag: Tag;                   // the `component_brightness` layer's tag, or 'artistic' when emissive_scale is null
}
type Tier = 1 | 2 | 3 | 4 | 5;       // D-32: 1 measured, 2 derived, 3 model_dependent, 4 inferred_from_analog, 5 artistic
interface Layer {
  id: string; tag: Tag; description: string; requires: string[];
  tier: Tier;                          // required; fixed by tag (see below)
  formula?: string;                    // required, non-blank, when tag is derived or model_dependent
  assumed?: Record<string, number | string>; // required when model_dependent: the inputs that were not measured, with the value used
}

// D-32, D-34: motion rates. Same tier rules as Layer.
interface DynamicsValue {
  value: number;                       // never null: a rate no rung can answer is omitted and listed in missing
  tag: Tag; tier: Tier; source: string;
  formula?: string; assumed?: Record<string, number | string>;
}
interface Dynamics {
  spin_period_h?: DynamicsValue;       // sidereal, hours, > 0 (equatorial for stars and giants)
  diff_rotation?: DynamicsValue;       // k in Omega(phi) = Omega_eq (1 - k sin^2 phi)
  jet_speed_ms?: DynamicsValue;        // peak zonal wind, m/s
  spot_lifetime_d?: DynamicsValue;     // star spot group lifetime, days, > 0
  flare_rate_per_d?: DynamicsValue;    // flares per day above the drawn threshold, >= 0
  pulsation_period_d?: DynamicsValue;  // Mira, from the light curve, days, > 0
  // required; keys spin, spots, flares, winds, clouds, pulsation; each value > 0; {} when nothing moves
  speedup: { [process: string]: number };
}

// D-23: VisibleMode and IRMode use one shape
interface VisibleMode {
  available: boolean;
  badge: string;
  rgb: TV<[number, number, number]> | null;             // same type as gaia_rgb / spherex_rgb; TV carries the tag
  source: 'gaia_rgb' | 'class_palette' | 'spherex_rgb';
  channels_um?: [number, number, number];               // IRMode only (§5.2)
}
type IRMode = VisibleMode;
```

When a mode is not available, the reason goes in `missing` ([§5.2](display-rules.md#r52-view-modes)).

**Tiers and dynamics (D-32, D-34).**
- Tag and tier always agree: `measured` 1, `derived` 2, `model_dependent` 3, `inferred_from_analog` 4, `artistic` 5. The schema rejects a mismatch, on `Layer` and on `DynamicsValue`. `formula` is required for `derived` and `model_dependent`. `assumed` is required for `model_dependent` and lists only the inputs that were not measured, keyed by card field or rule input name.
- A layer or rate falls down the chain and says which rung answered. When no rung answers, a layer goes in `missing` by its id and a rate as `dynamics:<key>` (for example `dynamics:flare_rate_per_d`). `scale_m` and card values are never filled by fallback. A tier 1 rate is the value of a measured card field in the same unit (`spin_period_h` from `rot_period_h`, `pulsation_period_d` from `period_var_d`) and wins over every other rung; a rate with no such field starts at tier 2.
- `speedup` is the time-lapse factor shown on screen for each animated process ([§5.7](display-rules.md#r57-motion-and-time-lapse)). It is a display choice, not a data value. The live backend omits `dynamics` until stage 6 exists. Absent means no motion data: the body stays still, except the R7.1 asteroid spin.
