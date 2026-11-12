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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber1 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber2 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber3 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber4 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber5 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber6 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber7 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber8 = {
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
 * Tagged value (R3.1) holding a number.
 */
export type TVNumber9 = {
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
 * Tagged value (R3.1) holding a sampled path: rows of [JD TDB, x, y, z (au), vx, vy, vz (au/day)], heliocentric ICRF (Q-261).
 */
export type TVTrack = {
  /**
   * null = unknown, never a guess.
   */
  value:
    | [
        [number, number, number, number, number, number, number],
        [number, number, number, number, number, number, number],
        ...[number, number, number, number, number, number, number][],
      ]
    | null;
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
export type AreaId = string;
export type AreaRa = number;
export type AreaDec = number;
/**
 * ISO-8601 UTC with a trailing Z (A17.8).
 */
export type AreaUtcTime = string;
/**
 * A refusal code of A17.8 (register: A4.12).
 */
export type AreaMissingCode = string;
export type AreaProvenanceEntry = {
  tag: AreaTag;
  source?: string;
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
 * The tags Area search uses (A16.5); never inferred_from_analog or artistic.
 */
export type AreaTag = 'measured' | 'derived' | 'model_dependent';
export type AreaFrameId = string;
export type AreaDetector = number;
export type AreaVisit = number;
export type AreaExposure = number;
/**
 * One polygon vertex: [ra, dec] in degrees.
 *
 * @minItems 2
 * @maxItems 2
 */
export type AreaRaDec = [AreaRa, AreaDec];
/**
 * <frame_id>:<n>, n from 1 by the rounded centroid row, then column (Q-208 (14)).
 */
export type AreaDotId = string;
export type AreaDotLabel = 'glitch' | 'star' | 'fixed' | 'mover';
export type AreaTrackId = string;
/**
 * Position angle in degrees, east of north, in [0, 360).
 */
export type AreaAngleDeg = number;
export type AreaVerdict = 'found_blind' | 'unexplained' | 'unchecked' | 'possible';
export type AreaLinker = 'pairs' | 'rate_grid';
export type AreaSedLabel = 'smooth' | 'rough' | 'too_few' | 'not_informative';
/**
 * GET /v1/areas/{area_id}/checks (A17.8, A17.6; gated, Q-203). Each part appears only if it ran (A18.11): checks:d4_not_run drops test_mover and completeness, checks:d5_not_run drops control, checks:not_run drops every part and the linker (Q-208 (12)).
 */
export type AreaChecks = {
  test_mover?: AreaTestMover;
  completeness?: AreaCompleteness;
  control?: AreaControl;
  linker?: AreaLinker;
  method: AreaMethod;
  cached_at: AreaUtcTime;
  computed_at: AreaUtcTime;
  missing: AreaMissingCode[];
  provenance: AreaChecksProvenance;
};
/**
 * [low, high], both in [0, 1].
 *
 * @minItems 2
 * @maxItems 2
 */
export type AreaInterval = [number, number];
/**
 * ISO-8601 UTC with milliseconds and a trailing Z.
 */
export type TrackPathUtcTime = string;
/**
 * Right ascension in degrees, ICRF.
 */
export type TrackPathRa = number;
/**
 * Declination in degrees, ICRF.
 */
export type TrackPathDec = number;
/**
 * A19.5, A19.10: path:deferred (poll), path:not_cached, path:observer, path:ephemeris, path:window, path:frames_incomplete (the frame list is not final; poll).
 */
export type TrackPathMissingCode =
  | 'path:deferred'
  | 'path:not_cached'
  | 'path:observer'
  | 'path:ephemeris'
  | 'path:window'
  | 'path:frames_incomplete';
export type TrackPathUtcTimeOrNull = TrackPathUtcTime | null;

/**
 * Bundle root: exists only so that every schema compiles into this one file.
 */
export interface ContractSchemas {
  card: ObjectCard;
  params: RenderParams;
  areaIndex: AreaIndex;
  areaSummary: AreaSummary;
  areaKnown: AreaKnown;
  areaDots: AreaDots;
  areaTracks: AreaTracks;
  areaChecks: AreaChecks;
  areaError: AreaError;
  trackPath: TrackPath;
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
  lum_lsun?: TVNumber1;
  mass_msun?: TVNumber2;
  flare_rate_per_d?: TVNumber3;
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
  mass_mearth?: TVNumber;
  orbit_au?: TVNumber;
  orbital_period_d?: TVNumber;
  host_teff_K?: TVNumber;
  host_radius_rsun?: TVNumber;
  host_mass_msun?: TVNumber;
  host_age_gyr?: TVNumber;
  orbit_ecc?: TVNumber4;
  insolation_searth?: TVNumber5;
  host_lum_lsun?: TVNumber6;
  dayside_temp_K?: TVNumber7;
  nightside_temp_K?: TVNumber8;
  hotspot_offset_deg?: TVNumber9;
  surface_pressure_bar?: TVNumber;
  surface_temperature_K?: TVNumber;
  surface_fluid?: TVString;
  component_teff_K?: TVPair;
  period_var_d?: TVNumber;
  lightcurve?: LightcurvePoint[];
  phase_angle_deg?: TVNumber;
  sun_vector?: TVVec3;
  gas_Q?: GasQ;
  coma_radius_km?: TVNumber;
  nucleus_radius_km_max?: TVNumber;
  epochs?: CometEpoch[];
  orbit_track?: TVTrack;
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
 * Gas production rates, molecules/s. Either one value per molecule (the R3.2 shape, valid for one epoch), or keyed by epoch ('2025-08', '2025-12'), each holding one value per molecule (the Q-42 proposal, read by the comet renderer, Q-260). An epoch with no measurement is left out, never guessed.
 */
export interface GasQ {
  co2?: TVNumber;
  h2o?: TVNumber;
  co?: TVNumber;
  '2025-08'?: GasQEpoch;
  '2025-12'?: GasQEpoch;
}
/**
 * Gas production rates at one SPHEREx epoch, molecules/s (Q-260).
 */
export interface GasQEpoch {
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
  /**
   * Per-body look of a brown_dwarf_binary, in the order of the card's spectral_class (A then B), when the class names two components (Q-154). Absent otherwise: both bodies then share the system look.
   *
   * @minItems 2
   * @maxItems 2
   */
  components?: [Component, Component];
  lighting: RenderLighting;
  view_modes: ViewModes;
  haptics: HapticProfile;
  dynamics?: Dynamics;
  confidence?: Confidence;
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
/**
 * One body of a brown_dwarf_binary (R7.4, Q-154). tint is linear RGB from this body's own class through the single-brown-dwarf class palette.
 */
export interface Component {
  /**
   * This body's spectral class, one half of the card's spectral_class, such as T1V.
   */
  class: string;
  tint: Triple;
  tint_tag: Tag;
  /**
   * This body's brightness relative to the brighter body, (Teff / Teff_max)^4 at equal radius. null = no Teff for this system: the body uses the system brightness.
   */
  emissive_scale: number | null;
  emissive_tag: Tag;
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
/**
 * How much of the picture rests on data, and the 3D gate (D-36, Q-220 to Q-222). C = sum(w c) / sum(w). It is not the probability that the picture is correct and it does not change a provenance tag. Absent for nebula and nova (no key measurement is defined for them).
 */
export interface Confidence {
  /**
   * C, 0 to 1.
   */
  score: number;
  /**
   * Part of the score from measured values.
   */
  measured_share: number;
  /**
   * Part of the score from derived and model-dependent values.
   */
  estimated_share: number;
  /**
   * The rest: assumed, artistic or missing.
   */
  assumed_share: number;
  /**
   * Minimum C for a 3D body. Starts at 0.25 (D-36).
   */
  threshold: number;
  band: 'mostly_data' | 'part_data' | 'mostly_assumed' | 'too_little';
  gate: {
    class_known: boolean;
    key_measurement: boolean;
    score_ok: boolean;
    /**
     * All three. When false the viewer draws no 3D body and shows found and needed.
     */
    passed: boolean;
  };
  /**
   * Plain words: what the card has.
   */
  found: string;
  /**
   * Plain words: what is missing for a 3D body. Empty when the gate passed.
   */
  needed: string;
  /**
   * What would raise the score most.
   */
  raise: string | null;
  inputs: ConfidenceInput[];
  /**
   * The score is a formula of the card (D-02).
   */
  tag: 'derived';
  formula: string;
  /**
   * States that the weights are placeholders.
   */
  weights_note: string;
  /**
   * States that this is not the probability the picture is correct.
   */
  note: string;
}
/**
 * One quantity in the score.
 */
export interface ConfidenceInput {
  id: string;
  label: string;
  /**
   * Placeholder weight; the weights of one type sum to 100.
   */
  weight: number;
  /**
   * How far the data narrows the class range.
   */
  c: number;
  /**
   * The tag of the value that fed it, or missing.
   */
  tag: 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic' | 'missing';
  /**
   * This input's part of C, in percentage points.
   */
  points: number;
  /**
   * Card fields that fed it (or could).
   */
  fields: string[];
}
/**
 * GET /v1/areas (A17.8): the prepared areas. Also holds the definitions the other area schemas share.
 */
export interface AreaIndex {
  areas: AreaIndexEntry[];
  cached_at: AreaUtcTime | null;
  computed_at: AreaUtcTime | null;
  missing: AreaMissingCode[];
  provenance: AreaIndexProvenance;
}
export interface AreaIndexEntry {
  area_id: AreaId;
  ra: AreaRa;
  dec: AreaDec;
  width_deg: number;
  height_deg: number;
  data_release: string;
  n_frames: number;
  n_visits: number;
  computed_at: AreaUtcTime;
  cached_at: AreaUtcTime;
}
export interface AreaIndexProvenance {
  areas: AreaProvenanceEntry;
}
/**
 * GET /v1/areas/{area_id} (A17.8): frames, coverage, step counts and method.
 */
export interface AreaSummary {
  area_id: AreaId;
  ra: AreaRa;
  dec: AreaDec;
  width_deg: number;
  height_deg: number;
  data_release: string;
  n_frames: number;
  n_visits: number;
  frames: AreaSummaryFrame[];
  coverage: AreaCoverage[];
  steps: AreaSteps;
  method: AreaMethod;
  cached_at: AreaUtcTime;
  computed_at: AreaUtcTime;
  missing: AreaMissingCode[];
  provenance: AreaSummaryProvenance;
}
export interface AreaSummaryFrame {
  frame_id: AreaFrameId;
  detector: AreaDetector;
  visit: AreaVisit;
  exposure: AreaExposure;
  time: AreaUtcTime;
  wavelength_min_um: number;
  wavelength_max_um: number;
  s_region: string;
}
export interface AreaCoverage {
  visit: AreaVisit;
  /**
   * @minItems 3
   */
  polygon: [AreaRaDec, AreaRaDec, AreaRaDec, ...AreaRaDec[]];
}
export interface AreaSteps {
  n_dots: number;
  n_glitches: number;
  n_stars: number;
  n_fixed: number;
  n_static_one_visit: number;
  n_tracks: number;
  n_possible: number;
  n_found_blind: number;
  n_unexplained: number;
  n_unchecked: number;
}
export interface AreaMethod {
  settings: AreaSettings;
  checks?: AreaChecksMethod;
}
/**
 * Named starting values of the run (A17 intro), as written into the reply.
 */
export interface AreaSettings {
  [k: string]: number | string;
}
/**
 * Settings of the gated checks (A17.6).
 */
export interface AreaChecksMethod {
  seeds: number[];
  n_per_cell: number;
  snr_bins: AreaBin[];
  rate_bins: AreaBin[];
  n_control_runs: number;
  psf: string;
  distance_model: string;
}
/**
 * A half-open bin [min, max); max null for the open top bin.
 */
export interface AreaBin {
  min: number;
  max: number | null;
}
export interface AreaSummaryProvenance {
  frames: AreaProvenanceEntry;
  coverage: AreaProvenanceEntry;
  steps: AreaProvenanceEntry;
}
/**
 * GET /v1/areas/{area_id}/known (A17.8, A17.5): known objects in the area, positions seen from SPHEREx.
 */
export interface AreaKnown {
  known: AreaKnownObject[];
  skybot: AreaSkybotAnswer[];
  cached_at: AreaUtcTime;
  computed_at: AreaUtcTime;
  missing: AreaMissingCode[];
  provenance: AreaKnownProvenance;
}
export interface AreaKnownObject {
  designation: string;
  number: number | null;
  object_id: string | null;
  kind: 'asteroid' | 'comet';
  v_mag: number | null;
  n_frames: number;
  n_visits: number;
  positions: AreaKnownPosition[];
  track_available: boolean;
}
export interface AreaKnownPosition {
  frame_id: AreaFrameId;
  time: AreaUtcTime;
  ra: AreaRa;
  dec: AreaDec;
}
/**
 * When that visit's SkyBoT cone was answered; null when it failed (skybot:<visit> in missing).
 */
export interface AreaSkybotAnswer {
  visit: AreaVisit;
  fetched_at: AreaUtcTime | null;
}
export interface AreaKnownProvenance {
  positions: AreaProvenanceEntry;
  skybot: AreaProvenanceEntry;
}
/**
 * GET /v1/areas/{area_id}/dots (A17.8, A17.2): every dot of the area, per visit, with its label.
 */
export interface AreaDots {
  visits: AreaVisitDots[];
  cached_at: AreaUtcTime;
  computed_at: AreaUtcTime;
  missing: AreaMissingCode[];
  provenance: AreaDotsProvenance;
}
export interface AreaVisitDots {
  visit: AreaVisit;
  dots: AreaDot[];
}
export interface AreaDot {
  dot_id: AreaDotId;
  frame_id: AreaFrameId;
  detector: AreaDetector;
  exposure: AreaExposure;
  time: AreaUtcTime;
  x: number;
  y: number;
  ra: AreaRa;
  dec: AreaDec;
  flux_uJy: number;
  flux_err: number;
  snr: number;
  wavelength_um: number;
  bandwidth_um: number;
  flags: string[];
  label: AreaDotLabel;
}
export interface AreaDotsProvenance {
  position: AreaProvenanceEntry;
  photometry: AreaProvenanceEntry;
  wavelength: AreaProvenanceEntry;
  label: AreaProvenanceEntry;
}
/**
 * GET /v1/areas/{area_id}/tracks (A17.8): tracks and possibles (A17.4) with match and verdict (A17.5), sed (A17.13) and linker (A17.12).
 */
export interface AreaTracks {
  tracks: AreaTrack[];
  skybot: AreaSkybotAnswer[];
  cached_at: AreaUtcTime;
  computed_at: AreaUtcTime;
  missing: AreaMissingCode[];
  provenance: AreaTracksProvenance;
}
export interface AreaTrack {
  track_id: AreaTrackId;
  visits: AreaVisit[];
  /**
   * @minItems 1
   */
  tracklets: [AreaTracklet, ...AreaTracklet[]];
  rate_deg_day: number | null;
  pa_deg: AreaAngleDeg | null;
  u_inv_au: number | null;
  status: 'track' | 'possible';
  reason: ('ambiguous' | 'no_partner' | 'one_visit') | null;
  verdict: AreaVerdict;
  match: AreaMatch | null;
  linker: AreaLinker;
  unchecked_by: AreaMissingCode[];
  sed?: AreaSed;
}
export interface AreaTracklet {
  visit: AreaVisit;
  /**
   * @minItems 1
   */
  dot_ids: [AreaDotId, ...AreaDotId[]];
  v_in_deg_day: number;
  pa_in_deg: AreaAngleDeg;
  rms_px: number;
}
export interface AreaMatch {
  designation: string;
  number: number | null;
  object_id: string | null;
  v_mag: number | null;
  median_sep_px: number;
  fetched_at: AreaUtcTime;
}
export interface AreaSed {
  label: AreaSedLabel;
  chi2_red: number | null;
  n_dots: number;
  sigma_floor: number;
}
export interface AreaTracksProvenance {
  tracks: AreaProvenanceEntry;
  match: AreaProvenanceEntry;
  sed?: AreaProvenanceEntry;
}
export interface AreaTestMover {
  ra: AreaRa;
  dec: AreaDec;
  rate_deg_day: number;
  pa_deg: AreaAngleDeg;
  snr: number;
  dots: AreaPlantedDot[];
  recovered: boolean;
  reason: string | null;
}
/**
 * A planted dot: an AreaDot without dot_id and label. Never in /dots (A17.6).
 */
export interface AreaPlantedDot {
  frame_id: AreaFrameId;
  detector: AreaDetector;
  exposure: AreaExposure;
  time: AreaUtcTime;
  x: number;
  y: number;
  ra: AreaRa;
  dec: AreaDec;
  flux_uJy: number;
  flux_err: number;
  snr: number;
  wavelength_um: number;
  bandwidth_um: number;
  flags: string[];
}
/**
 * Per cell only; no single figure (A17.6, A16.5).
 */
export interface AreaCompleteness {
  snr_bins: AreaBin[];
  rate_bins: AreaBin[];
  cells: AreaCompletenessCell[];
}
export interface AreaCompletenessCell {
  snr_bin: number;
  rate_bin: number;
  n: number;
  k: number;
  frac: number;
  wilson95: AreaInterval;
}
export interface AreaControl {
  n_runs: number;
  tracks_per_run: number[];
  mean: number;
  max: number;
}
/**
 * Keys present exactly when the checks ran.
 */
export interface AreaChecksProvenance {
  test_mover?: AreaProvenanceEntry;
  completeness?: AreaProvenanceEntry;
  control?: AreaProvenanceEntry;
}
/**
 * Error body: 404 area_not_found, 404 dot_not_found, 503 stamp_unavailable (A17.8).
 */
export interface AreaError {
  error: 'area_not_found' | 'dot_not_found' | 'stamp_unavailable';
  detail: string;
}
/**
 * GET /v1/objects/{id}/path (A19.5, Q-141): a moving object's path seen from SPHEREx, from the path search's cached Horizons ephemeris. Cache only; model_dependent.
 */
export interface TrackPath {
  id: string;
  /**
   * Horizons CENTER of every position: the SPHEREx spacecraft (A3.4, Q-138).
   */
  observer: '500@-163182';
  /**
   * Minutes between two samples (SX_MOVING_EPHEM_STEP_MIN).
   */
  step_min: number;
  /**
   * The spans served, each inside one search window; never joined across a gap.
   */
  windows: TrackPathWindow[];
  /**
   * Horizons samples inside the windows, in time order.
   */
  points: TrackPathPoint[];
  /**
   * The exact Horizons TLIST position at each frame midpoint inside the windows (the /frames positions).
   */
  frame_points: TrackPathFramePoint[];
  tag: 'model_dependent';
  assumption: string;
  formula: string;
  /**
   * Largest separation between the interpolated path and the exact TLIST position over frame_points; null without frame points.
   */
  interp_error_arcsec: number | null;
  missing: TrackPathMissingCode[];
  fetched_at: TrackPathUtcTimeOrNull;
  cached_at: TrackPathUtcTimeOrNull;
}
export interface TrackPathWindow {
  start: TrackPathUtcTime;
  end: TrackPathUtcTime;
}
export interface TrackPathPoint {
  time: TrackPathUtcTime;
  ra: TrackPathRa;
  dec: TrackPathDec;
}
export interface TrackPathFramePoint {
  frame_id: string;
  time: TrackPathUtcTime;
  ra: TrackPathRa;
  dec: TrackPathDec;
  /**
   * Horizons 3-sigma RA uncertainty (quantity 36); null until it is asked for (cut for the event, issue #74).
   */
  ra_3sigma_arcsec: number | null;
  /**
   * Horizons 3-sigma Dec uncertainty (quantity 36); null until it is asked for.
   */
  dec_3sigma_arcsec: number | null;
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

export const AREA_DOT_LABELS: readonly AreaDotLabel[] = ['glitch', 'star', 'fixed', 'mover'];

export const AREA_VERDICTS: readonly AreaVerdict[] = [
  'found_blind',
  'unexplained',
  'unchecked',
  'possible',
];

export const AREA_SED_LABELS: readonly AreaSedLabel[] = [
  'smooth',
  'rough',
  'too_few',
  'not_informative',
];

export const AREA_LINKERS: readonly AreaLinker[] = ['pairs', 'rate_grid'];
