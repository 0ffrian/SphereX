// "Hear it" panel model (approved preview, panels-preview.html): the pure parts. No browser globals.
//   Atmosphere: the wind you would hear on the surface. Inputs are the card's measured surface pressure and
//   temperature plus the dominant gas; the sound itself is `artistic` (shown as "Default"), the speed of
//   sound is `derived` (c = sqrt(gamma R T / M)). Missing input: the sound is refused, never guessed.
//   Spectrum: the object's own SPHEREx spectrum (measured), flux normalised 0..1 on a 0.75 to 5 um axis.
import type { ObjectCard, Tag } from '@/contract/generated';
import { cardToWorld } from '@/engine/worlds/cardToWorld';
import { buildSpectrumMapping, type SpectrumMappingPoint } from '@/sound/spectrumMapping';

export const GAS_CONSTANT = 8.314; // J/(mol K)
export const SOUND_REF_MS = 343; // m/s, air at 20 C: the howl pitch is scaled by c / this

/** Physical constants per gas: adiabatic index and molar mass (kg/mol). */
export const GASES = {
  N2: { label: 'N₂', gamma: 1.4, M: 0.028 },
  CO2: { label: 'CO₂', gamma: 1.29, M: 0.044 },
  H2: { label: 'H₂', gamma: 1.41, M: 0.002016 },
  He: { label: 'He', gamma: 1.66, M: 0.004 },
  CH4: { label: 'CH₄', gamma: 1.31, M: 0.016 },
  O2: { label: 'O₂', gamma: 1.4, M: 0.032 },
  H2O: { label: 'H₂O', gamma: 1.33, M: 0.018 },
  Ar: { label: 'Ar', gamma: 1.67, M: 0.04 },
  NH3: { label: 'NH₃', gamma: 1.31, M: 0.017 },
} as const;
export type GasKey = keyof typeof GASES;

/** How close a molar mass must be to a gas's to be called that gas (fraction). */
const MU_MATCH = 0.06;

export const L0_UM = 0.75;
export const L1_UM = 5;
export const SPEC_POINTS = 260;
export const SPEC_SECONDS = 9;

export const NO_STAR_LINE = 'A star has no surface to stand on, so there is no atmosphere sound.';
export const NO_GIANT_LINE = 'A gas giant has no surface to stand on, so there is no atmosphere sound.';
export const NO_ATMO_LINE = 'No atmosphere data for this object, so there is no wind to hear.';
export const NO_SPECTRUM_LINE = 'No spectrum for this object yet.';

const STAR_TYPES = new Set<ObjectCard['type']>(['star', 'star_mira', 'star_ttauri', 'brown_dwarf', 'brown_dwarf_binary']);

export interface AtmosphereModel {
  P: number; // surface pressure, bar
  T: number; // surface temperature, K
  gas: GasKey;
  gasLabel: string;
  c: number; // speed of sound, m/s
  /** Surface gravity, m/s^2 (derived from the card's mass and radius: g = G M / R^2). */
  gMs2: number;
  cTag: Extract<Tag, 'model_dependent'>;
  cFormula: string;
  /** Provenance of the inputs, for the tooltip. */
  pTag: Tag;
  tTag: Tag;
  gasTag: Tag;
  soundTag: Extract<Tag, 'artistic'>;
}

export type AtmosphereResult =
  | { ok: true; model: AtmosphereModel }
  | { ok: false; reason: 'star' | 'giant' | 'none'; line: string; missing: string[] };

export function soundSpeed(gas: GasKey, T: number): number {
  const g = GASES[gas];
  return Math.sqrt((g.gamma * GAS_CONSTANT * T) / g.M);
}
/** Low-pass cutoff, Hz. P in bar. */
export function cutoffHz(P: number): number {
  return 300 + 9000 * Math.min(1, Math.sqrt(P));
}
export function loudness(P: number): number {
  return Math.min(1, 0.15 + Math.pow(P, 0.4));
}
export function howlHz(c: number): number {
  return (180 * c) / SOUND_REF_MS;
}

/** Nearest gas to a molar mass in g/mol (the world engine's air assumption), or null. */
export function gasFromMolarMass(mu: number): GasKey | null {
  let best: GasKey | null = null;
  let bestErr = MU_MATCH;
  for (const k of Object.keys(GASES) as GasKey[]) {
    const err = Math.abs(GASES[k].M * 1000 - mu) / (GASES[k].M * 1000);
    if (err <= bestErr) {
      best = k;
      bestErr = err;
    }
  }
  return best;
}

