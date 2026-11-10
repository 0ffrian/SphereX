// Issue #71 stream E, D-36, A7.2 / R7.7: the gas-giant model. Pure TypeScript, no three.js, so it runs
// in a Web Worker and in tests. Ported from the approved prototype (`sculptor-preview.html`:
// `worldModel` gas branch, `gasProfile`, `GasSim`).
//
// What is solved: quasi-geostrophic vorticity on the sphere,
//     dq/dt + J(psi, q + f) = F - D,   q = lap(psi) - psi / L_D^2,
// spectral in longitude (FFT), tridiagonal in latitude, Arakawa Jacobian, Adams-Bashforth 2.
// The deep jets are FIXED (Juno: the jets reach about 3,000 km down, so the weather above them does
// not drive them) and are scaled to stay inside the Rayleigh-Kuo stability limit, so the bands
// persist and cannot break down. Storms live in the shear between jets. Time stepping, forcing and
// random storm births are functions of (input, seed, step count) only: no wall clock, no
// `Math.random`.
//
// Tags (D-02, D-32): the band LATITUDES of Jupiter and Saturn are observed (`measured`, [verify]
// against a published belt table); band COLOURS are `artistic`; the solved vorticity, storm sizes and
// the Rhines count are `model_dependent` / `derived`. See `GAS_LAYER_TAGS`.
import type { Tag } from '@/contract';
import { AU_M, G, R_JUP_M } from './constants';

// ---- small helpers -----------------------------------------------------------------------------

const TAU = Math.PI * 2;
const SIGMA_SB = 5.670374e-8; // W m^-2 K^-4, CODATA 2018
const R_GAS = 8314.462618; // J kmol^-1 K^-1, CODATA 2018

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Seeded PRNG (mulberry32): the same seed gives the same stream. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- constants with their sources -------------------------------------------------------------

/**
 * Heat-capacity factor `cp = 3.5 R_specific` (a diatomic gas). Display-grade modelling choice of the
 * prototype; a hydrogen-helium air is close to it. `model_dependent`.
 */
const CP_OVER_R = 3.5;
/** Reference pressure for the radiative time, Pa (1e4 Pa = 0.1 bar). Modelling choice. [verify] */
const RADIATIVE_REF_PA = 1e4;
/** Thermal-wind scaling `U = 0.6 sqrt(R dT)` (Showman et al. 2010 style order of magnitude). [verify] */
const WIND_COEFFICIENT = 0.6;
/** Storm deformation-radius factor for a gas giant (prototype). [verify] */
const DEFORMATION_FACTOR = 0.35;
/** Flattening rule `f = 0.7 q` (A7.2, calibrated on Jupiter and Saturn). */
const FLATTENING_COEFFICIENT = 0.7;
/** Hot-giant limit: nothing can be drawn as a band model above this (night side glows). Unused here. */
const IR_GLOW_K = 850;

// ---- observed band tables (Jupiter, Saturn) ----------------------------------------------------

/**
 * Bands by planetocentric latitude: [degrees, brightness, brown chromophore, roughness].
 *
 * Latitudes: the observed belts and zones of Jupiter and Saturn, from the prototype's table.
 * [verify] The edge latitudes are recalled from the standard belt/zone nomenclature (for example
 * the NEB spanning about 7 to 18 N and the SEB about 7 to 20 S on Jupiter) and not re-checked against
 * a primary table in this session. They are `measured` in kind (observed positions) and stay
 * [verify] until the astro-verifier has cited them. Brightness, chromophore and roughness are
 * `artistic` display values.
 */
export const GAS_NODES: Readonly<Record<string, readonly (readonly [number, number, number, number])[]>> = {
  jup: [[-90, .5, .35, .1], [-60, .58, .34, .25], [-52, .66, .22, .3], [-47, .58, .33, .3], [-43, .72, .12, .25], [-38, .6, .35, .3], [-34, .76, .1, .2], [-30, .55, .45, .35], [-26, .85, .08, .2], [-20, .88, .1, .3], [-18, .45, .72, .75], [-12, .42, .8, .9], [-8, .5, .65, .7], [-6, .88, .08, .35], [0, .92, .06, .3], [5, .88, .1, .4], [7.5, .44, .78, .75], [12, .4, .85, .85], [17, .45, .72, .6], [19, .87, .1, .2], [23, .84, .1, .2], [25, .5, .55, .4], [30, .55, .5, .35], [32, .78, .1, .2], [36, .6, .32, .3], [40, .72, .15, .25], [46, .6, .3, .3], [52, .64, .25, .25], [60, .56, .33, .2], [90, .5, .35, .1]],
  sat: [[-90, .55, .5, .03], [-70, .62, .42, .04], [-55, .72, .32, .05], [-40, .8, .22, .05], [-28, .74, .34, .06], [-15, .85, .18, .05], [0, .93, .08, .06], [12, .86, .18, .05], [25, .75, .33, .06], [38, .82, .2, .05], [50, .7, .35, .05], [65, .6, .45, .04], [78, .5, .5, .03], [90, .5, .5, .03]],
};

/** Reference gas giants with observed bands. */
export type ReferenceGasId = 'jup' | 'sat';

// ---- Saturn's rings ----------------------------------------------------------------------------

/**
 * Saturn's main rings in km from Saturn's centre. Radii: NASA Planetary Fact Sheet, "Saturn's Rings"
 * (https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html, read 10 Nov 2026): D 66,900 to
 * 74,510; C 74,658 to 91,975; B 91,975 to 117,507; A 122,340 to 136,780; F ring 139,826; Encke Gap
 * 133,410; Saturn equatorial radius 60,268 km (planet fact sheet). The Cassini Division is the gap
 * between the B outer and A inner edges. `measured`. Opacity and brightness are `artistic`; the
 * F ring is drawn as a thin line (width is an artistic choice) and the Encke Gap width is too.
 */
