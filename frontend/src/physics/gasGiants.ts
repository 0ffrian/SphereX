// A7.2 Gas giants: spin to band count (Rhines scale) and flattening. Gas giants also get the A7.1
// planet values. Storm placement, size and count (A7.2 "To build") need inputs no card or slider
// carries (buoyancy frequency N, scale height H, internal heat), so they are not computed here.
import type { ObjectCard } from '@/contract';
import { G, GM_EARTH, HOUR_S, R_JUP_M } from './constants';
import { derivePlanetInto } from './planets';
import type { Overrides } from '@/viewer/sliders';
import { InputReader, need, positive, ResultBuilder, type PhysicsResult } from './tagging';

/** A7.2: `f = 0.7 * q`, a rule of thumb calibrated on Jupiter and Saturn. */
export const FLATTENING_COEFFICIENT = 0.7;

const S = 'A7.2';

/** Spin rate from a rotation period in hours, rad/s. */
export function spinRateRadS(periodH: number): number | null {
  if (!positive(periodH)) return null;
  return (2 * Math.PI) / (periodH * HOUR_S);
}

/** Rhines scale `L = pi * sqrt(U / beta)`, `beta = 2 Omega / R`; metres. */
export function rhinesLengthM(omegaRadS: number, radiusM: number, windMs: number): number | null {
  if (!positive(omegaRadS, radiusM, windMs)) return null;
  const beta = (2 * omegaRadS) / radiusM;
  return Math.PI * Math.sqrt(windMs / beta);
}

/** Number of bands, about `sqrt(2 Omega R / U)`. Order of magnitude only (A7.2). */
export function bandCount(omegaRadS: number, radiusM: number, windMs: number): number | null {
  if (!positive(omegaRadS, radiusM, windMs)) return null;
  return Math.sqrt((2 * omegaRadS * radiusM) / windMs);
}

/** `f = 0.7 * q`, `q = Omega^2 R^3 / (G M)`; M in kg. */
export function flattening(omegaRadS: number, radiusM: number, massKg: number): number | null {
  if (!positive(omegaRadS, radiusM, massKg)) return null;
  const q = (omegaRadS ** 2 * radiusM ** 3) / (G * massKg);
  return FLATTENING_COEFFICIENT * q;
}

/** Earth masses to kg through the nominal GM (constants.ts). */
export const mearthToKg = (m: number): number => (m * GM_EARTH) / G;

export function deriveGasGiant(card: ObjectCard, overrides: Overrides): PhysicsResult {
  const r = new InputReader(card, overrides);
  const out = new ResultBuilder();
  const { radius, mass } = derivePlanetInto(card, r, out);

  const spin = r.read('rot_period_h', 'rot_period_h');
  const wind = r.read('zonal_wind_ms');

  const bands = need({ rot_period_h: spin, radius_rjup: radius, zonal_wind_ms: wind });
  if (bands.ok) {
    const { rot_period_h: p, radius_rjup: rj, zonal_wind_ms: u } = bands.v;
    const omega = spinRateRadS(p.value);
    const rM = rj.value * R_JUP_M;
    const l = omega === null ? null : rhinesLengthM(omega, rM, u.value);
    const inputs = [p, rj, u];
    out.put('band_count', omega === null ? null : bandCount(omega, rM, u.value), inputs, {
      section: S,
      formula: 'bands ~ sqrt(2 Omega R / U), Omega = 2 pi / P (order of magnitude only)',
    });
    out.put('rhines_length_km', l === null ? null : l / 1000, inputs, {
      section: S,
      formula: 'L = pi * sqrt(U / beta), beta = 2 Omega / R',
    });
  } else {
    out.refuse('band_count', bands.absent);
    out.refuse('rhines_length_km', bands.absent);
  }

  const flat = need({ rot_period_h: spin, radius_rjup: radius, mass_mearth: mass });
  if (flat.ok) {
    const { rot_period_h: p, radius_rjup: rj, mass_mearth: m } = flat.v;
    const omega = spinRateRadS(p.value);
    const f = omega === null ? null : flattening(omega, rj.value * R_JUP_M, mearthToKg(m.value));
    out.put('flattening', f, [p, rj, m], {
      section: S,
      formula: 'f = 0.7 * q, q = Omega^2 R^3 / (G M) (rule of thumb, Jupiter and Saturn)',
    });
  } else {
    out.refuse('flattening', flat.absent);
  }

  return out.build(r);
}
