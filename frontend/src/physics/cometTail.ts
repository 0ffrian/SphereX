// Issue #71 stream F (Q-261, Q-263): a modelled comet tail from the comet's real path.
//   Sun direction and the comet's velocity come from the card's `orbit_track` (JPL Horizons VECTORS,
//   heliocentric ICRF, au and au/day). Dust follows Finson and Probstein (1968): a grain of
//   radiation-pressure ratio beta leaves the comet with the comet's velocity and then moves under
//   (1 - beta) of the Sun's gravity; its offset from the comet is where it ends up. The ion tail is
//   the anti-solar direction. Every length is in au and then km; the display scales it.
//   Pure and deterministic: no Date, no Math.random.
import { mulberry32 } from '@/viewer/fields/noise';

/** Gaussian gravitational constant squared: GM_sun in au^3 / day^2 (k = 0.01720209895 rad/day, IAU 1976). */
export const GM_SUN_AU3_DAY2 = 2.959122082855911e-4;
/** One astronomical unit in km (IAU 2012 B2, exact). */
export const AU_KM = 149_597_870.7;

/**
 * Radiation-pressure ratios of the assumed grains: 570, 114, 28.5 and 5.7 micrometres in radius
 * for rho = 1 g/cm3 and Qpr = 1 (betaOfGrain). Compact grains (rho 2 to 3 g/cm3) of the same beta
 * are 2 to 3 times smaller. `model_dependent`.
 */
export const DUST_BETAS: readonly number[] = [0.001, 0.005, 0.02, 0.1];
/** The plain-words caveat of the beta-to-size mapping, for the tail note. */
export const GRAIN_SIZE_ASSUMPTION =
  'The dust tail assumes four grain sizes, 570, 114, 28.5 and 5.7 µm in radius. These sizes assume porous grains (density 1 g/cm³) that take up all the sunlight that falls on them (Qpr = 1); compact grains (2 to 3 g/cm³) feel the same push at sizes 2 to 3 times smaller.';
/** beta = 5.7e-5 Qpr / (rho a) with a in cm and rho in g/cm3 (Burns, Lamy and Soter 1979). */
export function betaOfGrain(radiusUm: number, densityGcm3 = 1, qpr = 1): number {
  return (5.7e-5 * qpr) / (densityGcm3 * radiusUm * 1e-4);
}

export type Row = readonly [number, number, number, number, number, number, number];
export type V3 = readonly [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export function unit(a: V3): V3 | null {
  const n = norm(a);
  return n > 0 && Number.isFinite(n) ? scale(a, 1 / n) : null;
}

export interface State {
  /** Heliocentric position, au. */
  r: V3;
  /** Heliocentric velocity, au/day. */
  v: V3;
}

/** True when every row has 7 finite numbers, time strictly increasing, and there are at least two. */
export function validTrack(rows: readonly Row[] | null | undefined): rows is readonly Row[] {
  if (!rows || rows.length < 2) return false;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.length !== 7 || !r.every(Number.isFinite)) return false;
    if (i > 0 && !(r[0] > rows[i - 1]![0])) return false;
  }
  return true;
}

/**
 * State at a Julian date by cubic Hermite interpolation between the two sampled rows (position and
 * velocity both known, so the error is far below a pixel for 3-day samples). Null outside the
 * sampled range.
 */
export function stateAt(rows: readonly Row[], jd: number): State | null {
  if (!validTrack(rows) || !Number.isFinite(jd)) return null;
  const last = rows.length - 1;
  if (jd < rows[0]![0] || jd > rows[last]![0]) return null;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]![0] <= jd) lo = mid;
    else hi = mid;
  }
  const a = rows[lo]!;
  const b = rows[Math.min(lo + 1, last)]!;
  const h = b[0] - a[0];
  const t = h > 0 ? (jd - a[0]) / h : 0;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const r = [0, 0, 0] as [number, number, number];
  const v = [0, 0, 0] as [number, number, number];
  for (let k = 0; k < 3; k++) {
    const p0 = a[1 + k]!;
    const p1 = b[1 + k]!;
    const m0 = a[4 + k]!;
    const m1 = b[4 + k]!;
    r[k] = h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1;
    // d/dt of the position spline, per day.
    v[k] =
      ((6 * t2 - 6 * t) * p0 +
        (3 * t2 - 4 * t + 1) * h * m0 +
        (-6 * t2 + 6 * t) * p1 +
        (3 * t2 - 2 * t) * h * m1) /
      h;
  }
  return { r, v };
}

