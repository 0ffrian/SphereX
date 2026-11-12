// Issue #71 stream C, D-36: the physics of a star's surface and its spots. Pure and deterministic:
// the model is a function of (Teff, radius, mass, rotation period, seed) and nothing else. No
// Math.random, no Date.
//
// Chain (each step names its tag, D-02 / D-32):
//   g = G M / R^2                                  derived (nominal constants, IAU 2015 B3)
//   H = k T / (mu m_H g)                           model_dependent (mu is an assumption)
//   L = 8 H                                        model_dependent (cell size rule of the issue)
//   convection fades out for hot stars             model_dependent (placeholder window, [verify])
//   tau_c = 12.3 d (L/Lsun)^-1/2, Reiners 2022     model_dependent (#93 3.4: the field law's own definition)
//   Ro = P_rot / tau_c                             model_dependent
//   <B> = Reiners et al. 2022 law of Ro            model_dependent
//   spot coverage f from <B>                       inferred_from_analog (Sun-anchored, PLACEHOLDER)
//   group areas lognormal, latitudes, Joy tilt     inferred_from_analog
//
// Giants (log g < GIANT_LOGG_MAX) have no Reiners field and no spots: the fit covers dwarfs only.
// What this module does not know it refuses (`missing`), it never fills in.
//
// ---- Interface for stream G (flares and plasma) ------------------------------------------------
// `SpotGroup` (centre, polarity axis, separation, area), `StellarModel.radiusRsun`, `.fieldG` and
// `.coverage` are the contract. All angles are radians. Directions are unit vectors in the star's
// body frame (+y = north pole, longitude = atan2(z, x), the frame of viewer/bodies/starModel.ts).
// `groups` is sorted largest area first and holds at most MAX_GROUPS_DRAWN groups; `nGroupsReal`
// is the physical count (it can be far larger on an active star). Flares should start at a group
// from this list (largest areas first) and size their energy from `areaFraction`.

import type { Tag } from '@/contract';
import { hash3 } from '@/viewer/fields/noise';
import { GM_SUN, K_B, R_SUN_M } from './constants';

export type Vec3 = [number, number, number];

/** One value's provenance (D-02): `derived` needs a formula, `model_dependent` an assumption. */
export interface StellarTag {
  tag: Tag;
  formula?: string;
  assumption?: string;
  /** Where the law comes from. Items ending [verify] are not checked against the paper yet. */
  cite: string;
}

// ---- constants ---------------------------------------------------------------------------------
/** Hydrogen atom mass, kg (CODATA 2018). */
const M_H_KG = 1.6735575e-27;
/** Mean molecular weight of a neutral solar-mix photosphere, ASSUMPTION (about 1.3). */
export const MU_PHOTOSPHERE = 1.3;
/** Cell size in scale heights, L = 8 H (issue #71, D-36). [verify] against Freytag et al. 2012. */
export const CELL_SCALE_HEIGHTS = 8;
/**
 * Convection window: fraction of surface convection is 1 below CONV_FULL_K, 0 above CONV_NONE_K,
 * smoothstep between. Placeholder around the Kraft break (about 6200 to 8000 K). [verify]
 */
export const CONV_FULL_K = 6500;
export const CONV_NONE_K = 8200;
/** Below this convection fraction there is no dynamo, no spots, no cells. */
export const CONV_MIN = 0.05;
/** Dwarfs only: the Reiners et al. 2022 sample is main-sequence M dwarfs and Sun-like dwarfs. */
export const GIANT_LOGG_MAX = 3.5; // log10(g in cgs). PLACEHOLDER [verify]

/** IAU 2015 Resolution B3 nominal solar effective temperature, K. */
export const TEFF_SUN_K = 5772;
/**
 * Convective turnover time at one solar luminosity, days: Reiners et al. 2022 (A&A 662, A41, sect. 4) define the
 * Rossby number of their field law with tau = 12.3 d (L / Lsun)^-1/2. #93 3.4: replaces the Wright et al. 2011
 * mass fit, which belongs to a different Rossby scale (it gave Barnard's Star 101 d against about 193 d here, from
 * the card's R 0.2022 Rsun and T 3243 K).
 * [verify] the 12.3 d coefficient against the paper (quoted in issue #93, not re-opened in this session).
 */
export const TAU_SUN_REINERS_D = 12.3;

