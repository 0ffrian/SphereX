// Air physics for the flyover soundscape (spec R13 §4): composition class, gamma, sound speed, density, impedance,
// the isothermal pressure profile, the silence ceiling and absorption alpha(f, P, T, class) in Np/m.
// Pure and deterministic. Every constant lives in tuning.ts with its citation.
import type { FluidKey } from '@/engine/worlds/types';
import type { AirAt, AirModel, CompClass } from './types';
import {
  CO2_ABS, CO2_MU_MIN, DB_PER_NP, EARTH_REF, GAMMA, H2_MU_DEFAULT, H2_MU_MAX, H2_TRANSPORT, ISO, ISO_H_MAX,
  LP_F_MAX, LP_F_MIN, LP_LOSS_NP, MU_WET_BELOW, P_FLOOR, RH_ASSUMED, R_GAS, SUTHERLAND, T_FLOOR_FRAC,
} from './tuning';

/** §3.2 composition class: CO2 when the fluid is CO2 or mu >= 40; H2 when mu < 4; otherwise N2 (water-rich included). */
export function classify(mu: number, fluid: FluidKey, _gas: boolean): CompClass {
  void _gas; // gas giants have mu ~2.3, so the mu rule already sends them to H2
  if (fluid === 'co2' || mu >= CO2_MU_MIN) return 'CO2';
  if (mu < H2_MU_MAX) return 'H2';
  return 'N2';
}

/** §4.2 gamma by class. CO2 uses the 1.29 sound-speed value (T kept in the signature for a later relaxation refinement). */
export function gammaFor(cls: CompClass, mu: number, _T: number): number {
  void _T;
  if (cls === 'CO2') return GAMMA.CO2;
  if (cls === 'H2') return GAMMA.H2;
  return mu < MU_WET_BELOW ? GAMMA.N2_WET : GAMMA.N2;
}

/** Ideal-gas sound speed, m/s (derived: c = sqrt(gamma R T / M), M = mu/1000). */
export function soundSpeed(gamma: number, T: number, mu: number): number {
  return Math.sqrt((gamma * R_GAS * T) / (mu / 1000));
}

/** Ideal-gas density, kg/m^3 (derived: rho = P M / (R T)). */
export function density(P: number, T: number, mu: number): number {
  return (P * (mu / 1000)) / (R_GAS * T);
}

/** The Earth reference air (§1): rho, c, Z. */
export function earthRef(): { rho: number; c: number; Z: number } {
  const rho = density(EARTH_REF.P, EARTH_REF.T, EARTH_REF.mu);
  const c = soundSpeed(EARTH_REF.gamma, EARTH_REF.T, EARTH_REF.mu);
  return { rho, c, Z: rho * c };
}

/** §4.1 air at height z km above the reference level. */
export function airAt(air: AirModel, z_km: number): AirAt {
  const z = Math.max(0, z_km);
  const P = air.P0 * Math.exp(-z / air.H_km);
  const T = Math.max(air.T0 - air.gamK * z, T_FLOOR_FRAC * air.T0);
  const rho = density(P, T, air.mu);
  const c = soundSpeed(air.gamma, T, air.mu);
  const silent = !air.airOK || !(P >= P_FLOOR);
  return { P, T, rho, c, Z: rho * c, silent };
}

/**
 * §11.2 path-mean pressure for a vertical path of height z: P0 H/z (1 - e^{-z/H}), P0 as z -> 0. The mean temperature
 * is the average of the two ends (ASSUMPTION: the spec says "mean T" without a rule).
 */
export function meanPathAir(air: AirModel, z_km: number): { P: number; T: number } {
  const z = Math.max(0, z_km);
  const x = z / air.H_km;
  const P = x < 1e-6 ? air.P0 * (1 - x / 2) : (air.P0 * (1 - Math.exp(-x))) / x;
  const Tz = Math.max(air.T0 - air.gamK * z, T_FLOOR_FRAC * air.T0);
  return { P, T: (air.T0 + Tz) / 2 };
}

/** §4.1 height (km) where P falls to P_FLOOR: H ln(P0/P_FLOOR); 0 when the surface is already below it. */
export function ceilingKm(air: AirModel): number {
  return air.P0 > P_FLOOR ? air.H_km * Math.log(air.P0 / P_FLOOR) : 0;
}

/** ISO 9613-1:1993 atmospheric absorption, dB/m, at relative humidity RH_ASSUMED (pa in Pa, T in K). */
export function isoDbPerM(f: number, pa: number, T: number): number {
  const prel = pa / ISO.pr;
  const tr = T / ISO.T0;
  const psatRel = Math.pow(10, ISO.psA * Math.pow(ISO.T01 / T, ISO.psB) + ISO.psC);
  // Molar concentration of water vapour in percent; capped (ASSUMPTION) where ISO's validity ends (steam worlds).
  const h = Math.min((RH_ASSUMED * 100 * psatRel) / prel, ISO_H_MAX * 100);
  const frO = prel * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN = prel * Math.pow(tr, -0.5) * (9 + 280 * h * Math.exp(-4.17 * (Math.pow(tr, -1 / 3) - 1)));
  const f2 = f * f;
  const relax =
    Math.pow(tr, -2.5) *
    ((ISO.aO * Math.exp(-ISO.bO / T)) / (frO + f2 / frO) + (ISO.aN * Math.exp(-ISO.bN / T)) / (frN + f2 / frN));
  return 8.686 * f2 * (ISO.cl * (1 / prel) * Math.sqrt(tr) + relax);
}

