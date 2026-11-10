// Issue #71 stream H (D-36, Q-270, Q-271): what the Surface view (orbit view) reads from the
// renderer that draws the globe. RockyWorld (stream D) and GasWorld (stream E) each expose a
// public readonly `orbitSources` getter; the adapters here map whatever they expose onto
// `OrbitSources` and say which layers cannot be drawn. A missing field refuses its layer: the
// layer is not drawn and its id goes into `missing` (never invented, never a crash).
//
// The adapters take STRUCTURAL inputs (`RockyOrbitInput`, `GasOrbitInput`) so this module does not
// import either renderer: the two streams merge independently. Field names are listed in
// docs/rendering/ (R7.9, "Surface view") and in the stream H report.
//
// World UV (all textures): u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5, row 0 = south.
import type { DataTexture, Texture } from 'three/webgpu';
import type { Tag } from '@/contract';
import { srgbToLinear } from '../renderers/linearColour';
import { HEIGHT_EXAGGERATION, type HeightGrid, type OrbitKind } from './orbitMath';

export type Rgb = readonly [number, number, number];

/** The environmental lapse rate is 0.66 of the dry adiabat (about 6.5 K/km against 9.8; US Standard Atmosphere 1976). */
export const ENV_LAPSE_FACTOR = 0.66;
/** The visible optical depth of the air from the surface pressure in bar (prototype; artistic fit). */
export function airOpticalDepth(pressureBar: number): number {
  return Math.min(3, 0.55 + 0.7 * Math.log10(pressureBar + 1));
}
/** The gas giant's visible optical depth above the cloud deck (prototype constant, artistic). */
export const GAS_TAU = 0.06;
/** A world hotter than this has dark rock (prototype: lava and hot rock, artistic). */
export const HOT_ROCK_K = 700;
export const HOT_ROCK_COLOUR: Rgb = [0.15, 0.12, 0.11];

export interface FluidLook {
  liq: Rgb;
  ice: Rgb;
  cld: Rgb;
  land: Rgb;
  /** Absorption of light in the liquid per km of depth, RGB (artistic). */
  aw: Rgb;
}

/**
 * Colours per fluid: the prototype's table (linear, artistic), the same numbers as stream D's
 * `FLUIDS`. ASSUMPTION: D's `Fluid` has no absorption `aw`, so it is kept here; when D exposes a
 * `palette` in `orbitSources` that one is used instead.
 */
export const FLUID_LOOK: Readonly<Record<string, FluidLook>> = {
  water: { liq: [0.012, 0.05, 0.13], ice: [0.82, 0.88, 0.96], cld: [1, 1, 1], land: [0.34, 0.27, 0.2], aw: [0.34, 0.056, 0.012] },
  methane: { liq: [0.03, 0.022, 0.014], ice: [0.72, 0.68, 0.58], cld: [0.95, 0.9, 0.76], land: [0.3, 0.18, 0.09], aw: [0.08, 0.02, 0.01] },
  ammonia: { liq: [0.06, 0.09, 0.13], ice: [0.9, 0.9, 0.84], cld: [1, 0.96, 0.84], land: [0.33, 0.29, 0.25], aw: [0.1, 0.1, 0.1] },
  nitrogen: { liq: [0.05, 0.06, 0.09], ice: [0.88, 0.82, 0.74], cld: [0.9, 0.9, 0.93], land: [0.36, 0.3, 0.26], aw: [0.1, 0.1, 0.1] },
  co2: { liq: [0.08, 0.09, 0.12], ice: [0.9, 0.9, 0.93], cld: [0.98, 0.98, 0.94], land: [0.42, 0.28, 0.18], aw: [0.1, 0.1, 0.1] },
};

/** Default haze colour (prototype: orange-brown haze; the runaway-greenhouse white is the renderer's to send). */
export const DEFAULT_HAZE_COLOUR: Rgb = [0.74, 0.46, 0.16];

export interface GasPalette {
  /** Zone, belt, storm, deep and polar colours, linear. */
  z: Rgb;
  b: Rgb;
  s: Rgb;
  d: Rgb;
  p: Rgb;
}