/** Luminosity in solar units from the radius and temperature: L = R^2 (Teff / 5772 K)^4 (Stefan-Boltzmann). */
export function luminosityLsun(radiusRsun: number, teffK: number): number {
  return radiusRsun * radiusRsun * Math.pow(teffK / TEFF_SUN_K, 4);
}

/** Convective turnover time, days, as Reiners et al. 2022 define it: 12.3 d (L / Lsun)^-1/2. */
export function turnoverTimeDays(radiusRsun: number, teffK: number): number {
  return TAU_SUN_REINERS_D / Math.sqrt(luminosityLsun(radiusRsun, teffK));
}

/**
 * Reiners et al. 2022 (A&A 662, A41) mean surface field, gauss: 199 Ro^-1.26 (Ro >= 0.13, slow
 * rotators) and 2050 Ro^-0.11 (Ro < 0.13, saturated).
 */
export const FIELD_UNSATURATED = { coefficientG: 199, exponent: -1.26 } as const;
export const FIELD_SATURATED = { coefficientG: 2050, exponent: -0.11 } as const;
export const RO_SATURATION = 0.13;
export function meanFieldG(ro: number): number {
  const law = ro < RO_SATURATION ? FIELD_SATURATED : FIELD_UNSATURATED;
  return law.coefficientG * Math.pow(ro, law.exponent);
}

/**
 * Spot coverage (fraction of the whole surface): PLACEHOLDER scaling, not a published law.
 * Anchored on the Sun (about 0.15% of the surface at an average field) and grown as the field to
 * the power COVERAGE_EXPONENT, capped at COVERAGE_MAX. [verify] both numbers. Stream B / a later
 * sensitivity pass may replace it; the UI must keep calling it a rough estimate.
 */
export const SUN_COVERAGE = 0.0015;
export const COVERAGE_EXPONENT = 1.6;
export const COVERAGE_MAX = 0.25;
/**
 * Solar field and rotation used as the anchor: Ro_sun = 25.4 d / 12.3 d = 2.07 (#93 3.4; with the Wright fit it was
 * 1.76). The Sun's field from the law is then 80 G (was 98 G); spot coverage is relative to it, so the Sun's
 * coverage stays SUN_COVERAGE.
 */
export const SUN_ROTATION_DAYS = 25.4;
const sunFieldG = (): number => meanFieldG(sunRossby());

/**
 * Sunspot group areas are lognormal (Baumann and Solanki 2005; parameters [verify]): median
 * 7.5e-5 of the whole surface, sigma 1 in ln. The mean is median * exp(sigma^2 / 2).
 */
export const GROUP_AREA_MEDIAN = 7.5e-5;
export const GROUP_AREA_SIGMA = 1;
export const GROUP_AREA_MEAN =
  GROUP_AREA_MEDIAN * Math.exp((GROUP_AREA_SIGMA * GROUP_AREA_SIGMA) / 2);
/** Most groups drawn at once (shader cost); the rest are only counted. */
export const MAX_GROUPS_DRAWN = 12;

/**
 * Butterfly latitudes (Sporer's law): the group belt starts high in the cycle and drifts to the
 * equator. Centre belt latitude grows with coverage (more active stars show spots at higher
 * latitudes, Schussler and Solanki 1992 [verify]); the numbers are the prototype's, ARTISTIC
 * scaling anchored on the Sun (belt centre 15 deg at the solar coverage).
 */
export const BELT_BASE_DEG = 15;
export const BELT_GROWTH_DEG = 45;
export const BELT_COVERAGE_FULL = 0.2;
/**
 * Belt swings from (1 + SWING/2) to (1 - SWING/2) of its centre over a cycle. Sun, at its coverage:
 * about 22 to 8.4 deg around a 15.3 deg centre (the observed butterfly starts nearer 30 deg).
 */
export const BUTTERFLY_SWING = 0.9;
export const BELT_SPREAD_DEG = 6;
export const BELT_MIN_RAD = (3 * Math.PI) / 180;
export const BELT_MAX_RAD = 1.3;
/** Joy's law: tilt = JOY_DEG * sin(lat), follower poleward (Hale et al. 1919; coefficient [verify]). */
export const JOY_DEG = 32;
/** Leader-follower separation (radians) = SEP_PER_SQRT_AREA * sqrt(area) + SEP_MIN. Artistic fit. */
export const SEP_PER_SQRT_AREA = 8;
export const SEP_MIN_RAD = 0.015;
/** Angular radius of a disc covering area fraction a of the sphere: a = (1 - cos th)/2, th = 2 sqrt(a). */
export const discRadiusFromArea = (area: number): number => Math.min(0.5, 2 * Math.sqrt(area));
/** Split of a group's area: leader, follower, two small pores (the prototype's split). */
export const AREA_SPLIT = { leader: 0.55, follower: 0.3, pore: 0.075 } as const;

