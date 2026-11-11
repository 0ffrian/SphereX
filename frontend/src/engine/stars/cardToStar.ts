// Issue #71 stream X (D-37): the star engine's inputs from any star card. The engine wants a preset
// {T, R, M, P, dwarf}; this fills it from the card and, where the card is silent, from the
// prototype's own tier chain (D-32): radius and mass from the Mamajek main-sequence table, the
// rotation period from the Sun's Rossby number through Wright's turnover time. Every value carries
// one tag (D-02). A missing temperature refuses: nothing is drawn and it is listed in `missing`.
// Brown dwarfs, Miras and anything that is not a star are out of scope (a Mira has no surface).
import type { ObjectCard, Tag } from '@/contract';
import {
  GIANT_LOGG_MAX,
  convectiveTurnoverDays,
  massFromRadius,
  massFromTeff,
  radiusFromTeff,
  sunRossby,
} from '@/physics/stellar';
import { GM_SUN, R_SUN_M } from '@/physics/constants';
import { hashString32, seedVec } from '../seed';

/** What the engine's `setStar` takes: the prototype's PRESETS row. */
export interface StarPreset {
  id: string;
  label: string;
  /** Surface temperature, K. */
  T: number;
  /** Radius, solar radii. */
  R: number;
  /** Mass, solar masses. */
  M: number;
  /** Rotation period, days. */
  P: number;
  /** A dwarf: the field and spot fit applies (Reiners et al. 2022 covers dwarfs). */
  dwarf: boolean;
  /**
   * Card stars only (#93 2.3): the 32-bit hash of the card id, for the spot RNG (rng(1729 ^ seed)). Artistic. The
   * prototype's rows have none, so they keep rng(1729).
   */
  seed?: number;
  /** Card stars only: the vec3 noise offset uSO (seedVec of `seed`, three integers in [0, 256)). Artistic. */
  so?: [number, number, number];
}

export interface StarValue {
  value: number;
  tag: Tag;
  /** Where it came from, in plain words. */
  note: string;
}

export interface StarFromCard {
  ok: true;
  preset: StarPreset;
  teff: StarValue;
  radius: StarValue;
  mass: StarValue;
  /** Luminosity, solar luminosities (for the turnover time; the engine preset does not take it). */
  luminosity: StarValue;
  rotation: StarValue;
  spectralClass: string | null;
  /** Inputs the tier chain filled in, in plain words. */
  assumed: string[];
}
export interface StarRefusal {
  ok: false;
  /** Card fields that are missing (listed in the plan's `missing`). */
  missing: string[];
  reason: string;
}

/** Colour table of the engine (the prototype's LUT) starts here; cooler is a brown dwarf. */
export const STAR_TEFF_MIN = 1200;

const positive = (x: number | null | undefined): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x > 0;
const TYPICAL = 'a typical main-sequence star (Mamajek mean dwarf sequence)';
/** The prototype's red giant preset: 1 solar mass. A giant has no main-sequence mass to read off. */
const GIANT_MASS_MSUN = 1;
/** Nominal solar effective temperature, K (IAU 2015 B3), for L = R^2 (T / T_sun)^4. */
const T_SUN_K = 5772;
const TAG_RANK: Record<Tag, number> = {
  measured: 1,
  derived: 2,
  model_dependent: 3,
  inferred_from_analog: 4,
  artistic: 5,
};
const weakerOf = (a: Tag, b: Tag): Tag => (TAG_RANK[a] >= TAG_RANK[b] ? a : b);

/**
 * The one star the artifact has a preset for by name: the Sun (sculptor-preview-next.html, PRESETS row
 * 'g'), so the Sun's picture is 1:1 with the artifact. The artifact's other rows (F, K, M, ...) are star
 * TYPES, not named stars: a named star such as Procyon, eps Eri or Barnard's Star goes through its own
 * card values and the tier chain below, never a type row (the review of PR #89: a type row overruled
 * the card's temperature, radius and period). Parity runs against those rows load them by preset id
 * (`PROTOTYPE_PRESETS`, `?preset=` in the parity hook). The engine's seeds are fixed in the artifact
 * (1729, 2024, 808); since #93 2.3 a card star (not these) carries its own `seed` and `so`.
 */
export const ARTIFACT_PRESET_BY_CARD_ID: Record<string, StarPreset> = {
  'ref-sun': { id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true },
};

/** The prototype's PRESETS rows (protoStar1.js), by id: for the parity harness only, never for a card. */
export const PROTOTYPE_PRESETS: Record<string, StarPreset> = {
  rg: { id: 'rg', label: 'Red giant', T: 3050, R: 300, M: 1.0, P: 400, dwarf: false },
  m: { id: 'm', label: 'Red dwarf', T: 3200, R: 0.19, M: 0.16, P: 140, dwarf: true },
  k: { id: 'k', label: 'Orange dwarf', T: 4500, R: 0.72, M: 0.72, P: 30, dwarf: true },
  g: { id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true },
  f: { id: 'f', label: 'Yellow-white', T: 6500, R: 1.3, M: 1.25, P: 8, dwarf: true },
  a: { id: 'a', label: 'White star', T: 8500, R: 1.8, M: 2.0, P: 1.5, dwarf: true },
  b: { id: 'b', label: 'Blue star', T: 22000, R: 4.5, M: 9, P: 1.5, dwarf: true },
};

