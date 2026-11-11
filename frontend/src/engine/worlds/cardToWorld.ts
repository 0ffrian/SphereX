// D-37: build the prototype's preset object (sculptor-preview-next.html WP) from ANY ObjectCard.
// Deterministic; no network; no GL. A measurement becomes a parameter by arithmetic only. Where the prototype
// assumed a value (fluid water, 1 bar, mu, sea share 0.5, no eccentricity or obliquity) the same default is used,
// tagged model_dependent and listed in `assumptions`. A missing required input refuses: `{ ok: false, missing }`.
import type { ObjectCard, Tag } from '@/contract';
import { deriveLocking } from '@/physics/tides';
import { FLUIDS, WP } from './presets.js';
import type { EngineOverrides, FluidKey, TaggedAssumption, WorldPreset } from './types';

export type { TaggedAssumption } from './types';

export interface CardToWorldOk {
  ok: true;
  preset: WorldPreset;
  /** Slider and pill overrides, passed through for WorldEngine.setOverrides (tag: artistic, a user choice). */
  overrides: EngineOverrides;
  /** One provenance tag per preset field. */
  tags: Record<string, Tag>;
  assumptions: TaggedAssumption[];
  /** Optional inputs that were absent and not needed (listed so nothing is silently dropped). */
  missing: string[];
  /** Artifact objects only: card values that differ from the prototype's preset by more than rounding (the preset's value is used). */
  mismatches: string[];
  /** Set when the object is one of the artifact's presets (the prototype preset id). */
  artifact?: string;
}
export interface CardToWorldRefused {
  ok: false;
  missing: string[];
}
export type CardToWorld = CardToWorldOk | CardToWorldRefused;

const GAS = 'gas_giant';
const ROCK = new Set(['planet_rocky', 'planet_water']);
/** Reference giants carry the prototype's observed band tables (GAS_NODES), palette, tilt, rings and light. */
const REF_GIANT: Record<string, string> = { 'ref-jupiter': 'jup', 'ref-saturn': 'sat' };
const SUN = { Ts: 5772, Rs: 1, Ms: 1 };
/** The prototype's default sea share of the surface. */
const DEFAULT_SEA = 0.5;

/** FNV-1a of the card id, folded to 1..997: a small stable integer (the prototype's seeds are small; the shaders take them as floats). */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 997) + 1;
}

function num(tv: { value: number | null } | undefined): number | null {
  const v = tv?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fluidKey(raw: string): FluidKey | null {
  const s = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s === 'ammoniawater') return 'ammoniaWater';
  if (s === 'co2' || s === 'carbondioxide') return 'co2';
  if (s === 'h2o') return 'water';
  if (s === 'ch4') return 'methane';
  if (s === 'n2') return 'nitrogen';
  return Object.prototype.hasOwnProperty.call(FLUIDS, s) ? (s as FluidKey) : null;
}