export const SATURN_RADIUS_KM = 60268;
export const SATURN_RINGS: readonly {
  id: 'D' | 'C' | 'B' | 'Cassini' | 'A' | 'F';
  name: string;
  innerKm: number;
  outerKm: number;
  /** Drawn opacity (artistic). */
  opacity: number;
  brightness: number;
}[] = [
  { id: 'D', name: 'D ring', innerKm: 66900, outerKm: 74510, opacity: 0.03, brightness: 0.3 },
  { id: 'C', name: 'C ring', innerKm: 74658, outerKm: 91975, opacity: 0.08, brightness: 0.3 },
  { id: 'B', name: 'B ring', innerKm: 91975, outerKm: 117507, opacity: 0.92, brightness: 0.86 },
  { id: 'Cassini', name: 'Cassini Division', innerKm: 117507, outerKm: 122340, opacity: 0.05, brightness: 0.4 },
  { id: 'A', name: 'A ring', innerKm: 122340, outerKm: 136780, opacity: 0.62, brightness: 0.76 },
  { id: 'F', name: 'F ring', innerKm: 139816, outerKm: 139836, opacity: 0.2, brightness: 0.6 },
];
/** Encke Gap, km (NASA ring table). */
export const ENCKE_GAP_KM = 133410;
/** Half-width of the Encke Gap as drawn, km (artistic; the table gives no width). */
export const ENCKE_HALF_WIDTH_KM = 160;
/** The ring texture spans these radii, in Saturn radii. */
export const RING_TEX_INNER = 1.1;
export const RING_TEX_OUTER = 2.35;
export const RING_TEX_SIZE = 512;

/** Ring opacity and brightness at radius `r` (Saturn radii). Pure; outside the rings: 0. */
export function ringAt(r: number): { opacity: number; brightness: number } {
  const km = r * SATURN_RADIUS_KM;
  if (Math.abs(km - ENCKE_GAP_KM) < ENCKE_HALF_WIDTH_KM) return { opacity: 0, brightness: 0.3 };
  for (const ring of SATURN_RINGS) {
    if (km >= ring.innerKm && km < ring.outerKm) return { opacity: ring.opacity, brightness: ring.brightness };
  }
  return { opacity: 0, brightness: 0.3 };
}

/**
 * The ring lookup texture, 512 columns from 1.10 to 2.35 Saturn radii: R opacity, G brightness, A 1.
 * Deterministic: the fine grain comes from a seeded generator.
 */
export function ringTexture(seed = 9): Float32Array {
  const out = new Float32Array(RING_TEX_SIZE * 4);
  const r = rng(seed);
  for (let i = 0; i < RING_TEX_SIZE; i++) {
    const rr = RING_TEX_INNER + (i / (RING_TEX_SIZE - 1)) * (RING_TEX_OUTER - RING_TEX_INNER);
    const base = ringAt(rr);
    let br = base.brightness;
    // The B ring has fine radial structure (artistic grain).
    if (rr >= 1.526 && rr < 1.95) br = 0.86 + 0.14 * Math.sin(rr * 90) * Math.sin(rr * 37);
    const fine = 0.86 + 0.28 * r();
    out[i * 4] = clamp(base.opacity * fine, 0, 1);
    out[i * 4 + 1] = clamp(br * (0.9 + 0.2 * r()), 0, 1);
    out[i * 4 + 3] = 1;
  }
  return out;
}

// ---- the planet model --------------------------------------------------------------------------

export interface GasInput {
  /** Reference object with observed bands, or null (bands then come from the Rhines count). */
  reference: ReferenceGasId | null;
  /** Equatorial radius in Jupiter radii. */
  radiusRj: number;
  /** Mass in Earth masses. */
  massEarth: number;
  /** Rotation period, hours. */
  rotPeriodH: number;
  /** Equilibrium temperature, K. */
  teqK: number;
  /** Internal heat temperature, K, or null when unknown (then the surface temperature is Teq). */
  tintK: number | null;
  /** Mean molecular weight, g/mol. */
  mu: number;
  /** Seed for storm placement and births. */
  seed: number;
  /**
   * Tidally locked: the spin equals the orbit (`rotPeriodH` is then the orbital period), one hot
   * day side faces the star, and the flow is one superrotating equatorial jet (prototype).
   * ASSUMPTION: set by the caller from a short orbit (see `gasWorldInput`), not measured.
   */
  locked?: boolean;
}

export interface GasModel {
  /** Spin rate, rad/s. */
  omega: number;
  /** Gravity at the cloud tops, m/s^2. */
  gravity: number;
  /** Cloud-top temperature, K. */
  tCloud: number;
  /** Scale height, m. */
  scaleHeightM: number;
  /** Typical jet speed, m/s (thermal-wind scaling). */
  windMs: number;
  /** Jets pole to pole, from the Rhines count, at least 2. */
  jets: number;
  /** Deformation radius, m, and the storm angular radius as a fraction of the planet radius. */
  deformationM: number;
  stormSize: number;
  /** Flattening from the spin, `0.7 q`. */
  flattening: number;
  /** Radius in metres. */
  radiusM: number;
  /** Rossby number U / (f L) at 30 degrees with the Rhines width. */
  rossby: number;
  /** Rhines width at 30 degrees, m. */
  rhinesM: number;
  /** Colour regime by Teq (Sudarsky-style, display only). */
  regime: GasRegime;
  /** Tidally locked flow (one superrotating jet, day-night contrast). */
  locked: boolean;
  /** How much of the day-night contrast survives the winds, 0.02..1 (1 = none carried away). */
  eps: number;
  /** Hottest (day side) and coldest (night side) temperature for a locked giant, K; the Teq otherwise. */
  tDayK: number;
  tNightK: number;
}

/**
 * Night-side glow: a hot giant glows by its own heat only above this temperature. The prototype's
 * shader threshold (850 K); `[verify]` it is a display threshold, not a measured value.
 */
export const GLOW_ABOVE_K = 850;
/** Day-side and night-side factors of a locked giant's temperature at full contrast (prototype 1.3 and 0.55). */
const LOCKED_DAY_FACTOR = 1.3;
const LOCKED_NIGHT_FACTOR = 0.55;

export type GasRegime =
  | 'Methane-rich air, blue'
  | 'Ammonia clouds'
  | 'Water clouds'
  | 'Cloudless, deep blue'
  | 'Silicate haze, dark blue'
  | 'Silicate clouds, glowing';

/** Colour regime by equilibrium temperature. Thresholds from the prototype; display only (`artistic`). */
export function gasRegime(teqK: number): GasRegime {
  if (teqK < 150) return 'Ammonia clouds';
  if (teqK < 350) return 'Water clouds';
  if (teqK < IR_GLOW_K) return 'Cloudless, deep blue';
  if (teqK < 1400) return 'Silicate haze, dark blue';
  return 'Silicate clouds, glowing';
}

/** Rhines width `L = pi sqrt(U / beta)`, beta = 2 Omega cos(lat) / R, metres. Null when it is undefined. */
export function rhinesWidthM(omega: number, radiusM: number, windMs: number, latRad: number): number | null {
  const beta = (2 * omega * Math.cos(latRad)) / radiusM;
  if (!(beta > 0) || !(windMs > 0)) return null;
  return Math.PI * Math.sqrt(windMs / beta);
}