const DEG = Math.PI / 180;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Point on the unit sphere (+y north, longitude = atan2(z, x)). */
const dir = (lat: number, lon: number): Vec3 => [
  Math.cos(lat) * Math.cos(lon),
  Math.sin(lat),
  Math.cos(lat) * Math.sin(lon),
];

/** Surface fraction with convective cells: 1 for cool stars, 0 for hot ones. */
export function convectionFraction(teffK: number): number {
  return 1 - smooth(CONV_FULL_K, CONV_NONE_K, teffK);
}

// ---- the spot-group interface (stream G builds on this) ----------------------------------------

export interface SpotGroup {
  /** Index in the list (0 = largest). Stable for a given input. */
  id: number;
  /** +1 north, -1 south. */
  hemisphere: 1 | -1;
  latRad: number;
  lonRad: number;
  /** Unit vector to the group centre (midpoint of leader and follower). */
  centre: Vec3;
  /** Unit tangent at `centre` along the polarity line, leader to follower (the loop axis). */
  polarityAxis: Vec3;
  /** Unit tangent at `centre`, perpendicular to `polarityAxis` (along the neutral line). */
  crossAxis: Vec3;
  /** Angular distance between leader and follower centres, radians. */
  separationRad: number;
  /** Area of the whole group as a fraction of the whole stellar surface (not of the disc). */
  areaFraction: number;
  /** Joy's-law tilt of the polarity axis out of the east direction, radians (+ = poleward). */
  tiltRad: number;
  leader: { centre: Vec3; radiusRad: number };
  follower: { centre: Vec3; radiusRad: number };
  /** Small pores, centres on the sphere. */
  pores: { centre: Vec3; radiusRad: number }[];
}

/**
 * Typical main-sequence (dwarf) rows, columns [Teff K, mass Msun, radius Rsun], hottest first.
 * Source: E. Mamajek, "A Modern Mean Dwarf Stellar Color and Effective Temperature Sequence"
 * (EEM_dwarf_UBVIJHK_colors_Teff.txt, version 2022.04.16,
 * https://www.pas.rochester.edu/~emamajek/EEM_dwarf_UBVIJHK_colors_Teff.txt; Pecaut and Mamajek
 * 2013, ApJS 208, 9). The source calls the adopted mean masses tentative. Used only to fill a
 * missing mass or radius for the surface physics (D-32 tier chain, tag `model_dependent`); never
 * for the scale bar or a size label (Q-33). Dwarfs only: a pre-main-sequence star (T Tauri) is
 * larger and cooler for its mass, so the assumption says so.
 */
export const MS_TABLE: readonly (readonly [number, number, number])[] = [
  [31400, 17.7, 7.16], // B0V
  [20600, 7.3, 4.06], // B2V
  [15700, 4.7, 2.77], // B5V
  [12300, 3.38, 2.86], // B8V
  [9700, 2.18, 2.193], // A0V
  [8100, 1.88, 1.785], // A5V
  [7220, 1.61, 1.728], // F0V
  [6550, 1.33, 1.473], // F5V
  [5930, 1.06, 1.1], // G0V
  [5770, 1.0, 1.012], // G2V
  [5660, 0.98, 0.977], // G5V
  [5270, 0.88, 0.813], // K0V
  [5100, 0.82, 0.783], // K2V
  [4440, 0.7, 0.701], // K5V
  [4100, 0.64, 0.63], // K7V
  [3850, 0.57, 0.588], // M0V
  [3660, 0.5, 0.501], // M1V
  [3560, 0.44, 0.446], // M2V
  [3430, 0.37, 0.361], // M3V
  [3210, 0.23, 0.274], // M4V
  [3060, 0.162, 0.196], // M5V
  [2810, 0.102, 0.137], // M6V
  [2680, 0.09, 0.12], // M7V
  [2570, 0.085, 0.114], // M8V
  [2380, 0.079, 0.102], // M9V
];