function co2Thin(f: number, P: number, T: number): number {
  const fr = CO2_ABS.fr * (P / CO2_ABS.pRef);
  const aInf = CO2_ABS.alphaInf * (P / CO2_ABS.pRef);
  const x = f / fr;
  return CO2_ABS.aCl * f * f * (CO2_ABS.pRef / P) * Math.sqrt(T / CO2_ABS.tRef) + (aInf * x * x) / (1 + x * x);
}

function co2Thick(f: number): number {
  return CO2_ABS.venusA100 * Math.pow(f / 100, CO2_ABS.venusExp);
}

function h2Classical(f: number, P: number, T: number): number {
  const mu = H2_MU_DEFAULT;
  const g = GAMMA.H2;
  const rho = density(P, T, mu);
  const c = soundSpeed(g, T, mu);
  const t = T / H2_TRANSPORT.tRef;
  const muV = H2_TRANSPORT.mu0 * Math.pow(t, H2_TRANSPORT.muExp);
  const k = H2_TRANSPORT.k0 * Math.pow(t, H2_TRANSPORT.kExp);
  return ((2 * Math.PI * Math.PI * f * f) / (rho * c * c * c)) * ((4 / 3) * muV + ((g - 1) * k) / H2_TRANSPORT.cp);
}

/**
 * §4.3 absorption in Np/m at frequency f (Hz), pressure P (Pa) and temperature T (K) for a composition class.
 * Returns Infinity (silence) for non-physical inputs, never NaN.
 */
export function absorption(fHz: number, P: number, T: number, cls: CompClass): number {
  if (!(P > 0) || !(T > 0) || !(fHz > 0) || !Number.isFinite(P) || !Number.isFinite(T)) return Infinity;
  let a: number;
  if (cls === 'N2') a = isoDbPerM(fHz, P, T) / DB_PER_NP;
  else if (cls === 'H2') a = h2Classical(fHz, P, T);
  else if (P <= CO2_ABS.pRef) a = co2Thin(fHz, P, T);
  else if (P >= CO2_ABS.venusP) a = co2Thick(fHz);
  else {
    const t = (Math.log(P) - Math.log(CO2_ABS.pRef)) / (Math.log(CO2_ABS.venusP) - Math.log(CO2_ABS.pRef));
    const lt = Math.log(co2Thin(fHz, CO2_ABS.pRef, T));
    const lk = Math.log(co2Thick(fHz));
    a = Math.exp(lt + (lk - lt) * t);
  }
  return Number.isFinite(a) && a >= 0 ? a : Infinity;
}

/** Kinematic viscosity nu = mu_v / rho (m^2/s) for the S2/S3 Reynolds gate. */
export function kinematicViscosity(cls: CompClass, T: number, rho: number): number {
  let muV: number;
  if (cls === 'H2') muV = H2_TRANSPORT.mu0 * Math.pow(T / H2_TRANSPORT.tRef, H2_TRANSPORT.muExp);
  else {
    const s = cls === 'CO2' ? SUTHERLAND.CO2 : SUTHERLAND.N2;
    muV = s.mu0 * Math.pow(T / SUTHERLAND.T0, 1.5) * ((SUTHERLAND.T0 + s.S) / (T + s.S));
  }
  return muV / rho;
}

/**
 * §11.2 low-pass cutoff: the frequency where alpha(f) d = 0.3466 Np (-3 dB), by bisection on a log scale over
 * 20 Hz..16 kHz, clamped. alphaOf must increase with f.
 */
export function lowpassHz(alphaOf: (f: number) => number, d_m: number): number {
  const loss = (f: number) => alphaOf(f) * Math.max(d_m, 0);
  if (!(loss(LP_F_MAX) > LP_LOSS_NP)) return LP_F_MAX;
  if (loss(LP_F_MIN) >= LP_LOSS_NP) return LP_F_MIN;
  let lo = Math.log(LP_F_MIN);
  let hi = Math.log(LP_F_MAX);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (loss(Math.exp(mid)) > LP_LOSS_NP) hi = mid;
    else lo = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * The world term of a bed's true level against the same source on Earth's surface (§11.3), in dB, by the rule playback
 * uses (R10). Ground sources (S4-S8, S10): 10 log10(Z(z)/Z_E). Flow rumble (S1, S9, S12): 20 log10(rho(z)/rho_E), as
 * p ∝ rho I_u U². Flow hiss (S2, S3): 20 log10((rho/c)/(rho_E/c_E)), as p ∝ rho U³/c. Thunder is a ground source.
 */
export function bedWorldDb(air: AirModel, z_km: number, id: string): number {
  const a = airAt(air, z_km);
  const e = earthRef();
  if (id === 'S2' || id === 'S3') return 20 * Math.log10(a.rho / a.c / (e.rho / e.c));
  if (id === 'S1_land' || id === 'S1_sea' || id === 'S9' || id === 'S12') return 20 * Math.log10(a.rho / e.rho);
  return 10 * Math.log10(a.Z / e.Z);
}