/** Scale height `H = R T / (mu g)` (R the molar gas constant), metres. */
export function scaleHeightM(tK: number, muGramsPerMol: number, gravity: number): number {
  return (R_GAS * tK) / (muGramsPerMol * gravity);
}

/**
 * The gas giant model: gravity, scale height, jet speed and count, deformation radius, storm size,
 * flattening. Returns null when a required input is missing or not positive (refuse, never invent).
 */
export function gasModel(input: GasInput): GasModel | null {
  const { radiusRj, massEarth, rotPeriodH, teqK, mu } = input;
  for (const v of [radiusRj, massEarth, rotPeriodH, teqK, mu]) if (!(v > 0) || !Number.isFinite(v)) return null;
  const radiusM = radiusRj * R_JUP_M;
  const mass = massEarth * 5.972168e24; // IAU 2015 nominal GM_E / G, kg (rounded)
  const gravity = (G * mass) / (radiusM * radiusM);
  const omega = TAU / (rotPeriodH * 3600);
  // Cloud-top temperature: sunlight plus the planet's own heat (prototype: 1.3 (Teq^4 + Tint^4)^(1/4)).
  const tCloud =
    input.tintK !== null && input.tintK > 0
      ? 1.3 * Math.pow(Math.pow(teqK, 4) + Math.pow(input.tintK, 4), 0.25)
      : teqK;
  const rSpecific = R_GAS / mu;
  const cp = rSpecific * CP_OVER_R;
  const H = (rSpecific * tCloud) / gravity;
  // Wind speed: iterate eps (how much the day-night contrast survives) and U (thermal wind).
  const tRad = (cp * RADIATIVE_REF_PA) / (gravity * 4 * SIGMA_SB * Math.pow(tCloud, 3));
  const locked = input.locked === true;
  let U = 100;
  let eps = 1;
  for (let i = 0; i < 6; i++) {
    // A locked giant has no spin to turn the flow: only advection across the planet moves heat.
    const tAdv = Math.min(radiusM / U, locked ? 1e13 : 1 / omega);
    eps = clamp(tAdv / (tAdv + tRad), 0.02, 1);
    const dT = locked ? eps * 0.6 * tCloud : Math.max(10, eps * 0.6 * tCloud);
    U = Math.max(1, WIND_COEFFICIENT * Math.sqrt(rSpecific * dT));
  }
  const n = Math.sqrt((2 * omega * radiusM) / U);
  const jets = Math.max(2, Math.round(clamp(n, 1, 22)));
  const LD = (DEFORMATION_FACTOR * Math.sqrt(gravity * H)) / omega;
  const stormSize = clamp((3 * LD) / radiusM, 0.03, 0.2);
  const flattening = clamp(
    (FLATTENING_COEFFICIENT * omega * omega * radiusM ** 3) / (G * mass),
    0,
    0.14,
  );
  const rhines = rhinesWidthM(omega, radiusM, U, (30 * Math.PI) / 180) ?? 0;
  const f30 = 2 * omega * Math.sin((30 * Math.PI) / 180);
  const rossby = rhines > 0 ? U / (f30 * rhines) : 0;
  return {
    omega,
    gravity,
    tCloud,
    scaleHeightM: H,
    windMs: U,
    jets,
    deformationM: LD,
    stormSize,
    flattening,
    radiusM,
    rossby,
    rhinesM: rhines,
    regime: gasRegime(teqK),
    locked,
    eps,
    tDayK: locked ? teqK * (1 + (LOCKED_DAY_FACTOR - 1) * eps) : teqK,
    tNightK: locked ? teqK * (1 - (1 - LOCKED_NIGHT_FACTOR) * eps) : teqK,
  };
}

// ---- band profile, storm table -----------------------------------------------------------------

export type StormType = 1 | 2 | 3;
export interface SmallStorm {
  lat: number;
  lon: number;
  r: number;
  ar: number;
  /** 1 anticyclone (white oval), 2 cyclone or hot spot (dark), 3 Oval BA (reddish). */
  type: StormType;
}
export interface BigStorm {
  lat: number;
  lon: number;
  r: number;
  ar: number;
  str: number;
  /** 1: red (Great Red Spot style). */
  red: 0 | 1;
}

/** Storm table of a reference body (observed names), see `docs/rendering` R7.7. */
export interface GasProfile {
  /** Zonal wind by latitude, normalised so the strongest jet is 1. */
  u(lat: number): number;
  /** 512 rows (south to north) of [brightness, chromophore, turbulence, polar]. */
  tex: Float32Array;
  big: BigStorm[];
  small: SmallStorm[];
}

/**
 * The wind profile and storms.
 *   - Jupiter and Saturn: the jet profile is integrated from the observed belt and zone brightness by
 *     thermal-wind balance, so each jet sits between a belt and a zone (Moon's notes: jets are
 *     maintained by eddies; zones are rising, belts sinking). Storms from the observed table.
 *   - Others: cos(jets * lat) jets (Rhines count) and storms placed in the zones between them.
 */