function cardToWorldGeneric(card: ObjectCard, overrides: EngineOverrides): CardToWorld {
  const missing: string[] = [];
  const tags: Record<string, Tag> = {};
  const assumptions: TaggedAssumption[] = [];
  const assume = (field: string, value: number | string | boolean, note: string): void => {
    tags[field] = 'model_dependent';
    assumptions.push({ field, value, tag: 'model_dependent', note });
  };

  const refGiant = REF_GIANT[card.id];
  const isRef = card.id.startsWith('ref-');
  const gas = card.type === GAS;
  if (!gas && !ROCK.has(card.type)) {
    return {
      ok: false,
      missing: ['type: ' + card.type + ' is not a planet type the world engine draws'],
    };
  }

  const Rj = num(card.radius_rjup);
  const Me = num(card.mass_mearth);
  const a = num(card.orbit_au);
  if (Rj === null) missing.push('radius_rjup');
  if (Me === null) missing.push('mass_mearth');
  if (a === null) missing.push('orbit_au');

  let Ts = num(card.host_teff_K);
  let Rs = num(card.host_radius_rsun);
  const hostMass = num(card.host_mass_msun);
  if (isRef && Ts === null && Rs === null) {
    // A body of the solar system (the reference rows): its host is the Sun, which the prototype uses for them.
    Ts = SUN.Ts;
    Rs = SUN.Rs;
    assume(
      'Ts',
      Ts,
      'reference solar-system body: the host star is the Sun (5772 K), as in the prototype',
    );
    assume(
      'Rs',
      Rs,
      'reference solar-system body: the host star is the Sun (1 R_sun), as in the prototype',
    );
  } else {
    if (Ts === null) missing.push('host_teff_K');
    if (Rs === null) missing.push('host_radius_rsun');
    if (Ts !== null) tags.Ts = card.host_teff_K!.tag;
    if (Rs !== null) tags.Rs = card.host_radius_rsun!.tag;
  }
  const Ms = hostMass ?? (isRef ? SUN.Ms : null);

  // Orbital period: measured, else Kepler's third law with the host mass.
  let P = num(card.orbital_period_d);
  if (P !== null) tags.P = card.orbital_period_d!.tag;
  else if (a !== null && Ms !== null) {
    P = 365.25 * Math.sqrt((a * a * a) / Ms);
    tags.P = 'derived';
    if (hostMass === null)
      assume(
        'Ms',
        Ms,
        'reference solar-system body: host mass 1 M_sun, used for the orbital period and tides',
      );
  } else if (a !== null) missing.push('orbital_period_d (or host_mass_msun to derive it)');

  // Spin: a measured/derived rotation period wins; otherwise the app's tidal-locking rule (A7.1).
  const rotH = num(card.rot_period_h);
  let locked: boolean | null = null;
  let Prot: number | undefined;
  if (rotH !== null && rotH > 0) {
    Prot = rotH / 24;
    tags.Prot = card.rot_period_h!.tag;
    if (P !== null) {
      locked = Math.abs(Prot - P) / P < 0.02;
      tags.locked = 'derived';
    }
  } else {
    const lockCard =
      isRef && hostMass === null
        ? ({
            ...card,
            host_mass_msun: {
              value: SUN.Ms,
              tag: 'model_dependent',
              source: 'reference body: the Sun',
              assumption: 'host is the Sun',
            },
          } as ObjectCard)
        : card;
    const lr = deriveLocking(lockCard);
    if (lr.ok) {
      locked = lr.locked;
      tags.locked = lr.tag === 'measured' || lr.tag === 'derived' ? 'model_dependent' : lr.tag;
      assumptions.push({
        field: 'locked',
        value: lr.locked,
        tag: 'model_dependent',
        note: 'tidal locking time against the star age: ' + lr.formula,
      });
      for (const [k, v] of Object.entries(lr.assumed))
        assumptions.push({
          field: 'locked.' + k,
          value: v,
          tag: 'model_dependent',
          note: 'assumed input of the locking rule',
        });
    } else missing.push('tidal_locking (needs ' + lr.needs.join(', ') + ')');
  }

  if (!locked && Prot === undefined) {
    if (gas) missing.push('rot_period_h');
    else {
      Prot = 1;
      assume(
        'Prot',
        1,
        'not locked and no rotation period on the card; 1 day, as the prototype falls back',
      );
    }
  }
  if (
    missing.length > 0 ||
    Rj === null ||
    Me === null ||
    a === null ||
    Ts === null ||
    Rs === null ||
    P === null ||
    locked === null
  ) {
    return { ok: false, missing };
  }
  tags.Rj = card.radius_rjup!.tag;
  tags.Me = card.mass_mearth!.tag;
  tags.a = card.orbit_au!.tag;
  tags.type = 'derived';
  tags.id = 'derived';
  tags.label = 'derived';

  // Fluid, pressure, mean molecular weight, sea share: the prototype's defaults when the card has none.
  const rawFluid = card.surface_fluid?.value ?? null;
  let fluid: FluidKey = 'water';
  if (rawFluid !== null) {
    const k = fluidKey(rawFluid);
    if (k) {
      fluid = k;
      tags.fluid = card.surface_fluid!.tag;
    } else
      assume(
        'fluid',
        'water',
        'the card names a fluid the engine has no data for (' +
          rawFluid +
          '); water, as the prototype defaults',
      );
  } else assume('fluid', 'water', 'no surface fluid on the card; water, as the prototype defaults');

  const waterWorld = card.type === 'planet_water';
  const PsCard = num(card.surface_pressure_bar);
  let Ps = 1;
  if (PsCard !== null) {
    Ps = PsCard;
    tags.Ps = card.surface_pressure_bar!.tag;
  } else
    assume(
      'Ps',
      Ps,
      gas
        ? 'not used for a giant; 1 bar as the prototype'
        : 'no surface pressure on the card; 1 bar, as the prototype defaults',
    );

  const mu = gas
    ? refGiant === 'sat'
      ? 2.1
      : 2.3
    : waterWorld
      ? 18
      : fluid === 'methane'
        ? 28
        : 29;
  assume(
    'mu',
    mu,
    gas
      ? 'hydrogen-helium air (prototype 2.3 g/mol)'
      : waterWorld
        ? 'water-rich air (prototype ocean world, 18 g/mol)'
        : fluid === 'methane'
          ? 'nitrogen air under a methane cycle (prototype Titan example, 28 g/mol)'
          : 'nitrogen-like air (prototype 29 g/mol)',
  );

  const preset: WorldPreset = {
    id: refGiant ?? card.id,
    label: card.name,
    type: gas ? 'gas' : 'rock',
    Ts,
    Rs,
    a,
    P,
    Rj,
    Me,
    locked,
    fluid,
    Ps,
    mu,
    seed: seedFromId(card.id),
  };
  tags.seed = 'artistic';
  if (Prot !== undefined) preset.Prot = Prot;
  if (!gas) {
    preset.sea = waterWorld ? 2 : DEFAULT_SEA;
    preset.oceanF = waterWorld ? 1 : DEFAULT_SEA;
    if (waterWorld) preset.ocean = true;
    assume(
      'sea',
      preset.sea,
      'sea share of the surface; the prototype uses ' +
        (waterWorld ? '2 (ocean world, K2-18 b)' : '0.5'),
    );
    tags.oceanF = 'model_dependent';
  }
  const albedo = num(card.albedo);
  if (albedo !== null) {
    preset.A = albedo;
    tags.A = card.albedo!.tag;
  }
  // Orbit extras (the prototype's ORB table): host mass, eccentricity and obliquity are not on the card.
  preset.ob = { Ms: Ms ?? 1, e: 0, obl: 0 };
  if (Ms === null)
    assume('ob.Ms', 1, 'no host mass on the card; 1 M_sun, as the prototype defaults for tides');
  assume('ob.e', 0, 'eccentricity is not on the card; circular, as the prototype defaults');
  assume('ob.obl', 0, 'obliquity is not on the card; upright, as the prototype defaults');

  if (refGiant) {
    // The prototype's observed Jupiter and Saturn: belts and zones from GAS_NODES, palette, tilt, rings, light, internal heat.
    const ref = WP.find((q) => q.id === refGiant)!;
    for (const k of ['pal', 'axis', 'roll', 'rings', 'L', 'Tint'] as const) {
      if (ref[k] !== undefined) {
        (preset as any)[k] = ref[k];
        tags[k] = k === 'pal' || k === 'L' ? 'artistic' : 'inferred_from_analog';
      }
    }
    preset.fluid = ref.fluid;
    assume('fluid', ref.fluid, 'reference giant: ammonia clouds, as the prototype');
  }

  return {
    ok: true,
    preset,
    overrides: { ...overrides },
    tags,
    assumptions,
    missing: [],
    mismatches: [],
  };
}

