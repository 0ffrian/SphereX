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
  water: { id: 'water', label: 'Water', Tt: 273.16, Pt: 611.7, Tb: 373.15, L: 40650, q: 0.01, liq: [0.012, 0.05, 0.13], ice: [0.82, 0.88, 0.96], cld: [1, 1, 1], land: [0.34, 0.27, 0.2] },
  methane: { id: 'methane', label: 'Methane', Tt: 90.69, Pt: 11700, Tb: 111.67, L: 8190, q: 0.05, liq: [0.03, 0.022, 0.014], ice: [0.72, 0.68, 0.58], cld: [0.95, 0.9, 0.76], land: [0.3, 0.18, 0.09] },
  ammonia: { id: 'ammonia', label: 'Ammonia', Tt: 195.4, Pt: 6060, Tb: 239.8, L: 23350, q: 0.02, liq: [0.06, 0.09, 0.13], ice: [0.9, 0.9, 0.84], cld: [1, 0.96, 0.84], land: [0.33, 0.29, 0.25] },
  nitrogen: { id: 'nitrogen', label: 'Nitrogen', Tt: 63.15, Pt: 12500, Tb: 77.36, L: 5570, q: 0.05, liq: [0.05, 0.06, 0.09], ice: [0.88, 0.82, 0.74], cld: [0.9, 0.9, 0.93], land: [0.36, 0.3, 0.26] },
  // CO2 has no liquid at one atmosphere: `Tb` is its sublimation point and `Pt` (5.18 bar) is above it.
  co2: { id: 'co2', label: 'CO₂', Tt: 216.58, Pt: 518000, Tb: 194.7, L: 25200, q: 0.02, liq: [0.08, 0.09, 0.12], ice: [0.9, 0.9, 0.93], cld: [0.98, 0.98, 0.94], land: [0.42, 0.28, 0.18] },
};

/** Order of the `surface_fluid` slider: index to fluid id. */
export const FLUID_ORDER: readonly FluidId[] = ['water', 'methane', 'ammonia', 'nitrogen', 'co2'];

/** Saturation vapour pressure, Pa, at temperature T (Clausius-Clapeyron from the triple point). */
export function psatFn(f: Fluid): (T: number) => number {
  return (T) => f.Pt * Math.exp((f.L / R_GAS) * (1 / f.Tt - 1 / T));
}

/** Boiling point at pressure `Pa` from the one-atmosphere point; null when there is no liquid range. */
export function boilingPointK(f: Fluid, Pa: number): number | null {
  if (!(Pa > f.Pt) || !(f.Tb > f.Tt)) return null;
  return 1 / (1 / f.Tb - (R_GAS * Math.log(Pa / ATM_PA)) / f.L);
}

export type FluidState = 'frozen' | 'liquid' | 'vapour';

/** What the fluid does at the mean surface temperature `Ts` and pressure `Pa`. */
export function fluidState(f: Fluid, Ts: number, Pa: number, airless: boolean): FluidState {
  if (Ts < f.Tt) return 'frozen';
  if (airless) return 'vapour';
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
export function skyColours(
  starTeffK: number,
  methaneRedDepth: number,
): { sky: Rgb3; sun: Rgb3 } {
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