export function gasProfile(model: GasModel, input: GasInput): GasProfile {
  const N = 1024;
  const dp = Math.PI / N;
  const u = new Float64Array(N);
  const bri = new Float64Array(N);
  const bro = new Float64Array(N);
  const tu = new Float64Array(N);
  const cs = new Float64Array(N);
  const la = new Float64Array(N);
  const nodes = input.reference ? GAS_NODES[input.reference] : undefined;
  for (let i = 0; i < N; i++) {
    la[i] = -Math.PI / 2 + (i + 0.5) * dp;
    cs[i] = Math.max(Math.cos(la[i]!), 0.02);
  }
  if (nodes) {
    let k = 0;
    let mean = 0;
    let tot = 0;
    const z = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const deg = (la[i]! * 180) / Math.PI;
      while (k < nodes.length - 2 && deg > nodes[k + 1]![0]) k++;
      const a = nodes[k]!;
      const b = nodes[k + 1]!;
      const t = sstep(a[0], b[0], deg);
      bri[i] = lerp(a[1], b[1], t);
      bro[i] = lerp(a[2], b[2], t);
      tu[i] = lerp(a[3], b[3], t);
      mean += bri[i]! * cs[i]!;
      tot += cs[i]!;
    }
    mean /= tot;
    let zm = 0;
    for (let i = 0; i < N; i++) {
      z[i] = -Math.tanh(la[i]! / 0.12) * (bri[i]! - mean);
      zm += z[i]! * cs[i]!;
    }
    zm /= tot;
    let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += -(z[i]! - zm) * cs[i]! * dp;
      u[i] = acc / cs[i]!;
    }
    // Equatorial superrotation (Jupiter ~100 m/s; Saturn far stronger) and Jupiter's 24 N jet,
    // the strongest (150-170 m/s). The relative sizes are display scalings. [verify]
    const sat = input.reference === 'sat';
    const eq = sat ? 1.5 : 0.2;
    const width = sat ? 0.18 : 0.02;
    let mx0 = 0;
    for (let i = 0; i < N; i++) mx0 = Math.max(mx0, Math.abs(u[i]!));
    for (let i = 0; i < N; i++) {
      let v = (u[i]! / mx0) * sstep(1.5, 1.15, Math.abs(la[i]!)) + eq * Math.exp((-la[i]! * la[i]!) / width);
      if (input.reference === 'jup') {
        const d24 = (la[i]! - 0.419) / 0.07;
        v += 0.8 * Math.exp(-d24 * d24);
      }
      u[i] = v;
    }
  } else {
    const js = model.jets;
    const zv = new Float64Array(N);
    let zmx = 0;
    for (let i = 0; i < N; i++) {
      const e0 = sstep(1.5, 1.15, Math.abs(la[i]!));
      // Locked: one broad eastward equatorial jet over weak mid-latitude jets (prototype).
      u[i] = e0 * (model.locked ? 0.2 * Math.cos(js * la[i]!) + 1.2 * Math.exp((-la[i]! * la[i]!) / 0.16) : Math.cos(js * la[i]!));
    }
    for (let i = 1; i < N - 1; i++) {
      zv[i] = -(cs[i + 1]! * u[i + 1]! - cs[i - 1]! * u[i - 1]!) / (2 * dp * cs[i]!);
      zmx = Math.max(zmx, Math.abs(zv[i]!));
    }
    for (let i = 0; i < N; i++) {
      const an = clamp((-Math.tanh(la[i]! / 0.12) * zv[i]! / (zmx || 1)) * 1.4, -1, 1);
      bri[i] = 0.66 + 0.22 * an;
      bro[i] = 0.42 - 0.34 * an;
      tu[i] = 0.3 + 0.35 * clamp(-an, 0, 1);
    }
  }
  let mx = 0;
  for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(u[i]!));
  for (let i = 0; i < N; i++) u[i] = u[i]! / (mx || 1);

  const tex = new Float32Array(512 * 4);
  for (let i = 0; i < 512; i++) {
    const s = Math.min(N - 1, i * 2);
    tex[i * 4] = bri[s]!;
    tex[i * 4 + 1] = bro[s]!;
    tex[i * 4 + 2] = tu[s]!;
    tex[i * 4 + 3] = sstep(0.95, 1.28, Math.abs(la[s]!));
  }

  // Zones: local brightness maxima away from the equator.
  const r = rng(input.seed * 23 + 1);
  let zones: number[] = [];
  for (let i = 4; i < N - 4; i++) {
    if (
      bri[i]! >= bri[i - 3]! &&
      bri[i]! > bri[i + 3]! &&
      Math.abs(la[i]!) < 1.1 &&
      Math.abs(la[i]!) > 0.16
    ) {
      if (!zones.length || la[i]! - zones[zones.length - 1]! > 0.08) zones.push(la[i]!);
    }
  }
  if (!zones.length) zones = [-0.5, 0.5];

  const big: BigStorm[] = [];
  const small: SmallStorm[] = [];
  const D = Math.PI / 180;
  const ovals = (n: number, lat: number, r0: number, type: StormType) => {
    for (let q = 0; q < n; q++)
      small.push({
        lat: lat + (r() - 0.5) * 0.02,
        lon: r() * TAU - Math.PI,
        r: r0 * (0.8 + 0.4 * r()),
        ar: 1.2,
        type,
      });
  };
  if (input.reference === 'jup') {
    // Great Red Spot, ~22 S, between a westward jet (north) and an eastward jet (south); now about
    // 14,000-16,000 km across (Moon's notes). Size is a fraction of the planet radius: 0.105 * 71,492
    // km = 7,500 km radius. [verify] against a current GRS measurement.
    big.push({ lat: -22 * D, lon: 0.75, r: 0.105, ar: 1.38, str: 2.6, red: 1 });
    for (let i = 0; i < 8; i++)
      small.push({ lat: -41 * D, lon: -2.2 + i * 0.42 + (r() - 0.5) * 0.08, r: 0.021, ar: 1.2, type: 1 }); // string of pearls
    small.push({ lat: -33 * D, lon: 2.4, r: 0.04, ar: 1.25, type: 3 }); // Oval BA, reddish since 2005-06
    ovals(3, 14 * D, 0.024, 2);
    ovals(5, -14 * D, 0.013, 1);
    ovals(3, 20 * D, 0.015, 1);
    ovals(4, 41 * D, 0.016, 1);
    ovals(9, 7.5 * D, 0.013, 2); // 5-micron hot spots: dry, cloud-free gaps at the NEB edge
    for (let i = 0; i < 8; i++) small.push({ lat: 83 * D, lon: i * 0.785, r: 0.032, ar: 1, type: 2 }); // north polar cluster: 8 around 1
    small.push({ lat: 89 * D, lon: 0, r: 0.032, ar: 1, type: 2 });
    for (let i = 0; i < 5; i++) small.push({ lat: -83 * D, lon: i * 1.257, r: 0.036, ar: 1, type: 2 }); // south polar cluster: 5 around 1
    small.push({ lat: -89 * D, lon: 0, r: 0.036, ar: 1, type: 2 });
  } else if (input.reference === 'sat') {
    ovals(2, 40 * D, 0.018, 1);
    ovals(2, -42 * D, 0.014, 1);
  } else {
    const nb = clamp(Math.round(1 + model.jets * 0.12), 1, 3);
    for (let i = 0; i < nb; i++)
      big.push({
        lat: zones[Math.floor(r() * zones.length)]!,
        lon: r() * TAU - Math.PI,
        r: 0.08 + 0.05 * r(),
        ar: 1.3,
        str: 2.3,
        red: model.regime === 'Ammonia clouds' ? 1 : 0,
      });
    const ns = clamp(Math.round(4 + model.jets * 0.5), 4, 12);
    for (let i = 0; i < ns; i++) ovals(1, zones[Math.floor(r() * zones.length)]!, 0.02 + 0.016 * r(), 1);
  }
  return {
    u: (lat: number) => {
      const x = clamp((lat + Math.PI / 2) / dp - 0.5, 0, N - 2);
      const a0 = Math.floor(x);
      return lerp(u[a0]!, u[a0 + 1]!, x - a0);
    },
    tex,
    big,
    small,
  };
}