/** Unit vector from the comet to the Sun at `jd` (ICRF), or null outside the sampled range. */
export function sunDirectionAt(rows: readonly Row[], jd: number): V3 | null {
  const s = stateAt(rows, jd);
  return s ? unit(scale(s.r, -1)) : null;
}

/**
 * The display frame: an orthonormal basis in ICRF. `x` is the Sun direction at `referenceJd`
 * (so the Sun is on the right of the picture at that time), `z` the orbit normal r x v (toward the
 * viewer), `y = z x x`. A direction `w` in ICRF maps to the scene as (w.x, w.y, w.z). Right-handed,
 * so the picture is not mirrored.
 */
export interface Frame {
  x: V3;
  y: V3;
  z: V3;
}
export function displayFrame(rows: readonly Row[], referenceJd: number): Frame | null {
  const s = stateAt(rows, referenceJd);
  if (!s) return null;
  const z = unit(cross(s.r, s.v));
  const sun = unit(scale(s.r, -1));
  if (!z || !sun) return null;
  const xRaw = sub(sun, scale(z, dot(sun, z)));
  const x = unit(xRaw);
  if (!x) return null;
  const y = cross(z, x);
  return { x, y, z };
}
export function toScene(frame: Frame, w: V3): V3 {
  return [dot(w, frame.x), dot(w, frame.y), dot(w, frame.z)];
}

export interface TailGrain {
  /** Offset from the comet in the display frame, km. */
  offsetKm: V3;
  beta: number;
  /** Days since release. */
  ageDays: number;
}

export interface TailOptions {
  betas?: readonly number[];
  /** First release time (JD). Earlier activity is unknown. */
  startJd: number;
  /** Grains per beta. */
  perBeta: number;
  seed: number;
  /** Integration step, days. */
  stepDays?: number;
}

/**
 * Finson-Probstein grains at `jd`. Release times are spread evenly between `startJd` and `jd`
 * (with a seeded jitter inside each slot); each grain is integrated with a leapfrog step under
 * (1 - beta) GM / r^2 from the comet's position and velocity at its release, then compared with
 * a beta = 0 grain released and integrated the same way (differential: the two-body step's drift
 * from the Horizons path cancels). No ejection speed (Finson-Probstein's syndyne/synchrone
 * approximation). Returns [] before `startJd` or outside the sampled range.
 */
export function dustGrains(
  rows: readonly Row[],
  jd: number,
  frame: Frame,
  opts: TailOptions,
): TailGrain[] {
  const betas = opts.betas ?? DUST_BETAS;
  const dt0 = opts.stepDays ?? 0.5;
  const now = stateAt(rows, jd);
  if (!now || !(jd > opts.startJd) || opts.perBeta < 1) return [];
  const rnd = mulberry32(opts.seed);
  const out: TailGrain[] = [];
  const span = jd - opts.startJd;
  for (const beta of betas) {
    for (let i = 0; i < opts.perBeta; i++) {
      const t0 = opts.startJd + ((i + rnd()) / opts.perBeta) * span;
      const s0 = stateAt(rows, Math.min(t0, jd));
      if (!s0) continue;
      const n = Math.max(1, Math.ceil((jd - t0) / dt0));
      const dt = (jd - t0) / n;
      // Differential: a beta = 0 grain released with the grain, integrated the same way, stands in
      // for the comet. Horizons' path carries planetary perturbations and non-gravitational forces
      // that the two-body step does not, so a beta = 0 grain drifts thousands of km from it over
      // weeks; that common drift cancels in the difference, leaving only radiation pressure.
      const r = leapfrog(s0, beta, n, dt);
      const ref = leapfrog(s0, 0, n, dt);
      const off = scale(toScene(frame, sub(r, ref)), AU_KM);
      out.push({ offsetKm: off, beta, ageDays: jd - t0 });
    }
  }
  return out;
}

