// GENERATED from shared/schemas/ by scripts/generate-contract.js (D-18). Do not edit.
// Hand-written helpers sit next to this file; import from "@/contract".

/**
 * R3.2 and D-04.
 */
export type ObjectType =
  | 'asteroid_shape'
  | 'asteroid_procedural'
  | 'comet'
  | 'brown_dwarf'
  | 'brown_dwarf_binary'
  | 'star_mira'
  | 'star_ttauri'
  | 'star'
  | 'candidate'
  | 'planet_rocky'
  | 'planet_water'
  | 'gas_giant'
  | 'nebula'
  | 'nova';
/**
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber = {
  /**
   * null = unknown, never a guess.
   */
  value: number | null;
  err?: number | Pair;
  tag: Tag;
  source: string;
  /**
   * Required, non-blank, when tag is derived.
   */
  formula?: string;
  /**
   * Required, non-blank, when tag is model_dependent.
   */
  assumption?: string;
};
/**
 * @minItems 2
 * @maxItems 2
 */
export type Pair = [number, number];
/**
 * The five provenance tags (R3.1, D-02).
 */
export type Tag = 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic';
/**
 * Tagged value (R3.1) holding a string.
 */
export type TVString = {
  /**
   * null = unknown, never a guess.
   */
  value: string | null;
  err?: number | Pair;
  tag: Tag;
  source: string;
  /**
   * Required, non-blank, when tag is derived.
   */
  formula?: string;
  /**
   * Required, non-blank, when tag is model_dependent.
   */
  assumption?: string;
};
/**
 * Tagged value (R3.1) holding an RGB triple.
 */
export type TVRgb = {
  /**
   * null = unknown, never a guess.
   */
  value: Triple | null;
  err?: number | Pair;
  tag: Tag;
  source: string;
  /**
   * Required, non-blank, when tag is derived.
   */
  formula?: string;
  /**
   * Required, non-blank, when tag is model_dependent.
   */
  assumption?: string;
};
/**
 * An RGB triple or a 3-vector.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Triple = [number, number, number];
/**
 * Tagged value (R3.1) holding a 3-vector.
 */
export type TVVec3 = {
  /**
   * null = unknown, never a guess.
   */
  value: Triple | null;
  err?: number | Pair;
  tag: Tag;
  source: string;
  /**
   * Required, non-blank, when tag is derived.
   */
  formula?: string;
  /**
   * Required, non-blank, when tag is model_dependent.
   */
  assumption?: string;
};
export type CometEpoch = '2025-08' | '2025-12';
/**
 * Tagged value (R3.1) holding a pair of numbers.
 */
export type TVPair = {
  /**
   * null = unknown, never a guess.
   */
  value: Pair | null;
  err?: number | Pair;
  tag: Tag;
  source: string;
  /**
   * Required, non-blank, when tag is derived.
   */
  formula?: string;
  /**
   * Required, non-blank, when tag is model_dependent.
   */
  assumption?: string;
};
export type Layer = {
  id: string;
  tag: Tag;
  tier: Tier;
  description: string;
  requires: string[];
  /**
   * Required, non-blank, when tag is derived or model_dependent.
   */
  formula?: string;
  /**
   * Inputs that were not measured, keyed by card field or rule input name, with the value used. Required when tag is model_dependent.
   */
  assumed?: {
    [k: string]: number | string;
  };
};
/**
 * Fallback tier of the rung that answered: 1 measured, 2 derived, 3 model_dependent, 4 inferred_from_analog, 5 artistic (D-32). Always agrees with the tag.
 */
export type Tier = 1 | 2 | 3 | 4 | 5;
/**
 * terrain = height plus ocean and ice masks; flow = bands, jets, storms (D-12).
 */
export type TextureHaptic = 'height' | 'mesh' | 'bands' | 'terrain' | 'flow' | 'none';
export type DataHaptic =
  'field' | 'flux_pulse' | 'teq_pulse' | 'heartbeat' | 'dimming' | 'motion' | 'detections' | 'none';
/**
 * A DynamicsValue whose value is above 0 (periods and lifetimes).
 */
export type PositiveDynamicsValue = DynamicsValue & {
  value?: number;
};
/**
 * One motion rate with its provenance and the tier of the rung that answered (D-32). A rate no rung can answer is omitted and listed in missing as dynamics:<key>.
 */
export type DynamicsValue = {
  value: number;
  tag: Tag;
  tier: Tier;
  source: string;
  /**
   * Required, non-blank, when tag is derived or model_dependent.
   */
  formula?: string;
  /**
   * Inputs that were not measured, keyed by card field or rule input name, with the value used. Required when tag is model_dependent.
   */
  assumed?: {
    [k: string]: number | string;
  };
};
/**
 * A DynamicsValue whose value is 0 or more (rates).
 */
export type NonNegativeDynamicsValue = DynamicsValue & {
  value?: number;
};

/**
 * Bundle root: exists only so that both schemas compile into this one file.
 */