export function cardToStar(card: ObjectCard | null | undefined): StarFromCard | StarRefusal {
  if (!card) return { ok: false, missing: ['card'], reason: 'No star card.' };
  if (card.type !== 'star' && card.type !== 'star_ttauri')
    return {
      ok: false,
      missing: [],
      reason:
        card.type === 'star_mira'
          ? 'A Mira variable is a giant with no steady surface to simulate.'
          : card.type.startsWith('brown_dwarf')
            ? 'Brown dwarfs are out of scope for the star engine.'
            : 'Not a star.',
    };
  const t = card.teff_K;
  const art = ARTIFACT_PRESET_BY_CARD_ID[card.id];
  if (!t || !positive(t.value))
    return {
      ok: false,
      missing: ['teff_K'],
      reason: 'The card has no effective temperature, so the star is not drawn.',
    };
  if (t.value < STAR_TEFF_MIN)
    return {
      ok: false,
      missing: [],
      reason: 'Cooler than the star colour table (a brown dwarf): out of scope.',
    };
  let teff: StarValue = { value: t.value, tag: t.tag, note: `from the card (${t.source})` };
  const assumed: string[] = [];

  let radius: StarValue;
  const r = card.radius_rsun;
  if (r && positive(r.value))
    radius = { value: r.value, tag: r.tag, note: `from the card (${r.source})` };
  else {
    const v = radiusFromTeff(teff.value);
    radius = { value: v, tag: 'model_dependent', note: `from the temperature of ${TYPICAL}` };
    assumed.push(`radius ${v.toFixed(2)} Rsun from the temperature of ${TYPICAL}`);
  }

  // The card's mass (Gaia FLAME, issue #93 B) when it has one; else from the radius when it is a dwarf's, else from
  // the temperature.
  let mass: StarValue;
  const mc = card.mass_msun;
  if (mc && positive(mc.value))
    mass = { value: mc.value, tag: mc.tag, note: `from the card (${mc.source})` };
  else if (r && positive(r.value)) {
    const m = massFromRadius(r.value);
    if (m !== null) {
      mass = { value: m, tag: 'model_dependent', note: `from the radius of ${TYPICAL}` };
      assumed.push(`mass ${m.toFixed(2)} Msun from the radius of ${TYPICAL}`);
    } else {
      mass = {
        value: GIANT_MASS_MSUN,
        tag: 'inferred_from_analog',
        note: 'a typical giant, 1 solar mass (the radius is outside the dwarf range)',
      };
      assumed.push('mass 1.00 Msun, a typical giant (the radius is outside the dwarf range)');
    }
  } else {
    const m = massFromTeff(teff.value);
    mass = { value: m, tag: 'model_dependent', note: `from the temperature of ${TYPICAL}` };
    assumed.push(`mass ${m.toFixed(2)} Msun from the temperature of ${TYPICAL}`);
  }

  let rotation: StarValue;
  const p = card.rot_period_h;
  if (p && positive(p.value))
    rotation = { value: p.value / 24, tag: p.tag, note: `from the card (${p.source})` };
  else {
    const v = sunRossby() * convectiveTurnoverDays(mass.value);
    rotation = {
      value: v,
      tag: 'inferred_from_analog',
      note: `the Sun's Rossby number (${sunRossby().toFixed(2)}) assumed, with Wright et al. 2011's turnover time`,
    };
    assumed.push(`rotation period ${v.toFixed(1)} days: the Sun's Rossby number assumed`);
  }

  // Issue #93 B: luminosity for the turnover time. The card's (Gaia FLAME) when it has one, else Stefan-Boltzmann from
  // the radius and temperature above, L = R^2 (T / 5772 K)^4, no stronger than its inputs (D-32).
  let luminosity: StarValue;
  const lc = card.lum_lsun;
  if (lc && positive(lc.value))
    luminosity = { value: lc.value, tag: lc.tag, note: `from the card (${lc.source})` };
  else
    luminosity = {
      value: radius.value * radius.value * Math.pow(teff.value / T_SUN_K, 4),
      tag: weakerOf('derived', weakerOf(radius.tag, teff.tag)),
      note: 'L = R^2 (T / 5772 K)^4 from the radius and temperature (Stefan-Boltzmann)',
    };

  const g = (GM_SUN * mass.value) / Math.pow(R_SUN_M * radius.value, 2);
  const dwarf = Math.log10(g * 100) >= GIANT_LOGG_MAX;
  const spectralClass = card.spectral_class?.value ?? null;
  if (art) {
    const pick = (v: StarValue, x: number, what: string): StarValue => {
      const off = Math.abs(x - v.value) / Math.max(v.value, 1e-9) > 0.01;
      if (!off) return v;
      assumed.push(
        `${what} ${x} from the artifact preset "${art.label}", the card says ${+v.value.toPrecision(4)}`,
      );
      return {
        value: x,
        tag: 'inferred_from_analog',
        note: `the artifact's "${art.label}" preset; the card says ${+v.value.toPrecision(4)}`,
      };
    };
    teff = pick(teff, art.T, 'temperature');
    radius = pick(radius, art.R, 'radius');
    mass = pick(mass, art.M, 'mass');
    rotation = pick(rotation, art.P, 'rotation period (days)');
  }
  return {
    ok: true,
    preset: art ?? {
      id: card.id,
      label: card.name,
      T: teff.value,
      R: radius.value,
      M: mass.value,
      P: rotation.value,
      dwarf,
      seed: hashString32(card.id),
      so: seedVec(hashString32(card.id)),
    },
    teff,
    radius,
    mass,
    luminosity,
    rotation,
    spectralClass: typeof spectralClass === 'string' ? spectralClass : null,
    assumed,
  };
}