/** What the orbit pass reads. Textures are the ones the globe shader samples. */
export interface OrbitSources {
  kind: OrbitKind;
  seed: number;
  /** Planet radius, km. Required: without it the orbit view is refused. */
  radiusKm: number;
  /** Atmosphere scale height, km (derived: R T / (mu g)). Null refuses the atmosphere layer. */
  scaleHeightKm: number | null;
  /** Surface pressure, bar (rocky). Null refuses the atmosphere layer of a rocky world. */
  pressureBar: number | null;
  /** Haze 0..1 and its colour. */
  haze: number;
  hazeColour: Rgb;

  // ---- rocky ----
  /** Float RGBA, R = height (model km, sea level 0). Null refuses the surface. */
  height: DataTexture | null;
  /** CPU copy of the heights, for the camera's ground height and the peak search. */
  heightGrid: HeightGrid | null;
  /** Float RGBA, R = temperature K, G = sea-ice thickness, B = frost, A = relative humidity. */
  climate: DataTexture | null;
  /** RGBA8 (stream D): R = river or lake water, G = salt flat, B = sediment plume, A = frozen. Null (no ocean basin or no air) refuses rivers, lakes, salt. */
  hydrology: DataTexture | null;
  /** Live cloud tracer, R = cloud amount, G = detail (D's render target, read each frame; null: clouds follow the climate humidity). */
  cloudBase: (() => Texture | null) | null;
  cloudCover: number | null;
  hasOcean: boolean;
  /** Environmental lapse rate, K per km (already 0.66 of the dry rate). Null refuses snow from temperature. */
  lapseKPerKm: number | null;
  fluid: { id: string; tripleK: number; boilK: number | null } | null;
  look: FluidLook | null;
  /** Mean surface temperature, K, when the renderer knows it (dark rock above HOT_ROCK_K). */
  surfaceTempK: number | null;

  // ---- gas ----
  /** Solver velocity field RGBA (x = longitude rate, y = latitude rate). Null refuses the eddies. */
  velocity: Texture | null;
  /** 1 x N band profile (b = belt turbulence, a = polar). Null refuses the deck. */
  bands: Texture | null;
  /** The live cloud tracer (R brightness, G chroma, B noise, A storm). It swaps buffers, so it is read each frame. */
  tracer: (() => Texture | null) | null;
  gasPalette: GasPalette | null;
}

export interface OrbitLayer {
  id: string;
  label: string;
  tag: Tag;
  /** Required for `derived`. */
  formula?: string;
  /** Required for `model_dependent`. */
  assumption?: string;
  /** Shown in the UI as the one-line reason. */
  note: string;
}

export interface OrbitLayerStatus extends OrbitLayer {
  drawn: boolean;
}

export const ORBIT_LAYERS: readonly OrbitLayer[] = [
  {
    id: 'orbit.height',
    label: 'Mountains and valleys',
    tag: 'artistic',
    note: 'The height map of the globe, drawn 3 times taller than scale so relief reads from the ground (2 times for clouds of a gas giant). Fine detail and gullies are added for looks.',
  },
  {
    id: 'orbit.detail',
    label: 'Eroded fine detail and gullies',
    tag: 'artistic',
    note: 'Detail finer than the height map is invented for looks and fades out where a pixel is bigger than it.',
  },
  {
    id: 'orbit.ocean',
    label: 'Ocean and sunglint',
    tag: 'model_dependent',
    assumption: 'Sea level comes from the plate model; water is shown only where the fluid is liquid at the modelled temperature.',
    note: 'Sea level and sea ice come from the planet model; the glint is how light would reflect.',
  },
  {
    id: 'orbit.snow',
    label: 'Snow and frost',
    tag: 'model_dependent',
    assumption: 'Temperature from the climate model, cooled with height by 0.66 times the dry lapse rate.',
    note: 'Snow where the model is cold, more of it higher up.',
  },
  {
    id: 'orbit.hydrology',
    label: 'Rivers, lakes and salt',
    tag: 'model_dependent',
    assumption: 'Drainage from the terrain and the climate budget.',
    note: 'Rivers, lakes and salt flats from the planet model.',
  },
  {
    id: 'orbit.atmosphere',
    label: 'Air, haze and sky',
    tag: 'derived',
    formula: 'single scattering through an exponential atmosphere, scale height H = R T / (mu g), air mass capped at sqrt(pi R / 2 H)',
    note: 'The thickness of the air follows the model scale height and pressure.',
  },
  {
    id: 'orbit.clouds',
    label: 'Cloud deck',
    tag: 'artistic',
    note: 'One cloud deck about 3 km up (drawn 3 times taller), lit by its own slope and shading the ground. Where the planet model gives humidity the clouds follow it.',
  },
  {
    id: 'orbit.gas',
    label: 'Cloud tops of the gas giant',
    tag: 'model_dependent',
    assumption: 'The cloud tracer carried by the solved winds (D-36); same model as the globe.',
    note: 'The large clouds are the solved flow, the same as on the globe.',
  },
  {
    id: 'orbit.eddies',
    label: 'Small eddies',
    tag: 'artistic',
    note: 'Below the solver grid (about 280 km) the clouds are stretched along the winds and curled by noise, for looks.',
  },
];