// ---- the solver --------------------------------------------------------------------------------

export const GAS_NX = 256;
export const GAS_NY = 128;
/** Time step in solver units (the prototype's value, stable with the dissipation below). */
export const GAS_DT = 0.0032;
/** Steps the planet is settled for before it is shown (the prototype's spin-up). */
export const GAS_SETTLE_STEPS = 420;

/** A storm at its position now (the deep jet at its latitude carries it east or west). */
export interface PlacedStorm {
  lat: number;
  lon: number;
  /** Radius in radians. */
  r: number;
  /** 1 white oval, 2 cyclone or hot spot, 3 Oval BA, 4 Great-Red-Spot style. */
  kind: 1 | 2 | 3 | 4;
}

export interface GasSim {
  step(): void;
  /** Where every listed storm is now; the picture and the haptics read the same list (D-34). */
  placedStorms(): PlacedStorm[];
  /** Velocity field for the tracer pass: RGBA floats, GAS_NX x GAS_NY, row 0 at the south pole. */
  exportField(redInit?: boolean): Float32Array;
  readonly steps: number;
  readonly dt: number;
  readonly zmax: number;
  /** Mean zonal flow by latitude row (diagnostic: the jets must not drift). */
  zonalMeanFlow(): Float64Array;
  /** Largest |q| (diagnostic: stays finite). */
  maxAbsVorticity(): number;
}

