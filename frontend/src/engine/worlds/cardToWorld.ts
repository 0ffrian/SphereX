// D-37: build the prototype's preset object (sculptor-preview-next.html WP) from ANY ObjectCard.
// Deterministic; no network; no GL. A measurement becomes a parameter by arithmetic only. Where the prototype
// assumed a value (fluid water, 1 bar, mu, sea share 0.5, no eccentricity or obliquity) the same default is used,
// tagged model_dependent and listed in `assumptions`. A missing required input refuses: `{ ok: false, missing }`.
import type { ObjectCard, Tag } from '@/contract';
import { MEASURED_FLATTENING, MEASURED_PEAK_WIND_MS, WIND_DT_FLOOR_K } from '@/physics/gasDynamics';
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
  /**
   * Eclipse and phase-curve values from the card (issue #93 C), shown as readouts next to the engine's own day and
   * night numbers. The engine does not take them as inputs yet (its day-night contrast is its own model).
   */
  measured: MeasuredReadout[];
}

/** One card value shown as it is, with its tag and source (never fed to the engine). */
export interface MeasuredReadout {
  field: 'dayside_temp_K' | 'nightside_temp_K' | 'hotspot_offset_deg';
  label: string;
  value: string;
  tag: Tag;
  source: string;
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
/** The prototype's Bond albedo when a preset has none (worldModel: `p.A != null ? p.A : 0.3`). */
const DEFAULT_ALBEDO = 0.3;
/** Albedo range a card temperature may be inverted to (a Bond albedo cannot be negative; 0.95 keeps it physical). */
const ALBEDO_MIN = 0;
const ALBEDO_MAX = 0.95;
/** Solar radius in AU (IAU 2015 nominal R_sun / au), as the engine's worldModel uses it. */
const RSUN_AU = 0.00465047;
/**
 * Basalt solidus, K (Lesher and Spera 2015; the engine's LAVA.Tsol). A rocky world whose equilibrium temperature is
 * above it has molten rock on its day side and can hold only a thin rock-vapour atmosphere.
 */
const ROCK_SOLIDUS_K = 1400;
/**
 * The thin rock-vapour atmosphere given to such a world when its card has no pressure: the artifact's own lava-world
 * example (WP 'lava': 0.005 bar, mu 44, no sea), so the engine draws it airless (below 0.02 bar) with the magma
 * showing. Rock-vapour atmospheres of lava planets are of order millibars or less (Schaefer and Fegley 2009, ApJ 703,
 * L113; Ito et al. 2015, ApJ 801, 144) [verify]. `inferred_from_analog`.
 */
const ROCK_VAPOUR = { Ps: 0.005, mu: 44, sea: 0 };

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

/**
 * Jupiter and Saturn: their measured peak jet speed and flattening replace the engine's estimates (#89 review 5, 6).
 * The engine reads them as p.Umeas and p.fMeas (core.js, declared renames).
 */
function setMeasuredGiant(
  preset: WorldPreset,
  tags: Record<string, Tag>,
  ref: string | undefined,
): void {
  if (ref !== 'jup' && ref !== 'sat') return;
  preset.Umeas = MEASURED_PEAK_WIND_MS[ref];
  preset.fMeas = MEASURED_FLATTENING[ref];
  tags.Umeas = 'measured';
  tags.fMeas = 'measured';
}

/** The engine's equilibrium temperature at zero albedo, K: T_star sqrt(R_star / 2a) (worldModel). */
function teqZeroAlbedo(Ts: number, Rs: number, a: number): number {
  return Ts * Math.sqrt((Rs * RSUN_AU) / (2 * a));
}

const TIER: Record<Tag, number> = {
  measured: 1,
  derived: 2,
  model_dependent: 3,
  inferred_from_analog: 4,
  artistic: 5,
};
/** `derived`, or weaker when an input is weaker (D-32: a result is never stronger than its inputs). */
function derivedFrom(...tags: (Tag | undefined)[]): Tag {
  let t: Tag = 'derived';
  for (const x of tags) if (x && TIER[x] > TIER[t]) t = x;
  return t;
}

/**
 * Issue #93 B: the engine uses R_star only for the starlight (worldModel: S = sigma T^4 (R_star / a)^2, Teq from the
 * same), so a measured host luminosity enters as the radius that gives it at the card's T_star:
 * R = sqrt(L / L_sun) (5772 K / T_star)^2 (L = 4 pi R^2 sigma T^4, nominal solar Teff 5772 K). Else the card's
 * insolation with its orbit, L = S a^2 (S in Earth units, a in AU). Else null: R_star and T_star as before.
 */
function starlightRadius(
  card: ObjectCard,
  Ts: number,
  a: number,
): { Rs: number; tag: Tag; note: string } | null {
  const k = Math.pow(SUN.Ts / Ts, 2);
  const L = num(card.host_lum_lsun);
  if (L !== null && L > 0)
    return {
      Rs: Math.sqrt(L) * k,
      tag: derivedFrom(card.host_lum_lsun!.tag, card.host_teff_K?.tag),
      note:
        "starlight from the card's host luminosity " +
        L.toPrecision(4) +
        ' L_sun (' +
        card.host_lum_lsun!.tag +
        '): R_star = sqrt(L) (5772 K / T_star)^2, so the engine, which reads R_star only for the starlight, gives that luminosity',
    };
  const S = num(card.insolation_searth);
  if (S !== null && S > 0)
    return {
      Rs: Math.sqrt(S * a * a) * k,
      tag: derivedFrom(card.insolation_searth!.tag, card.orbit_au?.tag, card.host_teff_K?.tag),
      note:
        "starlight from the card's insolation " +
        S.toPrecision(4) +
        ' S_earth (' +
        card.insolation_searth!.tag +
        '): L = S a^2, R_star = sqrt(L) (5772 K / T_star)^2, so the engine, which reads R_star only for the starlight, gives that flux',
    };
  return null;
}

const MEASURED_LABEL: Record<MeasuredReadout['field'], string> = {
  dayside_temp_K: 'Day side, measured',
  nightside_temp_K: 'Night side, measured',
  hotspot_offset_deg: 'Hottest point, measured',
};

/** The card's eclipse and phase-curve values (issue #93 C), as readouts. A null value is not shown. */
export function measuredReadouts(card: ObjectCard): MeasuredReadout[] {
  const out: MeasuredReadout[] = [];
  for (const field of Object.keys(MEASURED_LABEL) as MeasuredReadout['field'][]) {
    const tv = card[field];
    const v = num(tv);
    if (!tv || v === null) continue;
    const err = typeof tv.err === 'number' ? ' ± ' + String(+tv.err.toPrecision(3)) : '';
    const value =
      field === 'hotspot_offset_deg'
        ? String(Math.abs(v)) + err + '° ' + (v >= 0 ? 'east' : 'west') + ' of noon'
        : String(Math.round(v)) + err + ' K';
    out.push({ field, label: MEASURED_LABEL[field], value, tag: tv.tag, source: tv.source });
  }
  return out;
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
  const starlight = starlightRadius(card, Ts, a);
  if (starlight) {
    Rs = starlight.Rs;
    tags.Rs = starlight.tag;
    assumptions.push({
      field: 'Rs',
      value: Number(Rs.toFixed(4)),
      tag: starlight.tag,
      note: starlight.note,
    });
  }
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
  // Equilibrium temperature: the card's measured one when it has it (#89 review 10), else the engine's own with the
  // default albedo. Used here to recognise a lava world; the albedo below makes the engine agree with the card.
  const teqCard = num(card.teq_K);
  const T0 = teqZeroAlbedo(Ts, Rs, a);
  const teqEst = teqCard ?? T0 * Math.pow(1 - DEFAULT_ALBEDO, 0.25);
  const PsCard = num(card.surface_pressure_bar);
  const lavaWorld = !gas && PsCard === null && teqEst >= ROCK_SOLIDUS_K;
  let Ps = 1;
  if (PsCard !== null) {
    Ps = PsCard;
    tags.Ps = card.surface_pressure_bar!.tag;
  } else if (lavaWorld) {
    // 55 Cnc e and its kind (Q-317, Q-319): the generic 1 bar of water made a runaway steam world whose haze hid
    // the magma; a world this hot keeps only a thin rock-vapour atmosphere.
    Ps = ROCK_VAPOUR.Ps;
    tags.Ps = 'inferred_from_analog';
    assumptions.push({
      field: 'Ps',
      value: Ps,
      tag: 'inferred_from_analog',
      note:
        'no surface pressure on the card, and the world is hotter than molten rock (Teq ' +
        Math.round(teqEst) +
        ' K, above the basalt solidus of ' +
        ROCK_SOLIDUS_K +
        " K): a thin rock-vapour atmosphere of 0.005 bar, as the artifact's lava-world example, so it is drawn airless with the magma showing",
    });
  } else
    assume(
      'Ps',
      Ps,
      gas
        ? 'not used for a giant; 1 bar as the prototype'
        : 'no surface pressure on the card; 1 bar, as the prototype defaults',
    );

  const mu = lavaWorld
    ? ROCK_VAPOUR.mu
    : gas
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
    lavaWorld
      ? 'rock-vapour air (the artifact lava-world example, 44 g/mol)'
      : gas
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
  if (lavaWorld) {
    preset.sea = ROCK_VAPOUR.sea;
    preset.oceanF = 0;
    tags.sea = 'inferred_from_analog';
    tags.oceanF = 'inferred_from_analog';
    assumptions.push({
      field: 'sea',
      value: 0,
      tag: 'inferred_from_analog',
      note: 'no water ocean on a world above the rock solidus (the artifact lava-world example); the magma sea is drawn instead',
    });
  } else if (!gas) {
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
  // Bond albedo. The engine computes Teq = T0 (1 - A)^1/4 itself, so a measured temperature on the card is honoured
  // by choosing A to match it (#89 review 10); otherwise the card's albedo, otherwise the prototype's 0.3.
  const tSurfCard = gas ? null : num(card.surface_temperature_K);
  const albedo = num(card.albedo);
  const invert = (target: number, factor: number): { A: number; clamped: boolean } => {
    const raw = 1 - Math.pow(target / (T0 * factor), 4);
    const A = Math.min(ALBEDO_MAX, Math.max(ALBEDO_MIN, raw));
    return { A, clamped: A !== raw };
  };
  if (tSurfCard !== null) {
    // The engine's grey greenhouse: Ts = Teq (1 + 0.75 tau)^1/4, tau = 0.8 Ps (x1.8 under CO2), none below 0.02 bar.
    const tau = Ps < 0.02 ? 0 : 0.8 * Ps * (fluid === 'co2' ? 1.8 : 1);
    const r = invert(tSurfCard, Math.pow(1 + 0.75 * tau, 0.25));
    preset.A = r.A;
    tags.A = 'derived';
    assumptions.push({
      field: 'A',
      value: Number(r.A.toFixed(3)),
      tag: 'derived',
      note:
        "Bond albedo chosen so the engine's mean surface temperature equals the card's " +
        tSurfCard +
        ' K (' +
        card.surface_temperature_K!.tag +
        '): A = 1 - (Ts / (T0 (1 + 0.75 tau)^1/4))^4, T0 = T_star sqrt(R_star / 2a)' +
        (r.clamped ? '; held at ' + r.A : ''),
    });
  } else if (teqCard !== null) {
    const r = invert(teqCard, 1);
    preset.A = r.A;
    tags.A = 'derived';
    assumptions.push({
      field: 'A',
      value: Number(r.A.toFixed(3)),
      tag: 'derived',
      note:
        "Bond albedo chosen so the engine's equilibrium temperature equals the card's " +
        teqCard +
        ' K (' +
        card.teq_K!.tag +
        '): A = 1 - (Teq / T0)^4, T0 = T_star sqrt(R_star / 2a) = ' +
        Math.round(T0) +
        ' K' +
        (r.clamped
          ? teqCard > T0
            ? "; the card's Teq is hotter than zero albedo with full heat redistribution allows (the catalogue assumes less redistribution), so A = 0"
            : "; the card's Teq is very cold, so A is held at " + ALBEDO_MAX
          : ''),
    });
  } else if (albedo !== null) {
    preset.A = albedo;
    tags.A = 'model_dependent';
    assumptions.push({
      field: 'A',
      value: albedo,
      tag: 'model_dependent',
      note:
        "the card's albedo (" +
        card.albedo!.tag +
        ') used as the Bond albedo; a geometric albedo (as catalogues give for small bodies) differs from the Bond albedo by the phase integral, which is not on the card',
    });
  } else
    assume(
      'A',
      DEFAULT_ALBEDO,
      'no albedo or temperature on the card; Bond albedo 0.3, as the prototype defaults',
    );
  if (gas && !refGiant) {
    assume(
      'U',
      'thermal-wind estimate',
      'jet speed U = 0.6 sqrt(R_specific dT) with dT = ' +
        (locked
          ? 'eps 0.6 Ts (locked)'
          : 'max(' +
            WIND_DT_FLOOR_K +
            ' K, eps 0.6 Ts); for a cool giant eps hits its floor, so the ' +
            WIND_DT_FLOOR_K +
            ' K floor sets U near 115-120 m/s: a floor, not a prediction'),
    );
    assume(
      'flat',
      '0.7 q',
      'flattening from the spin, f = 0.7 Omega^2 R^3 / (G M), an estimate (it gives Saturn 0.108 against the measured 0.098)',
    );
  }
  // Orbit extras (the prototype's ORB table): host mass and eccentricity from the card when it has them (issue #93 A);
  // the obliquity is never on the card. The engine's setPreset reads ob.e into W.ecc (seasons, tides, mean flux).
  const ecc = num(card.orbit_ecc);
  const eccOk = ecc !== null && ecc >= 0 && ecc < 1;
  preset.ob = { Ms: Ms ?? 1, e: eccOk ? ecc : 0, obl: 0 };
  if (Ms === null)
    assume('ob.Ms', 1, 'no host mass on the card; 1 M_sun, as the prototype defaults for tides');
  if (eccOk) tags['ob.e'] = card.orbit_ecc!.tag;
  else assume('ob.e', 0, 'eccentricity is not on the card; circular, as the prototype defaults');
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
    setMeasuredGiant(preset, tags, refGiant);
  }

  return {
    ok: true,
    preset,
    overrides: { ...overrides },
    tags,
    assumptions,
    missing: [],
    mismatches: [],
    measured: measuredReadouts(card),
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
};
/** Relative tolerance for a disagreement worth listing in `mismatches`. */
const ROUND_TOL = 0.03;
/**
 * Relative tolerance for "the preset holds the card's value" (the prototype rounds its inputs to 3 or 4 figures, at
 * most 0.13% for the objects here). Only then does the preset value carry the card's tag; a larger difference
 * (Titan's 1.5 bar against the measured 1.467) is the artifact's own setting, `inferred_from_analog`.
 */
const CARD_TOL = 0.005;
const within = (a: number, b: number, tol: number): boolean =>
  Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9);

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
      const nums = typeof pv === 'number' && typeof cv.v === 'number';
      const ok = nums
        ? within(pv as number, cv.v as number, CARD_TOL)
        : typeof pv === 'string' && typeof cv.v === 'string'
          ? fluidKey(cv.v) === pv
          : false;
      if (ok) {
        tags[k] = cv.tag;
        continue;
      }
      if (!nums || !within(pv as number, cv.v as number, ROUND_TOL))
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
      // The preset's value is the artifact's setting, not the card's measurement: it must not carry the card's tag.
      tags[k] = 'inferred_from_analog';
      assumptions.push({
        field: k,
        value: pv as number | string,
        tag: 'inferred_from_analog',
        note:
          'artifact example setting (the approved prototype preset ' +
          pid +
          '); the card says ' +
          String(cv.v) +
          ' (' +
          cv.src +
          ', ' +
          cv.tag +
          "), the preset's " +
          String(pv) +
          ' is used',
      });
      continue;
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
  if (pid === 'tit') {
    // The preset mixed Titan's 15.95-day orbit around Saturn (P) with Saturn's 9.58 AU orbit around the Sun (a). The
    // engine's orbit is the heliocentric one: a, the eccentricity and the obliquity set Titan's starlight and seasons
    // (Saturn's), and "locked" means locked to the star. So P is Saturn's year (Kepler, host 1 M_sun), and the
    // 15.95-day orbit around Saturn stays where it acts, as Titan's spin (Prot). Only the tidal-heat row reads P, and
    // it is negligible either way.
    preset.P = 365.25 * Math.pow(preset.a, 1.5);
    tags.P = 'derived';
    const i = assumptions.findIndex((x) => x.field === 'P');
    if (i >= 0) assumptions.splice(i, 1);
    assumptions.push({
      field: 'P',
      value: Number(preset.P.toFixed(0)),
      tag: 'derived',
      note:
        "the orbit around the Sun (Saturn's year, P = 365.25 a^1.5 days), consistent with a = " +
        preset.a +
        " AU; Titan's 15.95-day orbit around Saturn is its spin",
    });
  }
  setMeasuredGiant(preset, tags, pid);
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
    measured: measuredReadouts(card),
  };
}
