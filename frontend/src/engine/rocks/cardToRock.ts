// Issue #71, D-37 (stream V3): builds the prototype's rock preset (`RP` entry) from any ObjectCard.
// The prototype's own assumptions are kept and tagged as it tags them: rock strength Y = 1e6 Pa and
// surface age 70 are defaults inside `rockModel` and `R.age` (artistic); a bulk density the card
// does not hold comes from a class analog (inferred_from_analog; values from Bennu and Eros, the
// prototype's own examples). A missing diameter refuses (D-32: the three.js viewer draws the body).
// Pure: no DOM, no three.js, no clock. Same card and seed give the same preset.
import { hashInt32, seedVec } from '../seed';
import type { ObjectCard, Tag } from '@/contract';
import { RP } from './source';

export interface RockPreset {
  id: string;
  label: string;
  /** Diameter, km. */
  D: number;
  /** Length to width. */
  ab: number;
  /** Spin period, hours (Infinity when unknown: the spin limit then cannot force solid rock). */
  P: number;
  /** Reflectivity, 0..1. */
  A: number;
  /** Bulk density, kg/m3. */
  rho: number;
  tint: [number, number, number];
  seed: number;
  /**
   * Card bodies only (#93 2.8): three integers in [0, 256) the shader adds to its noise position (seedVec of the card
   * seed's hash). The artifact's bodies have none and keep their seed along (1, 1, 1). Artistic.
   */
  seed3?: [number, number, number];
  /** Card bodies only: the card seed's 32-bit hash, for the crater and shape RNG and the per-crater variation. */
  seedHash?: number;
  comet?: boolean;
}

export interface RockInput {
  value: string;
  tag: Tag;
  /** Where it came from, in plain words. */
  why: string;
}

export interface RockFromCard {
  preset: RockPreset;
  /** Every value the engine uses and its tag, for the badges and the notes. */
  inputs: Record<
    'size' | 'shape' | 'spin' | 'albedo' | 'density' | 'colour' | 'strength' | 'age' | 'light',
    RockInput
  >;
  /** The card has a shape model: the mesh replaces the generated lumps (see meshRadial). */
  meshUrl: string | null;
  /** Where the card differs from the artifact preset that is drawn instead (empty for every other body). */
  mismatches: string[];
}

export type RockRefusal = { refused: true; reason: string; missing: string[] };

/** The prototype's defaults (RP): colour of a dark rock and of a nucleus. */
const TINT_ROCK: [number, number, number] = [0.45, 0.43, 0.41];
const TINT_COMET: [number, number, number] = [0.42, 0.4, 0.38];
/** Prototype `RP`: nucleus density, albedo and shape. */
const COMET_RHO = 530;
const COMET_A = 0.05;
const COMET_AB = 1.5;
/**
 * C-type: Bennu, 1,190 +- 13 kg/m3 (Lauretta et al. 2019, Nature 568, 55); S-type: Eros, 2,670
 * kg/m3 (Yeomans et al. 2000). Albedos are the prototype's `RP` values. The prototype's own 'rub'
 * example keeps its rounded 1,200 (source.ts, verbatim); it is within 1 %, so no mismatch is noted.
 */
const RHO_C = 1190;
const RHO_S = 2670;
const RHO_GENERIC = 1500;
const A_C = 0.044;
const A_S = 0.25;
const A_GENERIC = 0.12;

function num(card: ObjectCard, f: keyof ObjectCard): { v: number; tag: Tag } | null {
  const t = card[f] as { value?: unknown; tag?: Tag } | undefined;
  return typeof t?.value === 'number' && Number.isFinite(t.value)
    ? { v: t.value, tag: t.tag ?? 'derived' }
    : null;
}

function fmt(x: number, d = 1): string {
  return x.toLocaleString('en', { maximumFractionDigits: d });
}

/** Class letter family: C-like or S-like (the same sets the backend uses), else null. */
export function classFamily(cls: string | null): 'C' | 'S' | null {
  const l = (cls ?? '').trim().slice(0, 1).toUpperCase();
  if (l && 'CBFGDP'.includes(l)) return 'C';
  if (l && 'SQVAORKL'.includes(l)) return 'S';
  return null;
}

/** Upper end (exclusive) of the engine seed: the shader adds the seed to a noise position, so it stays small. */
export const ROCK_SEED_RANGE = 97;
/** Engine seed steps: 1/4096, so a seed survives float32 exactly and prints the same everywhere. */
const ROCK_SEED_STEPS = ROCK_SEED_RANGE * 4096;
/**
 * The engine seed for a card seed. The prototype's seeds are small numbers (the shader adds the seed
 * to a noise position), so the card's 32-bit seed is hashed (murmur3 finaliser) and folded into
 * [0, 97) in steps of 1/4096: about 400,000 values instead of 97, so two cards rarely share a field.
 * Deterministic. The prototype's own examples keep their own integer seeds (artifactPreset).
 * Since #93 2.8 a card body also carries seed3 and seedHash (cardToRock), which the engine uses for its noise
 * offset and its crater RNG instead; this value stays for display and as part of the body's cache key.
 */