/** Log-log interpolation of column `y` against column `x` of MS_TABLE; clamps at the ends. */
function msInterp(x: number, xi: 0 | 1 | 2, yi: 0 | 1 | 2): number {
  const rows = [...MS_TABLE].sort((a, b) => a[xi] - b[xi]);
  if (x <= rows[0]![xi]) return rows[0]![yi];
  const last = rows[rows.length - 1]!;
  if (x >= last[xi]) return last[yi];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if (x <= b[xi]) {
      const t = Math.log(x / a[xi]) / Math.log(b[xi] / a[xi]);
      return a[yi] * Math.pow(b[yi] / a[yi], t);
    }
  }
  return last[yi];
}
export const massFromTeff = (teffK: number): number => msInterp(teffK, 0, 1);
export const radiusFromTeff = (teffK: number): number => msInterp(teffK, 0, 2);
/** Mass from a radius by the main-sequence relation; null when the radius is outside the dwarf range (a giant). */
export function massFromRadius(radiusRsun: number): number | null {
  const radii = MS_TABLE.map((r) => r[2]);
  if (radiusRsun > Math.max(...radii) * 1.5 || radiusRsun < Math.min(...radii) / 1.5) return null;
  return msInterp(radiusRsun, 2, 1);
}
/** The Sun's Rossby number: assumed for a star with no rotation period (inferred_from_analog). */
export const sunRossby = (): number => SUN_ROTATION_DAYS / TAU_SUN_REINERS_D;

export interface StellarInput {
  teffK: number;
  /** Radius from the card, or null: then it is taken from Teff for the surface physics only. */
  radiusRsun: number | null;
  /** Mass from the card or literature, or null: then from the radius, else from Teff (main sequence). */
  massMsun: number | null;
  /** Rotation period in days, or null: then the Sun's Rossby number is assumed. */
  rotationPeriodD: number | null;
  seed: number;
  /** Caps the drawn groups (the `low` quality tier uses fewer). Default MAX_GROUPS_DRAWN. */
  maxGroups?: number;
}

export interface StellarModel {
  teffK: number;
  radiusRsun: number;
  massMsun: number;
  /** Surface gravity, m/s^2, and log10 of it in cgs. */
  gravityMS2: number;
  logg: number;
  dwarf: boolean;
  /** 0..1 share of the surface with boiling cells. */
  convection: number;
  scaleHeightKm: number;
  cellSizeKm: number;
  /** Cells across one stellar radius (R / L). Small for giants, large for dwarfs. */
  cellsPerRadius: number;
  rossby: number | null;
  /** Mean surface field, gauss; null when there is no dynamo or no rotation period. */
  fieldG: number | null;
  /** Fraction of the whole surface under spots, 0 when none are drawn. */
  coverage: number;
  /** Physical number of groups at once, and how many of them are in `groups`. */
  nGroupsReal: number;
  groups: SpotGroup[];
  /** Phase of the activity cycle used for the latitudes, 0..1 (from the seed). */
  cyclePhase: number;
  /** Centre latitude of the group belt now, radians. */
  beltLatRad: number;
  /**
   * Inputs that were filled in by the tier chain (D-32), in plain words, with what they came from.
   * Empty when the card gave all three. The card itself is never written.
   */
  assumed: { mass?: string; radius?: string; rotation?: string };
  /** Tags of every value above. */
  tags: Readonly<Record<string, StellarTag>>;
  /** Reasons a quantity was not computed (plain words). */
  notes: string[];
}

export interface StellarRefusal {
  model: null;
  missing: string[];
  notes?: string[];
}