export function createGasSim(model: GasModel, seed: number, prof: GasProfile): GasSim {
  const NX = GAS_NX;
  const NY = GAS_NY;
  const N = NX * NY;
  const dp = Math.PI / NY;
  const dl = TAU / NX;
  const M = NX / 2 + 1;
  const dt = GAS_DT;
  const q = new Float64Array(N);
  const psi = new Float64Array(N);
  const tn = new Float64Array(N);
  const to = new Float64Array(N);
  const lap = new Float64Array(N);
  const plume = new Float32Array(N);
  const out = new Float32Array(N * 4);
  const A = new Float64Array(N);
  const lat = new Float64Array(NY);
  const cs = new Float64Array(NY);
  const csF = new Float64Array(NY + 1);
  const f = new Float64Array(NY);
  const jets = model.jets;
  // Non-dimensional spin of the solver (prototype): grows with the jet count so beta keeps the bands apart.
  const Om = Math.max((jets * jets) / 2, 6);
  const ld = clamp(model.deformationM / model.radiusM, 0.06, 0.22);
  const r = rng(seed * 11 + 5);
  let steps = 0;
  for (let j = 0; j < NY; j++) {
    lat[j] = -Math.PI / 2 + (j + 0.5) * dp;
    cs[j] = Math.cos(lat[j]!);
    f[j] = 2 * Om * Math.sin(lat[j]!);
  }
  for (let j = 0; j <= NY; j++) csF[j] = Math.max(Math.cos(-Math.PI / 2 + j * dp), 0);

  // FFT of length NX (radix 2).
  const re = new Float64Array(NX);
  const im = new Float64Array(NX);
  const rev = new Int32Array(NX);
  const twr = new Float64Array(NX / 2);
  const twi = new Float64Array(NX / 2);
  for (let i = 0; i < NX; i++) {
    let x = i;
    let y = 0;
    for (let k = 0; k < 8; k++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }
  for (let i = 0; i < NX / 2; i++) {
    twr[i] = Math.cos((-TAU * i) / NX);
    twi[i] = Math.sin((-TAU * i) / NX);
  }
  const fft = () => {
    for (let i = 0; i < NX; i++) {
      const j2 = rev[i]!;
      if (j2 > i) {
        let t = re[i]!;
        re[i] = re[j2]!;
        re[j2] = t;
        t = im[i]!;
        im[i] = im[j2]!;
        im[j2] = t;
      }
    }
    for (let sz = 2; sz <= NX; sz <<= 1) {
      const hs = sz >> 1;
      const st = NX / sz;
      for (let a = 0; a < NX; a += sz) {
        for (let b = 0, c = 0; b < hs; b++, c += st) {
          const p = a + b;
          const o = p + hs;
          const wr = twr[c]!;
          const wi = twi[c]!;
          const xr = re[o]! * wr - im[o]! * wi;
          const xi = re[o]! * wi + im[o]! * wr;
          re[o] = re[p]! - xr;
          im[o] = im[p]! - xi;
          re[p] = re[p]! + xr;
          im[p] = im[p]! + xi;
        }
      }
    }
  };

  // Tridiagonal solve per zonal wavenumber for psi from q.
  const a0 = new Float64Array(NY);
  const c0 = new Float64Array(NY);
  const CP = new Float64Array(M * NY);
  const DN = new Float64Array(M * NY);
  const Qr = new Float64Array(M * NY);
  const Qi = new Float64Array(M * NY);
  const Pr = new Float64Array(M * NY);
  const Pi = new Float64Array(M * NY);
  const mcut = new Int32Array(NY);
  const ldi = 1 / (ld * ld);
  for (let j = 0; j < NY; j++) {
    a0[j] = csF[j]! / (cs[j]! * dp * dp);
    c0[j] = csF[j + 1]! / (cs[j]! * dp * dp);
    mcut[j] = Math.max(2, Math.floor((NX / 2) * Math.min(1, cs[j]! * 1.25)));
  }
  for (let mm = 0; mm < M; mm++) {
    let prevC = 0;
    for (let j = 0; j < NY; j++) {
      const b0 = -(a0[j]! + c0[j]!) - (mm * mm) / (cs[j]! * cs[j]!) - ldi;
      const den = b0 - a0[j]! * prevC;
      DN[mm * NY + j] = den;
      prevC = c0[j]! / den;
      CP[mm * NY + j] = prevC;
    }
  }
  const solve = () => {
    for (let j = 0; j < NY; j++) {
      const row = j * NX;
      for (let i = 0; i < NX; i++) {
        re[i] = q[row + i]!;
        im[i] = 0;
      }
      fft();
      for (let mm = 0; mm < M; mm++) {
        const ok = mm <= mcut[j]!;
        Qr[mm * NY + j] = ok ? re[mm]! / NX : 0;
        Qi[mm * NY + j] = ok ? im[mm]! / NX : 0;
      }
    }
    for (let mm = 0; mm < M; mm++) {
      const o = mm * NY;
      for (let j = 0; j < NY; j++) {
        const ar = a0[j]!;
        const d = DN[o + j]!;
        Pr[o + j] = (Qr[o + j]! - ar * (j ? Pr[o + j - 1]! : 0)) / d;
        Pi[o + j] = (Qi[o + j]! - ar * (j ? Pi[o + j - 1]! : 0)) / d;
      }
      for (let j = NY - 2; j >= 0; j--) {
        Pr[o + j] = Pr[o + j]! - CP[o + j]! * Pr[o + j + 1]!;
        Pi[o + j] = Pi[o + j]! - CP[o + j]! * Pi[o + j + 1]!;
      }
    }
    for (let j = 0; j < NY; j++) {
      const row = j * NX;
      re[0] = Pr[j]!;
      im[0] = 0;
      for (let mm = 1; mm < M; mm++) {
        const pr = Pr[mm * NY + j]!;
        const pi = Pi[mm * NY + j]!;
        re[mm] = pr;
        im[mm] = -pi;
        if (mm < NX / 2) {
          re[NX - mm] = pr;
          im[NX - mm] = pi;
        }
      }
      fft();
      for (let i = 0; i < NX; i++) psi[row + i] = re[i]!;
    }
  };

  // Deep jets: fixed, scaled to stay inside the Rayleigh-Kuo stability limit so they cannot break down.
  const ut = new Float64Array(NY);
  const qt = new Float64Array(NY);
  const pt = new Float64Array(NY);
  const zt = new Float64Array(NY);
  const Ua = 0.6; // largest non-dimensional jet speed the solver allows (prototype)
  let maxC = 0;
  for (let j = 0; j < NY; j++) ut[j] = prof.u(lat[j]!);
  for (let j = 2; j < NY - 2; j++) {
    if (Math.abs(lat[j]!) > 1.1) continue;
    maxC = Math.max(maxC, Math.abs((ut[j + 1]! - 2 * ut[j]! + ut[j - 1]!) / (dp * dp)) / (2 * Om * cs[j]!));
  }
  const ks = Math.min(Ua, 0.7 / (maxC || 1)); // Rayleigh-Kuo: beta - U_yy > 0 everywhere (0.7 safety factor)
  for (let j = 0; j < NY; j++) ut[j] = ut[j]! * ks;
  let acc = 0;
  let mean = 0;
  for (let j = 0; j < NY; j++) {
    acc += -ut[j]! * dp;
    pt[j] = acc;
    mean += acc;
  }
  mean /= NY;
  for (let j = 0; j < NY; j++) pt[j] = pt[j]! - mean;
  let zmax = 0.5;
  for (let j = 1; j < NY - 1; j++) {
    zt[j] = -(cs[j + 1]! * ut[j + 1]! - cs[j - 1]! * ut[j - 1]!) / (2 * dp * cs[j]!);
    qt[j] = zt[j]! - pt[j]! * ldi;
    if (Math.abs(lat[j]!) < 1.15) zmax = Math.max(zmax, Math.abs(zt[j]!));
  }
  qt[0] = qt[1]!;
  qt[NY - 1] = qt[NY - 2]!;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) q[j * NX + i] = qt[j]!;

  const vortex = (lt: number, ln: number, rad: number, amp: number, ar: number) => {
    const j0 = Math.max(0, Math.floor((lt - 3 * rad + Math.PI / 2) / dp));
    const j1 = Math.min(NY - 1, Math.ceil((lt + 3 * rad + Math.PI / 2) / dp));
    const cl0 = Math.max(Math.cos(lt), 0.1);
    const ci = Math.round((ln + Math.PI) / dl);
    const wi = Math.ceil((3 * rad * ar) / (cl0 * dl));
    for (let j2 = j0; j2 <= j1; j2++) {
      for (let ii = ci - wi; ii <= ci + wi; ii++) {
        const iw = ((ii % NX) + NX) % NX;
        const dx = ((ii - ci) * dl * cl0) / ar;
        const dy = lat[j2]! - lt;
        q[j2 * NX + iw] = q[j2 * NX + iw]! + amp * Math.exp(-(dx * dx + dy * dy) / (rad * rad));
      }
    }
  };
  // Great-spot style storms start as an anticyclone in the zone (counter to the local planetary vorticity).
  for (const s of prof.big) vortex(s.lat, s.lon, s.r, -Math.sign(s.lat) * s.str * zmax, s.ar);

  const step = () => {
    solve();
    for (let i = 0; i < N; i++) A[i] = q[i]! + f[Math.floor(i / NX)]!;
    const dd = 1 / (12 * dl * dp);
    for (let j = 1; j < NY - 1; j++) {
      const row = j * NX;
      const cc = 1 / cs[j]!;
      for (let i = 0; i < NX; i++) {
        const ie = (i + 1) % NX;
        const iw = (i + NX - 1) % NX;
        const C0 = row + i;
        const E = row + ie;
        const W2 = row + iw;
        const Nn = row + NX + i;
        const S = row - NX + i;
        const NE = row + NX + ie;
        const NW = row + NX + iw;
        const SE = row - NX + ie;
        const SW = row - NX + iw;
        // Arakawa (1966) J1 + J2 + J3 Jacobian: conserves energy and enstrophy.
        tn[C0] =
          -(
            (psi[E]! - psi[W2]!) * (A[Nn]! - A[S]!) -
            (psi[Nn]! - psi[S]!) * (A[E]! - A[W2]!) +
            psi[E]! * (A[NE]! - A[SE]!) -
            psi[W2]! * (A[NW]! - A[SW]!) -
            psi[Nn]! * (A[NE]! - A[NW]!) +
            psi[S]! * (A[SE]! - A[SW]!) +
            A[Nn]! * (psi[NE]! - psi[NW]!) -
            A[S]! * (psi[SE]! - psi[SW]!) -
            A[E]! * (psi[NE]! - psi[SE]!) +
            A[W2]! * (psi[NW]! - psi[SW]!)
          ) *
          dd *
          cc;
      }
    }
    // Adams-Bashforth 2 (Euler on the first step).
    for (let i = 0; i < N; i++) {
      q[i] = q[i]! + dt * (steps ? 1.5 * tn[i]! - 0.5 * to[i]! : tn[i]!);
      to[i] = tn[i]!;
      plume[i] = plume[i]! * 0.97;
    }
    // Scale-selective dissipation (4th-order hyperviscosity), stronger towards the poles.
    for (let j = 2; j < NY - 2; j++) {
      const r2 = j * NX;
      const nuL = Math.min(0.055, 0.02 / Math.max(cs[j]! * cs[j]!, 0.02));
      for (let i = 0; i < NX; i++) {
        const e1 = (i + 1) % NX;
        const e2 = (i + 2) % NX;
        const w1 = (i + NX - 1) % NX;
        const w2 = (i + NX - 2) % NX;
        lap[r2 + i] =
          nuL * (q[r2 + e2]! - 4 * q[r2 + e1]! + 6 * q[r2 + i]! - 4 * q[r2 + w1]! + q[r2 + w2]!) +
          0.02 *
            (q[r2 + 2 * NX + i]! - 4 * q[r2 + NX + i]! + 6 * q[r2 + i]! - 4 * q[r2 - NX + i]! + q[r2 - 2 * NX + i]!);
      }
    }
    for (let j = 2; j < NY - 2; j++) {
      const r3 = j * NX;
      for (let i = 0; i < NX; i++) q[r3 + i] = q[r3 + i]! - lap[r3 + i]!;
    }
    // Forcing: relax the zonal mean to the deep-jet state (eddies feed the jets, which stay fixed),
    // damp eddies near the poles, clamp runaway values. Polar rows are held at the target.
    for (let j = 0; j < NY; j++) {
      const r4 = j * NX;
      let m0 = 0;
      for (let i = 0; i < NX; i++) m0 += q[r4 + i]!;
      m0 /= NX;
      const dz = ((qt[j]! - m0) * dt) / 0.06;
      const sp = Math.abs(lat[j]!) > 1.22 ? 0.05 : 0;
      if (Math.abs(lat[j]!) > 1.34) {
        for (let i = 0; i < NX; i++) q[r4 + i] = qt[j]!;
        continue;
      }
      const lim = (6 * zmax) / Math.min(ld, 0.25);
      for (let i = 0; i < NX; i++)
        q[r4 + i] = clamp(q[r4 + i]! + dz + (m0 - q[r4 + i]!) * (sp + dt * 0.12), m0 - lim, m0 + lim);
    }
    // Random storm births in the shear between jets (anticyclones in zones, from the sign of the
    // background vorticity). The generator is seeded and advanced once per step, so the state is a
    // function of (seed, step count).
    const la0 = (r() - 0.5) * 2.2;
    const ln0 = r() * TAU - Math.PI;
    const jj = clamp(Math.round((la0 + Math.PI / 2) / dp), 2, NY - 3);
    if (zt[jj]! * Math.sign(la0) > 0 && r() < 0.14) {
      const am = (r() < 0.5 ? -1 : 1) * 0.12 * zmax;
      vortex(la0, ln0, ld * 0.6, am, 1);
    }
    steps++;
  };

  const exportField = (redInit = false): Float32Array => {
    const t = steps * dt;
    const Z0 = zmax;
    for (let j = 0; j < NY; j++) {
      const row = j * NX;
      const jn = Math.min(j + 1, NY - 1);
      const js = Math.max(j - 1, 0);
      const sg = Math.sign(lat[j]!) || 1;
      for (let i = 0; i < NX; i++) {
        const ie = (i + 1) % NX;
        const iw = (i + NX - 1) % NX;
        const k0 = (row + i) * 4;
        out[k0] = clamp(-(psi[jn * NX + i]! - psi[js * NX + i]!) / (2 * dp) / Math.max(cs[j]!, 0.1), -6, 6);
        out[k0 + 1] = clamp((psi[row + ie]! - psi[row + iw]!) / (2 * dl * Math.max(cs[j]!, 0.1)), -3, 3);
        out[k0 + 2] = clamp(((q[row + i]! + psi[row + i]! * ldi) * sg) / Z0, -3, 3);
        out[k0 + 3] = 0;
      }
    }
    const stamp = (s: { lat: number; r: number; ar: number }, lon: number, val: number, swirl: boolean) => {
      const j0 = Math.max(0, Math.floor((s.lat - 2.6 * s.r + Math.PI / 2) / dp));
      const j1 = Math.min(NY - 1, Math.ceil((s.lat + 2.6 * s.r + Math.PI / 2) / dp));
      const cl0 = Math.max(Math.cos(s.lat), 0.1);
      const ci = Math.round((lon + Math.PI) / dl);
      const wi = Math.ceil((2.6 * s.r * s.ar) / (cl0 * dl));
      for (let j2 = j0; j2 <= j1; j2++) {
        for (let ii = ci - wi; ii <= ci + wi; ii++) {
          const iw = ((ii % NX) + NX) % NX;
          const k0 = (j2 * NX + iw) * 4;
          const dx = ((ii - ci) * dl * cl0) / s.ar;
          const dy = lat[j2]! - s.lat;
          const g0 = Math.exp(-(dx * dx + dy * dy) / (s.r * s.r));
          out[k0 + 3] = out[k0 + 3]! + val * g0;
          if (swirl) {
            const sv = ((-Math.sign(s.lat) * 0.9 * g0) / s.r) * 0.05;
            out[k0] = out[k0]! + ((-dy * sv) / Math.max(cs[j2]!, 0.1)) * 12;
            out[k0 + 1] = out[k0 + 1]! + dx * sv * 12;
          }
        }
      }
    };
    // The listed storms are carried along at the deep-jet wind of their latitude.
    for (const s of prof.small) {
      const jr = clamp(Math.round((s.lat + Math.PI / 2) / dp - 0.5), 0, NY - 1);
      stamp(s, s.lon + (ut[jr]! / Math.max(cs[jr]!, 0.1)) * t, s.type === 2 ? -1 : 1, true);
    }
    for (const s of prof.big) {
      const jr = clamp(Math.round((s.lat + Math.PI / 2) / dp - 0.5), 0, NY - 1);
      const lon = s.lon + (ut[jr]! / Math.max(cs[jr]!, 0.1)) * t;
      if (!s.red) {
        stamp(s, lon, 1, true);
        continue;
      }
      // Great Red Spot: a solid red body with a rim of lighter swirling cloud.
      const j0 = Math.max(0, Math.floor((s.lat - 2.2 * s.r + Math.PI / 2) / dp));
      const j1 = Math.min(NY - 1, Math.ceil((s.lat + 2.2 * s.r + Math.PI / 2) / dp));
      const cl0 = Math.max(Math.cos(s.lat), 0.1);
      const ci = Math.round((lon + Math.PI) / dl);
      const wi = Math.ceil((2.2 * s.r * s.ar) / (cl0 * dl));
      for (let j2 = j0; j2 <= j1; j2++) {
        for (let ii = ci - wi; ii <= ci + wi; ii++) {
          const iw = ((ii % NX) + NX) % NX;
          const k0 = (j2 * NX + iw) * 4;
          const dx = ((ii - ci) * dl * cl0) / s.ar;
          const dy = lat[j2]! - s.lat;
          const g0 = Math.exp(-(dx * dx + dy * dy) / (s.r * s.r));
          const sv = ((-Math.sign(s.lat) * 0.55 * g0) / s.r);
          out[k0] = out[k0]! + (-dy * sv) / Math.max(cs[j2]!, 0.1);
          out[k0 + 1] = out[k0 + 1]! + dx * sv;
          out[k0 + 3] = g0 > 0.42 ? 2 + clamp((g0 - 0.42) / 0.3, 0, 1) : Math.max(out[k0 + 3]!, (0.75 * g0) / 0.42);
        }
      }
    }
    if (redInit) for (const s of prof.small) if (s.type === 3) stamp(s, s.lon, 3, false);
    return out;
  };

  const placedStorms = (): PlacedStorm[] => {
    const t = steps * dt;
    const at = (s: { lat: number; lon: number }) => {
      const jr = clamp(Math.round((s.lat + Math.PI / 2) / dp - 0.5), 0, NY - 1);
      return s.lon + (ut[jr]! / Math.max(cs[jr]!, 0.1)) * t;
    };
    return [
      ...prof.big.map((s): PlacedStorm => ({ lat: s.lat, lon: at(s), r: s.r, kind: s.red ? 4 : 1 })),
      ...prof.small.map((s): PlacedStorm => ({ lat: s.lat, lon: at(s), r: s.r, kind: s.type })),
    ];
  };

  return {
    step,
    exportField,
    placedStorms,
    get steps() {
      return steps;
    },
    dt,
    zmax,
    zonalMeanFlow: () => {
      // Mean u(lat) = -d psi / d lat, averaged over longitude.
      const res = new Float64Array(NY);
      for (let j = 0; j < NY; j++) {
        const jn = Math.min(j + 1, NY - 1);
        const js = Math.max(j - 1, 0);
        let s = 0;
        for (let i = 0; i < NX; i++) s += -(psi[jn * NX + i]! - psi[js * NX + i]!) / ((jn - js) * dp);
        res[j] = s / NX / Math.max(cs[j]!, 0.1);
      }
      return res;
    },
    maxAbsVorticity: () => {
      let m = 0;
      for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(q[i]!));
      return m;
    },
  };
}

