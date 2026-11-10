// D-26, D-27: the one slider registry and the `overrides` type. Every key the client-side
// `overrides` map may hold is listed here, for the viewer (shader kinds) and the physics layer
// (A7, `src/physics/`) alike. `SliderKey` is derived from this map, so an unknown key fails the
// type check. Values use card units: a key that names an ObjectCard field (`teq_K`,
// `radius_rjup`, `rot_period_h`) has that field's unit. Defaults live with the body
// (renderers/shaderSpec.ts) or come from the card (physics).
//
// D-26: baked types allow only colour, lighting and spin sliders; the other groups exist only on
// the shader kinds, which redraw live (D-01).
//
// Invalid values (one policy for every reader): a value is used only when `isValidOverride`
// accepts it (registered for the type, a finite number, inside [min, max]). Anything else is
// ignored, never clamped: the store refuses to keep it, `sliderValue` returns undefined (the body
// default is drawn) and the physics layer lists the key in `ignored`.
//
// ASSUMPTION: min, max and step are UI bounds, not claims about any object. The relief group is
// taken from the mock-up's sliders (artistic); the physics ranges span the bodies in A7 (Earth to
// brown-dwarf masses, minutes to months of spin) and can be retuned freely.
import type { ObjectType } from '@/contract';

/** What a slider changes. D-26 limits baked types to the first three. */
export type SliderGroup = 'colour' | 'lighting' | 'spin' | 'relief' | 'physics';

export interface SliderDef {
  key: string;
  min: number;
  max: number;
  step: number;
  /** '' = unitless 0..1 fraction or count. */
  unit: string;
  appliesTo: readonly ObjectType[];
  /** Added to the D-27 fields so D-26 can be checked (see the note under D-27). */
  group: SliderGroup;
  /** Section the slider feeds, shown next to it; says so where it feeds no physics rule. */
  spec: string;
}

/** D-26: the only slider groups a baked type may have. */
export const BAKED_SLIDER_GROUPS: readonly SliderGroup[] = ['colour', 'lighting', 'spin'];

const PLANETS = ['planet_rocky', 'planet_water'] as const satisfies readonly ObjectType[];
const WORLDS = [...PLANETS, 'gas_giant'] as const satisfies readonly ObjectType[];
const ASTEROIDS = [
  'asteroid_shape',
  'asteroid_procedural',
] as const satisfies readonly ObjectType[];
const ARTISTIC = 'R7.7 (artistic look; no A7 rule)';

