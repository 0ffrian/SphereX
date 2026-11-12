// Liquids table for the soundscape (spec R13 §4.4, [SS §11]). Values marked [verify] in the spec carry
// `inferred_from_analog`; the rest are handbook values (`measured`). Lava is viscous: its bubbles do not ring [SS §10].
import type { FluidKey } from '@/engine/worlds/types';
import { earthRef } from './air';
import type { AirModel, LiquidProps } from './types';
import { DROP_CD, DROP_R_EARTH_M, EARTH_REF, MF_SIZE_EXP, WATER_RHO, WATER_SIGMA } from './tuning';

export const LIQUIDS: Record<FluidKey | 'lava', LiquidProps> = {
  water: { name: 'water', rho: 998, sigma: 0.0728, viscous: false, tag: 'measured' },
  /** 94 K; rho [verify] (pure methane; a Titan lake is a methane-ethane-nitrogen mix). */
  methane: { name: 'methane', rho: 450, sigma: 0.0178, viscous: false, tag: 'inferred_from_analog' },
  /** 240 K. */
  ammonia: { name: 'ammonia', rho: 682, sigma: 0.032, viscous: false, tag: 'measured' },
  /** Mixture; rho and sigma [verify]. */
  ammoniaWater: { name: 'ammonia-water', rho: 850, sigma: 0.05, viscous: false, tag: 'inferred_from_analog' },
  /** 77 K; [verify]. */
  nitrogen: { name: 'nitrogen', rho: 807, sigma: 0.0089, viscous: false, tag: 'inferred_from_analog' },
  /** At the triple point; sigma -> 0 at 304 K [verify]. */
  co2: { name: 'carbon dioxide', rho: 1178, sigma: 0.017, viscous: false, tag: 'inferred_from_analog' },
  /** Basalt; rho [verify]. */
  lava: { name: 'lava', rho: 2650, sigma: 0.36, viscous: true, tag: 'inferred_from_analog' },
};

/** §4.4: the surface liquid's properties; a lava world uses lava. Unknown fluid -> null (refused, never guessed). */
export function liquidFor(fluid: FluidKey, lavaWorld: boolean): LiquidProps | null {
  if (lavaWorld) return LIQUIDS.lava;
  return Object.prototype.hasOwnProperty.call(LIQUIDS, fluid) ? LIQUIDS[fluid] : null;
}

// ---------- liquid physics used by several sources (kept here so weather.ts and sources.ts share one copy) ----------

/**
 * R2 bubble and foam pitch factor m_f relative to Earth seawater bubbles:
 * sqrt((P0/rho_l)/(1.013e5/1000)) * sqrt(gamma/1.4) * ((sigma_E/rho_E)/(sigma/rho_l))^(3/5)
 * (Minnaert scaling with the Deane & Stokes size-break shift [SS §6]). null without a liquid.
 */
export function bubbleFactor(air: AirModel): number | null {
  const l = air.liquid;
  if (!l || !(l.rho > 0) || !(l.sigma > 0) || !(air.P0 > 0)) return null;
  const pressure = Math.sqrt(air.P0 / l.rho / (1.013e5 / 1000));
  const gas = Math.sqrt(air.gamma / 1.4);
  const size = Math.pow(WATER_SIGMA / WATER_RHO / (l.sigma / l.rho), MF_SIZE_EXP);
  return pressure * gas * size;
}

/**
 * R3 largest raindrop and its fall speed. r_max = 3.25 mm * sqrt((sigma/(g drho)) / (sigma/(g drho))_Earth)
 * (Loftus & Wordsworth 2021 capillary scaling, Earth-calibrated); v = sqrt(8 r drho g / (3 C_D rho_a)) [SS 4.2];
 * pitch p = r_E / r. The Titan spread (Lorenz 1993 4.75 mm against the scaling's ~6.5 mm) is [verify].
 */
export function dropPhysics(air: AirModel): { r_m: number; vt: number; pitch: number } | null {
  const l = air.liquid;
  if (!l || l.viscous || !(air.gv > 0) || !(air.rho0 > 0)) return null;
  const drho = l.rho - air.rho0;
  if (!(drho > 0)) return null;
  const e = earthRef();
  const lc2 = l.sigma / (air.gv * drho);
  const lc2E = WATER_SIGMA / (EARTH_REF.g * (WATER_RHO - e.rho));
  const r = DROP_R_EARTH_M * Math.sqrt(lc2 / lc2E);
  const vt = Math.sqrt((8 * r * drho * air.gv) / (3 * DROP_CD * air.rho0));
  return { r_m: r, vt, pitch: DROP_R_EARTH_M / r };
}