/**
 * Objects the approved prototype already has, by card id (D-37, Moon 11 Nov 2026: 1:1 with the artifact). For these the
 * prototype's own preset is used whole (seed, mu, sea, palette, light, tilt, rings, locking, pressure ...); card values
 * win only where they equal the preset within rounding, otherwise the mismatch is reported in `mismatches`.
 */
export const ARTIFACT_PRESETS: Record<string, string> = {
  'simbad-trappist-1e': 't1e',
  'simbad-trappist-1f': 't1f',
  'simbad-kepler-186f': 'k186',
  'simbad-k2-18b': 'k218',
  'simbad-hd-189733b': 'hd',
  'ref-jupiter': 'jup',
  'ref-saturn': 'sat',
  'ref-titan': 'tit',
  'ref-earth': 'earth',
};
/** Relative tolerance for "equal within rounding" (the prototype rounds its inputs to 3 or 4 figures). */
const ROUND_TOL = 0.03;
const same = (a: number, b: number): boolean =>
  Math.abs(a - b) <= ROUND_TOL * Math.max(Math.abs(a), Math.abs(b), 1e-9);

export function cardToWorld(card: ObjectCard, overrides: EngineOverrides = {}): CardToWorld {
  const gen = cardToWorldGeneric(card, overrides);
  const pid = ARTIFACT_PRESETS[card.id];
  const proto = pid ? WP.find((q) => q.id === pid) : undefined;
  if (!proto) return gen;
  const preset: WorldPreset = JSON.parse(JSON.stringify(proto));
  const tags: Record<string, Tag> = {};
  const assumptions: TaggedAssumption[] = [];
  const mismatches: string[] = [];
  const cardVals: Record<string, { v: number | string | null; tag?: Tag; src: string }> = {
    Ts: { v: num(card.host_teff_K), tag: card.host_teff_K?.tag, src: 'host_teff_K' },
    Rs: { v: num(card.host_radius_rsun), tag: card.host_radius_rsun?.tag, src: 'host_radius_rsun' },
    a: { v: num(card.orbit_au), tag: card.orbit_au?.tag, src: 'orbit_au' },
    P: { v: num(card.orbital_period_d), tag: card.orbital_period_d?.tag, src: 'orbital_period_d' },
    Rj: { v: num(card.radius_rjup), tag: card.radius_rjup?.tag, src: 'radius_rjup' },
    Me: { v: num(card.mass_mearth), tag: card.mass_mearth?.tag, src: 'mass_mearth' },
    Ps: {
      v: num(card.surface_pressure_bar),
      tag: card.surface_pressure_bar?.tag,
      src: 'surface_pressure_bar',
    },
    Prot: {
      v: num(card.rot_period_h) === null ? null : num(card.rot_period_h)! / 24,
      tag: card.rot_period_h?.tag,
      src: 'rot_period_h',
    },
    fluid: {
      v: card.surface_fluid?.value ?? null,
      tag: card.surface_fluid?.tag,
      src: 'surface_fluid',
    },
  };
  for (const k of Object.keys(preset) as (keyof WorldPreset)[]) {
    const pv = preset[k];
    const cv = cardVals[k as string];
    if (cv && cv.v !== null && cv.tag) {
      const ok =
        typeof pv === 'number' && typeof cv.v === 'number'
          ? same(pv, cv.v)
          : typeof pv === 'string' && typeof cv.v === 'string'
            ? fluidKey(cv.v) === pv
            : false;
      if (ok) {
        tags[k] = cv.tag;
        continue;
      }
      mismatches.push(
        k +
          ': card ' +
          cv.src +
          ' = ' +
          String(cv.v) +
          ' but the artifact preset has ' +
          String(pv) +
          '; the preset value is used',
      );
    }
    if (k === 'id' || k === 'label' || k === 'type') {
      tags[k] = 'derived';
      continue;
    }
    tags[k] = k === 'pal' || k === 'L' || k === 'seed' ? 'artistic' : 'model_dependent';
    assumptions.push({
      field: k,
      value: typeof pv === 'object' ? JSON.stringify(pv) : (pv as number | string | boolean),
      tag: tags[k]!,
      note: 'artifact example setting (the approved prototype preset ' + pid + '); not on the card',
    });
  }
  preset.label = card.name;
  if (gen.ok && gen.preset.locked !== preset.locked)
    mismatches.push(
      'locked: the card rule gives ' +
        String(gen.preset.locked) +
        ', the artifact preset has ' +
        String(preset.locked) +
        '; the preset value is used',
    );
  return {
    ok: true,
    preset,
    overrides: { ...overrides },
    tags,
    assumptions,
    missing: [],
    mismatches,
    artifact: pid,
  };
}
