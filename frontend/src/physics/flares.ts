// Issue #71 stream G, D-36: flares and plasma on a star. Pure and deterministic: every function is a
// function of (stellar model, seed, display time) and nothing else. No Math.random, no Date, no
// frame time. Scrubbing works because each plasma particle is a pure function of the event's age.
//
// Chain (tags, D-02 / D-32, R7.5.5):
//   which group flares, and when      inferred_from_analog (seeded draw at real spot groups)
//   energy E                          inferred_from_analog (power law dN/dE ~ E^-2, flare statistics
//                                     of the Sun and active stars, Hawley et al. 2014 [verify])
//   E_max = 0.1 (B^2/8pi) A^(3/2)     model_dependent (the energy budget of Shibata et al. 2013,
//                                     PASJ 65, 49; B = 1000 G and the 0.1 efficiency are [verify], issue #71)
//   decay index n = 3 h^2/(a^2+h^2)   model_dependent (Kliem and Torok 2006 torus threshold, n >= 1.5)
//   open or closed, loop shape        model_dependent
//   wisps, side-on turning, colours   artistic
//
// Geometry: a group is a bipole. In its local frame `a` runs along the polarity axis (leader to
// follower), `l` along the neutral line and `h` is height in stellar radii. Loops are arches
// a(s) = -A cos(pi s), l(s) = L + sh cos(pi s), h(s) = H sin(pi s), s in 0..1.

import { hash3 } from '@/viewer/fields/noise';
import type { SpotGroup, Vec3 } from './stellar';

// ---- constants -----------------------------------------------------------------------------------
/** Field strength for the energy cap, gauss (issue #71; sunspot umbra 2000-3000 G, flare sites about 1000 G). [verify] */
export const B_FLARE_G = 1000;
/** Fraction of the magnetic energy a flare can release, in E_max = 0.1 (B^2/8 pi) A^(3/2). [verify] */
export const FLARE_EFFICIENCY = 0.1;
/** Solar radius, cm (IAU 2015 B3: 6.957e10 cm). */
export const R_SUN_CM = 6.957e10;
/** Reference flare energy (an M-class flare), erg. Artistic anchor of the displayed class scale. */
export const E_REF_ERG = 1e30;
/** Decay-index threshold above which the rope is unstable and the flare opens (Kliem and Torok 2006). */
export const DECAY_THRESHOLD = 1.5;
/** Smallest gap between two flare starts on screen, display seconds (WCAG 2.3.1: under 3 flashes per second). */
export const MIN_GAP_S = 1.4;
export const MAX_GAP_S = 14;
/** Streak budget (issue #71 stream G): `high` and `low` quality levels. */
export const STREAK_BUDGET = { high: 60000, medium: 40000, low: 24000 } as const;
/** Loops are drawn this many times larger in the enlarged view (artistic, said in the layer). */
export const ENLARGE_FACTOR = 3;

// ---- energy and class ---------------------------------------------------------------------------
/** E_max of a group, erg: 0.1 (B^2/8pi) A^(3/2), A in cm^2 from the area fraction of the whole surface. */
export function emaxErg(areaFraction: number, radiusRsun: number): number {
  const rcm = radiusRsun * R_SUN_CM;
  const aCm2 = areaFraction * 4 * Math.PI * rcm * rcm;
  return FLARE_EFFICIENCY * ((B_FLARE_G * B_FLARE_G) / (8 * Math.PI)) * Math.pow(aCm2, 1.5);
}

/** n = 3 h^2 / (a^2 + h^2) with x = h / a, the rope height over half the pole separation. */
export const decayIndexOf = (x: number): number => (3 * x * x) / (1 + x * x);
export const opens = (n: number): boolean => n >= DECAY_THRESHOLD;

/**
 * C, M or X class from the energy (display scale from E_REF: C below 1e30, M to 1e31, X above).
 * The GOES classes are defined by peak soft X-ray flux, not energy: these energy thresholds are a
 * convention, taken at the low end of published bolometric energies (an X1 flare is about 1-3e31 erg,
 * Emslie et al. 2012, ApJ 759, 71).
 */
export function flareClass(e: number): string {
  if (e >= 10 * E_REF_ERG) return `X${(e / (10 * E_REF_ERG)).toFixed(1)}`;
  if (e >= E_REF_ERG) return `M${(e / E_REF_ERG).toFixed(1)}`;
  return `C${(e / (0.1 * E_REF_ERG)).toFixed(1)}`;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number): string =>
  String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : SUP[+c]))
    .join('');

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---- the schedule --------------------------------------------------------------------------------
export interface ScheduleContext {
  seed: number;
  groups: readonly SpotGroup[];
  radiusRsun: number;
  /** Flares per display second the star would show (from the flare rate and the speed-up). */
  ratePerDisplayS: number;
}

