// Synthetic objects for the Texture panel (issue #11): a card, render params and (for the shader
// kinds) a body like ShaderBody's, so the panel builds its sources through `buildHaptics` exactly as
// the viewer will, and shows the same refusals. Synthetic values only, never fixtures (the app
// must not import fixtures): every value says "synthetic" in its source.
// The tags are illustrative: some synthetic values are tagged `measured` (the gas giant's Teq, the
// comet's Q) only to exercise the R11 honesty path (what still plays in Measured only), though
// their `source` says they are not measurements. The panel says so on screen.
import type { HapticProfile, ObjectCard, ObjectType, RenderParams, Tag } from '@/contract';
import type { BuildHapticsOptions, HapticBody, PlanBodyLike } from '@/haptics/profiles';
import { HeightGrid } from '@/haptics/sources/heightMap';
import { FieldSampler, generateField, type FieldData } from '@/viewer/fields/fieldGenerator';
import { generateNebula, type PointSet } from '@/viewer/renderers/pointClouds';
import { resolveShaderSpec } from '@/viewer/renderers/shaderSpec';
import type { Overrides } from '@/viewer/sliders';

export const PAD_W = 256;
export const PAD_H = 128;
const SEED = 1234;
const SRC = 'synthetic test-page value, not a measurement';

export type BodyKind = 'gas' | 'water' | 'rocky' | 'asteroid' | 'comet' | 'nebula';

export const BODY_LABEL: Readonly<Record<BodyKind, string>> = {
  gas: 'Gas giant with rings (flow, Teq pulse)',
  water: 'Water world (terrain, Teq pulse)',
  rocky: 'Hot rocky world (terrain with lava cracks, Teq pulse)',
  asteroid: 'Procedural asteroid (height map)',
  comet: 'Comet coma (field)',
  nebula: 'Nebula (point density)',
};

const TYPE: Readonly<Record<BodyKind, ObjectType>> = {
  gas: 'gas_giant',
  water: 'planet_water',
  rocky: 'planet_rocky',
  asteroid: 'asteroid_procedural',
  comet: 'comet',
  nebula: 'nebula',
};

/** The haptic profiles the backend would send (R8.5, D-12). Texture tags are `artistic`. */
const PROFILE: Readonly<Record<BodyKind, Omit<HapticProfile, 'data_tag'>>> = {
  gas: { texture: 'flow', texture_tag: 'artistic', data: 'teq_pulse', params: { maxRateHz: 12 } },
  water: { texture: 'terrain', texture_tag: 'artistic', data: 'teq_pulse', params: { tau: 0.15 } },
  rocky: { texture: 'terrain', texture_tag: 'artistic', data: 'teq_pulse', params: { tau: 0.15 } },
  asteroid: { texture: 'height', texture_tag: 'artistic', data: 'none', params: { tau: 0.15 } },
  comet: { texture: 'none', texture_tag: 'artistic', data: 'field', params: { maxRateHz: 30 } },
  nebula: { texture: 'none', texture_tag: 'artistic', data: 'field', params: {} },
};

export interface ObjectChoices {
  /** Tag of the synthetic teq_K (measured = from pl_eqt, derived = A7.1). */
  teqTag: Tag;
  epoch: '2025-08' | '2025-12';
}

export interface SyntheticObject {
  card: ObjectCard;
  params: RenderParams;
  body: HapticBody | null;
  options: BuildHapticsOptions;
  /** 'map': equirectangular pad; 'face': the body seen face-on. */
  view: 'map' | 'face';
  /** Grey levels 0–1 of the pad image, per pad pixel (map view), or the face-on drawing data. */
  image:
    | { kind: 'map'; value: (c: number, r: number) => number }
    | { kind: 'points'; sets: PointSet[] }
    | { kind: 'coma'; density: number };
}

function tv(value: number, tag: Tag = 'measured') {
  return tag === 'derived'
    ? { value, tag, source: SRC, formula: 'synthetic' }
    : tag === 'model_dependent'
      ? { value, tag, source: SRC, assumption: 'synthetic' }
      : { value, tag, source: SRC };
}

/** Teq of each synthetic world (K). */
const TEQ: Readonly<Record<'gas' | 'water' | 'rocky', number>> = {
  gas: 1100,
  water: 300,
  rocky: 900,
};

