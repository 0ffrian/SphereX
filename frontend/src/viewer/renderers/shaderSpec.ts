// R7.7, D-01, D-12, D-26: pure mapping from ObjectCard + RenderParams (+ slider overrides) to what
// the shader kinds draw. No three.js here, so refusal and defaults are unit-testable.
//
// Honesty: every surface layer of these kinds is `artistic` (R7.7). Missing data refuses the layer:
// it is not drawn and its id goes in `missing` (R1 principle 3). Nothing is invented.
import type { ObjectCard, ObjectType, RenderParams, Tag, Tier } from '@/contract';
import {
  bandCount,
  flattening as spinFlattening,
  mearthToKg,
  spinRateRadS,
} from '@/physics/gasGiants';
import { OCEANS_REMOVED_ABOVE_K, POLAR_ICE_BELOW_K } from '@/physics/planets';
import { deriveClimate, type ClimateDerivation, type Scenario } from '@/physics/climate';
import { isExoplanetCard, type PlanetCard } from '@/physics/cardFields';
import { R_JUP_M } from '@/physics/constants';
import { STILL_MOTION, TIER_OF_TAG, weakestTag, type Motion } from '../motion/motion';
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

/**
 * Issue #62, D-32: a gas giant's surface is five layers, one per rung of the tier chain, so the
 * honesty toggle (D-21) can show each at its own level: `bands`, `flattening`, `colour` and `storms`
 * from "+ Estimated", `turbulence` only with "+ Artistic". The backend offers them (stage 7).
 */
export const GAS_LAYER_IDS = ['bands', 'flattening', 'colour', 'storms', 'turbulence'] as const;
export type GasLayerId = (typeof GAS_LAYER_IDS)[number];
/** Which gas layers are drawn. Every key is a layer id of `GAS_LAYER_IDS`. */
export type GasSwitches = Readonly<Record<GasLayerId, boolean>>;
export const NO_GAS_LAYERS: GasSwitches = {
  bands: false,
  flattening: false,
  colour: false,
  storms: false,
  turbulence: false,
};

/**
 * What a gas giant that is hidden at "Measured only" says (PR #63 review): the bands and flattening
 * are Estimated (shown with + Estimated); the storms and swirls are the artist's (+ Artistic). The
 * colour is Estimated only when the backend's `colour` layer is (a `teq_K` on the card); with no
 * temperature it is the artist's default and is said to be (PR #63 approval nit).
 */
export function gasHiddenText(params: Pick<RenderParams, 'layers'>): string {
  const colour = params.layers.find((l) => l.id === 'colour');
  return colour && colour.tag !== 'artistic'
    ? "The bands, flattening and colour are estimated from rules and typical values and are hidden at this level; choose + Estimated to see them. The storms and swirls are an artist's impression, shown with + Artistic."
    : "The bands and flattening are estimated from rules and typical values and are hidden at this level; choose + Estimated to see them. The colour, storms and swirls are an artist's impression, shown with + Artistic.";
}

export function isShaderKind(t: ObjectType): t is ShaderKind {
  return (SHADER_KINDS as readonly string[]).includes(t);
}

// ASSUMPTION: defaults below are the mock-up's final-state slider values (artistic, not physical).
const PLANET_DEFAULTS = {
  planet_rocky: { freq: 1.6, sea: 0, ice: 0, heat: 0, relief: 0.081, cloud: 0.2, atmo: 0.85 },
  planet_water: { freq: 2, sea: 0.58, ice: 0.22, heat: 0, relief: 0.054, cloud: 0.7, atmo: 0.85 },
} as const;
export const GAS_DEFAULTS = { bands: 12, turbulence: 0.5, storms: 5, rings: 0 } as const;

/**
 * Typical values of a giant planet that stand in for a spin or a jet speed the card does not have
 * (D-32 tier 4, always stated in `assumed`). Twins of `TYPICAL_SPIN_H`, `TYPICAL_ZONAL_WIND_MS`
 * in `backend/app/core/render/gas_giant.py`. The spin is Jupiter's (verified, see `JUPITER_SPIN_H`)
 * used as a class-typical value; the wind is the 50 m/s that A7.2 uses as its Jupiter example and is
 * [verify]: no source uses it in the Rhines estimate (Q-119). `null` would refuse the rule.
 */
export const TYPICAL_GAS_SPIN_H: number | null = 9.925;
export const TYPICAL_GAS_WIND_MS: number | null = 50;

