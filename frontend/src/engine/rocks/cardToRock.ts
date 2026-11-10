// Issue #71, D-37 (stream V3): builds the prototype's rock preset (`RP` entry) from any ObjectCard.
// The prototype's own assumptions are kept and tagged as it tags them: rock strength Y = 1e6 Pa and
// surface age 70 are defaults inside `rockModel` and `R.age` (artistic); a bulk density the card
// does not hold comes from a class analog (inferred_from_analog; values from Bennu and Eros, the
// prototype's own examples). A missing diameter refuses (D-32: the three.js viewer draws the body).
// Pure: no DOM, no three.js, no clock. Same card and seed give the same preset.
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
    'size' | 'shape' | 'spin' | 'albedo' | 'density' | 'colour' | 'strength' | 'age',
    RockInput
  >;
  /** The card has a shape model: the mesh replaces the generated lumps (see meshRadial). */
  meshUrl: string | null;
}

export type RockRefusal = { refused: true; reason: string; missing: string[] };

/** The prototype's defaults (RP): colour of a dark rock and of a nucleus. */
const TINT_ROCK: [number, number, number] = [0.45, 0.43, 0.41];
const TINT_COMET: [number, number, number] = [0.42, 0.4, 0.38];
/** Prototype `RP`: nucleus density, albedo and shape. */
const COMET_RHO = 530;
const COMET_A = 0.05;
const COMET_AB = 1.5;
/** C-type: Bennu (Lauretta et al. 2019); S-type: Eros (Yeomans et al. 2000). Prototype `RP` values. */
const RHO_C = 1200;
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

/** The prototype's seeds are small integers (the shader adds the seed to a position): keep it small. */
export function rockSeed(seed: number): number {
  return Math.abs(Math.floor(Number.isFinite(seed) ? seed : 0)) % 97;
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
    },
    meshUrl,
  };
  if (fromArtifact) {
    // The artifact's colour and seed are part of its look; the card's size, spin and albedo are
    // listed as before, the artifact's own values are the ones drawn.
    out.inputs.colour = {
      value: "the artifact's tint",
      tag: 'artistic',
      why: "this body is one of the approved preview's own examples",
    };
  }
  return out;
}
