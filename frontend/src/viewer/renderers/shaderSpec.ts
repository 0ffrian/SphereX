// R7.7, D-01, D-12, D-26: pure mapping from ObjectCard + RenderParams (+ slider overrides) to what
// the shader kinds draw. No three.js here, so refusal and defaults are unit-testable.
//
// Honesty: every surface layer of these kinds is `artistic` (R7.7). Missing data refuses the layer:
// it is not drawn and its id goes in `missing` (R1 principle 3). Nothing is invented.
import type { ObjectCard, ObjectType, RenderParams, Tag } from '@/contract';
import type { FieldParams } from '../fields/fieldGenerator';
import { FIELD_TAG } from '../fields/fieldGenerator';
import { sliderValue, type Overrides } from '../sliders';
import {
  ATMOSPHERE_ROCKY,
  ATMOSPHERE_WATER,
  DEFAULT_PALETTE_T_K,
  GASK,
  GLOW_ABOVE_K,
  keyed,
  lavaHeatFromTeq,
  type Palette4,
  type Rgb,
} from './shaderPalette';

export const SHADER_KINDS = [
  'planet_rocky',
  'planet_water',
  'gas_giant',
  'nebula',
  'nova',
] as const satisfies readonly ObjectType[];
export type ShaderKind = (typeof SHADER_KINDS)[number];

/** Planets and gas giants keep a plain sphere when the surface is hidden; nebulae and novae do not. */
export function kindHasPlainSphere(kind: ShaderKind): boolean {
  return kind !== 'nebula' && kind !== 'nova';
}

/** The card field that holds the body's size (Q-33): the radius of a world, the extent of a cloud. */
export function sizeFieldFor(kind: ShaderKind): 'radius_rjup' | 'diameter_km' {
  return kindHasPlainSphere(kind) ? 'radius_rjup' : 'diameter_km';
}

// ASSUMPTION: camera distances frame each body; mock-up used 4.4 (worlds), 7.2 (gas), 5.4 / 5.
const DISTANCE = { world: 4, gasNoRings: 4, gasRings: 7.2, nebula: 5.4, nova: 5 } as const;

/** Camera distance that frames the body (display value). */
export function shaderDistance(spec: Pick<ShaderSpec, 'kind' | 'gas'>): number {
  if (spec.kind === 'nebula') return DISTANCE.nebula;
  if (spec.kind === 'nova') return DISTANCE.nova;
  if (spec.kind === 'gas_giant')
    return (spec.gas?.rings ?? 0) > 0.01 ? DISTANCE.gasRings : DISTANCE.gasNoRings;
  return DISTANCE.world;
}

export function isShaderKind(t: ObjectType): t is ShaderKind {
  return (SHADER_KINDS as readonly string[]).includes(t);
}

// ASSUMPTION: defaults below are the mock-up's final-state slider values (artistic, not physical).
const PLANET_DEFAULTS = {
  planet_rocky: { freq: 1.6, sea: 0, ice: 0, heat: 0, relief: 0.081, cloud: 0.2, atmo: 0.85 },
  planet_water: { freq: 2, sea: 0.4, ice: 0.22, heat: 0, relief: 0.054, cloud: 0.7, atmo: 0.85 },
} as const;
const GAS_DEFAULTS = { bands: 12, turbulence: 0.5, storms: 5, rings: 0 } as const;

export interface PlanetStyle {
  /** 0 = rocky brown, 1 = green / grey mix (mock-up uHue). */
  hue: number;
  relief: number;
  cloudCover: number;
  atmosphere: number;
  atmosphereColour: Rgb;
}

export interface GasStyle {
  palette: Palette4;
  /** Where the palette came from: the card's teq_K, or the artist default (teq_K unknown). */
  paletteSource: 'teq_K' | 'artist_default';
  paletteTemperatureK: number;
  glow: number;
  rings: number;
}

export interface ShaderSpec {
  kind: ShaderKind;
  seed: number;
  /** 'surface' for planets and gas giants, 'point_cloud' for nebula and nova. */
  layerId: 'surface' | 'point_cloud';
  /** R7.7: always `artistic`. */
  tag: Extract<Tag, 'artistic'>;
  /** False when the layer was refused. */
  drawable: boolean;
  /** Refused layer ids plus the ids RenderParams already lists as missing. */
  missing: string[];
  field: FieldParams | null;
  planet: PlanetStyle | null;
  gas: GasStyle | null;
}