export interface FlareEvent {
  /** Index in the schedule (negative for fired-by-hand events). */
  m: number;
  /** Display second the flare starts, and how long it lasts. */
  t0: number;
  life: number;
  groupId: number;
  energyErg: number;
  /** Rope height over half the pole separation (x), decay index n, and the outcome. */
  x: number;
  decayIndex: number;
  open: boolean;
  /** Per-event seed for the plasma particles. */
  s: number;
}

/** Gap between starts, display seconds, from the rate; never under MIN_GAP_S, never over MAX_GAP_S. */
export function gapOf(ratePerDisplayS: number): number {
  if (!(ratePerDisplayS > 0)) return MAX_GAP_S;
  return clamp(1 / ratePerDisplayS, MIN_GAP_S, MAX_GAP_S);
}

/** The lowest energy drawn: raised on very active stars so a flare still starts no more often than the floor. */
export function thresholdErg(ratePerDisplayS: number): number {
  const d = ratePerDisplayS > 0 ? 1 / ratePerDisplayS : MAX_GAP_S;
  return E_REF_ERG * Math.max(1, MIN_GAP_S / d);
}

/** Slot length: consecutive starts are at least half a slot apart, so at least MIN_GAP_S. */
export const slotOf = (gap: number): number => Math.max(gap, 2 * MIN_GAP_S);

function pickGroup(ctx: ScheduleContext, m: number): SpotGroup | null {
  let tot = 0;
  const w = ctx.groups.map((g) => {
    const x = Math.sqrt(g.areaFraction);
    tot += x;
    return x;
  });
  if (!(tot > 0)) return null;
  let u = hash3(m, 21, 0, ctx.seed) * tot;
  for (let i = 0; i < w.length; i++) {
    u -= w[i]!;
    if (u <= 0) return ctx.groups[i]!;
  }
  return ctx.groups[ctx.groups.length - 1]!;
}

/** Builds one event at a group. `forceErg` caps to the group's E_max (the "big flare" button). */
export function makeEvent(
  ctx: ScheduleContext,
  m: number,
  t0: number,
  group: SpotGroup,
  forceErg?: number,
): FlareEvent {
  const em = emaxErg(group.areaFraction, ctx.radiusRsun);
  const emin = Math.min(thresholdErg(ctx.ratePerDisplayS), em * 0.5);
  // Power law dN/dE ~ E^-2 between emin and em: inverse-CDF draw.
  const u = hash3(m, 22, 0, ctx.seed);
  const draw = 1 / (1 / emin - u * (1 / emin - 1 / em));
  const E = forceErg !== undefined ? Math.min(forceErg, em) : draw;
  // Rope height over half the pole separation grows with energy; widely separated poles are harder to open.
  const x = clamp(
    (0.45 + 0.6 * Math.log10(E / E_REF_ERG) + (hash3(m, 23, 0, ctx.seed) - 0.5) * 0.5) *
      Math.pow(0.06 / group.separationRad, 0.25),
    0.15,
    3,
  );
  const n = decayIndexOf(x);
  return {
    m,
    t0,
    life: clamp(6 + 2.2 * Math.log10(E / E_REF_ERG), 5, 12),
    groupId: group.id,
    energyErg: E,
    x,
    decayIndex: n,
    open: opens(n),
    s: Math.floor(hash3(m, 24, 0, ctx.seed) * 1e9),
  };
}

/** Event number m of the schedule, or null when the star has no group. Pure in (ctx, m). */
export function scheduledEvent(ctx: ScheduleContext, m: number): FlareEvent | null {
  const g = pickGroup(ctx, m);
  if (!g) return null;
  const slot = slotOf(gapOf(ctx.ratePerDisplayS));
  const t0 = m * slot + slot * 0.5 * hash3(m, 25, 0, ctx.seed);
  return makeEvent(ctx, m, t0, g);
}

/** Events on screen at display time t (those with t0 <= t < t0 + life), oldest first. */
export function eventsAt(ctx: ScheduleContext, t: number): FlareEvent[] {
  if (t < 0 || ctx.groups.length === 0 || !(ctx.ratePerDisplayS > 0)) return [];
  const slot = slotOf(gapOf(ctx.ratePerDisplayS));
  const out: FlareEvent[] = [];
  const m1 = Math.floor(t / slot);
  const back = Math.ceil(12 / slot) + 1;
  for (let m = Math.max(0, m1 - back); m <= m1; m++) {
    const e = scheduledEvent(ctx, m);
    if (e && t >= e.t0 && t < e.t0 + e.life) out.push(e);
  }
  return out;
}