/**
 * A choice that came from a rule or an analogue, with where it came from (D-32, R3.4). The look of
 * a generated surface is `artistic` (R7.7); this says what set a number inside it, so the legend
 * and the "how it is made" text can name the tier of the rule. Never stronger than its inputs.
 */
export interface RuleChoice {
  value: number;
  tag: Tag;
  tier: Tier;
  formula?: string;
  assumed?: Record<string, number | string>;
  /** Plain-words source for the text. */
  basis: string;
}

/**
 * Jupiter, the analogue for gas-giant flattening and spin. Verified (Q-119): 9.92492 h System III,
 * rounded, and 1 - 66854/71492 from the 1-bar radii (NASA Jupiter Fact Sheet; IAU WGCCRE 2015,
 * doi:10.1007/s10569-017-9805-5). Q-110: checked, so they may sit at tier 3 as named assumptions.
 */
export const JUPITER_FLATTENING = 0.06487;
export const JUPITER_SPIN_H = 9.925;
/**
 * Largest flattening drawn. The rule `f = 0.7 q` is a rule of thumb calibrated on Jupiter and
 * Saturn (A7.2) and breaks down near break-up spin, so the drawn value is capped. A display limit,
 * artistic, [verify].
 */
export const FLATTENING_MAX = 0.15;
/** Bounds of the drawn band count (the `bands` slider range, sliders.ts). */
export const BANDS_MIN = 3;
export const BANDS_MAX = 24;

export interface PlanetStyle {
  /** 0 = rocky brown, 1 = green / grey mix (mock-up uHue). */
  hue: number;
  relief: number;
  cloudCover: number;
  atmosphere: number;
  atmosphereColour: Rgb;
  /** Teq thresholds of A7.1 that set ice and ocean (null: no teq_K on the card, defaults drawn). */
  climate: RuleChoice | null;
  /**
   * Issue #68 Part 3: the climate scenario, or null when the card has no host-star fields or no
   * `teq_K` (solar-system bodies and old cards: the polar-ice rule, unchanged).
   */
  scenario: Scenario | null;
  /**
   * Tag of the climate pattern (the ocean and ice masks of a locked planet) when it can be drawn on
   * its own, without the artistic terrain: set for `eyeball` and `snowball`, else null.
   */
  patternTag: Tag | null;
}

export interface GasStyle {
  palette: Palette4;
  /** Where the palette came from: the card's teq_K, or the artist default (teq_K unknown). */
  paletteSource: 'teq_K' | 'artist_default';
  paletteTemperatureK: number;
  glow: number;
  rings: number;
  /** Where the band count came from: the Rhines rule (A7.2), or null for a slider / the artist default. */
  bandsRule: RuleChoice | null;
  /** Flattening `f` of the drawn sphere (0 = round) and what set it. */
  flattening: number;
  flatteningRule: RuleChoice | null;
}