export const SLIDER_REGISTRY = {
  // ---- Shader-kind look (R7.7, artistic). `relief` group: shader kinds only (D-26). ----------
  relief: {
    key: 'relief',
    min: 0,
    max: 0.2,
    step: 0.005,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: ARTISTIC,
  },
  sea_level: {
    key: 'sea_level',
    min: 0,
    max: 0.65,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: ARTISTIC,
  },
  ice: {
    key: 'ice',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    // No viewer slider panel exists yet, so the reason is in the help text (Q-160): on a tidally
    // locked planet the ice edge comes from the locking model, not from this slider.
    spec: `${ARTISTIC}; no effect on an eyeball or snowball planet, whose ice edge follows the star-facing point`,
  },
  // The default comes from the A7.1 lava threshold on the card's teq_K (shaderPalette.ts).
  lava_heat: {
    key: 'lava_heat',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: `${ARTISTIC}; default from the A7.1 lava threshold`,
  },
  cloud_cover: {
    key: 'cloud_cover',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: ARTISTIC,
  },
  atmosphere: {
    key: 'atmosphere',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: ARTISTIC,
  },
  // Drives the drawn gas-giant bands. The A7.2 `band_count` (from rot_period_h and
  // zonal_wind_ms) is shown next to it but does not drive the shader yet.
  bands: {
    key: 'bands',
    min: 3,
    max: 24,
    step: 1,
    unit: '',
    appliesTo: ['gas_giant'],
    group: 'relief',
    spec: `${ARTISTIC}; A7.2 band_count is shown, not drawn`,
  },
  turbulence: {
    key: 'turbulence',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: ['gas_giant'],
    group: 'relief',
    spec: ARTISTIC,
  },
  storms: {
    key: 'storms',
    min: 0,
    max: 8,
    step: 1,
    unit: '',
    appliesTo: ['gas_giant'],
    group: 'relief',
    spec: ARTISTIC,
  },
  rings: {
    key: 'rings',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '',
    appliesTo: ['gas_giant'],
    group: 'relief',
    spec: ARTISTIC,
  },

  // Issue #71 stream E: pacing of a solved gas world. 0 = 5 minutes of planet time per second (the
  // default, slow like the real planet), 1 = one Earth day per second (storms visibly drift).
  gas_pacing: {
    key: 'gas_pacing',
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    appliesTo: ['gas_giant'],
    group: 'spin',
    spec: 'D-36 (pacing of the simulated winds; a display choice)',
  },

  // ---- A7.1 planets (shader kinds). ---------------------------------------------------------
  teq_K: {
    key: 'teq_K',
    min: 30,
    max: 3000,
    step: 1,
    unit: 'K',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  radius_rjup: {
    key: 'radius_rjup',
    min: 0.02,
    max: 2.5,
    step: 0.01,
    unit: 'R_J',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  mass_mearth: {
    key: 'mass_mearth',
    min: 0.01,
    max: 6000,
    step: 0.01,
    unit: 'M_E',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  star_teff_K: {
    key: 'star_teff_K',
    min: 2000,
    max: 40000,
    step: 10,
    unit: 'K',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  star_radius_rsun: {
    key: 'star_radius_rsun',
    min: 0.08,
    max: 20,
    step: 0.01,
    unit: 'R_sun',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  semi_major_axis_au: {
    key: 'semi_major_axis_au',
    min: 0.005,
    max: 50,
    step: 0.005,
    unit: 'au',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },
  bond_albedo: {
    key: 'bond_albedo',
    min: 0,
    max: 0.95,
    step: 0.01,
    unit: '',
    appliesTo: WORLDS,
    group: 'physics',
    spec: 'A7.1',
  },

  // ---- Issue #71 stream D (Q-240, Q-243): the climate-budget world of a rocky or water planet. The
  // star temperature and orbit sliders are `star_teff_K` and `semi_major_axis_au` above; these are
  // the rest. Pressure and surface fluid are assumptions for any exoplanet (D-36); a value the
  // visitor sets is `artistic` "(your setting)" (Q-58). Each rebuilds the world (a worker run). ---
  surface_pressure_bar: {
    key: 'surface_pressure_bar',
    min: 0.002,
    max: 100,
    step: 0.001,
    unit: 'bar',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'Q-240 (assumed for any exoplanet, D-36)',
  },
  // Index into FLUID_ORDER (physics/fluids.ts): 0 water, 1 methane, 2 ammonia, 3 nitrogen, 4 CO2.
  surface_fluid: {
    key: 'surface_fluid',
    min: 0,
    max: 4,
    step: 1,
    unit: '',
    appliesTo: PLANETS,
    group: 'physics',
    spec: 'Q-240 (assumed for any exoplanet, D-36)',
  },
  // 0 or 1: draws the plate boundaries over the surface (artistic overlay).
  show_plates: {
    key: 'show_plates',
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    appliesTo: PLANETS,
    group: 'relief',
    spec: 'Q-242 (plate tectonics is an assumption, D-36)',
  },

  // ---- A7.2 gas giants. Feeds band_count only; the drawn wind comes from the band phase
  // (`zonalWind` in fields/fieldGenerator.ts), not from this slider. -------------------------
  zonal_wind_ms: {
    key: 'zonal_wind_ms',
    min: 1,
    max: 500,
    step: 1,
    unit: 'm/s',
    appliesTo: ['gas_giant'],
    group: 'physics',
    spec: 'A7.2 band_count only (not drawn)',
  },

  // ---- Spin (allowed on baked types by D-26): A7.2 band count and flattening on gas giants,
  // A7.4 spin barrier on asteroids; on other types it only turns the body. Max 10,000 h so
  // slow rotators (Venus about 5,830 h, the slowest asteroids) fit. ---------------------------
  rot_period_h: {
    key: 'rot_period_h',
    min: 0.1,
    max: 10000,
    step: 0.1,
    unit: 'h',
    appliesTo: [...WORLDS, ...ASTEROIDS, 'brown_dwarf', 'brown_dwarf_binary'],
    group: 'spin',
    spec: 'A7.2 (gas giants), A7.4 (asteroids); viewer spin only on other types',
  },
  // ASSUMPTION: bulk density only feeds the A7.4 spin barrier and changes no bake, so it is filed
  // under 'spin' to fit D-26. Needs explicit approval (Q-58).
  bulk_density_kg_m3: {
    key: 'bulk_density_kg_m3',
    min: 500,
    max: 8000,
    step: 10,
    unit: 'kg/m^3',
    appliesTo: ASTEROIDS,
    group: 'spin',
    spec: 'A7.4',
  },

  // ---- A7.5 supernova remnants. ASSUMPTION: drawn by the `nova` shell-remnant kind (A6, Q-59).
  age_yr: {
    key: 'age_yr',
    min: 10,
    max: 100000,
    step: 10,
    unit: 'yr',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
  energy_e51: {
    key: 'energy_e51',
    min: 0.1,
    max: 10,
    step: 0.1,
    unit: '1e51 erg',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
  ambient_density_cm3: {
    key: 'ambient_density_cm3',
    min: 0.01,
    max: 100,
    step: 0.01,
    unit: 'cm^-3',
    appliesTo: ['nova'],
    group: 'physics',
    spec: 'A7.5',
  },
} as const satisfies Record<string, SliderDef>;

export type SliderKey = keyof typeof SLIDER_REGISTRY;

/** D-27: user edits, kept apart from the card (D-02). */
export type Overrides = Readonly<Partial<Record<SliderKey, number | boolean>>>;

/** Every registered slider, in registry order. */
export const SLIDERS: readonly (SliderDef & { key: SliderKey })[] = Object.values(SLIDER_REGISTRY);

/** Keys that change the field (re-run the worker); the rest are shader uniforms only. */
export const FIELD_SLIDER_KEYS: readonly SliderKey[] = [
  'surface_pressure_bar',
  'surface_fluid',
  'sea_level',
  'ice',
  'lava_heat',
  'bands',
  'turbulence',
  'storms',
];

/** The registry entry for `key`; undefined for a key that is not registered (untyped input). */
function defOf(key: string): SliderDef | undefined {
  return Object.prototype.hasOwnProperty.call(SLIDER_REGISTRY, key)
    ? (SLIDER_REGISTRY as Record<string, SliderDef>)[key]
    : undefined;
}

/** The sliders shown for one type, in registry order. */
export function slidersFor(type: ObjectType): (SliderDef & { key: SliderKey })[] {
  return SLIDERS.filter((s) => s.appliesTo.includes(type));
}

/** True when `key` is a registered slider shown for `type`. */
export function sliderApplies(type: ObjectType, key: SliderKey): boolean {
  return defOf(key)?.appliesTo.includes(type) ?? false;
}

/** True when `value` may be used for `key` on a body of `type`: applies, finite, in range. */
export function isValidOverride(
  type: ObjectType,
  key: SliderKey,
  value: number | boolean | undefined,
): value is number {
  const def = defOf(key);
  if (!def || !def.appliesTo.includes(type)) return false;
  if (typeof value !== 'number') return false; // every registered slider is numeric today
  return Number.isFinite(value) && value >= def.min && value <= def.max;
}

/** The override for `key` when `isValidOverride` accepts it, else undefined (never clamped). */
export function sliderValue(
  overrides: Overrides | undefined,
  key: SliderKey,
  type: ObjectType,
): number | undefined {
  const v = overrides?.[key];
  return isValidOverride(type, key, v) ? v : undefined;
}