/** The most recent flare that has started by t (shown in the "Latest flare" card), or null. */
export function latestEvent(ctx: ScheduleContext, t: number): FlareEvent | null {
  if (ctx.groups.length === 0 || !(ctx.ratePerDisplayS > 0) || t < 0) return null;
  const slot = slotOf(gapOf(ctx.ratePerDisplayS));
  for (let m = Math.floor(t / slot); m >= Math.max(0, Math.floor(t / slot) - 4); m--) {
    const e = scheduledEvent(ctx, m);
    if (e && e.t0 <= t) return e;
  }
  return null;
}

/** Plain words for one flare (the "Latest flare" card). */
export function flareText(e: FlareEvent): string {
  const ex = Math.floor(Math.log10(e.energyErg));
  const mant = e.energyErg / Math.pow(10, ex);
  return (
    `Class ${flareClass(e.energyErg)}, ${mant.toFixed(1)}×10${sup(ex)} erg. ` +
    `The rope climbs to ${e.x.toFixed(2)} of the half-distance between the poles, so the decay index is n = ${e.decayIndex.toFixed(2)}. ` +
    (e.open
      ? `That is above ${DECAY_THRESHOLD}, so the field opens and an eruption leaves the star.`
      : `That is below ${DECAY_THRESHOLD}, so the field holds and the flare stays closed.`)
  );
}

// ---- stages of one flare (close-up view) ---------------------------------------------------------
/** The five named stages with the time (0..1 of the 60 minutes shown) each starts at. */
export const STAGES = [
  { id: 'pre', label: 'Stressed field', at: 0.08, upto: 0.16 },
  { id: 'trig', label: 'Rope rises', at: 0.22, upto: 0.27 },
  { id: 'imp', label: 'Reconnection', at: 0.34, upto: 0.44 },
  { id: 'grad', label: 'Hot loops', at: 0.62, upto: 0.86 },
  { id: 'end', label: 'Afterwards', at: 0.93, upto: 1.01 },
] as const;
export const stageIndex = (t: number): number => {
  const bounds = [0.16, 0.27, 0.44, 0.86];
  let i = 0;
  while (i < 4 && t >= bounds[i]!) i++;
  return i;
};
export const STAGE_TEXT: Record<(typeof STAGES)[number]['id'], { closed: string; open: string }> = {
  pre: {
    closed:
      'A twisted rope of plasma sits low along the line between north and south polarities. Loops above hold it down.',
    open: 'A twisted rope of plasma sits low along the line between north and south polarities. The field above it is weak.',
  },
  trig: {
    closed:
      'The rope lifts and starts to squeeze the loops above it. They are strong enough to push back.',
    open: 'The rope lifts. The field above weakens fast enough that each rise makes the next one easier.',
  },
  imp: {
    closed:
      'Field lines snap and rejoin low in the corona. Fast electrons hit the surface and two bright ribbons flash. The rope stalls.',
    open: 'A thin current sheet forms under the escaping rope. Field reconnects through it and two bright ribbons flash at the feet.',
  },
  grad: {
    closed:
      'Heated plasma fills loops that stay about the same size. They cool from white through gold to red, and plasma rains back down.',
    open: 'New loops stack higher as reconnection climbs, so the ribbons move apart. Field above stays stretched open, and the eruption leaves the star.',
  },
  end: {
    closed:
      'The field is still closed. Nothing left the star, so this flare sends no eruption into space.',
    open: 'A coronal mass ejection is on its way out. The opened field slowly closes again behind it.',
  },
};

/** Hard X-ray impulse shape (Neupert effect: hard X-rays follow the time derivative of the soft). */
export const impulseAt = (t: number): number =>
  smooth(0.255, 0.3, t) * (t < 0.34 ? 1 : Math.exp(-(t - 0.34) / 0.12));
