# Data contract: TV, ObjectCard, RenderParams

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R3, R3.1–R3.4 · **Implements:** D-02, D-04 ([decisions](../decisions.md))

## R3. Data contract

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
  diameter_km?: TV; radius_rjup?: TV; radius_rsun?: TV;
  shape_source?: TV<string>;          // URL/DOI of mesh, or null
  rot_period_h?: TV; lightcurve_amp_mag?: TV;
  // appearance inputs
  albedo?: TV; gaia_rgb?: TV<[number, number, number]>;
  spherex_rgb?: TV<[number, number, number]>;   // from §5.2
  spectral_class?: TV<string>;        // 'S'|'C'|'V'|'X'|'T1'|'T6'|'Y'|'M4V'...
  band_depth_1um?: TV; band_depth_2um?: TV; band_depth_3um?: TV;
  slope_075_25?: TV;                  // spectral slope, %/µm
  ch4_depth_33?: TV; flux_45um?: TV;  // brown dwarfs
  teff_K?: TV;
  // variability
  period_var_d?: TV;                  // Mira period
  lightcurve?: { t_mjd: number; flux: number; sigma: number; lambda_um: number; flags: number }[];
  // geometry of observation (solar-system bodies)
  phase_angle_deg?: TV; sun_vector?: TV<[number, number, number]>;
  // comet
  gas_Q?: { co2?: TV; h2o?: TV; co?: TV };   // molecules/s, per epoch
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
   - Classification thresholds (which columns, which cut-offs): **[verify] / to decide**. Open item, [§12](layout-tests-open-items.md#r12-open-items-verify). Do not hard-code values until they are agreed.
   - The Exoplanet Archive service itself is not yet confirmed ([architecture spec §3.8](../architecture/README.md)).
5. `nebula` and `nova` come from user sliders only. No catalogue rule is defined (to decide).
6. Anything else → `candidate`.

### R3.4 RenderParams (produced by the backend: `GET /v1/objects/{id}/render-params`)

The backend converts an ObjectCard into RenderParams with deterministic rules ([§6.2](surface-generation.md#r62-card--generator-parameters-deterministic-rules)). The frontend renders RenderParams only.

```ts
interface RenderParams {
  id: string; type: ObjectType; generator_version: string; seed: number;
  scale_m: number;                     // physical radius in metres
  layers: Layer[];                     // ordered, each with a tag
  textures?: { albedo: string; height: string; normal: string; roughness?: string; height_bin?: string };
  lighting: { mode: 'sun' | 'self'; sun_dir?: [number, number, number]; phase_angle_deg?: number };
  view_modes: { visible: VisibleMode; spherex_ir?: IRMode };
  haptics: HapticProfile;              // §8
  alt_text: string;                    // §9
  missing: string[];                   // layers refused for missing data, shown to the user
}
interface Layer { id: string; tag: Tag; description: string; requires: string[] }
```