type CardNumberField = keyof ObjectCard;

function cardValue(card: ObjectCard, field: string): number | null {
  const v = (card as unknown as Record<string, { value?: unknown } | undefined>)[field];
  return typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : null;
}

/** Fields a body of this kind cannot be drawn without. */
const REQUIRED_CARD_FIELD: Record<ShaderKind, CardNumberField> = {
  planet_rocky: 'radius_rjup',
  planet_water: 'radius_rjup',
  gas_giant: 'radius_rjup',
  nebula: 'diameter_km',
  nova: 'diameter_km',
};

/**
 * Throws if the card and params are not for the same shader kind (a caller bug); otherwise never
 * throws: missing data comes back as `drawable: false` with the layer id in `missing`.
 */
export function resolveShaderSpec(
  card: ObjectCard,
  params: RenderParams,
  overrides?: Overrides,
): ShaderSpec {
  const kind = params.type;
  if (!isShaderKind(kind) || card.type !== kind) {
    throw new TypeError(`ShaderBody: not a shader kind pair (card ${card.type}, params ${kind})`);
  }
  const layerId = kind === 'nebula' || kind === 'nova' ? 'point_cloud' : 'surface';
  const missing = new Set(params.missing);

  const layer = params.layers.find((l) => l.id === layerId);
  // A layer the backend lists as missing is refused, as the plan does (planCommon `draw`).
  let drawable = layer !== undefined && !params.missing.includes(layerId);
  if (layer) {
    for (const req of layer.requires) if (cardValue(card, req) === null) drawable = false;
  }
  if (cardValue(card, REQUIRED_CARD_FIELD[kind]) === null) drawable = false;
  // Q-33: an unknown size means the body is refused, never guessed.
  if (params.scale_m === null || !(params.scale_m > 0)) drawable = false;
  if (!drawable) missing.add(layerId);

  const base = { kind, seed: params.seed, layerId, tag: FIELD_TAG, drawable } as const;
  const out = (extra: Partial<ShaderSpec>): ShaderSpec => ({
    ...base,
    missing: [...missing],
    field: null,
    planet: null,
    gas: null,
    ...extra,
  });

  if (kind === 'nebula' || kind === 'nova') return out({});

  const sv = (key: Parameters<typeof sliderValue>[1]) => sliderValue(overrides, key, kind);

  if (kind === 'gas_giant') {
    const teq = cardValue(card, 'teq_K');
    const T = teq ?? DEFAULT_PALETTE_T_K;
    return out({
      field: {
        kind: 'gas',
        seed: params.seed,
        freq: 0,
        seaLevel: 0,
        iceExtent: 0,
        heat: 0,
        bands: sv('bands') ?? GAS_DEFAULTS.bands,
        turbulence: sv('turbulence') ?? GAS_DEFAULTS.turbulence,
        storms: sv('storms') ?? GAS_DEFAULTS.storms,
      },
      gas: {
        palette: keyed(GASK, T),
        paletteSource: teq === null ? 'artist_default' : 'teq_K',
        paletteTemperatureK: T,
        glow: T > GLOW_ABOVE_K ? 0.3 : 0,
        rings: sv('rings') ?? GAS_DEFAULTS.rings,
      },
    });
  }

  const d = PLANET_DEFAULTS[kind];
  // N9: lava cracks glow only when teq_K says the surface is hot (>= ~700 K, A7.1). No teq_K, no
  // glow. A slider override still wins: it is the visitor's own artistic choice (D-26).
  const heat = kind === 'planet_rocky' ? lavaHeatFromTeq(cardValue(card, 'teq_K')) : d.heat;
  return out({
    field: {
      kind: 'terrain',
      seed: params.seed,
      freq: d.freq,
      seaLevel: sv('sea_level') ?? d.sea,
      iceExtent: sv('ice') ?? d.ice,
      heat: sv('lava_heat') ?? heat,
      bands: 0,
      turbulence: 0,
      storms: 0,
    },
    planet: {
      hue: kind === 'planet_water' ? 0.5 : 0.2,
      relief: sv('relief') ?? d.relief,
      cloudCover: sv('cloud_cover') ?? d.cloud,
      atmosphere: sv('atmosphere') ?? d.atmo,
      atmosphereColour: kind === 'planet_water' ? ATMOSPHERE_WATER : ATMOSPHERE_ROCKY,
    },
  });
}