export interface ContractSchemas {
  card: ObjectCard;
  params: RenderParams;
}
/**
 * What is known about one object (R3.2). Served by GET /v1/objects/{id}/card (D-16). Single source of the contract (D-18).
 */
export interface ObjectCard {
  /**
   * Stable id, e.g. sbdb:101955 (A5.1).
   */
  id: string;
  name: string;
  type: ObjectType;
  diameter_km?: TVNumber;
  radius_rjup?: TVNumber;
  radius_rsun?: TVNumber;
  shape_source?: TVString;
  rot_period_h?: TVNumber;
  lightcurve_amp_mag?: TVNumber;
  albedo?: TVNumber;
  gaia_rgb?: TVRgb;
  spherex_rgb?: TVRgb;
  spectral_class?: TVString;
  band_depth_1um?: TVNumber;
  band_depth_2um?: TVNumber;
  band_depth_3um?: TVNumber;
  slope_075_25?: TVNumber;
  ch4_depth_33?: TVNumber;
  flux_45um?: TVNumber;
  teff_K?: TVNumber;
  teq_K?: TVNumber;
  period_var_d?: TVNumber;
  lightcurve?: LightcurvePoint[];
  phase_angle_deg?: TVNumber;
  sun_vector?: TVVec3;
  gas_Q?: GasQ;
  coma_radius_km?: TVNumber;
  nucleus_radius_km_max?: TVNumber;
  epochs?: CometEpoch[];
  pm_mas_yr?: TVPair;
}
export interface LightcurvePoint {
  t_mjd: number;
  flux: number;
  sigma: number;
  lambda_um: number;
  flags: number;
}
/**
 * Gas production rates, molecules/s. One value per molecule; R3.2's 'per epoch' does not fit this shape (Q-42).
 */
export interface GasQ {
  co2?: TVNumber;
  h2o?: TVNumber;
  co?: TVNumber;
}
/**
 * How to draw and feel one object (R3.4). Served by GET /v1/objects/{id}/render-params (D-16). Single source of the contract (D-18).
 */
export interface RenderParams {
  id: string;
  type: ObjectType;
  generator_version: string;
  /**
   * Seed = hash of (object id + generator version) (R1, A5.1). The hash is not specified yet (Q-35).
   */
  seed: number;
  /**
   * Physical radius in metres. null when the size is unknown: the body is refused, never guessed (Q-33).
   */
  scale_m: number | null;
  /**
   * Ordered, each with a tag.
   */
  layers: Layer[];
  textures?: RenderTextures;
  lighting: RenderLighting;
  view_modes: ViewModes;
  haptics: HapticProfile;
  dynamics?: Dynamics;
  /**
   * R9.
   */
  alt_text: string;
  /**
   * Layers refused for missing data, shown to the user.
   */
  missing: string[];
}
export interface RenderTextures {
  albedo: string;
  height: string;
  normal: string;
  roughness?: string;
  height_bin?: string;
  /**
   * Peak relief as a fraction of the body radius (R6.2 relief_amp): the scale of the displacement by the baked height map (R7.2). Optional (Q-103); the backend sends it for `asteroid_procedural` (issue #62), tagged `artistic` through its `displacement` layer.
   */
  relief_amp?: number;
}
export interface RenderLighting {
  mode: 'sun' | 'self';
  sun_dir?: Triple;
  phase_angle_deg?: number;
}
export interface ViewModes {
  visible: VisibleMode;
  spherex_ir?: VisibleMode;
}
/**
 * D-23. IRMode uses the same shape. When a mode is not available, the reason goes in missing.
 */
export interface VisibleMode {
  available: boolean;
  badge: string;
  rgb: TVRgb | null;
  source: 'gaia_rgb' | 'class_palette' | 'spherex_rgb';
  channels_um?: Triple;
}
/**
 * R8.8.
 */
export interface HapticProfile {
  texture: TextureHaptic;
  texture_tag: Tag;
  data: DataHaptic;
  data_tag: Tag;
  /**
   * For example tau, k, softness, maxRateHz.
   */
  params: {
    [k: string]: number;
  };
}
/**
 * Motion data (R3.4, D-32). Absent = no motion data. Rates: spin_period_h: Sidereal rotation period, hours. diff_rotation: k in Omega(phi) = Omega_eq (1 - k sin^2 phi). jet_speed_ms: Peak zonal wind speed, m/s. spot_lifetime_d: Star spot group lifetime, days. flare_rate_per_d: Flares per day above the drawn threshold. pulsation_period_d: Pulsation period, days.
 */
export interface Dynamics {
  spin_period_h?: PositiveDynamicsValue;
  diff_rotation?: DynamicsValue;
  jet_speed_ms?: DynamicsValue;
  spot_lifetime_d?: PositiveDynamicsValue;
  flare_rate_per_d?: NonNegativeDynamicsValue;
  pulsation_period_d?: PositiveDynamicsValue;
  /**
   * Time-lapse factor shown on screen for each animated process (D-34). {} when nothing moves.
   */
  speedup: {
    [k: string]: number;
  };
}

export const TAGS: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];

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
