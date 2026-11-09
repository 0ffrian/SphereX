// Issue #68 Track C, R7.7, R5.3: the types of the scenario "looks". A look is a set of artistic
// settings only. Nothing here is a physical value.
import type { Tag, Tier } from '@/contract';

/**
 * The climate scenario. ASSUMPTION: Track B owns the canonical union (`physics/climate.ts`); this
 * copy has exactly the same five members and is swapped for an import when the tracks merge.
 */
export type Scenario = 'lava' | 'hot_dry' | 'eyeball' | 'snowball' | 'temperate';

export const SCENARIOS: readonly Scenario[] = [
  'lava',
  'hot_dry',
  'eyeball',
  'snowball',
  'temperate',
];

export type CloudStyle = 'banded' | 'patchy';

/**
 * Artistic settings of a drawn planet. Units and ranges follow `PLANET_DEFAULTS` in
 * `renderers/shaderSpec.ts` (mock-up slider values), so a look can replace it:
 * `cloudCover` is its `cloud` (0..1), `relief` its `relief` (about 0.03..0.12 of the radius),
 * `freq` its `freq` (noise frequency on the unit sphere, about 1..3),
 * `atmosphereStrength` its `atmo` (0..1).
 */
export interface ScenarioLook {
  /** 0..1 cloud cover. */
  cloudCover: number;
  /** Banded (zonal) or patchy (cellular) clouds. */
  cloudStyle: CloudStyle;
  /** Height-field relief scale. */
  relief: number;
  /** Terrain noise frequency. */
  freq: number;
  /** Surface hue shift in degrees, 0..360 (0 = the shader's own palette). ASSUMPTION: no hue slider exists yet. */
  surfaceHue: number;
  /** 0..1 atmosphere glow. */
  atmosphereStrength: number;
  /** Atmosphere colour, linear RGB 0..1. */
  atmosphereColour: readonly [number, number, number];
  /** 0..1 contrast of the ice texture. */
  iceContrast: number;
}

export type LookKey = keyof ScenarioLook;

/** The only keys a look or a preset may carry. Anything else is not artistic and is refused. */
export const LOOK_KEYS: readonly LookKey[] = [
  'cloudCover',
  'cloudStyle',
  'relief',
  'freq',
  'surfaceHue',
  'atmosphereStrength',
  'atmosphereColour',
  'iceContrast',
];

/** Every look is `artistic`, drawn at "+ Artistic" only (tier 5). */
export const LOOK_TAG: Tag = 'artistic';
export const LOOK_TIER: Tier = 5;