/** Soft X-ray light curve, 0..1: rises while the hard burst runs, then decays (open decays slower). */
export function softXray(t: number, open: boolean): number {
  const tau = open ? 0.27 : 0.15;
  return t < 0.47 ? smooth(0.26, 0.47, t) : Math.exp(-(t - 0.47) / tau);
}
/** Soft and hard curves at n + 1 points. Hard = d(soft)/dt with a seeded spiky factor, scaled to 1 (Neupert 1968). */
export function lightCurves(open: boolean, seed = 5, n = 240): { soft: number[]; hard: number[] } {
  const soft: number[] = [];
  const hard: number[] = [];
  let mx = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = softXray(t, open);
    const b = softXray(t + 1 / n, open);
    soft.push(a);
    const h = Math.max(0, (b - a) * n) * (0.72 + 0.56 * hash3(i, 26, 0, seed));
    hard.push(h);
    mx = Math.max(mx, h);
  }
  return { soft, hard: hard.map((v) => (mx > 0 ? v / mx : 0)) };
}

// ---- temperature ramp ----------------------------------------------------------------------------
/** Temperature 0 (cool, red) to 1 (hot, blue-white) to colour. Artistic ramp of the SDO look. */
export function tempRamp(t: number): Vec3 {
  const a: Vec3 = [0.62, 0.035, 0.01];
  const b: Vec3 = [1, 0.3, 0.035];
  const c: Vec3 = [1, 0.72, 0.22];
  const d: Vec3 = [1, 0.95, 0.82];
  const e: Vec3 = [0.72, 0.86, 1];
  const mix = (p: Vec3, q: Vec3, k: number): Vec3 => [
    lerp(p[0], q[0], k),
    lerp(p[1], q[1], k),
    lerp(p[2], q[2], k),
  ];
  t = clamp(t, 0, 1);
  if (t < 0.3) return mix(a, b, t / 0.3);
  if (t < 0.6) return mix(b, c, (t - 0.3) / 0.3);
  if (t < 0.85) return mix(c, d, (t - 0.6) / 0.25);
  return mix(d, e, (t - 0.85) / 0.15);
}

// ---- streak sink ---------------------------------------------------------------------------------
/** A fixed-size buffer of line segments: positions (6 floats) and colours (6 floats) per streak. */
export class StreakSink {
  readonly pos: Float32Array;
  readonly col: Float32Array;
  n = 0;
  /** Streaks accepted; may be lowered below the allocation (quality level). */
  cap: number;
  constructor(alloc: number) {
    this.cap = alloc;
    this.pos = new Float32Array(alloc * 6);
    this.col = new Float32Array(alloc * 6);
  }
  reset(): void {
    this.n = 0;
  }
  /** Adds a streak head to tail; the tail is dimmer. Refused once the budget is full. */
  push(p0: Vec3, p1: Vec3, temp: number, density: number): boolean {
    if (this.n >= this.cap) return false;
    const c = tempRamp(temp);
    const k = clamp(density * STREAK_GAIN, 0, 1.6);
    const i = this.n * 6;
    this.pos[i] = p0[0];
    this.pos[i + 1] = p0[1];
    this.pos[i + 2] = p0[2];
    this.pos[i + 3] = p1[0];
    this.pos[i + 4] = p1[1];
    this.pos[i + 5] = p1[2];
    for (let j = 0; j < 3; j++) {
      this.col[i + j] = c[j]! * k;
      this.col[i + 3 + j] = c[j]! * k * 0.12;
    }
    this.n++;
    return true;
  }
}
/** Display gain of one streak (artistic). */
const STREAK_GAIN = 6;

// ---- geometry of a group's local frame -----------------------------------------------------------
/** Point at (a, l) in the group's tangent plane, lifted to height h above the unit sphere. */
export function groupPoint(g: SpotGroup, a: number, l: number, h: number): Vec3 {
  const x = g.centre[0] + g.polarityAxis[0] * a + g.crossAxis[0] * l;
  const y = g.centre[1] + g.polarityAxis[1] * a + g.crossAxis[1] * l;
  const z = g.centre[2] + g.polarityAxis[2] * a + g.crossAxis[2] * l;
  const k = (1 + h) / (Math.hypot(x, y, z) || 1);
  return [x * k, y * k, z * k];
}

/** Maps local (a, l, h) to a point. The star uses `groupPoint`; the close-up uses a plane. */
export type Mapper = (a: number, l: number, h: number) => Vec3;

/**
 * Is a point at `p` hidden by the disc seen from direction `view` (unit vector from the star to the
 * camera)? True when it is behind the limb plane and inside the disc silhouette.
 */
export function occludedByDisc(p: Vec3, view: Vec3, radius = 1): boolean {
  const d = p[0] * view[0] + p[1] * view[1] + p[2] * view[2];
  if (d >= 0) return false;
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - d * d;
  return r2 < radius * radius;
}

const pr = (seed: number, k: number): number => hash3(k, 31, 0, seed);