const TAGS: Record<string, StellarTag> = {
  gravity: {
    tag: 'derived',
    formula: 'g = G M / R^2',
    cite: 'Newton; nominal GM and R of the Sun (IAU 2015 B3)',
  },
  scaleHeight: {
    tag: 'model_dependent',
    formula: 'H = k T / (mu m_H g)',
    assumption: `mean molecular weight mu = ${MU_PHOTOSPHERE} (neutral solar-mix photosphere)`,
    cite: 'pressure scale height of an ideal gas',
  },
  cellSize: {
    tag: 'model_dependent',
    formula: `L = ${CELL_SCALE_HEIGHTS} H`,
    assumption: 'granule size scales with the pressure scale height [verify]',
    cite: 'issue #71 / D-36; Freytag et al. 2012 [verify]',
  },
  convection: {
    tag: 'model_dependent',
    assumption: `convection fades out between ${CONV_FULL_K} K and ${CONV_NONE_K} K (placeholder window) [verify]`,
    cite: 'Kraft break, Kraft 1967 [verify]',
  },
  rossby: {
    tag: 'model_dependent',
    formula: 'Ro = P_rot / tau_c',
    assumption:
      'tau_c = 12.3 d (L/Lsun)^-1/2, L = R^2 (Teff / 5772 K)^4: the turnover time the field law is defined with',
    cite: 'Reiners et al. 2022, A&A 662, A41 [verify the 12.3 d coefficient]',
  },
  field: {
    tag: 'model_dependent',
    formula: '<B> = 199 G Ro^-1.26 (Ro >= 0.13); 2050 G Ro^-0.11 (Ro < 0.13)',
    assumption: 'dwarfs only; scatter of the fit not shown',
    cite: 'Reiners et al. 2022, A&A 662, A41',
  },
  coverage: {
    tag: 'inferred_from_analog',
    assumption: `PLACEHOLDER: Sun coverage ${SUN_COVERAGE} scaled by (B/B_sun)^${COVERAGE_EXPONENT}, capped at ${COVERAGE_MAX}; not a published law [verify]`,
    cite: 'analogue: the Sun',
  },
  groups: {
    tag: 'inferred_from_analog',
    assumption:
      'group areas lognormal like sunspot groups; latitudes and tilt follow the solar butterfly diagram and Joy’s law; which groups are where is a seeded draw, not a measurement',
    cite: 'Baumann and Solanki 2005; Hale et al. 1919 [verify]',
  },
};

/** Standard normal draw from two hashes (Box-Muller). Deterministic in (a, b, seed). */
function gauss(a: number, b: number, seed: number): number {
  const u1 = hash3(a, b, 1, seed);
  const u2 = hash3(a, b, 2, seed);
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}

/** Centre latitude (radians) of the butterfly belt for a coverage and a cycle phase 0 (start) to 1 (end). */
export function beltLatitude(coverage: number, phase: number): number {
  const centre =
    (BELT_BASE_DEG + BELT_GROWTH_DEG * Math.min(1, coverage / BELT_COVERAGE_FULL)) * DEG;
  return centre * (1 + BUTTERFLY_SWING * (0.5 - clamp(phase, 0, 1)));
}

/**
 * Builds the groups for a given total coverage: lognormal areas rescaled so they add up to the
 * coverage (when fewer than the physical count are drawn the drawn ones are the largest).
 */
export function buildSpotGroups(
  seed: number,
  coverage: number,
  beltLat: number,
  maxGroups: number,
): { groups: SpotGroup[]; nReal: number } {
  const nReal = coverage / GROUP_AREA_MEAN;
  const nG = Math.min(maxGroups, Math.round(nReal));
  if (nG < 1) return { groups: [], nReal };
  const scale = coverage / (nG * GROUP_AREA_MEAN);
  const raw: { area: number; hemi: 1 | -1; lat: number; lon: number; i: number }[] = [];
  for (let i = 0; i < nG; i++) {
    const area = GROUP_AREA_MEDIAN * Math.exp(GROUP_AREA_SIGMA * gauss(i, 11, seed)) * scale;
    const hemi: 1 | -1 = i % 2 ? -1 : 1;
    const lat = clamp(
      beltLat + BELT_SPREAD_DEG * DEG * gauss(i, 12, seed),
      BELT_MIN_RAD,
      BELT_MAX_RAD,
    );
    raw.push({ area, hemi, lat, lon: hash3(i, 13, 0, seed) * 2 * Math.PI, i });
  }
  raw.sort((a, b) => b.area - a.area || a.i - b.i);
  const groups = raw.map((r, id): SpotGroup => {
    const sep = SEP_PER_SQRT_AREA * Math.sqrt(r.area) + SEP_MIN_RAD;
    const lat = r.hemi * r.lat;
    const centre = dir(lat, r.lon);
    const east: Vec3 = [-Math.sin(r.lon), 0, Math.cos(r.lon)];
    const north: Vec3 = [
      -Math.sin(lat) * Math.cos(r.lon),
      Math.cos(lat),
      -Math.sin(lat) * Math.sin(r.lon),
    ];
    // Follower poleward: the east axis turns towards the pole of its own hemisphere.
    const tilt = r.hemi * JOY_DEG * DEG * Math.sin(r.lat);
    const axis = norm([
      east[0] * Math.cos(tilt) + north[0] * Math.sin(tilt),
      east[1] * Math.cos(tilt) + north[1] * Math.sin(tilt),
      east[2] * Math.cos(tilt) + north[2] * Math.sin(tilt),
    ]);
    const crossAxis = norm(cross(centre, axis));
    // Footpoints at +-sep/2 along the great circle through the centre.
    const at = (u: number, v: number): Vec3 =>
      norm([
        centre[0] + axis[0] * u + crossAxis[0] * v,
        centre[1] + axis[1] * u + crossAxis[1] * v,
        centre[2] + axis[2] * u + crossAxis[2] * v,
      ]);
    const half = Math.tan(sep / 2);
    const leaderC = at(-half, 0);
    const followerC = at(half, 0);
    const pores = [0, 1].map((k) => {
      const a = hash3(r.i, 20 + k, 0, seed) * 2 * Math.PI;
      const d = sep * (0.2 + 0.4 * hash3(r.i, 22 + k, 0, seed));
      return {
        centre: at(Math.cos(a) * d, Math.sin(a) * d),
        radiusRad: discRadiusFromArea(r.area * AREA_SPLIT.pore),
      };
    });
    return {
      id,
      hemisphere: r.hemi,
      latRad: lat,
      lonRad: r.lon,
      centre,
      polarityAxis: axis,
      crossAxis,
      separationRad: sep,
      areaFraction: r.area,
      tiltRad: tilt,
      leader: { centre: leaderC, radiusRad: discRadiusFromArea(r.area * AREA_SPLIT.leader) },
      follower: { centre: followerC, radiusRad: discRadiusFromArea(r.area * AREA_SPLIT.follower) },
      pores,
    };
  });
  return { groups, nReal };
}