export interface ShaderSpec {
  kind: ShaderKind;
  seed: number;
  /** 'surface' for planets, 'point_cloud' for nebula and nova, 'bands' (the first) for a gas giant. */
  layerId: 'surface' | 'point_cloud' | GasLayerId;
  /** Every layer id of the body: `GAS_LAYER_IDS` for a gas giant, else just `layerId`. */
  layerIds: readonly string[];
  /** R7.7: the surface of a planet, nebula or nova is always `artistic`. A gas giant's layers carry their own tags (`gasLayers`). */
  tag: Extract<Tag, 'artistic'>;
  /**
   * Gas giants: the layers the backend offers that can be drawn (not listed missing, every field
   * they require on the card), with their tags. Null for every other kind.
   */
  gasLayers: Partial<Record<GasLayerId, Tag>> | null;
  /** False when the layer was refused. */
  drawable: boolean;
  /** Physical radius in metres (`RenderParams.scale_m`), for the rates that need it. */
  scaleM: number | null;
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
  motion: Motion = STILL_MOTION,
): ShaderSpec {
  const kind = params.type;
  if (!isShaderKind(kind) || card.type !== kind) {
    throw new TypeError(`ShaderBody: not a shader kind pair (card ${card.type}, params ${kind})`);
  }
  const gasKind = kind === 'gas_giant';
  const layerId = gasKind
    ? GAS_LAYER_IDS[0]
    : kind === 'nebula' || kind === 'nova'
      ? 'point_cloud'
      : 'surface';
  const layerIds: readonly string[] = gasKind ? GAS_LAYER_IDS : [layerId];
  const missing = new Set(params.missing);

  // A layer the backend lists as missing is refused, as the plan does (planCommon `draw`).
  const usable = (id: string): Tag | null => {
    const layer = params.layers.find((l) => l.id === id);
    if (layer === undefined || params.missing.includes(id)) return null;
    for (const req of layer.requires) if (cardValue(card, req) === null) return null;
    return layer.tag;
  };
  const gasLayers: Partial<Record<GasLayerId, Tag>> | null = gasKind ? {} : null;
  let drawable: boolean;
  if (gasLayers) {
    for (const id of GAS_LAYER_IDS) {
      const t = usable(id);
      if (t !== null) gasLayers[id] = t;
    }
    drawable = Object.keys(gasLayers).length > 0;
  } else {
    drawable = usable(layerId) !== null;
  }
  if (cardValue(card, REQUIRED_CARD_FIELD[kind]) === null) drawable = false;
  // Q-33: an unknown size means the body is refused, never guessed.
  if (params.scale_m === null || !(params.scale_m > 0)) drawable = false;
  if (!drawable) for (const id of layerIds) missing.add(id);
  else if (gasLayers) {
    // A layer that cannot be drawn is refused on its own; the others still are.
    for (const id of GAS_LAYER_IDS)
      if (gasLayers[id] === undefined && params.layers.some((l) => l.id === id)) missing.add(id);
  }

  const base = {
    kind,
    seed: params.seed,
    layerId,
    layerIds,
    tag: FIELD_TAG,
    gasLayers,
    drawable,
    scaleM: params.scale_m,
  } as const;
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
    const bandsRule = rhinesBands(motion, params.scale_m);
    const flat = flatteningRule(motion, card, overrides);
    return out({
      field: {
        kind: 'gas',
        seed: params.seed,
        freq: 0,
        seaLevel: 0,
        iceExtent: 0,
        heat: 0,
        // A slider wins (D-27); then the Rhines rule from the spin and the jet speed; then the default.
        bands: sv('bands') ?? bandsRule?.value ?? GAS_DEFAULTS.bands,
        turbulence: sv('turbulence') ?? GAS_DEFAULTS.turbulence,
        storms: sv('storms') ?? GAS_DEFAULTS.storms,
      },
      gas: {
        palette: keyed(GASK, T),
        paletteSource: teq === null ? 'artist_default' : 'teq_K',
        paletteTemperatureK: T,
        glow: T > GLOW_ABOVE_K ? 0.3 : 0,
        rings: sv('rings') ?? GAS_DEFAULTS.rings,
        bandsRule: sv('bands') === undefined ? bandsRule : null,
        flattening: flat?.value ?? 0,
        flatteningRule: flat,
      },
    });
  }

  const d = PLANET_DEFAULTS[kind];
  const baseClimate = climateFromTeq(card, d);
  // Issue #68: only a card that carries the host-star fields (Track A) is tested for locking.
  const derived = isExoplanetCard(card) ? deriveClimate(card as PlanetCard, kind) : null;
  const substellar = derived?.scenario === 'eyeball' || derived?.scenario === 'snowball';
  const climate = { ...baseClimate, rule: scenarioRule(baseClimate.rule, derived, kind) };
  // N9: lava cracks glow only when teq_K says the surface is hot (>= ~700 K, A7.1). No teq_K, no
  // glow. A slider override still wins: it is the visitor's own artistic choice (D-26).
  const heat = kind === 'planet_rocky' ? lavaHeatFromTeq(cardValue(card, 'teq_K')) : d.heat;
  return out({
    field: {
      kind: 'terrain',
      seed: params.seed,
      freq: d.freq,
      seaLevel: sv('sea_level') ?? climate.sea,
      iceExtent: sv('ice') ?? climate.ice,
      heat: sv('lava_heat') ?? heat,
      // Locked planet: ice and ocean by the angle from the star-facing point (fieldGenerator).
      ...(substellar ? { substellar: true, iceAngleRad: derived!.iceAngleRad ?? 0 } : {}),
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
      climate: climate.rule,
      scenario: derived?.scenario ?? null,
      patternTag: substellar ? (climate.rule?.tag ?? null) : null,
    },
  });
}

const deg = (rad: number): number => Math.round((rad * 180) / Math.PI);

