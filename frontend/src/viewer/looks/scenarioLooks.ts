// Issue #68 Track C, R7.7, R5.3, D-27: default looks per climate scenario.
//
// FIRST PASS. Every number below is `artistic`, set by reasoning from PLANET_DEFAULTS
// (planet_rocky: cloud .2, relief .081, freq 1.6, atmo .85; planet_water: cloud .7, relief .054,
// freq 2, ice .22) and awaits tuning against published artist depictions. The references are not
// committed (no image, no URL here); sources are recorded when the tuning step lands.
import {
  LOOK_KEYS,
  LOOK_TAG,
  LOOK_TIER,
  SCENARIOS,
  type Scenario,
  type ScenarioLook,
} from './types';
import type { Tag, Tier } from '@/contract';

const LOOKS: Record<Scenario, ScenarioLook> = {
  // Molten, almost cloudless, dim red-orange glow, rugged crust.
  lava: {
    cloudCover: 0.05,
    cloudStyle: 'patchy',
    relief: 0.095,
    freq: 2.4,
    surfaceHue: 0,
    atmosphereStrength: 0.5,
    atmosphereColour: [1.0, 0.45, 0.2],
    iceContrast: 0,
  },
  // Dry rocky desert, thin tan haze.
  hot_dry: {
    cloudCover: 0.08,
    cloudStyle: 'patchy',
    relief: 0.081,
    freq: 1.6,
    surfaceHue: 0.1,
    atmosphereStrength: 0.55,
    atmosphereColour: [0.9, 0.7, 0.45],
    iceContrast: 0,
  },
  // Tidally locked: a cloud swirl round the sub-stellar point, ice on the night side.
  eyeball: {
    cloudCover: 0.6,
    cloudStyle: 'banded',
    relief: 0.06,
    freq: 1.8,
    surfaceHue: 0.3,
    atmosphereStrength: 0.8,
    atmosphereColour: [0.55, 0.7, 1.0],
    iceContrast: 0.7,
  },
  // White, high-contrast ice, thin pale atmosphere.
  snowball: {
    cloudCover: 0.2,
    cloudStyle: 'patchy',
    relief: 0.05,
    freq: 1.9,
    surfaceHue: 0.8,
    atmosphereStrength: 0.6,
    atmosphereColour: [0.75, 0.88, 1.0],
    iceContrast: 0.9,
  },
  // Blue-green world, broken clouds, bright blue limb (the planet_water defaults).
  temperate: {
    cloudCover: 0.7,
    cloudStyle: 'patchy',
    relief: 0.054,
    freq: 2,
    surfaceHue: 0.3,
    atmosphereStrength: 0.85,
    atmosphereColour: [0.4, 0.62, 1.0],
    iceContrast: 0.4,
  },
};

for (const l of Object.values(LOOKS)) Object.freeze(l.atmosphereColour);
for (const l of Object.values(LOOKS)) Object.freeze(l);
export const SCENARIO_LOOKS: Readonly<Record<Scenario, ScenarioLook>> = Object.freeze(LOOKS);

/** Allowed numeric range per key (display limits, artistic). A value outside is clamped. */
const RANGE: Partial<Record<keyof ScenarioLook, readonly [number, number]>> = {
  cloudCover: [0, 1],
  relief: [0, 0.25],
  freq: [0.1, 8],
  surfaceHue: [0, 1],
  atmosphereStrength: [0, 1],
  iceContrast: [0, 1],
};
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** A safe value for a key, or undefined when it is not usable (wrong type, NaN, Infinity). */
function safe(k: keyof ScenarioLook, v: unknown): ScenarioLook[keyof ScenarioLook] | undefined {
  if (k === 'cloudStyle') return v === 'banded' || v === 'patchy' ? v : undefined;
  if (k === 'atmosphereColour') {
    if (!Array.isArray(v) || v.length !== 3) return undefined;
    if (!v.every((c) => typeof c === 'number' && Number.isFinite(c))) return undefined;
    return [clamp(v[0], [0, 1]), clamp(v[1], [0, 1]), clamp(v[2], [0, 1])] as const;
  }
  const r = RANGE[k];
  return r && typeof v === 'number' && Number.isFinite(v) ? clamp(v, r) : undefined;
}

/** A partial set of artistic settings. Sliders are always one of these. */
export type LookOverrides = Partial<ScenarioLook>;

/** Look for a scenario, or null for an unknown one (the caller then keeps PLANET_DEFAULTS). */
export function lookForScenario(s: string | null | undefined): ScenarioLook | null {
  return (SCENARIOS as readonly string[]).includes(s ?? '') ? SCENARIO_LOOKS[s as Scenario] : null;
}

/**
 * Merge: scenario look, then preset, then sliders. Sliders win (D-27); a preset beats the
 * scenario look. Pure; the inputs are not changed. `undefined`, non-finite and wrong-typed values are skipped and numbers are clamped to their range.
 */
export function mergeLook(
  base: ScenarioLook,
  preset?: LookOverrides | null,
  sliders?: LookOverrides | null,
): ScenarioLook {
  const out: ScenarioLook = { ...base };
  for (const layer of [preset, sliders]) {
    if (!layer) continue;
    const o = out as unknown as Record<string, unknown>;
    for (const k of LOOK_KEYS) {
      const v = safe(k, layer[k]); // NaN, Infinity, wrong types and unknown values are skipped
      if (v !== undefined) o[k] = v;
    }
  }
  return out;
}

export function lookLegend(s: Scenario, lockTested = true): string {
  // `temperate` is the fallback when the tidal-locking rule was refused: say only what is known.
  if (s === 'temperate' && !lockTested)
    return "Look: typical artist's depiction of a world with ice only where it is cold (whether it is tidally locked could not be tested)";
  return `Look: typical artist's depiction of a ${s.replace('_', ' ')} world`;
}

export const lookProvenance: { tag: Tag; tier: Tier; plusArtisticOnly: true } = {
  tag: LOOK_TAG,
  tier: LOOK_TIER,
  plusArtisticOnly: true,
};