/**
 * The star's surface model. Refuses (returns `{ model: null, missing }`) when Teff, radius or mass
 * is missing or not positive. A missing rotation period still gives the cells (they do not need
 * it) and refuses the field and spots, with a note.
 */
export function stellarModel(input: StellarInput): { model: StellarModel } | StellarRefusal {
  const ok = (x: number | null | undefined): x is number =>
    typeof x === 'number' && Number.isFinite(x) && x > 0;
  // Only Teff is required: everything else falls down the tier chain (D-32).
  if (!ok(input.teffK)) return { model: null, missing: ['teff_K'] };
  const teffK = input.teffK;
  const assumed: StellarModel['assumed'] = {};
  const PM13 = 'a typical main-sequence star (Mamajek mean dwarf sequence, 2022.04.16)';
  let radiusRsun: number;
  if (ok(input.radiusRsun)) radiusRsun = input.radiusRsun;
  else {
    radiusRsun = radiusFromTeff(teffK);
    assumed.radius = `radius ${radiusRsun.toFixed(2)} Rsun from the temperature of ${PM13}, used only for the surface physics, not for the size shown`;
  }
  let massMsun: number;
  if (ok(input.massMsun)) massMsun = input.massMsun;
  else if (ok(input.radiusRsun)) {
    const m = massFromRadius(input.radiusRsun);
    if (m === null)
      return {
        model: null,
        missing: ['mass_msun'],
        notes: ['The radius is outside the dwarf range, so no mass is assumed for a giant.'],
      };
    massMsun = m;
    assumed.mass = `mass ${massMsun.toFixed(2)} Msun from the radius of ${PM13}`;
  } else {
    massMsun = massFromTeff(teffK);
    assumed.mass = `mass ${massMsun.toFixed(2)} Msun from the temperature of ${PM13}`;
  }
  let rotationPeriodD: number;
  if (ok(input.rotationPeriodD)) rotationPeriodD = input.rotationPeriodD;
  else {
    rotationPeriodD = sunRossby() * turnoverTimeDays(radiusRsun, teffK);
    assumed.rotation = `rotation period ${rotationPeriodD.toFixed(1)} days: the Sun's Rossby number (${sunRossby().toFixed(2)}) assumed, so the field and spots are a Sun-like guess`;
  }

  const g = (GM_SUN * massMsun) / Math.pow(R_SUN_M * radiusRsun, 2);
  const logg = Math.log10(g * 100);
  const dwarf = logg >= GIANT_LOGG_MAX;
  const conv = convectionFraction(teffK);
  const hM = (K_B * teffK) / (MU_PHOTOSPHERE * M_H_KG * g);
  const scaleHeightKm = hM / 1000;
  const cellSizeKm = CELL_SCALE_HEIGHTS * scaleHeightKm;
  const cellsPerRadius = (R_SUN_M * radiusRsun) / 1000 / cellSizeKm;

  const notes: string[] = [];
  const tags: Record<string, StellarTag> = {
    gravity: TAGS.gravity!,
    scaleHeight: TAGS.scaleHeight!,
    cellSize: TAGS.cellSize!,
    convection: TAGS.convection!,
  };
  let rossby: number | null = null;
  let fieldG: number | null = null;
  let coverage = 0;
  let groups: SpotGroup[] = [];
  let nReal = 0;
  const cyclePhase = hash3(7, 7, 7, input.seed);
  let beltLat = beltLatitude(0, cyclePhase);

  if (conv <= CONV_MIN) {
    notes.push(
      'Stars this hot have almost no convection near the surface: no boiling cells and no spots.',
    );
  } else if (!dwarf) {
    notes.push(
      'The magnetic-field fit covers dwarf stars only, so no field and no spots are drawn for a giant.',
    );
  } else {
    rossby = rotationPeriodD / turnoverTimeDays(radiusRsun, teffK);
    fieldG = meanFieldG(rossby);
    coverage =
      Math.min(COVERAGE_MAX, SUN_COVERAGE * Math.pow(fieldG / sunFieldG(), COVERAGE_EXPONENT)) *
      conv;
    beltLat = beltLatitude(coverage, cyclePhase);
    const built = buildSpotGroups(
      input.seed,
      coverage,
      beltLat,
      input.maxGroups ?? MAX_GROUPS_DRAWN,
    );
    groups = built.groups;
    nReal = built.nReal;
    tags.rossby = TAGS.rossby!;
    tags.field = TAGS.field!;
    if (assumed.rotation) {
      const a = `${assumed.rotation}`;
      tags.rossby = { ...TAGS.rossby!, tag: 'inferred_from_analog', assumption: a };
      tags.field = { ...TAGS.field!, tag: 'inferred_from_analog', assumption: a };
    }
    tags.coverage = TAGS.coverage!;
    tags.groups = TAGS.groups!;
  }

  // A mass or radius from the table weakens everything built on gravity to model_dependent.
  if (assumed.mass || assumed.radius) {
    const a = [assumed.mass, assumed.radius].filter(Boolean).join('; ');
    tags.gravity = { ...TAGS.gravity!, tag: 'model_dependent', assumption: a };
  }
  if (assumed.mass)
    tags.mass = {
      tag: 'model_dependent',
      assumption: assumed.mass,
      cite: 'Mamajek EEM_dwarf table, version 2022.04.16',
    };
  if (assumed.radius)
    tags.radius = {
      tag: 'model_dependent',
      assumption: assumed.radius,
      cite: 'Mamajek EEM_dwarf table, version 2022.04.16',
    };

  return {
    model: {
      assumed,
      teffK,
      radiusRsun,
      massMsun,
      gravityMS2: g,
      logg,
      dwarf,
      convection: conv,
      scaleHeightKm,
      cellSizeKm,
      cellsPerRadius,
      rossby,
      fieldG,
      coverage,
      nGroupsReal: nReal,
      groups,
      cyclePhase,
      beltLatRad: beltLat,
      tags,
      notes,
    },
  };
}