const LAYER_BY_ID = new Map(ORBIT_LAYERS.map((l) => [l.id, l]));

export const ORBIT_NOTE =
  'Left: the world from orbit. Scroll on it to go down to the clouds and mountains or back up, drag it to look around, use the arrow keys or Fly forward to move, and click the globe on the right to look at that place.';

export interface OrbitResolved {
  sources: OrbitSources | null;
  layers: OrbitLayerStatus[];
  /** Ids of the layers that cannot be drawn. */
  missing: string[];
  /** Why the whole view is refused, or null. */
  refusal: string | null;
}

// ---- the structural inputs the two renderers expose ---------------------------------------------

type TexLike = DataTexture;

/** What stream D's `RockyWorld` exposes (`ShaderBody.orbitSources`), plus the fields stream H asks it to add. */
export interface RockyOrbitInput {
  terrainTexture?: TexLike | null;
  climateTexture?: TexLike | null;
  /** Terrain grid, 2 floats per texel (height, boundary signal). */
  terrain?: { W: number; H: number; data: Float32Array } | null;
  radiusKm?: number | null;
  /** Dry lapse rate, K per km. */
  lapseKPerKm?: number | null;
  fluid?: { id: string; tripleK: number; boilK: number | null } | null;
  cloudCover?: number | null;
  seed?: number;
  hasOcean?: boolean;
  haze?: number;
  hydrologyTexture?: TexLike | null;
  /** A getter on D's object: the latest render-target texture. */
  cloudTracerTexture?: Texture | null;
  // Asked of stream D (ASSUMPTION: names). Without them the atmosphere layer is refused.
  scaleHeightKm?: number | null;
  pressureBar?: number | null;
  hazeColour?: Rgb | null;
  surfaceTempK?: number | null;
  palette?: Partial<Record<'liq' | 'ice' | 'cld' | 'land' | 'aw', readonly number[]>> | null;
}

/** What stream E's `GasWorld.orbitSources` (`GasOrbitSources`) exposes. */
export interface GasOrbitInput {
  radiusKm?: number | null;
  seed?: number;
  scaleHeightKm?: number | null;
  haze?: number;
  hazeColour?: Rgb | null;
  /** R/G winds, B vorticity, A storm code. */
  velocity?: Texture | null;
  /** 1 x 512: R brightness, G chromophore, B turbulence, A polar. */
  bands?: Texture | null;
  /** The tracer render target swaps after every pass: a texture (read the getter each frame) or a function. Null before the first pass. */
  tracer?: Texture | (() => Texture | null) | null;
  /** sRGB display colours. */
  palette?: Readonly<Record<'z' | 'b' | 's' | 'd' | 'p', readonly number[]>> | null;
  /** False while the planet is still forming (hidden settling): show the "forming" state. */
  ready?: boolean;
}