export function syntheticObject(kind: BodyKind, choices: ObjectChoices): SyntheticObject {
  const type = TYPE[kind];
  const p = PROFILE[kind];
  const card: ObjectCard = { id: `synthetic:${kind}`, name: `Synthetic ${kind}`, type };
  const layerId = kind === 'nebula' ? 'point_cloud' : 'surface';
  const params = {
    id: card.id,
    type,
    generator_version: 'test-page',
    seed: SEED,
    scale_m: 1e7,
    layers: [{ id: layerId, tag: 'artistic', description: SRC, requires: [] }],
    lighting: { mode: 'sun', sun_dir: [1, 0, 0] },
    view_modes: {
      visible: { available: false, badge: 'synthetic', rgb: null, source: 'class_palette' },
    },
    haptics: {
      ...p,
      // The comet field's tag waits on Q-17; the backend fixture uses model_dependent.
      data_tag: kind === 'comet' ? 'model_dependent' : 'artistic',
    },
    alt_text: SRC,
    missing: [],
  } as RenderParams;

  const overrides: Overrides = kind === 'gas' ? { rings: 0.8 } : {};
  const options: BuildHapticsOptions = { overrides };

  if (kind === 'gas' || kind === 'water' || kind === 'rocky') {
    card.radius_rjup = tv(1);
    card.teq_K = tv(TEQ[kind], choices.teqTag);
    const spec = resolveShaderSpec(card, params, overrides);
    const data = generateField(spec.field!, PAD_W, PAD_H);
    const texel = (f: FieldData, c: number, r: number, ch: number, b = false) =>
      (b ? f.b : f.a)[(r * f.width + c) * 4 + ch]!;
    const value =
      kind === 'gas'
        ? (c: number, r: number) =>
            0.2 + 0.6 * texel(data, c, r, 0) + (texel(data, c, r, 2) > 0 ? 0.2 : 0)
        : (c: number, r: number) =>
            texel(data, c, r, 1, true) >= 0.5
              ? 0.95
              : texel(data, c, r, 0, true) >= 0.5
                ? 0.15
                : texel(data, c, r, 2, true) >= 0.5
                  ? 1
                  : 0.3 + 0.6 * texel(data, c, r, 0);
    return {
      card,
      params,
      body: { field: new FieldSampler(data), pointSets: null, worldToBody: (q) => q },
      options,
      view: 'map',
      image: { kind: 'map', value },
    };
  }
  if (kind === 'asteroid') {
    card.diameter_km = tv(1);
    // A synthetic relief: the terrain function's height, as a baked height map would hold it.
    const data = generateField(
      {
        kind: 'terrain',
        seed: SEED,
        freq: 3,
        seaLevel: 0,
        iceExtent: 0,
        heat: 0,
        bands: 0,
        turbulence: 0,
        storms: 0,
      },
      PAD_W,
      PAD_H,
    );
    const heights = new Float32Array(PAD_W * PAD_H);
    for (let i = 0; i < heights.length; i++) heights[i] = data.a[i * 4]!;
    const grid = new HeightGrid(PAD_W, PAD_H, heights);
    return {
      card,
      params,
      body: null,
      options: { ...options, heightGrid: grid },
      view: 'map',
      image: { kind: 'map', value: (c, r) => grid.texel(c, r) },
    };
  }
  if (kind === 'comet') {
    // December denser than August (R8.4 item 3).
    (card as { gas_Q: unknown }).gas_Q = {
      '2025-08': { co2: tv(2.5e25), h2o: tv(1e25) },
      '2025-12': { co2: tv(1e26), h2o: tv(5e25), co: tv(2e25) },
    };
    card.epochs = ['2025-08', '2025-12'];
    const nucleus: PlanBodyLike[] = [{ id: 'nucleus', axes: [0.04, 0.04, 0.04] }];
    return {
      card,
      params,
      body: null,
      options: { ...options, epoch: choices.epoch, gas: 'co2', planBodies: nucleus },
      view: 'face',
      image: { kind: 'coma', density: choices.epoch === '2025-12' ? 1 : 0.25 },
    };
  }
  card.diameter_km = tv(1e9, 'artistic');
  const points = generateNebula(SEED);
  const sets = { glow: points.glow, dust: points.dust, stars: points.stars };
  return {
    card,
    params,
    body: { field: null, pointSets: sets, worldToBody: (q) => q },
    options,
    view: 'face',
    image: { kind: 'points', sets: Object.values(sets) },
  };
}