// ---- pacing -------------------------------------------------------------------------------------

/** Default pacing: 5 minutes of planet time per real second (Moon, 10 Nov 2026: slow, like the real planet). */
export const PACE_SLOW_S_PER_S = 300;
/** Optional pacing: one Earth day per real second. */
export const PACE_DAY_S_PER_S = 86400;
/** Below this pacing the planet turns on screen; above it the view co-rotates (storms drift instead). */
export const PACE_SPIN_LIMIT_S_PER_S = 1000;

/** Physical seconds one solver step stands for: the advective time `R / U` times the step. */
export function secondsPerStep(model: GasModel): number {
  return (model.radiusM / Math.max(model.windMs, 1)) * GAS_DT;
}

/** Whole solver steps for `simSeconds` of planet time at the model's step length. A pure function. */
export function stepsFor(model: GasModel, simSeconds: number): number {
  return Math.max(0, Math.floor(simSeconds / secondsPerStep(model)));
}

/** Spin angle (rad) for `simSeconds` of planet time while the view turns with the planet; 0 when it co-rotates. */
export function spinAngle(model: GasModel, simSeconds: number, secondsPerSecond: number): number {
  // A locked giant keeps one face to its star: the view does not turn.
  if (model.locked) return 0;
  return secondsPerSecond < PACE_SPIN_LIMIT_S_PER_S ? simSeconds * model.omega : 0;
}