export function rockSeed(seed: number): number {
  let h = Math.floor(Math.abs(Number.isFinite(seed) ? seed : 0)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) % ROCK_SEED_STEPS) / 4096;
}

/**
 * Bodies the artifact's `#rocks` section has as presets (`RP`): when the card is that body, the
 * artifact's own values and seed are used so the picture is 1:1 with the artifact (Moon, D-37).
 * Explicit id table (backend object ids). The artifact's 'rub' preset is a "Bennu-sized example";
 * its values are Bennu's.
 */
export const ARTIFACT_PRESET_BY_ID: Readonly<Record<string, string>> = {
  'sbdb-50788063': 'oum',
  'sbdb-20101955': 'rub',
  'sbdb-20000433': 'eros',
};

function artifactPreset(cardId: string): RockPreset | null {
  const key = ARTIFACT_PRESET_BY_ID[cardId];
  const p = key ? (RP as RockPreset[]).find((r) => r.id === key) : undefined;
  return p ? { ...p, tint: [...p.tint] as [number, number, number], id: cardId } : null;
}

export function cardToRock(
  card: ObjectCard,
  opts: { seed: number; tint?: [number, number, number] | null },
): RockFromCard | RockRefusal {
  const comet = card.type === 'comet';
  const diam = num(card, 'diameter_km');
  const nuc = num(card, 'nucleus_radius_km_max');
  const meshUrl = typeof card.shape_source?.value === 'string' ? card.shape_source.value : null;
  let D: number | null = null;
  let sizeTag: Tag = 'model_dependent';
  let sizeWhy = 'diameter on the card';
  if (diam && diam.v > 0) {
    D = diam.v;
    sizeTag = diam.tag;
  } else if (comet && nuc && nuc.v > 0) {
    D = nuc.v * 2;
    sizeTag = nuc.tag;
    sizeWhy = 'nucleus radius on the card (an upper limit)';
  }
  if (D === null) {
    return {
      refused: true,
      reason: 'The card has no size, so the surface cannot be worked out.',
      missing: [comet ? 'nucleus_radius_km_max' : 'diameter_km'],
    };
  }
  const clsRaw = typeof card.spectral_class?.value === 'string' ? card.spectral_class.value : null;
  const fam = classFamily(clsRaw);

  const amp = num(card, 'lightcurve_amp_mag');
  let ab = comet ? COMET_AB : 1;
  let shape: RockInput;
  if (meshUrl) {
    ab = 1;
    shape = {
      value: 'shape model',
      tag: 'measured',
      why: 'the radio or optical shape model on the card',
    };
  } else if (!comet && amp && amp.v >= 0) {
    ab = Math.pow(10, 0.4 * amp.v);
    shape = {
      value: `${fmt(ab, 1)} : 1`,
      tag: 'model_dependent',
      why: 'length to width = 10^(0.4 A) from the light-curve amplitude',
    };
  } else if (comet) {
    shape = {
      value: `${fmt(ab, 1)} : 1, two lobes`,
      tag: 'artistic',
      why: "no shape model: the prototype's two-lobed nucleus",
    };
  } else {
    shape = {
      value: 'nearly round',
      tag: 'artistic',
      why: 'no light curve on the card, so no elongation is drawn',
    };
  }

  const per = num(card, 'rot_period_h');
  const P = per && per.v > 0 ? per.v : Infinity;
  const spin: RockInput =
    P === Infinity
      ? {
          value: 'not on the card',
          tag: 'artistic',
          why: 'without a spin, nothing forces solid rock',
        }
      : { value: `${fmt(P, 1)} h`, tag: per!.tag, why: 'rotation period on the card' };

  const alb = num(card, 'albedo');
  let A: number;
  let albedo: RockInput;
  if (comet) {
    A = COMET_A;
    albedo = {
      value: '5%',
      tag: 'inferred_from_analog',
      why: "the prototype's dark nucleus (comet nuclei are very dark)",
    };
  } else if (alb && alb.v > 0) {
    A = alb.v;
    albedo = { value: `${fmt(A * 100)}%`, tag: alb.tag, why: 'albedo on the card' };
  } else {
    A = fam === 'C' ? A_C : fam === 'S' ? A_S : A_GENERIC;
    albedo = {
      value: `${fmt(A * 100, 1)}%`,
      tag: 'inferred_from_analog',
      why: fam
        ? `typical of a ${fam}-type body (${fam === 'C' ? 'Bennu' : 'Eros'})`
        : 'a middle value: the class is not known',
    };
  }

  const rho = comet ? COMET_RHO : fam === 'C' ? RHO_C : fam === 'S' ? RHO_S : RHO_GENERIC;
  const density: RockInput = {
    value: `${fmt(rho)} kg/m³`,
    tag: 'inferred_from_analog',
    why: comet
      ? 'a typical weak, porous nucleus'
      : fam
        ? `an analog: ${fam === 'C' ? 'Bennu' : 'Eros'}`
        : 'a generic value: the class is not known',
  };

  const tint = opts.tint ?? (comet ? TINT_COMET : TINT_ROCK);
  const colour: RockInput = opts.tint
    ? {
        value: 'from the card colour',
        tag: 'derived',
        why: 'the colour the card allows at this honesty level',
      }
    : {
        value: 'dark grey',
        tag: 'artistic',
        why: "no colour data: the prototype's dark rock tint",
      };

  const fromArtifact = artifactPreset(card.id);
  const out: RockFromCard = {
    preset: fromArtifact ?? {
      id: card.id,
      label: card.name,
      D,
      ab,
      P,
      A,
      rho,
      tint: [...tint] as [number, number, number],
      seed: rockSeed(opts.seed),
      seed3: seedVec(hashInt32(opts.seed)),
      seedHash: hashInt32(opts.seed),
      comet,
    },
    inputs: {
      size: { value: D < 1 ? `${fmt(D * 1000)} m` : `${fmt(D, 1)} km`, tag: sizeTag, why: sizeWhy },
      shape,
      spin,
      albedo,
      density,
      colour,
      strength: {
        value: '1 MPa',
        tag: 'artistic',
        why: 'a typical rock strength from the prototype; real rock spans about 1 kPa to 10 MPa',
      },
      age: {
        value: 'old',
        tag: 'artistic',
        why: "no age on the card: the prototype's default of 70 on a 0 to 100 scale",
      },
      // The engine's shading (source.ts fragment shader): Lommel-Seeliger plus a Lambert term, an
      // exponential phase darkening, no opposition surge. Not fitted to any body.
      light: {
        value: 'Lommel–Seeliger and Lambert blend',
        tag: 'artistic',
        why: "the prototype's shading: a blend of the Lommel–Seeliger and Lambert laws with a simple darkening at high phase and no brightening at opposition; not fitted to this body",
      },
    },
    meshUrl,
    mismatches: [],
  };
  if (fromArtifact) {
    // The artifact's colour and seed are part of its look, and its size, shape, spin, albedo and density are
    // what is drawn: the inputs show those, and where the card says something else that is reported.
    const pr = fromArtifact;
    const same = (a: number, b: number) =>
      Number.isFinite(a) && Number.isFinite(b)
        ? Math.abs(a - b) <= 0.01 * Math.max(Math.abs(a), Math.abs(b))
        : a === b;
    const why = "the approved preview's example value (this body is one of its own examples)";
    const size = (d: number) => (d < 1 ? `${fmt(d * 1000)} m` : `${fmt(d, 1)} km`);
    const note = (name: string, card: string, drawn: string) =>
      out.mismatches.push(
        `${name}: the card has ${card} but the preview's example has ${drawn}; the example is drawn`,
      );
    const whyCard = (card: string) => `${why}; the card says ${card}`;
    if (!same(pr.D, D)) {
      note('size', size(D), size(pr.D));
      out.inputs.size = { value: size(pr.D), tag: 'artistic', why: whyCard(size(D)) };
    }
    if (!same(pr.ab, ab)) {
      note('shape', shape.value, `${fmt(pr.ab, 1)} : 1`);
      out.inputs.shape = {
        value: `${fmt(pr.ab, 1)} : 1`,
        tag: 'artistic',
        why: whyCard(shape.value),
      };
    }
    if (!same(pr.P, P)) {
      note('spin', spin.value, `${fmt(pr.P, 1)} h`);
      out.inputs.spin = { value: `${fmt(pr.P, 1)} h`, tag: 'artistic', why: whyCard(spin.value) };
    }
    if (!same(pr.A, A)) {
      note('reflectivity', albedo.value, `${fmt(pr.A * 100, 1)}%`);
      out.inputs.albedo = {
        value: `${fmt(pr.A * 100, 1)}%`,
        tag: 'artistic',
        why: whyCard(albedo.value),
      };
    }
    if (!same(pr.rho, rho)) {
      note('density', density.value, `${fmt(pr.rho)} kg/m³`);
      out.inputs.density = {
        value: `${fmt(pr.rho)} kg/m³`,
        tag: 'artistic',
        why: whyCard(density.value),
      };
    }
    out.inputs.colour = {
      value: "the artifact's tint",
      tag: 'artistic',
      why: "this body is one of the approved preview's own examples",
    };
  }
  return out;
}
