// Issue #71 stream D (D-36, Q-240): the surface fluids of a rocky or water world and what each one
// does with temperature and pressure. Pure functions, no `Math.random`, no `Date`.
//
// Phase per fluid follows Clausius-Clapeyron: ln(P_sat / P_t) = (L / R) (1 / T_t - 1 / T). The
// boiling point at another pressure comes from the same relation, anchored at the one-atmosphere
// boiling point. The numbers below are handbook values for the pure fluid; none of them is a
// measurement of any exoplanet.
//
// [verify] Every Tt, Pt, Tb and L in `FLUIDS` was entered from the NIST Chemistry WebBook
// (webbook.nist.gov, phase-change and triple-point data) and from the Wagner and Pruss (2002)
// water formulation without opening the pages in this session. They are standard values and the
// fit is only used to the tolerance the tests state, but they are not yet checked against the
// cited page (Q-241). Nothing else in this file is a physical constant of an object.

/** Universal gas constant, J/(mol K) (CODATA 2018: 8.314462618). The prototype used 8.314. */
export const R_GAS = 8.314462618;
/** Stefan-Boltzmann constant, W/(m^2 K^4) (CODATA 2018). */
export const SIGMA_SB = 5.670374419e-8;
/** One standard atmosphere, Pa (exact, by definition). */
export const ATM_PA = 101325;

export type FluidId = 'water' | 'methane' | 'ammonia' | 'nitrogen' | 'co2';

export interface Fluid {
  id: FluidId;
  label: string;
  /** Triple-point temperature, K [verify]. */
  Tt: number;
  /** Triple-point pressure, Pa [verify]. */
  Pt: number;
  /** Boiling (or, for CO2, sublimation) point at one atmosphere, K [verify]. */
  Tb: number;
  /** Molar enthalpy of vaporisation (sublimation for CO2), J/mol [verify]. */
  L: number;
  /**
   * Only for a fluid whose one-atmosphere point is a sublimation point (Tb < Tt, CO2): the enthalpy of
   * vaporisation near the triple point, J/mol.
   */
  Lv?: number;
  /**
   * Critical point (K, Pa), where the liquid-vapour line ends (#93 3.1). At or above Pc there is no boiling; above
   * both Tc and Pc the fluid is supercritical and no sea can stand on the surface. Handbook constants of the pure
   * fluid from the NIST Chemistry WebBook fluid data (reference equations of state cited per fluid).
   */
  Tc: number;
  Pc: number;
  /** Mixing ratio of the fluid's vapour at the cloud base, mass fraction (artistic; water 0.01 puts Earth's cloud base near 1 km, the prototype's 0.02 put it at the ground, Q-241). */
  q: number;
  /** Colours of the liquid, ice, cloud and bare land under this fluid, linear (artistic). */
  liq: readonly [number, number, number];
  ice: readonly [number, number, number];
  cld: readonly [number, number, number];
  land: readonly [number, number, number];
}