interface Emit {
  sink: StreakSink;
  at: Mapper;
  /** Particle count scale, 1 on high; lower on low (quality only). */
  q: number;
  /** Streak length and the stroke weight scale. */
  len: number;
}

/** One streak along an arch at parameter s. */
function emitArch(
  E: Emit,
  cA: number,
  A: number,
  L: number,
  h: number,
  sh: number,
  s: number,
  oL: number,
  oh: number,
  len: number,
  T: number,
  D: number,
): void {
  const c = Math.cos(Math.PI * s);
  const sn = Math.sin(Math.PI * s);
  const p0 = E.at(cA - A * c, L + sh * c + oL, h * sn + oh);
  const c2 = Math.cos(Math.PI * (s + 0.012));
  const s2 = Math.sin(Math.PI * (s + 0.012));
  const p1 = E.at(cA - A * c2, L + sh * c2 + oL, h * s2 + oh);
  const k = len / 6;
  E.sink.push(
    p0,
    [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k],
    T,
    D,
  );
}

/** Plasma on one loop: evaporates up from both feet, hangs while hot, then cools and drains as rain. Pure in age. */
export function plasmaTube(
  E: Emit,
  seed: number,
  A: number,
  L: number,
  h: number,
  age: number,
  M: number,
  len: number,
  gain: number,
): void {
  const fade = smooth(0, 0.05, age) * (1 - smooth(0.95, 1.35, age));
  if (fade <= 0.002) return;
  const tr = A * 0.17;
  const m = Math.max(6, Math.round(M * E.q));
  for (let j = 0; j < m; j++) {
    const k = seed * 131 + j * 5;
    const h1 = pr(seed, k);
    const h2 = pr(seed, k + 1);
    const h3 = pr(seed, k + 2);
    const h4 = pr(seed, k + 3);
    const h5 = pr(seed, k + 4);
    const p = clamp((age - h1 * 0.24) / 0.15, 0, 1);
    if (p <= 0) continue;
    const up = 0.5 * p * (2 - p) * (0.5 + 0.6 * h2);
    const q = clamp((age - (0.42 + 0.5 * h3)) / 0.42, 0, 1);
    const sN = up * (1 - q * q) + 0.03 * Math.sin(age * 24 + h4 * 6.283) * (1 - q);
    const s = clamp(j & 1 ? 1 - sN : sN, 0.003, 0.997);
    const sn = Math.sin(Math.PI * s);
    const ra = Math.sqrt(h5) * tr * (0.35 + 0.65 * sn);
    const an = h4 * 39.1;
    const oL = Math.cos(an) * ra + tr * 0.35 * Math.sin(s * 17 + age * 9 + seed) * (0.4 + h2);
    const oh = Math.sin(an) * ra * 0.75;
    let T = clamp(0.94 - age * 1.05 - 0.22 * h5 - (q > 0 ? 0.22 : 0), 0, 1);
    let D = 0.75 * gain * fade * (1 - 0.5 * q);
    const ll = len * (1 + 2.5 * (1 - p) + 3 * q);
    if (q > 0.02 && h5 > 0.62) {
      // Coronal rain: cool, dense, falling clumps.
      D *= 1.7;
      T *= 0.5;
    }
    emitArch(E, 0, A, L, h, 0, s, oL, oh, ll, T, D);
  }
}

/** The twisted flux rope along the neutral line, rising and untwisting. */
export function plasmaRope(
  E: Emit,
  seed: number,
  z: number,
  rad: number,
  Lr: number,
  alpha: number,
  imp: number,
  u: number,
  M: number,
  gain: number,
): void {
  if (alpha <= 0.01) return;
  const m = Math.round(M * E.q);
  for (let j = 0; j < m; j++) {
    const k = seed * 97 + j * 5;
    const h1 = pr(seed, k);
    const h2 = pr(seed, k + 1);
    const h3 = pr(seed, k + 2);
    const h4 = pr(seed, k + 3);
    const at = (v: number) => {
      const ph = v * 11 + Math.floor(h2 * 6) * 1.05 + u * 8;
      const env = Math.pow(Math.max(0, 1 - v * v), 0.55);
      const r2 = rad * (0.35 + 1.15 * h3);
      return E.at(r2 * Math.cos(ph) * env, v * Lr, z * env + r2 * Math.sin(ph) * env);
    };
    const v = ((h1 + u * 0.25) % 1) * 2 - 1;
    const p0 = at(v);
    const p1 = at(v + 0.03);
    E.sink.push(
      p0,
      [p1[0], p1[1], p1[2]],
      clamp(0.16 + 0.55 * imp + 0.18 * h4, 0, 1),
      gain * alpha,
    );
  }
}