export function isGasInput(x: unknown): x is GasOrbitInput {
  return typeof x === 'object' && x !== null && ('velocity' in x || 'bands' in x || 'tracer' in x) && !('terrainTexture' in x);
}

export function isRockyInput(x: unknown): x is RockyOrbitInput {
  return typeof x === 'object' && x !== null && ('terrainTexture' in x || 'climateTexture' in x);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;

function rgbOrNull(c: unknown): Rgb | null {
  return Array.isArray(c) && c.length === 3 && c.every(finite) ? ([c[0], c[1], c[2]] as Rgb) : null;
}

function statuses(missing: ReadonlySet<string>, kind: OrbitKind): OrbitLayerStatus[] {
  const ids =
    kind === 'rocky'
      ? ['orbit.height', 'orbit.detail', 'orbit.ocean', 'orbit.snow', 'orbit.hydrology', 'orbit.atmosphere', 'orbit.clouds']
      : ['orbit.gas', 'orbit.eddies', 'orbit.atmosphere'];
  return ids.map((id) => ({ ...LAYER_BY_ID.get(id)!, drawn: !missing.has(id) }));
}

const EMPTY: OrbitSources = {
  kind: 'rocky',
  seed: 0,
  radiusKm: 0,
  scaleHeightKm: null,
  pressureBar: null,
  haze: 0,
  hazeColour: DEFAULT_HAZE_COLOUR,
  height: null,
  heightGrid: null,
  climate: null,
  hydrology: null,
  cloudBase: null,
  cloudCover: null,
  hasOcean: false,
  lapseKPerKm: null,
  fluid: null,
  look: null,
  surfaceTempK: null,
  velocity: null,
  bands: null,
  tracer: null,
  gasPalette: null,
};

/** The orbit sources of a rocky world, with the layers that cannot be drawn. */
export function rockyOrbitSources(input: RockyOrbitInput | null | undefined): OrbitResolved {
  const missing = new Set<string>();
  if (!input) return refuse('rocky', 'This object has no surface to fly over yet.');
  if (!positive(input.radiusKm)) return refuse('rocky', 'The planet radius is not known, so the surface view cannot be sized.');
  if (!input.terrainTexture || !input.terrain) {
    return refuse('rocky', 'The height map is not available, so the surface view cannot be drawn.');
  }
  const fluidId = input.fluid?.id ?? '';
  const baseLook = FLUID_LOOK[fluidId] ?? null;
  const look: FluidLook | null = baseLook
    ? ({ ...baseLook, ...(input.palette ?? {}) } as FluidLook)
    : input.palette && input.palette.liq && input.palette.ice && input.palette.cld && input.palette.land
      ? ({ aw: [0.1, 0.1, 0.1], ...input.palette } as FluidLook)
      : null;
  if (!look) {
    return refuse('rocky', 'The colours of the ground are not known, so the surface view cannot be drawn.');
  }
  const climate = input.climateTexture ?? null;
  if (!climate || !positive(input.lapseKPerKm) || !input.fluid) missing.add('orbit.snow');
  if (!input.hasOcean || !climate || !input.fluid) missing.add('orbit.ocean');
  const hydrology = input.hydrologyTexture ?? null;
  if (!hydrology) missing.add('orbit.hydrology');
  const scaleHeight = positive(input.scaleHeightKm) ? input.scaleHeightKm : null;
  const pressure = positive(input.pressureBar) ? input.pressureBar : null;
  if (scaleHeight === null || pressure === null) missing.add('orbit.atmosphere');
  const cloudBase: (() => Texture | null) | null = input.cloudTracerTexture ? () => input.cloudTracerTexture ?? null : null;
  const cover = finite(input.cloudCover) ? input.cloudCover : null;
  if (cover === null || (!cloudBase && !climate)) missing.add('orbit.clouds');
  const t = input.terrain;
  const sources: OrbitSources = {
    ...EMPTY,
    kind: 'rocky',
    seed: input.seed ?? 0,
    radiusKm: input.radiusKm,
    scaleHeightKm: scaleHeight,
    pressureBar: pressure,
    haze: finite(input.haze) ? input.haze : 0,
    hazeColour: rgbOrNull(input.hazeColour) ?? DEFAULT_HAZE_COLOUR,
    height: input.terrainTexture,
    heightGrid: { width: t.W, height: t.H, data: t.data, stride: 2 },
    climate,
    hydrology,
    cloudBase,
    cloudCover: cover,
    hasOcean: input.hasOcean === true && missing.has('orbit.ocean') === false,
    lapseKPerKm: positive(input.lapseKPerKm) ? input.lapseKPerKm * ENV_LAPSE_FACTOR : null,
    fluid: input.fluid ?? null,
    look,
    surfaceTempK: finite(input.surfaceTempK) ? input.surfaceTempK : null,
  };
  return { sources, layers: statuses(missing, 'rocky'), missing: [...missing], refusal: null };
}

/** The orbit sources of a gas giant, with the layers that cannot be drawn. */
export function gasOrbitSources(
  input: GasOrbitInput | null | undefined,
  /** Re-reads the live getter (the tracer swaps buffers each pass). */
  live?: () => GasOrbitInput | null | undefined,
): OrbitResolved {
  const missing = new Set<string>();
  if (!input) return refuse('gas', 'This object has no cloud deck to fly over yet.');
  if (!positive(input.radiusKm)) return refuse('gas', 'The planet radius is not known, so the surface view cannot be sized.');
  if (input.ready === false) return refuse('gas', 'The planet is still forming. The surface view opens when it has settled.');
  if (!input.bands || !input.palette || input.tracer === undefined) {
    return refuse('gas', 'The flow of the clouds is not available, so the surface view cannot be drawn.');
  }
  const asTex = (t: GasOrbitInput['tracer']): Texture | null => (typeof t === 'function' ? t() : (t ?? null));
  const tracerFn: () => Texture | null =
    typeof input.tracer === 'function' ? input.tracer : live ? () => asTex(live()?.tracer) : () => asTex(input.tracer);
  if (!input.velocity) missing.add('orbit.eddies');
  const scaleHeight = positive(input.scaleHeightKm) ? input.scaleHeightKm : null;
  if (scaleHeight === null) missing.add('orbit.atmosphere');
  const p = input.palette;
  const lin = (c: readonly number[]): Rgb => srgbToLinear([c[0]!, c[1]!, c[2]!]);
  const sources: OrbitSources = {
    ...EMPTY,
    kind: 'gas',
    seed: input.seed ?? 0,
    radiusKm: input.radiusKm,
    scaleHeightKm: scaleHeight,
    haze: finite(input.haze) ? input.haze : 0,
    hazeColour: rgbOrNull(input.hazeColour) ?? DEFAULT_HAZE_COLOUR,
    velocity: input.velocity ?? null,
    bands: input.bands,
    tracer: tracerFn,
    gasPalette: { z: lin(p.z), b: lin(p.b), s: lin(p.s), d: lin(p.d), p: lin(p.p) },
  };
  return { sources, layers: statuses(missing, 'gas'), missing: [...missing], refusal: null };
}

function refuse(kind: OrbitKind, why: string): OrbitResolved {
  const all = statuses(new Set(ORBIT_LAYERS.map((l) => l.id)), kind);
  return { sources: null, layers: all, missing: all.map((l) => l.id), refusal: why };
}

/**
 * What a built body exposes as `orbitSources` (any shape) to the orbit sources and the layer list.
 * Null input (no body, or a body that exposes nothing): the view is refused with a plain message.
 */
export function resolveOrbitSources(exposed: unknown, live?: () => unknown): OrbitResolved {
  if (isGasInput(exposed)) return gasOrbitSources(exposed, live as never);
  if (isRockyInput(exposed)) return rockyOrbitSources(exposed);
  return refuse('rocky', 'This object has no surface view.');
}

/** Exaggeration used by the camera and the shader. */
export function exaggerationOf(kind: OrbitKind): number {
  return HEIGHT_EXAGGERATION[kind];
}