/** The five fluids of the prototype, in the order the `surface_fluid` slider indexes them. */
export const FLUIDS: Readonly<Record<FluidId, Fluid>> = {
  water: {
    id: 'water',
    label: 'Water',
    Tt: 273.16,
    Pt: 611.7,
    Tb: 373.15,
    L: 40650,
    // Critical point: 647.096 K, 22.064 MPa (IAPWS-95, Wagner and Pruss 2002, as NIST lists).
    Tc: 647.1,
    Pc: 22.064e6,
    q: 0.01,
    liq: [0.012, 0.05, 0.13],
    ice: [0.82, 0.88, 0.96],
    cld: [1, 1, 1],
    land: [0.34, 0.27, 0.2],
  },
  methane: {
    id: 'methane',
    label: 'Methane',
    Tt: 90.69,
    Pt: 11700,
    Tb: 111.67,
    L: 8190,
    // Critical point: 190.564 K, 4.5992 MPa (Setzmann and Wagner 1991, as NIST lists).
    Tc: 190.56,
    Pc: 4.599e6,
    q: 0.05,
    liq: [0.03, 0.022, 0.014],
    ice: [0.72, 0.68, 0.58],
    cld: [0.95, 0.9, 0.76],
    land: [0.3, 0.18, 0.09],
  },
  ammonia: {
    id: 'ammonia',
    label: 'Ammonia',
    Tt: 195.4,
    Pt: 6060,
    Tb: 239.8,
    L: 23350,
    // Critical point: 405.40 K, 11.333 MPa (Tillner-Roth, Harms-Watzenberg and Baehr 1993, as NIST lists).
    Tc: 405.4,
    Pc: 11.33e6,
    q: 0.02,
    liq: [0.06, 0.09, 0.13],
    ice: [0.9, 0.9, 0.84],
    cld: [1, 0.96, 0.84],
    land: [0.33, 0.29, 0.25],
  },
  nitrogen: {
    id: 'nitrogen',
    label: 'Nitrogen',
    Tt: 63.15,
    Pt: 12500,
    Tb: 77.36,
    L: 5570,
    // Critical point: 126.192 K, 3.3958 MPa (Span, Lemmon, Jacobsen, Wagner and Yokozeki 2000, as NIST lists).
    Tc: 126.19,
    Pc: 3.3958e6,
    q: 0.05,
    liq: [0.05, 0.06, 0.09],
    ice: [0.88, 0.82, 0.74],
    cld: [0.9, 0.9, 0.93],
    land: [0.36, 0.3, 0.26],
  },
  // CO2 has no liquid at one atmosphere: `Tb` is its sublimation point and `Pt` (5.18 bar) is above it.
  // Its liquid-vapour line starts at the triple point: Lv about 15.3 kJ/mol near the triple point (NIST Chemistry
  // WebBook, CO2 phase-change data [verify]: not re-opened in this session); critical point 304.13 K, 7.3773 MPa
  // (Span and Wagner 1996, J. Phys. Chem. Ref. Data 25, 1509).
  co2: {
    id: 'co2',
    label: 'CO₂',
    Tt: 216.58,
    Pt: 518000,
    Tb: 194.7,
    L: 25200,
    Lv: 15300,
    Tc: 304.13,
    Pc: 7.3773e6,
    q: 0.02,
    liq: [0.08, 0.09, 0.12],
    ice: [0.9, 0.9, 0.93],
    cld: [0.98, 0.98, 0.94],
    land: [0.42, 0.28, 0.18],
  },
};

/** Order of the `surface_fluid` slider: index to fluid id. */
export const FLUID_ORDER: readonly FluidId[] = ['water', 'methane', 'ammonia', 'nitrogen', 'co2'];

/** Upper end of the liquid fit below, K: the one-atmosphere boiling point of water. */
const MK_TOP_K = 373.15;

/**
 * Saturation vapour pressure of water, Pa (#93 3.2): Murphy and Koop 2005 (QJRMS 131, 1539), eq. 7 over ice below
 * the triple point (273.16 K) and eq. 10 over liquid above it. Their liquid fit is stated for 123 to 332 K; carried
 * to 373.15 K it is 0.6 % above IAPWS-95, so it is used up to there. Above 373.15 K the curve continues by
 * Clausius-Clapeyron with the 373 K heat of vaporisation from the fit's value at 373.15 K. `derived` (a fit to
 * measurements). The engine's core.js psatMK is the same function.
 */
export function psatWater(T: number): number {
  if (T < 273.16)
    return Math.exp(9.550426 - 5723.265 / T + 3.53068 * Math.log(T) - 0.00728332 * T);
  const t = Math.min(T, MK_TOP_K);
  const p = Math.exp(
    54.842763 -
      6763.22 / t -
      4.21 * Math.log(t) +
      0.000367 * t +
      Math.tanh(0.0415 * (t - 218.8)) *
        (53.878 - 1331.22 / t - 9.44523 * Math.log(t) + 0.014025 * t),
  );
  return T > MK_TOP_K
    ? p * Math.exp((FLUIDS.water.L / R_GAS) * (1 / MK_TOP_K - 1 / T))
    : p;
}

/**
 * Saturation vapour pressure, Pa, at temperature T. Water follows Murphy and Koop 2005 (`psatWater`). Any other
 * fluid follows Clausius-Clapeyron from the triple point; a fluid with a vaporisation heat `Lv` (CO2) uses it above
 * the triple point and its sublimation heat `L` below (#93 3.2: the prototype used `L` on both sides).
 */
export function psatFn(f: Fluid): (T: number) => number {
  if (f.id === 'water') return psatWater;
  const Lv = f.Lv;
  if (Lv !== undefined)
    return (T) => f.Pt * Math.exp(((T >= f.Tt ? Lv : f.L) / R_GAS) * (1 / f.Tt - 1 / T));
  return (T) => f.Pt * Math.exp((f.L / R_GAS) * (1 / f.Tt - 1 / T));
}