// ---- views -------------------------------------------------------------------------------------

export type StarColourView = 'observatory' | 'enhanced' | 'true';
export type StarScale = 'enlarged' | 'true' | 'close';

/** Cells across the disc drawn when the cells are enlarged (artistic: so the boiling reads). */
export const ENLARGED_CELLS_ACROSS = 30;

/** Cells across one radius to draw for a scale choice. `enlarged` is artistic whenever it changes anything. */
export function cellsForScale(
  model: StellarModel,
  scale: StarScale,
): { cells: number; artistic: boolean } {
  if (scale === 'enlarged' && model.cellsPerRadius > ENLARGED_CELLS_ACROSS)
    return { cells: ENLARGED_CELLS_ACROSS, artistic: true };
  return { cells: model.cellsPerRadius, artistic: false };
}

/** Where to look and how wide a window for the close-up: the largest group (else lat 15, lon 0.5). */
export function closeUpTarget(model: StellarModel): {
  latRad: number;
  lonRad: number;
  halfWidth: number;
} {
  const g = model.groups[0];
  const half = Math.min(1.28, 15 / Math.max(model.cellsPerRadius, 1e-9));
  return g
    ? { latRad: g.latRad, lonRad: g.lonRad, halfWidth: half }
    : { latRad: 0.26, lonRad: 0.5, halfWidth: half };
}

