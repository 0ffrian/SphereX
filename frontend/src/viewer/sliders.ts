// D-26, D-27: the slider registry and the `overrides` type. Only the relief-type sliders of the
// shader kinds are registered so far (baked types get colour, lighting and spin only, D-26).
// Values use the card's units. Defaults live with the body (renderers/shaderSpec.ts).
import type { ObjectType } from '@/contract';

export interface SliderDef {
  key: SliderKey;
  min: number;
  max: number;
  step: number;
  /** '' = unitless 0..1 fraction or count. */
  unit: string;
  appliesTo: readonly ObjectType[];
}

const PLANETS = ['planet_rocky', 'planet_water'] as const satisfies readonly ObjectType[];

// ASSUMPTION: ranges are artist ranges taken from the mock-up's sliders; none is a physical value.
export const SLIDER_REGISTRY = {
  relief: { key: 'relief', min: 0, max: 0.2, step: 0.005, unit: '', appliesTo: PLANETS },
  sea_level: { key: 'sea_level', min: 0, max: 0.65, step: 0.01, unit: '', appliesTo: PLANETS },
  ice: { key: 'ice', min: 0, max: 1, step: 0.01, unit: '', appliesTo: PLANETS },
  lava_heat: { key: 'lava_heat', min: 0, max: 1, step: 0.01, unit: '', appliesTo: PLANETS },
  cloud_cover: { key: 'cloud_cover', min: 0, max: 1, step: 0.01, unit: '', appliesTo: PLANETS },
  atmosphere: { key: 'atmosphere', min: 0, max: 1, step: 0.01, unit: '', appliesTo: PLANETS },
  bands: { key: 'bands', min: 3, max: 24, step: 1, unit: '', appliesTo: ['gas_giant'] },
  turbulence: { key: 'turbulence', min: 0, max: 1, step: 0.01, unit: '', appliesTo: ['gas_giant'] },
  storms: { key: 'storms', min: 0, max: 8, step: 1, unit: '', appliesTo: ['gas_giant'] },
  rings: { key: 'rings', min: 0, max: 1, step: 0.01, unit: '', appliesTo: ['gas_giant'] },
} as const satisfies Record<string, SliderDef>;

export type SliderKey =
  | 'relief'
  | 'sea_level'
  | 'ice'
  | 'lava_heat'
  | 'cloud_cover'
  | 'atmosphere'
  | 'bands'
  | 'turbulence'
  | 'storms'
  | 'rings';

/** D-27. */
export type Overrides = Partial<Record<SliderKey, number | boolean>>;

/** Keys that change the field (re-run the worker); the rest are shader uniforms only. */
export const FIELD_SLIDER_KEYS: readonly SliderKey[] = [
  'sea_level',
  'ice',
  'lava_heat',
  'bands',
  'turbulence',
  'storms',
];

/** Numeric override clamped to the registry range, or undefined when absent / not applicable. */
export function sliderValue(
  overrides: Overrides | undefined,
  key: SliderKey,
  type: ObjectType,
): number | undefined {
  const def: SliderDef = SLIDER_REGISTRY[key];
  const v = overrides?.[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || !def.appliesTo.includes(type)) {
    return undefined;
  }
  return Math.min(def.max, Math.max(def.min, v));
}