/** Cool dense surges thrown up tall field lines from the ribbons, in clumps. */
export function plasmaSurge(
  E: Emit,
  seed: number,
  u: number,
  base: number,
  span: number,
  rA: number,
  ad: number,
  open: boolean,
  eT: number,
  M: number,
  len: number,
  gain: number,
): void {
  const m = Math.round(M * E.q);
  for (let i = 0; i < 16; i++) {
    const side = i & 1 ? 1 : -1;
    const b = seed * 53 + i * 11;
    const A = ad * (0.18 + 0.25 * pr(seed, b));
    const hT = ad * (1.6 + 3.2 * pr(seed, b + 1)) * (0.6 + 0.8 * eT);
    const L = ad * (2 * pr(seed, b + 2) - 1) * 0.9;
    const q0 = (u - (base + 0.4 * span * pr(seed, b + 3))) / span;
    if (q0 <= 0 || q0 > 1.1) continue;
    for (let j = 0; j < m; j++) {
      const k = b + j * 7;
      const h1 = pr(seed, k);
      const h2 = pr(seed, k + 1);
      const h3 = pr(seed, k + 2);
      const h4 = pr(seed, k + 3);
      const qq = (q0 - Math.floor(h1 * 5) * 0.07 - h2 * 0.05) / 0.65;
      if (qq <= 0 || qq >= 1) continue;
      const s = open ? Math.min(0.5, 0.75 * Math.pow(qq, 0.7)) : 2 * qq * (1 - qq);
      const H = open ? hT * (1 + 3 * qq) : Math.min(hT, ad * 2.4);
      const ra = h3 * A * 0.8;
      emitArch(
        E,
        side * rA,
        A,
        L,
        H,
        0,
        Math.max(0.004, s),
        Math.cos(h4 * 40) * ra,
        Math.sin(h4 * 40) * ra,
        len * 0.7,
        0.1 + 0.2 * h3,
        gain * (1 - smooth(0.75, 1, qq)),
      );
    }
  }
}

/** Siphon flow along a quiet or stretched loop: plasma streams up one leg. */
export function plasmaLeg(
  E: Emit,
  seed: number,
  A: number,
  L: number,
  H: number,
  u: number,
  flow: number,
  M: number,
  len: number,
  gain: number,
  T0: number,
): void {
  const m = Math.max(4, Math.round(M * E.q));
  const tr = A * 0.12;
  for (let j = 0; j < m; j++) {
    const k = seed * 71 + j * 5;
    const h1 = pr(seed, k);
    const h2 = pr(seed, k + 1);
    const h3 = pr(seed, k + 2);
    const h4 = pr(seed, k + 3);
    const s = ((h1 + u * flow * (0.5 + h2)) % 1) * 0.5;
    emitArch(
      E,
      0,
      A,
      L,
      H,
      0,
      clamp(j & 1 ? s : 1 - s, 0.004, 0.996),
      Math.cos(h4 * 40) * h3 * tr,
      Math.sin(h4 * 40) * h3 * tr,
      len,
      T0 + 0.2 * h3,
      gain,
    );
  }
}

// ---- whole-star plasma ---------------------------------------------------------------------------
export interface PlasmaOptions {
  /** Loop enlargement: ENLARGE_FACTOR in the enlarged view, 1 at true scale. */
  boost: number;
  /** Particle count scale for the quality level (1 high, about 0.4 low). */
  q: number;
  /** Display time of quiet-loop siphon flow, seconds. */
  clock: number;
}

/** Loop size at a group (radians of arc), enlarged by `boost`. */
export const loopScale = (g: SpotGroup, boost: number): number =>
  Math.max(0.012 * boost, g.separationRad * 0.5 * boost);

/** Number of quiet loops of a group (seeded from its area; prototype rule). */
export const quietLoopCount = (g: SpotGroup): number =>
  Math.round(clamp(6 + Math.sqrt(g.areaFraction / 7.5e-5) * 5, 7, 18));

