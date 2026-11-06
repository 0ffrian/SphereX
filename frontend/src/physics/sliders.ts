// D-27 slider registry: every key the client-side `overrides` map may hold. `SliderKey` is
// derived from this list, so an unknown key fails the type check. Values use card units: a key
// that names an ObjectCard field (`teq_K`, `radius_rjup`, `rot_period_h`) has that field's unit.
// D-26: baked types allow only colour, lighting and spin sliders; the other groups exist only on
// the shader kinds, which redraw live (D-01).
//
// The min/max/step values are UI bounds for the slider, not claims about any object. They are
// placeholders chosen to span the bodies in A7 (Earth to brown-dwarf masses, minutes to weeks of
// spin) and can be retuned freely.
// ASSUMPTION: the ranges and steps below; no spec gives them.
import type { ObjectType } from '@/contract';

/** What a slider changes. D-26 limits baked types to the first three. */
export type SliderGroup = 'colour' | 'lighting' | 'spin' | 'relief' | 'physics';

export interface SliderSpec<K extends string = string> {
  key: K;
  min: number;
  max: number;
  step: number;
  unit: string;
  appliesTo: readonly ObjectType[];
  /** ASSUMPTION: D-27 lists the fields above; `group` is added so D-26 can be checked. */
  group: SliderGroup;
  /** Physics section the slider feeds (A7.x), shown next to the slider; says where it feeds none. */
  spec: string;
}

/** D-01: the browser-shader kinds. Every other type is baked on the backend. */
export const SHADER_KINDS: readonly ObjectType[] = [
  'planet_rocky',
  'planet_water',
  'gas_giant',
  'nebula',
  'nova',
];

/** D-26: the only slider groups a baked type may have. */
export const BAKED_SLIDER_GROUPS: readonly SliderGroup[] = ['colour', 'lighting', 'spin'];

const PLANETS = ['planet_rocky', 'planet_water', 'gas_giant'] as const;
const ASTEROIDS = ['asteroid_shape', 'asteroid_procedural'] as const;

export const SLIDER_REGISTRY = [
  // A7.1 planets (shader kinds: any group allowed)
  {
    key: 'teq_K',
    min: 30,
    max: 3000,
    step: 1,
    unit: 'K',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'radius_rjup',
    min: 0.02,
    max: 2.5,
    step: 0.01,
    unit: 'R_J',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'mass_mearth',
    min: 0.01,
    max: 6000,
    step: 0.01,
    unit: 'M_E',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'star_teff_K',
    min: 2000,
    max: 40000,
    step: 10,
    unit: 'K',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'star_radius_rsun',
    min: 0.08,
    max: 20,
    step: 0.01,
    unit: 'R_sun',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'semi_major_axis_au',
    min: 0.005,
    max: 50,
    step: 0.005,
    unit: 'au',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  {
    key: 'bond_albedo',
    min: 0,
    max: 0.95,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'A7.1',
  },
  // A7.2 gas giants
  {
    key: 'zonal_wind_ms',
    min: 1,
    max: 500,
    step: 1,
    unit: 'm/s',
    appliesTo: ['gas_giant'],
    group: 'physics',
    spec: 'A7.2',
  },
  // Spin (allowed on baked types by D-26): A7.2 band count and flattening on gas giants, A7.4 spin
  // barrier on asteroids. On rocky and water planets and brown dwarfs it only turns the body in
  // the viewer; no A7 rule reads it there.
  {
    key: 'rot_period_h',
    min: 0.1,
    max: 1000,
    step: 0.1,
    unit: 'h',
    appliesTo: [...PLANETS, ...ASTEROIDS, 'brown_dwarf', 'brown_dwarf_binary'],
    group: 'spin',
    spec: 'A7.2 (gas giants), A7.4 (asteroids); viewer spin only on other types',
  },
  // ASSUMPTION: bulk density only feeds the A7.4 spin barrier and does not change the bake, so it
  // is filed under 'spin' to fit D-26 (Q-43).
  {
    key: 'bulk_density_kg_m3',
    min: 500,
    max: 8000,
    step: 10,
    unit: 'kg/m^3',
    appliesTo: ASTEROIDS,
    group: 'spin',
    spec: 'A7.4',
  },
  // A7.5 supernova remnants. ASSUMPTION: drawn by the `nova` shell-remnant kind (A6, Q-44).
  {
    key: 'age_yr',
    min: 10,
    max: 100000,
    step: 10,
    unit: 'yr',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
  {
    key: 'energy_e51',
    min: 0.1,
    max: 10,
    step: 0.1,
    unit: '1e51 erg',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
  {
    key: 'ambient_density_cm3',
    min: 0.01,
    max: 100,
    step: 0.01,
    unit: 'cm^-3',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
] as const satisfies readonly SliderSpec[];

export type SliderKey = (typeof SLIDER_REGISTRY)[number]['key'];

/** D-27: user edits, kept apart from the card (D-02). */
export type Overrides = Readonly<Partial<Record<SliderKey, number | boolean>>>;

const BY_KEY: ReadonlyMap<string, SliderSpec<SliderKey>> = new Map(
  SLIDER_REGISTRY.map((s) => [s.key, s as SliderSpec<SliderKey>]),
);

export function sliderSpec(key: SliderKey): SliderSpec<SliderKey> {
  const spec = BY_KEY.get(key);
  if (!spec) throw new Error(`unknown slider key "${key}"`);
  return spec;
}

/** The sliders shown for one type, in registry order. */
export function slidersFor(type: ObjectType): SliderSpec<SliderKey>[] {
  return SLIDER_REGISTRY.filter((s) => (s.appliesTo as readonly ObjectType[]).includes(type));
}

/** True when `key` is a registered slider shown for `type`. */
export function sliderApplies(type: ObjectType, key: SliderKey): boolean {
  return BY_KEY.get(key)?.appliesTo.includes(type) ?? false;
}

/** True when `value` may be stored for `key` on a body of `type`: applies, finite, in range. */
export function isValidOverride(
  type: ObjectType,
  key: SliderKey,
  value: number | boolean,
): boolean {
  const spec = BY_KEY.get(key);
  if (!spec || !spec.appliesTo.includes(type)) return false;
  if (typeof value !== 'number') return false; // every registered slider is numeric today
  return Number.isFinite(value) && value >= spec.min && value <= spec.max;
}
