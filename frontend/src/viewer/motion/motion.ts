// Issue #42, R5.7, D-32, D-34: what moves, how fast, and which tier says so. Pure: no three.js.
//
// Every motion rate comes from `RenderParams.dynamics` and follows the tier chain of D-32:
//   rung 1  a measured card field in the same unit (`rot_period_h` -> `spin_period_h`,
//           `period_var_d` -> `pulsation_period_d`, `flare_rate_per_d` -> `flare_rate_per_d`); it wins over every other rung (R3.4),
//   rung 2+ the backend's `dynamics` value, with the tier it carries,
//   rung 4  a typical value for the kind of body (`MOTION_CONFIG.typical`; every entry is still
//           [verify], so it is `null` and answers nothing),
//   none    the rate is omitted and listed in `missing` as `dynamics:<key>`.
// A process is animated only when its time-lapse factor is stated in `dynamics.speedup` AND every
// rate it needs was answered. "A process with no stated speed-up is not animated" (reference
// checklist, section 2); nothing pretends to be real time (D-34).
import type { Dynamics, ObjectCard, ObjectType, RenderParams, Tag, Tier } from '@/contract';
import type { MissingItem } from '../planTypes';

export const MOTION_KEYS = [
  'spin_period_h',
  'diff_rotation',
  'jet_speed_ms',
  'spot_lifetime_d',
  'flare_rate_per_d',
  'pulsation_period_d',
] as const;
export type MotionKey = (typeof MOTION_KEYS)[number];

export type ProcessId = 'spin' | 'spots' | 'flares' | 'winds' | 'clouds' | 'pulsation';

export const TIER_OF_TAG: Readonly<Record<Tag, Tier>> = {
  measured: 1,
  derived: 2,
  model_dependent: 3,
  inferred_from_analog: 4,
  artistic: 5,
};
const TAG_OF_TIER: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];

/** The weakest (highest tier) of some tags: a result is never stronger than its inputs (D-32). */
export function weakestTag(tags: readonly Tag[]): Tag {
  let worst = 1;
  for (const t of tags) worst = Math.max(worst, TIER_OF_TAG[t]);
  return TAG_OF_TIER[worst - 1]!;
}

export interface RatePlan {
  key: MotionKey;
  /** In the unit of the `dynamics` key (hours, days, m/s, per day, or a plain factor). */
  value: number;
  tag: Tag;
  tier: Tier;
  source: string;
  formula?: string;
  assumed?: Record<string, number | string>;
  /** Which rung answered: the measured card field, the backend's `dynamics`, or a class value. */
  via: 'card' | 'dynamics' | 'class';
}

export interface ProcessPlan {
  id: ProcessId;
  /** Plain-words name shown next to the speed-up. */
  label: string;
  /** Time-lapse factor from `dynamics.speedup` (a display choice, never a claim). */
  speedup: number;
  /** The weakest tag among the rates it runs on. */
  tag: Tag;
  tier: Tier;
  /** Which rates it runs on, for the "how it is made" text. */
  rates: MotionKey[];
}

export interface Motion {
  rates: Partial<Record<MotionKey, RatePlan>>;
  /** Animated processes only. Empty when nothing moves. */
  processes: ProcessPlan[];
  /**
   * The processes that drive something DRAWN now (D-21, D-34), a subset of `processes`. Empty until
   * the plan is finished (`finishMotion`, called by `planRender`): a process whose layer is hidden
   * (honesty, view mode) is not registered on the clock, shows no note and does not keep the frame
   * loop running.
   */
  activeProcesses: ProcessId[];
  /** `dynamics:<key>` refusals (rates no rung could answer) and stated speed-ups with no rate. */
  missing: MissingItem[];
  notes: string[];
}

/** Simulation time of one process in sim seconds (the SimClock's `simTime`). */
export type SimTimeFn = (id: string) => number;

export const STILL_MOTION: Motion = {
  rates: {},
  processes: [],
  activeProcesses: [],
  missing: [],
  notes: [],
};