export function formatPressure(P: number): string {
  if (P >= 0.1) return `${Number(P.toPrecision(3))} bar`;
  return `${Math.round(P * 1000)} mbar`;
}

/**
 * The wind model of a card. ASSUMPTION: the card has no dominant-gas field, so the gas is the one the world
 * engine already assumes for the object's air (cardToWorld `mu`, tagged as an assumption there), matched to
 * the gas table by molar mass. Pressure and temperature must be on the card (not the engine's 1 bar default).
 */
export function atmosphereOf(card: ObjectCard | null): AtmosphereResult {
  if (!card) return { ok: false, reason: 'none', line: NO_ATMO_LINE, missing: ['card'] };
  if (STAR_TYPES.has(card.type)) return { ok: false, reason: 'star', line: NO_STAR_LINE, missing: [] };
  if (card.type === 'gas_giant') return { ok: false, reason: 'giant', line: NO_GIANT_LINE, missing: [] };
  const P = card.surface_pressure_bar?.value ?? null;
  const T = card.surface_temperature_K?.value ?? null;
  const missing: string[] = [];
  if (P === null || !(P > 0)) missing.push('surface_pressure_bar');
  if (T === null || !(T > 0)) missing.push('surface_temperature_K');
  const world = missing.length === 0 ? cardToWorld(card) : null;
  const gas = world && world.ok ? gasFromMolarMass(world.preset.mu) : null;
  if (missing.length === 0 && gas === null) missing.push('dominant_gas');
  if (missing.length > 0 || P === null || T === null || gas === null || !world || !world.ok)
    return { ok: false, reason: 'none', line: NO_ATMO_LINE, missing };
  return {
    ok: true,
    model: {
      P,
      T,
      gas,
      gasLabel: GASES[gas].label,
      c: soundSpeed(gas, T),
      gMs2: (6.674e-11 * world.preset.Me * 5.972e24) / (world.preset.Rj * 71492e3) ** 2,
      cTag: 'model_dependent',
      cFormula: 'c = sqrt(gamma R T / M)',
      pTag: card.surface_pressure_bar!.tag,
      tTag: card.surface_temperature_K!.tag,
      gasTag: world.tags.mu ?? 'model_dependent',
      soundTag: 'artistic',
    },
  };
}

export interface SpectrumCurve {
  /** Flux normalised to 0..1 at SPEC_POINTS wavelengths from L0_UM to L1_UM; null where the object has no data. */
  values: (number | null)[];
  lambdaMinUm: number;
  lambdaMaxUm: number;
}

/** Normalise the object's SPHEREx spectrum onto the panel's axis; null when nothing usable. */
export function spectrumCurve(points: readonly SpectrumMappingPoint[] | null): SpectrumCurve | null {
  if (!points || points.length === 0) return null;
  const m = buildSpectrumMapping(points);
  if (m.empty) return null;
  const values: (number | null)[] = [];
  for (let i = 0; i < SPEC_POINTS; i++) {
    const l = L0_UM + ((L1_UM - L0_UM) * i) / (SPEC_POINTS - 1);
    values.push(m.sampleAt(l)?.strength ?? null);
  }
  return { values, lambdaMinUm: m.lambdaMinUm, lambdaMaxUm: m.lambdaMaxUm };
}

export function lamAt(p: number): number {
  return L0_UM + (L1_UM - L0_UM) * p;
}
/** Pitch 880 to 110 Hz on log wavelength. */
export function freqAt(p: number): number {
  const x = Math.log(lamAt(p) / L0_UM) / Math.log(L1_UM / L0_UM);
  return 880 * Math.pow(110 / 880, x);
}

export function reachFraction(P: number): number {
  return Math.max(0.04, Math.min(1, Math.log10(cutoffHz(P) / 100) / 2));
}
export function reachText(P: number): string {
  return P < 0.1
    ? `Thin air drops the high hiss above about ${(cutoffHz(P) / 1000).toFixed(1)} kHz; the wind sounds far away and muffled.`
    : 'Thick air carries the high hiss; the wind sounds close and full.';
}