/**
 * Boiling point at pressure `Pa`; null when there is no liquid range (below the triple-point pressure).
 * Normally anchored at the one-atmosphere point. When that point is a sublimation point (Tb < Tt, CO2) the
 * liquid-vapour line is drawn up from the triple point instead, Tb(P) = [1/Tt - R ln(P/Pt) / Lv]^-1.
 * Every fluid's line ends at its critical point (#93 3.1): the result is capped at Tc, and at or above Pc it is
 * Tc itself (no boiling there: below Tc the fluid is a compressed liquid, above it supercritical).
 */
export function boilingPointK(f: Fluid, Pa: number): number | null {
  if (!(Pa > f.Pt)) return null;
  if (Pa >= f.Pc) return f.Tc;
  let tb: number;
  if (f.Tb < f.Tt) {
    if (f.Lv === undefined) return null;
    tb = 1 / (1 / f.Tt - (R_GAS * Math.log(Pa / f.Pt)) / f.Lv);
  } else tb = 1 / (1 / f.Tb - (R_GAS * Math.log(Pa / ATM_PA)) / f.L);
  return Math.min(f.Tc, tb);
}

export type FluidState = 'frozen' | 'liquid' | 'vapour' | 'supercritical';

/**
 * What the fluid does at the mean surface temperature `Ts` and pressure `Pa`. At or above both its critical
 * pressure and temperature it is `supercritical`: one dense fluid, no sea surface (#93 3.1).
 */
export function fluidState(f: Fluid, Ts: number, Pa: number, airless: boolean): FluidState {
  if (Ts < f.Tt) return 'frozen';
  if (airless) return 'vapour';
  if (Pa >= f.Pc && Ts >= f.Tc) return 'supercritical';
  const tb = boilingPointK(f, Pa);
  return tb !== null && Ts < tb ? 'liquid' : 'vapour';
}

/**
 * Cloud base: follow the dry adiabat up from the surface (`P ~ T^3.5`, kappa = 2/7 of a diatomic
 * gas) until the fluid's saturation pressure falls below its mixing ratio times the local
 * pressure. Returns the temperature there, or null when it never condenses.
 */
export function cloudBaseK(f: Fluid, Ts: number, Pa: number): number | null {
  const psat = psatFn(f);
  for (let T = Ts; T > Ts * 0.45; T -= 0.5) {
    const Pz = Pa * Math.pow(T / Ts, 3.5);
    if (psat(T) <= f.q * Pz) return T;
  }
  return null;
}

// ---- starlight -----------------------------------------------------------------------------

/** Planck spectral radiance up to a constant: B(lambda, T), lambda in nm. hc/k = 0.014388 m K. */
export function planck(lnm: number, T: number): number {
  const m = lnm * 1e-9;
  return 1 / (Math.pow(m, 5) * (Math.exp(0.014388 / (m * T)) - 1));
}

/** Share of the starlight (300 to 4000 nm) that is visible (<= 700 nm). Sets the ice albedo (stream D). */
export function visFraction(T: number): number {
  let a = 0;
  let b = 0;
  for (let l = 300; l <= 4000; l += 25) {
    const v = planck(l, T);
    b += v;
    if (l <= 700) a += v;
  }
  return a / b;
}

export type Rgb3 = [number, number, number];

/**
 * Sky colour and sun colour from the star's spectrum: Rayleigh scattering ~ lambda^-4 of the
 * blackbody at 640, 540 and 450 nm, normalised to the brightest band. Methane absorbs red
 * (optical depth `ch4` at 640 nm). Direct sunlight is the same spectrum after scattering out an
 * optical depth of 3.2 at 550 nm. Both are `derived` from Teff with these stated shortcuts.
 */
export function skyColours(starTeffK: number, methaneRedDepth: number): { sky: Rgb3; sun: Rgb3 } {
  const bands = [640, 540, 450];
  const sky = bands.map(
    (l, n) =>
      planck(l, starTeffK) * Math.pow(550 / l, 4) * (n === 0 ? Math.exp(-methaneRedDepth) : 1),
  );
  const sun = bands.map((l) => planck(l, starTeffK) * Math.exp(-3.2 * Math.pow(550 / l, 4)));
  const norm = (v: number[]): Rgb3 => {
    const m = Math.max(v[0]!, v[1]!, v[2]!);
    return [v[0]! / m, v[1]! / m, v[2]! / m];
  };
  return { sky: norm(sky), sun: norm(sun) };
}