/** Position after `n` kick-drift-kick leapfrog steps of `dt` days under (1 - beta) GM / r^2. */
function leapfrog(s0: State, beta: number, n: number, dt: number): V3 {
  let r: V3 = s0.r;
  let v: V3 = s0.v;
  const acc = (p: V3): V3 => {
    const d = norm(p);
    return scale(p, (-(1 - beta) * GM_SUN_AU3_DAY2) / (d * d * d));
  };
  let a = acc(r);
  for (let k = 0; k < n; k++) {
    v = add(v, scale(a, dt / 2));
    r = add(r, scale(v, dt));
    a = acc(r);
    v = add(v, scale(a, dt / 2));
  }
  return r;
}

/** The comet's own two-body drift from the Horizons path: a beta = 0 grain released at `t0`, km, at `jd` (diagnostics and tests). */
export function referenceDriftKm(
  rows: readonly Row[],
  t0: number,
  jd: number,
  stepDays = 0.5,
): number | null {
  const s0 = stateAt(rows, t0);
  const now = stateAt(rows, jd);
  if (!s0 || !now || !(jd > t0)) return null;
  const n = Math.max(1, Math.ceil((jd - t0) / stepDays));
  return norm(sub(leapfrog(s0, 0, n, (jd - t0) / n), now.r)) * AU_KM;
}

export interface TailSummary {
  /** Unit direction of the ion tail in the display frame (away from the Sun). */
  ionAxis: V3;
  /** Unit direction of the dust tail axis (away from the Sun) in the display frame. */
  dustAxis: V3;
  /** Unit direction the dust bends toward (perpendicular to the axis), or null if it does not bend. */
  dustBend: V3 | null;
  /** Length of the dust tail along the axis, km (median beta's oldest grain). */
  dustLengthKm: number;
  /** Sideways offset of that grain from the axis, km. */
  dustLateralKm: number;
  /** Real angle between the Sun direction and the comet's velocity, degrees (the cause of the bend). */
  sunVelocityAngleDeg: number;
}

/**
 * Summary of the tail at `jd`: axes and extent. Axis directions are the real anti-solar direction;
 * the bend is the mean sideways offset of the oldest grain of each beta. Null when the track does
 * not cover `jd`, or when `jd` is not after `startJd` (no grains yet).
 */
export function summariseTail(
  rows: readonly Row[],
  jd: number,
  frame: Frame,
  opts: TailOptions,
): TailSummary | null {
  const s = stateAt(rows, jd);
  const sun = s ? unit(scale(s.r, -1)) : null;
  if (!s || !sun) return null;
  const axis = unit(scale(toScene(frame, sun), -1));
  if (!axis) return null;
  const grains = dustGrains(rows, jd, frame, opts);
  if (grains.length === 0) return null;
  // Oldest grain per beta (smallest release time = largest age).
  const oldest = new Map<number, TailGrain>();
  for (const g of grains) {
    const prev = oldest.get(g.beta);
    if (!prev || g.ageDays > prev.ageDays) oldest.set(g.beta, g);
  }
  const lens: number[] = [];
  let lat: V3 = [0, 0, 0];
  for (const g of oldest.values()) {
    const along = dot(g.offsetKm, axis);
    lens.push(Math.max(0, along));
    lat = add(lat, sub(g.offsetKm, scale(axis, along)));
  }
  lens.sort((p, q) => p - q);
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  const latLen = norm(lat) / Math.max(1, oldest.size);
  const bend = unit(lat);
  const vUnit = unit(s.v);
  const angle = vUnit ? (Math.acos(Math.max(-1, Math.min(1, dot(vUnit, sun)))) * 180) / Math.PI : 0;
  return {
    ionAxis: axis,
    dustAxis: axis,
    dustBend: bend,
    dustLengthKm: median,
    dustLateralKm: latLen,
    sunVelocityAngleDeg: angle,
  };
}