export interface MotionConfig {
  /**
   * Rung 4: a typical rate for the kind of body (D-32), keyed by object type and motion key.
   * Every value is [verify] (R7.4: "typical field-dwarf period (range [verify])"; R7.5.2 "typical k
   * by class: [verify]"), so none is set. A value here must carry a source in `source`.
   */
  typical: Partial<
    Record<ObjectType, Partial<Record<MotionKey, { value: number; source: string } | null>>>
  >;
}

/** [verify]: no typical rate is checked against a source yet, so rung 4 answers nothing. */
export const MOTION_CONFIG: MotionConfig = { typical: {} };

/** Which rates a body type runs on (R5.7 table). */
export const KEYS_BY_TYPE: Readonly<Partial<Record<ObjectType, readonly MotionKey[]>>> = {
  star: ['spin_period_h', 'diff_rotation', 'spot_lifetime_d', 'flare_rate_per_d'],
  star_ttauri: ['spin_period_h', 'diff_rotation', 'spot_lifetime_d', 'flare_rate_per_d'],
  star_mira: ['pulsation_period_d'],
  brown_dwarf: ['spin_period_h', 'jet_speed_ms'],
  brown_dwarf_binary: ['spin_period_h', 'jet_speed_ms'],
  gas_giant: ['spin_period_h', 'jet_speed_ms'],
  planet_rocky: ['spin_period_h', 'jet_speed_ms'],
  planet_water: ['spin_period_h', 'jet_speed_ms'],
};

const PROCESS_LABEL: Readonly<Record<ProcessId, string>> = {
  spin: 'Spin',
  spots: 'Spot changes',
  flares: 'Flares',
  winds: 'Winds',
  clouds: 'Cloud changes',
  pulsation: 'Pulsation',
};

/** Process -> the rates it needs (all of them). */
const PROCESS_RATES: Readonly<Record<ProcessId, readonly MotionKey[]>> = {
  spin: ['spin_period_h'],
  spots: ['spot_lifetime_d'],
  flares: ['flare_rate_per_d'],
  winds: ['jet_speed_ms'],
  clouds: ['jet_speed_ms'],
  pulsation: ['pulsation_period_d'],
};

/**
 * WCAG 2.3.1 (no more than three flashes in any second; R5.7 keeps it far lower): a flare process
 * starts at most this many flares per real second, however large the shown speed-up.
 */
export const MAX_FLARE_ONSETS_PER_REAL_S = 0.5;

/**
 * The flare speed-up shown and drawn: the one the card states, lowered so that the flare rate times
 * the speed-up stays at or below `MAX_FLARE_ONSETS_PER_REAL_S` real flares per second. Rounded down
 * to two significant figures; the label is always this value. Idempotent.
 */
export function cappedFlareSpeedup(requested: number, ratePerDay: number): number {
  const perRealS = (ratePerDay / 86400) * requested;
  if (!(perRealS > MAX_FLARE_ONSETS_PER_REAL_S)) return requested;
  const capped = (requested * MAX_FLARE_ONSETS_PER_REAL_S) / perRealS;
  const step = 10 ** (Math.floor(Math.log10(capped)) - 1);
  return Number((Math.floor(capped / step) * step).toPrecision(2));
}

const PROCESS_ORDER: readonly ProcessId[] = [
  'spin',
  'spots',
  'flares',
  'winds',
  'clouds',
  'pulsation',
];

/** The card field that holds a measured value of the same unit as a rate (R3.4: tier 1 wins). */
const CARD_FIELD: Partial<Record<MotionKey, 'rot_period_h' | 'period_var_d' | 'flare_rate_per_d'>> =
  {
    spin_period_h: 'rot_period_h',
    pulsation_period_d: 'period_var_d',
    // Issue #93 C: a measured flare rate from the literature registry (its band and threshold in `source`).
    flare_rate_per_d: 'flare_rate_per_d',
  };

function validValue(key: MotionKey, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  // Periods and lifetimes are > 0; a flare rate may be 0 (no flares); the rest must be finite.
  if (key === 'flare_rate_per_d') return v >= 0;
  if (key === 'diff_rotation' || key === 'jet_speed_ms') return true;
  return v > 0;
}