/** Quiet loops with siphon flow along each, for every group. Pure in (groups, seed, clock). */
export function emitQuiet(
  sink: StreakSink,
  groups: readonly SpotGroup[],
  seed: number,
  o: PlasmaOptions,
): void {
  for (const g of groups) {
    const ad = loopScale(g, o.boost);
    const at: Mapper = (a, l, h) => groupPoint(g, a, l, h);
    const E: Emit = { sink, at, q: o.q, len: 9 };
    const k = quietLoopCount(g);
    for (let i = 0; i < k; i++) {
      const b = seed * 7 + g.id * 101 + i;
      const u = pr(seed, b);
      const A = 0.45 + 1.05 * u;
      const L = (pr(seed, b + 1) - 0.5) * 1.3;
      const h = 0.75 + 1.8 * u;
      // siphon flow: slow stream up one leg of each loop
      plasmaLeg(E, b, A * ad, L * ad, h * ad, o.clock * 0.04, 1, 8, 20, 0.034, 0.42);
    }
  }
}

/** The plasma and field lines of one flare at display time t. Pure in (event, group, t). */
export function emitEvent(
  sink: StreakSink,
  g: SpotGroup,
  e: FlareEvent,
  t: number,
  o: PlasmaOptions,
): void {
  const u = (t - e.t0) / e.life;
  if (u < 0 || u > 1) return;
  const at: Mapper = (a, l, h) => groupPoint(g, a, l, h);
  const E: Emit = { sink, at, q: o.q, len: 9 };
  const eT = clamp(Math.log10(e.energyErg / E_REF_ERG) / 2, 0, 1);
  const ad = clamp(
    Math.max(0.012 * o.boost, g.separationRad * 0.5 * o.boost) *
      Math.pow(e.energyErg / E_REF_ERG, 0.1),
    0.012,
    0.2,
  );
  const fade = 1 - smooth(0.86, 1, u);
  const imp = smooth(0.08, 0.16, u) * (u < 0.2 ? 1 : Math.exp(-(u - 0.2) / 0.22));
  const w = 1;
  void w;
  if (e.open) {
    // Stretched, opening field: tall legs.
    const ko = smooth(0.12, 0.62, u);
    for (let n = 0; n < 12; n++) {
      const a = 1.1 + 0.9 * pr(e.s, 400 + n);
      const l = (pr(e.s, 420 + n) - 0.5) * 1.6;
      plasmaLeg(
        E,
        e.s + n,
        ad * a * (1 - 0.3 * ko),
        ad * l,
        ad * (1.8 + 26 * ko * ko * ko),
        u,
        1.3,
        40,
        23,
        0.026 * (1 - 0.55 * ko) * fade,
        0.46,
      );
    }
  }
  const zr = e.open
    ? ad * (0.3 + 14 * Math.pow(smooth(0.12, 0.78, u), 2.2))
    : ad * (0.25 + 0.5 * e.x * smooth(0.05, 0.22, u));
  const ropeA =
    (e.open ? 1 - smooth(0.5, 0.86, u) : 1 - smooth(0.34, 0.62, u)) * smooth(0, 0.06, u);
  plasmaRope(
    E,
    e.s % 977,
    zr,
    ad * (0.12 + (e.open ? 1.1 * smooth(0.15, 0.7, u) : 0.05)),
    ad * 1.05,
    ropeA,
    imp,
    u,
    300,
    0.06,
  );
  const N = Math.round(12 + 26 * eT);
  for (let i = 0; i < N; i++) {
    const tl = pr(e.s, 300 + i) * 2 - 1;
    const th = 1.45 + 0.8 * pr(e.s, 340 + i);
    const bs = lerp(0.13, e.open ? 0.72 : 0.5, Math.pow(i / N, 1.1));
    const ag = (u - bs) / 0.34;
    if (ag <= 0 || ag > 1.35) continue;
    const A2 = ad * (0.42 + (e.open ? 0.85 : 0.22) * smooth(0.13, 0.85, bs));
    plasmaTube(
      E,
      (e.s % 1009) + i,
      A2,
      ad * tl * 0.95,
      A2 * th,
      ag,
      20,
      9,
      0.11 * (0.6 + 0.5 * eT),
    );
  }
  const rA = ad * (0.42 + (e.open ? 0.8 : 0.2) * smooth(0.13, 0.8, u));
  plasmaSurge(E, e.s % 811, u, 0.12, 0.55, rA, ad, e.open, eT, 6, 9, 0.15);
  // White-hot footpoints: two ribbons along the neutral line at +-rA.
  if (imp > 0.01) {
    for (const side of [-1, 1]) {
      for (let q = 0; q < 16; q++) {
        const l0 = (q / 16 - 0.5) * ad * 1.9;
        const l1 = ((q + 1) / 16 - 0.5) * ad * 1.9;
        for (let layer = 0; layer < 3; layer++) {
          const off = (layer - 1) * 0.02 * ad;
          sink.push(
            at(side * rA + off, l0, 0.002),
            at(side * rA + off, l1, 0.002),
            0.97,
            imp * (1 - layer * 0.25) * 0.3 * (0.5 + eT),
          );
        }
      }
    }
  }
}