// ---- tags ---------------------------------------------------------------------------------------

/**
 * One tag per drawn layer of the gas world (D-02). A reference object's observed bands and rings are
 * `measured`; for any other giant the bands come from the Rhines count (`derived`, formula
 * `N = sqrt(2 Omega R / U)` with a modelled wind, so effectively `model_dependent`). Weather
 * (storms, flow) is `model_dependent`; colours are `artistic`.
 */
export interface GasLayerTag {
  id: string;
  tag: Tag;
  formula?: string;
  assumption?: string;
  source: string;
}

export function gasLayerTags(reference: ReferenceGasId | null): GasLayerTag[] {
  const observed = reference !== null;
  const out: GasLayerTag[] = [
    observed
      ? {
          id: 'bands',
          tag: 'measured',
          source: 'Observed belt and zone latitudes of Jupiter or Saturn [verify: edge latitudes not yet cited]',
        }
      : {
          id: 'bands',
          tag: 'model_dependent',
          assumption: 'Jet count from the Rhines scale with a thermal-wind speed U = 0.6 sqrt(R dT) [verify]',
          source: 'A7.2 band count, sqrt(2 Omega R / U)',
        },
    {
      id: 'storms',
      tag: observed ? 'inferred_from_analog' : 'model_dependent',
      ...(observed
        ? { source: 'Named storms of the reference planet placed from observed latitudes; sizes are display values' }
        : {
            assumption: 'Storm size from the deformation radius, sqrt(g H) / Omega; placement in the zones',
            source: 'Deformation radius from gravity and scale height',
          }),
    },
    {
      id: 'flow',
      tag: 'model_dependent',
      assumption: 'Quasi-geostrophic vorticity over fixed deep jets, kept inside the Rayleigh-Kuo limit',
      source: 'Solved on the sphere',
    },
    { id: 'colour', tag: 'artistic', source: 'Chromophore colours are not identified; a display choice' },
  ];
  if (reference === 'sat') {
    out.push({
      id: 'rings',
      tag: 'measured',
      source: 'NASA Planetary Fact Sheet, Saturn rings table (ring edges in km)',
    });
  }
  return out;
}

/** Keep the AU constant in use for callers converting orbits (here only so the import is exercised). */
export const GAS_AU_M = AU_M;
