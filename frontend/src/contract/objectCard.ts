// R3.2 ObjectCard (produced by the backend: GET /v1/objects/{id}/card), D-04 type union, D-12 teq_K.
import type { TV } from './tags';

export type ObjectType =
  | 'asteroid_shape' // has a real shape model (DAMIT / NASA mission)
  | 'asteroid_procedural' // known small body, no shape model
  | 'comet' // 3I/ATLAS for the demo
  | 'brown_dwarf'
  | 'brown_dwarf_binary' // Eps Indi Ba + Bb
  | 'star_mira' // R Dra
  | 'star_ttauri' // RW Aur
  | 'star' // Barnard's Star and generic stars
  | 'candidate' // unknown moving source: no 3D body
  // D-04: from the Exoplanet Archive or user sliders, not SPHEREx detections. P2 or lower.
  // Drawn by browser shaders, not backend bakes (D-01); haptics from a shared CPU field (R7.7).
  | 'planet_rocky'
  | 'planet_water'
  | 'gas_giant'
  | 'nebula'
  | 'nova';

export const OBJECT_TYPES: readonly ObjectType[] = [
  'asteroid_shape',
  'asteroid_procedural',
  'comet',
  'brown_dwarf',
  'brown_dwarf_binary',
  'star_mira',
  'star_ttauri',
  'star',
  'candidate',
  'planet_rocky',
  'planet_water',
  'gas_giant',
  'nebula',
  'nova',
];

export interface LightcurvePoint {
  t_mjd: number;
  flux: number;
  sigma: number;
  lambda_um: number;
  flags: number;
}

export type CometEpoch = '2025-08' | '2025-12';

export interface ObjectCard {
  id: string;
  name: string;
  type: ObjectType;
  // geometry
  diameter_km?: TV;
  radius_rjup?: TV;
  radius_rsun?: TV;
  shape_source?: TV<string>; // URL/DOI of mesh, or null
  rot_period_h?: TV;
  lightcurve_amp_mag?: TV;
  // appearance inputs
  albedo?: TV;
  gaia_rgb?: TV<[number, number, number]>;
  spherex_rgb?: TV<[number, number, number]>; // from R5.2
  spectral_class?: TV<string>; // 'S'|'C'|'V'|'X'|'T1'|'T6'|'Y'|'M4V'...
  band_depth_1um?: TV;
  band_depth_2um?: TV;
  band_depth_3um?: TV;
  slope_075_25?: TV; // spectral slope, %/µm
  ch4_depth_33?: TV;
  flux_45um?: TV; // brown dwarfs
  teff_K?: TV;
  // D-12 (Proposed): planet equilibrium temperature. Exoplanet Archive `pl_eqt` (measured) when
  // present, otherwise derived (architecture spec A7.1). `teq_pulse` is refused when null.
  teq_K?: TV;
  // variability
  period_var_d?: TV; // Mira period
  lightcurve?: LightcurvePoint[];
  // geometry of observation (solar-system bodies)
  phase_angle_deg?: TV;
  sun_vector?: TV<[number, number, number]>;
  // comet
  gas_Q?: { co2?: TV; h2o?: TV; co?: TV }; // molecules/s, per epoch
  coma_radius_km?: TV;
  nucleus_radius_km_max?: TV;
  epochs?: CometEpoch[];
  // motion
  pm_mas_yr?: TV<[number, number]>;
}