/**
 * Issue #68 Part 3c (Q-156): what the `climate` layer says once the planet was tested for locking.
 * Eyeball and snowball replace the polar-ice rule; a temperate planet keeps it but is weakened to
 * the locking tag (the verdict "not locked" is itself model-dependent) and says so; lava and
 * hot_dry, and a planet whose locking rule was refused, keep the rule as it was. Never stronger than
 * its inputs and always `model_dependent` or weaker once the locking rule ran.
 */
function scenarioRule(
  base: RuleChoice | null,
  d: ClimateDerivation | null,
  kind: 'planet_rocky' | 'planet_water',
): RuleChoice | null {
  if (!d || !base || !d.lock || !d.lock.ok) return base;
  const tag = weakestTag([base.tag, d.tag]);
  const lock = d.lock;
  const lockText = `locking time ${lock.tLockGyr.toPrecision(3)} Gyr against an age of ${lock.ageGyr} Gyr`;
  if (d.scenario === 'eyeball' && d.tssK !== null && d.iceAngleRad !== null) {
    const surface = kind === 'planet_water' ? 'open water' : 'bare ground';
    return {
      value: d.tssK,
      tag,
      tier: TIER_OF_TAG[tag],
      formula: d.formula,
      assumed: d.assumed,
      basis: `Eyeball: ${surface} within ${deg(d.iceAngleRad)}° of the star-facing point, ice beyond it and over the night side (${lockText}; ${Math.round(d.tssK)} K at the star-facing point; no heat spread, no greenhouse)`,
    };
  }
  if (d.scenario === 'snowball' && d.tssK !== null) {
    return {
      value: d.tssK,
      tag,
      tier: TIER_OF_TAG[tag],
      formula: d.formula,
      assumed: d.assumed,
      basis: `Snowball: ice over the whole surface${kind === 'planet_rocky' ? ', with a little high rock showing' : ''} (${lockText}; only ${Math.round(d.tssK)} K at the star-facing point; no heat spread, no greenhouse)`,
    };
  }
  if (d.scenario === 'temperate') {
    return {
      ...base,
      tag,
      tier: TIER_OF_TAG[tag],
      formula: `${base.formula}; locked if t_lock < age`,
      assumed: d.assumed,
      basis: `${base.basis}. Not tidally locked (${lockText}), so the ice follows the equilibrium temperature`,
    };
  }
  return base;
}

/**
 * A typical value standing in for a missing rate, or null when it is [verify]. The typical spin is
 * "typical for this kind of body, no formula": `inferred_from_analog`, tier 4 (D-32, Q-119 b). The
 * typical wind is [verify] (Q-119, Q-110), so it is `inferred_from_analog` too.
 */
function typicalRate(value: number | null, tag: Tag): { value: number; tag: Tag } | null {
  return value === null ? null : { value, tag };
}

/**
 * A7.2 Rhines band count, `N ~ sqrt(2 Omega R / U)`, from the spin and the jet speed (both from
 * `dynamics`, each with its own tier) and the radius. `N` counts bands pole to pole; the field's
 * `bands` is half of that (its phase runs 2 * bands half-periods), so the drawn value is `N / 2`,
 * rounded and kept inside the slider range. The tag is the weakest of the inputs, never stronger
 * than `derived` (an order of magnitude only, A7.2). Null when an input is missing: nothing is invented.
 */
export function rhinesBands(motion: Motion, scaleM: number | null): RuleChoice | null {
  // A rate the card or `dynamics` does not give is the typical value of a giant planet (D-32 tier
  // 4), stated in `assumed`; the backend's `bands` layer says the same (gas_giant.py).
  const spin =
    motion.rates.spin_period_h ?? typicalRate(TYPICAL_GAS_SPIN_H, 'inferred_from_analog');
  const wind =
    motion.rates.jet_speed_ms ?? typicalRate(TYPICAL_GAS_WIND_MS, 'inferred_from_analog');
  if (!spin || !wind || scaleM === null || !(scaleM > 0)) return null;
  const omega = spinRateRadS(spin.value);
  const n = omega === null ? null : bandCount(omega, scaleM, Math.abs(wind.value));
  if (n === null || !Number.isFinite(n)) return null;
  const tag = weakestTag(['derived', spin.tag, wind.tag]);
  const value = Math.min(BANDS_MAX, Math.max(BANDS_MIN, Math.round(n / 2)));
  return {
    value,
    tag,
    tier: TIER_OF_TAG[tag],
    formula:
      'bands ~ sqrt(2 Omega R / U), Omega = 2 pi / P, R = the radius on the card (order of magnitude only)',
    assumed:
      tag === 'model_dependent' || tag === 'inferred_from_analog' || tag === 'artistic'
        ? { spin_period_h: spin.value, jet_speed_ms: wind.value, radius_m: scaleM }
        : undefined,
    // The count shown is the one drawn: the field's `bands` runs pole to pole twice over.
    basis: `Rhines rule from the spin, the wind speed and the radius on the card: about ${2 * value} bands from pole to pole`,
  };
}