// ---- close-up stage ------------------------------------------------------------------------------
export interface StageOptions {
  open: boolean;
  /** Class strength 0.55 (C), 0.8 (M), 1 (X). */
  strength: number;
  q: number;
}
export const CLASS_STRENGTH = { c: 0.55, m: 0.8, x: 1 } as const;
export const CLASS_LABEL = {
  c: 'about 10²⁹ erg',
  m: 'about 10³⁰ erg',
  x: 'about 10³¹ erg or more',
} as const;

/** Time-scale of the stage functions (0..1 = 60 minutes). */
export const ribbonHalf = (t: number, open: boolean): number => {
  const s = smooth(0.26, 0.82, t);
  return open ? 0.014 + 0.046 * s : 0.014 + 0.007 * s;
};
export const ropeHeight = (t: number, open: boolean): number =>
  open
    ? 0.024 + 0.045 * smooth(0.16, 0.28, t) + 1.3 * Math.pow(smooth(0.24, 0.72, t), 2.2)
    : 0.024 + 0.034 * smooth(0.16, 0.3, t) - 0.018 * smooth(0.42, 0.82 - 0.02, t);

/** Plasma of the close-up flare at stage time t (0..1). `at` maps (a, l, h) to a drawn point. Pure in t. */
export function emitStage(sink: StreakSink, at: Mapper, t: number, o: StageOptions): void {
  const E: Emit = { sink, at, q: o.q, len: 15 };
  const { open, strength: e } = o;
  const ko = open ? smooth(0.2, 0.56, t) : 0;
  const imp = impulseAt(t);
  const over = 18;
  for (let n = 0; n < over; n++) {
    const L = lerp(-0.13, 0.13, n / (over - 1));
    const a = 0.08 + 0.05 * pr(44, n);
    const h0 = 0.07 + 0.05 * pr(44, n + 50);
    const h = open
      ? h0 * (1 + 42 * ko * ko * ko)
      : h0 * (1 + 0.14 * smooth(0.14, 0.3, t) - 0.08 * smooth(0.4, 0.72, t));
    plasmaLeg(
      E,
      n + 301,
      a * (1 - 0.3 * ko),
      L,
      h,
      t,
      open ? 3 : 1.2,
      14,
      36,
      (0.016 + 0.03 * imp) * (1 - 0.5 * ko),
      0.42,
    );
  }
  const ropeA = open ? 1 - 0.75 * smooth(0.55, 0.85, t) : 1 - smooth(0.42, 0.75, t);
  plasmaRope(
    E,
    7,
    ropeHeight(t, open),
    0.006 + (open ? 0.05 * smooth(0.25, 0.7, t) : 0.004),
    0.12,
    ropeA,
    imp,
    t * 2.5,
    220,
    0.055,
  );
  const bEnd = open ? 0.84 : 0.56;
  const life = open ? 0.26 : 0.3;
  const count = Math.round(lerp(38, 90, (e - 0.55) / 0.45));
  for (let i = 0; i < count; i++) {
    const pu = i / 89;
    const born = lerp(0.285, bEnd, Math.pow(pu, 1.15));
    const ag = (t - born) / life;
    if (ag <= 0 || ag > 1.35) continue;
    const a0 = ribbonHalf(born, open);
    plasmaTube(
      E,
      i + 11,
      a0,
      (pr(45, i) * 2 - 1) * 0.095,
      a0 * (1.15 + 0.3 * pr(45, i + 100)),
      ag,
      20,
      15,
      0.1 * (0.5 + 0.5 * e),
    );
  }
  plasmaSurge(E, 5, t, 0.29, 0.42, ribbonHalf(t, open), 0.04, open, e, 8, 15, 0.13);
  const rA =
    smooth(0.25, 0.3, t) *
    (0.25 + 0.75 * Math.exp(-Math.max(0, t - 0.34) / 0.17)) *
    (0.55 + 0.45 * e);
  if (rA > 0.01) {
    const r = ribbonHalf(t, open);
    for (const side of [-1, 1])
      for (let q = 0; q < 40; q++) {
        const l0 = -0.105 + (0.21 * q) / 40;
        const l1 = -0.105 + (0.21 * (q + 1)) / 40;
        sink.push(at(side * r, l0, 0.0015), at(side * r, l1, 0.0015), 0.97, rA * 0.3);
      }
  }
}