/** One rate, by the chain: measured card field, then `dynamics`, then a class value, else null. */
export function resolveRate(
  key: MotionKey,
  card: ObjectCard,
  params: RenderParams,
  config: MotionConfig = MOTION_CONFIG,
): RatePlan | null {
  const field = CARD_FIELD[key];
  if (field) {
    const tv = card[field];
    if (tv && tv.tag === 'measured' && validValue(key, tv.value)) {
      return { key, value: tv.value, tag: 'measured', tier: 1, source: tv.source, via: 'card' };
    }
  }
  const d = (params.dynamics as Dynamics | undefined)?.[key];
  if (d && validValue(key, d.value)) {
    // The tag fixes the tier (R3.4); a record whose two disagree is not trusted.
    const tier = TIER_OF_TAG[d.tag];
    if (tier === d.tier) {
      return {
        key,
        value: d.value,
        tag: d.tag,
        tier,
        source: d.source,
        formula: d.formula,
        assumed: d.assumed,
        via: 'dynamics',
      };
    }
  }
  const typ = config.typical[params.type]?.[key];
  if (typ && validValue(key, typ.value)) {
    return {
      key,
      value: typ.value,
      tag: 'inferred_from_analog',
      tier: 4,
      source: typ.source,
      via: 'class',
    };
  }
  return null;
}

export function resolveMotion(
  card: ObjectCard,
  params: RenderParams,
  config: MotionConfig = MOTION_CONFIG,
): Motion {
  const keys = KEYS_BY_TYPE[params.type] ?? [];
  const dyn = params.dynamics;
  if (keys.length === 0 || !dyn) {
    // Absent `dynamics`: no motion data, the body stays still (R3.4, R5.7).
    return {
      ...STILL_MOTION,
      notes: dyn || keys.length === 0 ? [] : ['There is no motion data, so the body stays still.'],
    };
  }

  const rates: Partial<Record<MotionKey, RatePlan>> = {};
  const missing: MissingItem[] = [];
  const notes: string[] = [];
  for (const key of keys) {
    const r = resolveRate(key, card, params, config);
    if (r) rates[key] = r;
    else
      missing.push({
        id: `dynamics:${key}`,
        reason: 'data',
        detail: 'No measured value, formula or typical value gives this rate.',
      });
  }

  const processes: ProcessPlan[] = [];
  for (const id of PROCESS_ORDER) {
    const need = PROCESS_RATES[id].filter((k) => keys.includes(k));
    if (need.length === 0) continue;
    // Which processes a type can run: every process whose rate is on its key list.
    if (id === 'clouds' && params.type !== 'gas_giant') continue;
    const speedup = dyn.speedup?.[id];
    const stated = typeof speedup === 'number' && Number.isFinite(speedup) && speedup > 0;
    if (!stated) continue; // no stated speed-up: not animated
    if (!need.every((k) => rates[k])) continue; // refused above as dynamics:<key>
    processes.push({
      id,
      label: PROCESS_LABEL[id],
      speedup:
        id === 'flares' ? cappedFlareSpeedup(speedup!, rates.flare_rate_per_d!.value) : speedup!,
      tag: weakestTag(need.map((k) => rates[k]!.tag)),
      tier: TIER_OF_TAG[weakestTag(need.map((k) => rates[k]!.tag))],
      rates: [...need],
    });
  }
  // The cloud detail rides on the winds clock (jets advect it), so it needs the winds process.
  const filtered = processes.some((p) => p.id === 'winds')
    ? processes
    : processes.filter((p) => p.id !== 'clouds');
  return { rates, processes: filtered, activeProcesses: [], missing, notes };
}

/** The process plan with this id, if it is animated. */
export function processOf(m: Motion, id: ProcessId): ProcessPlan | undefined {
  return m.processes.find((p) => p.id === id);
}

export const processLabel = (id: ProcessId): string => PROCESS_LABEL[id];

/** Radians per simulated second of the spin, or 0 when the spin is not animated. */
export function spinRateRadPerSimS(m: Motion): number {
  const spin = m.rates.spin_period_h;
  if (!spin || !processOf(m, 'spin')) return 0;
  return (2 * Math.PI) / (spin.value * 3600);
}