/**
 * A7.2 flattening `f = 0.7 q`, `q = Omega^2 R^3 / (G M)`. The card has no mass, so the order is:
 * a mass from the `mass_mearth` slider with the spin (the visitor's choice: `artistic`, the formula
 * kept); the spin with Jupiter's mean density assumed, `f = f_J (P_J / P)^2` (tier 3 or weaker),
 * the spin being the typical one of a giant planet when the card has none (issue #62). Null only if
 * that typical value is [verify] (null). Capped at `FLATTENING_MAX`.
 */
export function flatteningRule(
  motion: Motion,
  card: ObjectCard,
  overrides: Overrides | undefined,
): RuleChoice | null {
  const spin = motion.rates.spin_period_h;
  const cap = (f: number) => Math.min(FLATTENING_MAX, Math.max(0, f));
  const mass = sliderValue(overrides, 'mass_mearth', 'gas_giant');
  const radiusRj = cardValue(card, 'radius_rjup');
  if (spin && mass !== undefined && radiusRj !== null) {
    const omega = spinRateRadS(spin.value);
    const f = omega === null ? null : spinFlattening(omega, radiusRj * R_JUP_M, mearthToKg(mass));
    if (f !== null && Number.isFinite(f)) {
      return {
        value: cap(f),
        tag: 'artistic',
        tier: 5,
        formula: 'f = 0.7 * q, q = Omega^2 R^3 / (G M)',
        basis: `Flattening from the spin and the mass you set (${mass} Earth masses)`,
      };
    }
  }
  // Without a spin the typical one stands in (the backend's `flattening` layer says the same).
  const used = spin ?? typicalRate(TYPICAL_GAS_SPIN_H, 'inferred_from_analog');
  if (used) {
    const tag = weakestTag(['model_dependent', used.tag]);
    return {
      value: cap(JUPITER_FLATTENING * (JUPITER_SPIN_H / used.value) ** 2),
      tag,
      tier: TIER_OF_TAG[tag],
      formula: 'f = f_J (P_J / P)^2, from f = 0.7 q with q proportional to Omega^2',
      assumed: { mean_density: 'same as Jupiter', spin_period_h: used.value },
      basis: spin
        ? 'Flattening from the spin, with a Jupiter-like mean density assumed'
        : 'Flattening from the typical spin of a giant planet, with a Jupiter-like mean density assumed',
    };
  }
  return null;
}

/**
 * A7.1 thresholds on `teq_K`: below about 330 K a world gets polar ice, above about 450 K oceans
 * are removed (the lava threshold is `lavaHeatFromTeq`). With no `teq_K` the artist defaults are
 * drawn and the rule is null. The ice extent below the threshold "grows as temperature falls"
 * (A7.1) but the A7.1 text gives no end of the ramp, so the default extent is kept there; the ramp
 * end is [verify] and not invented.
 */
export function climateFromTeq(
  card: ObjectCard,
  d: { sea: number; ice: number },
): { sea: number; ice: number; rule: RuleChoice | null } {
  const teq = cardValue(card, 'teq_K');
  const tag = card.teq_K?.tag;
  if (teq === null || !tag) return { sea: d.sea, ice: d.ice, rule: null };
  const sea = teq > OCEANS_REMOVED_ABOVE_K ? 0 : d.sea;
  // Cold: polar ice (at least the water-world default extent: a rocky world's own default is none).
  const coldIce = Math.max(d.ice, PLANET_DEFAULTS.planet_water.ice);
  const ice = teq >= POLAR_ICE_BELOW_K ? 0 : coldIce;
  const t = weakestTag(['derived', tag]);
  return {
    sea,
    ice,
    rule: {
      value: teq,
      tag: t,
      tier: TIER_OF_TAG[t],
      formula: `polar ice below ${POLAR_ICE_BELOW_K} K, no oceans above ${OCEANS_REMOVED_ABOVE_K} K`,
      basis: `Ice and ocean from the equilibrium temperature, ${Math.round(teq)} K`,
    },
  };
}