/**
 * How visible the cells are (0..1) when `cellsAcross` of them span one radius and the window is
 * `halfWidth` radii wide on a screen about `viewPx` pixels tall: cells smaller than a few pixels
 * average out. Prototype rule (smoothstep .2 to .55 of the cell footprint in pixels, approximated).
 */
export function granuleVisibility(cellsAcross: number, halfWidth = 1.28, viewPx = 700): number {
  const foot = (2 * halfWidth * cellsAcross) / viewPx;
  return 1 - smooth(0.2, 0.55, foot);
}

// ---- readouts in plain words -------------------------------------------------------------------

export interface ReadoutRow {
  label: string;
  value: string;
  tag: Tag | null;
}

const fmt = (x: number, d = 0): string => x.toLocaleString('en', { maximumFractionDigits: d });

/** Rows for the details panel. Plain words; the tag of each row is the weakest of its inputs. */
export function starReadouts(m: StellarModel): ReadoutRow[] {
  const rows: ReadoutRow[] = [
    {
      label: 'Surface gravity',
      value: `${fmt(m.gravityMS2, m.gravityMS2 < 1 ? 3 : 0)} m/s²`,
      tag: 'derived',
    },
  ];
  if (m.convection > CONV_MIN) {
    rows.push({
      label: 'Size of one cell',
      value:
        m.cellSizeKm > 1e5 ? `${fmt(m.cellSizeKm / 1e6)} million km` : `${fmt(m.cellSizeKm)} km`,
      tag: 'model_dependent',
    });
    rows.push({
      label: 'Cells per star radius',
      value: fmt(m.cellsPerRadius),
      tag: 'model_dependent',
    });
  } else {
    rows.push({
      label: 'Boiling cells',
      value: 'None: no outer convection',
      tag: 'model_dependent',
    });
  }
  if (m.rossby !== null && m.fieldG !== null) {
    rows.push({ label: 'Rossby number', value: fmt(m.rossby, 2), tag: 'model_dependent' });
    rows.push({
      label: 'Average magnetic field',
      value: `${fmt(m.fieldG)} G`,
      tag: 'model_dependent',
    });
    rows.push({
      label: 'Surface covered by spots (rough estimate)',
      value: `${fmt(m.coverage * 100, 2)}%`,
      tag: 'inferred_from_analog',
    });
    rows.push({
      label: `Spot groups${m.nGroupsReal > m.groups.length ? ` (${m.groups.length} largest drawn)` : ''}`,
      value: fmt(Math.round(m.nGroupsReal)),
      tag: 'inferred_from_analog',
    });
  } else if (!m.dwarf) {
    rows.push({ label: 'Magnetic field', value: 'Fit covers dwarfs only', tag: null });
  } else if (m.convection <= CONV_MIN) {
    rows.push({ label: 'Magnetic field', value: 'No surface dynamo', tag: null });
  } else {
    rows.push({ label: 'Magnetic field', value: 'Needs the rotation period', tag: null });
  }
  return rows;
}

/** One plain sentence for the stage caption. */
export function starCaption(m: StellarModel, scale: StarScale): string {
  if (m.convection <= CONV_MIN)
    return 'Stars this hot have almost no convection near the surface, so there are no boiling cells and no sunspots. The smooth look is the correct one.';
  const { cells, artistic } = cellsForScale(m, scale);
  if (scale === 'true')
    return m.cellsPerRadius > 150
      ? 'True scale. Real cells are smaller than a pixel at this distance, which is why a whole star looks smooth in visible light.'
      : 'True scale. Low gravity makes the cells enormous, so a giant shows only a handful at once.';
  if (scale === 'enlarged')
    return artistic
      ? `Cells drawn ${fmt(m.cellsPerRadius / cells)} times larger than life so the boiling reads at this distance. This layer is labelled Default (artistic).`
      : 'Cells at true scale. Low gravity makes them this large.';
  return `Close-up at true scale. One cell is about ${m.cellSizeKm > 1e5 ? `${fmt(m.cellSizeKm / 1e6)} million km` : `${fmt(m.cellSizeKm)} km`} across.`;
}
