// Spec R13 §7 (baked spectra and events, S1–S12), §8.4 (thunder), §9 (bake method), §11.4/§11.7 (loudness):
// the ambience bake engine, #113 (T3). Pure: no DOM, no Web Audio; `bake.worker.ts` wraps it.
//
// Ported from Moon's "Ambience Loop Lab" prototype (DSP(): rng32, FFT tables, noiseMulti, mix, gustEnv, eventEnv,
// applyIR, finish; team-internal, 12 Nov 2026). Thanks, Moon. The method is his: a random-phase spectrum per layer,
// one complex inverse FFT giving two independent channels (re → L, im → R), a periodic control-rate envelope, events at
// seeded times that wrap round the loop, echoes by multiplying spectra. Deviations from the prototype (plan v2):
//   1. Gusts: Gaussian g = max(0, 1 + Iu·n(t)), n from 24 loop harmonics with amplitude k^-0.83 (power f^-5/3)
//      [SS 1.3], not exp(Σ k^-0.6). Rumble follows g², hiss g³ (pressure ∝ U², U³), whistle g² ("squared gust").
//   2. No air absorption baked into beds: the mixer applies it live for the real distance (§11.2). Only the extra path
//      of an echo tap is blurred, with α ≈ absK2·f² (exact for classical absorption; an approximation where
//      relaxation dominates, so the blur is tagged model_dependent).
//   3. Every physical number comes in `spec.params` (frozen key table, App. D); nothing is derived here except the
//      wave fall time √(2Hs/g) and echo delays from c0.
//   4. Loudness: K-weighted integrated loudness (BS.1770) to BED_LUFS, with the gain lowered (never clipped) when the
//      sample peak would pass −1 dBFS; the achieved value goes in `lufs`.
//   5. Thunder and the vent burst are linear one-shots (no wrap, no echo IR), sized to their duration.
//   6. Shape table in Hz (1 Hz), pings by a two-pole recurrence, clicks with a sample-rate envelope, echo taps as a
//      closed-form spectrum: at most 4 N-point FFTs per bed.
// Determinism: Math.sin/exp/pow are not correctly rounded, so outputs are byte-identical within one JS engine
// (V8 in Chrome and Node), not across engines (Q-444).

import { mulberry32 } from '@/viewer/fields/noise';
import { hash32 } from './hash';
import * as K from './dspTuning';
import type { AirModel, BakeResult, BedSpec, SourceId } from './types';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------
// Errors and validation
// ---------------------------------------------------------------------------------------------------------------

/** A bed that cannot be baked from what it was given. Never a crash: the palette lists it as unavailable. */
export class BakeRefusedError extends Error {
  readonly id: SourceId;
  readonly variant: number;
  readonly missing: string[];
  constructor(id: SourceId, variant: number, missing: string[]) {
    super(`bake refused for ${id}/${variant}: ${missing.join(', ')}`);
    this.name = 'BakeRefusedError';
    this.id = id;
    this.variant = variant;
    this.missing = missing;
  }
}

/**
 * Required `params` keys per source: the frozen App. D table (plan v1 §4), which #112 fills. Notes for #112 and #116:
 * - `spec.Uref` shapes the sound only for S1 and S9 (the top of the rumble band, 40 + 5·Uref Hz). For every other bed it
 *   is cache identity only.
 * - thunder `d_m` and `absK2` are validated but unused: thunder has no echo response (plan v2 item 3), and distance
 *   absorption is applied live. The keys stay required because the table is frozen.
 * - Gain 1 means −24 LUFS integrated (BED_LUFS) for a loop bed, and a −16 dBFS peak (ONE_SHOT_PEAK_DBFS, a 70 dB
 *   L_TARGET peak) for a one-shot. A one-shot's `BakeResult.lufs` is informational: do not re-normalise by it.
 * - `variant`: thunder 0–3 (0, 1 near with a crack; 2, 3 far rolls), S8 1 = vent burst one-shot, all others 0.
 * `checkSpec` applies these rules, so a contract test can import them instead of copying them.
 */
export const REQUIRED_PARAMS: Record<SourceId, readonly string[]> = {
  S1_land: ['Iu'],
  S1_sea: ['Iu'],
  S2: ['Iu', 'fHiss_Hz'],
  S3: ['Iu'],
  S4: ['Hs_m', 'Tp_s', 'mf', 'absK2'],
  S5: ['Hs_m', 'Tp_s', 'mf', 'whitecapRate_per_s'],
  S6: ['rainPitch', 'mf'],
  S7: ['mf'],
  S8: [],
  S9: ['Iu'],
  S10: ['Iu'],
  S12: [],
  thunder: ['fm_Hz', 'dur_s', 'd_m', 'crack', 'absK2'],
};
/** Optional keys (the bed is baked without them). */
export const OPTIONAL_PARAMS: Partial<Record<SourceId, readonly string[]>> = {
  S3: ['fWhistle1_Hz', 'fWhistle2_Hz', 'fWhistle3_Hz'],
  S9: ['fHiss_Hz'],
  S12: ['Iu'],
};
/** Keys that may be zero (all others must be > 0). */
export const ZERO_OK: ReadonlySet<string> = new Set([
  'Iu',
  'whitecapRate_per_s',
  'absK2',
  'crack',
  'd_m',
]);

/** Number of variants per source (see REQUIRED_PARAMS). */
export const VARIANTS: Record<SourceId, number> = {
  S1_land: 1,
  S1_sea: 1,
  S2: 1,
  S3: 1,
  S4: 1,
  S5: 1,
  S6: 1,
  S7: 1,
  S8: 2,
  S9: 1,
  S10: 1,
  S12: 1,
  thunder: 4,
};

/** True when this bed is a linear one-shot rather than a seamless loop. */
export function isOneShot(id: SourceId, variant: number): boolean {
  return id === 'thunder' || (id === 'S8' && variant === 1);
}

function okNumber(key: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return ZERO_OK.has(key) ? v >= 0 : v > 0;
}

/** Every reason `bakeBed` would refuse this spec before baking (empty = bakeable). Pure; the palette uses it to keep
 * an invalid spec out of the memory budget. */
export function checkSpec(spec: BedSpec, air: AirModel): string[] {
  const missing: string[] = [];
  const nVariants = VARIANTS[spec.id];
  if (nVariants === undefined) return ['id'];
  if (!Number.isInteger(spec.variant) || spec.variant < 0 || spec.variant >= nVariants)
    missing.push('variant');
  const N = spec.N;
  if (!Number.isInteger(N) || N < 1 << 12 || N > 1 << 21 || (N & (N - 1)) !== 0) missing.push('N');
  if (!Number.isFinite(spec.sampleRate) || spec.sampleRate < 8000 || spec.sampleRate > 96000)
    missing.push('sampleRate');
  if (!Number.isFinite(spec.seed)) missing.push('seed');
  for (const k of REQUIRED_PARAMS[spec.id]) if (!okNumber(k, spec.params[k])) missing.push(k);
  for (const k of OPTIONAL_PARAMS[spec.id] ?? []) {
    if (k in spec.params && !okNumber(k, spec.params[k])) missing.push(k);
  }
  if (spec.id === 'S1_land' || spec.id === 'S1_sea' || spec.id === 'S9') {
    if (!Number.isFinite(spec.Uref) || spec.Uref < 0) missing.push('Uref');
  }
  if (
    spec.id === 'S3' &&
    !['fWhistle1_Hz', 'fWhistle2_Hz', 'fWhistle3_Hz'].some((k) => k in spec.params)
  ) {
    missing.push('fWhistle1_Hz|fWhistle2_Hz|fWhistle3_Hz');
  }
  if (spec.id === 'S4' && !(air.c0 > 0)) missing.push('air.c0');
  if ((spec.id === 'S4' || spec.id === 'S5') && !(air.gv > 0)) missing.push('air.gv');
  if (!missing.length && isOneShot(spec.id, spec.variant)) {
    // A one-shot sets its own FFT size: keep it at or below 2^21 (64 MB of scratch).
    if (nextPow2(bakedLength(spec)) > MAX_FFT) missing.push('sampleRate (one-shot too long)');
  }
  return missing;
}

function validate(spec: BedSpec, air: AirModel): void {
  const missing = checkSpec(spec, air);
  if (missing.length) throw new BakeRefusedError(spec.id, spec.variant, missing);
}

const MAX_FFT = 1 << 21;

// ---------------------------------------------------------------------------------------------------------------
// FFT (Moon's radix-2, twiddles cached per size) and scratch buffers
// ---------------------------------------------------------------------------------------------------------------

interface Tables {
  c: Float64Array;
  s: Float64Array;
  rev: Uint32Array;
}
const tables = new Map<number, Tables>();

function getTables(n: number): Tables {
  const hit = tables.get(n);
  if (hit) return hit;
  const c = new Float64Array(n / 2),
    s = new Float64Array(n / 2),
    rev = new Uint32Array(n);
  for (let i = 0; i < n / 2; i++) {
    const a = (TAU * i) / n;
    c[i] = Math.cos(a);
    s[i] = Math.sin(a);
  }
  const bits = Math.round(Math.log2(n));
  for (let i = 1; i < n; i++) rev[i] = (rev[i >> 1]! >> 1) | ((i & 1) << (bits - 1));
  const t = { c, s, rev };
  // Keep the two most recent sizes (a loop size and a one-shot size).
  if (tables.size >= 2) tables.delete(tables.keys().next().value!);
  tables.set(n, t);
  return t;
}

/** In-place complex FFT (unnormalised both ways; the caller divides by n where needed). n must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const { c, s, rev } = getTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      let x = re[i]!;
      re[i] = re[j]!;
      re[j] = x;
      x = im[i]!;
      im[i] = im[j]!;
      im[j] = x;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1,
      step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = c[k]!,
          wi = inverse ? s[k]! : -s[k]!,
          a = i + j,
          b = a + half;
        const br = re[b]!,
          bi = im[b]!;
        const xr = br * wr - bi * wi,
          xi = br * wi + bi * wr;
        const ar = re[a]!,
          ai = im[a]!;
        re[b] = ar - xr;
        im[b] = ai - xi;
        re[a] = ar + xr;
        im[a] = ai + xi;
      }
    }
  }
}

interface Scratch {
  lre: Float64Array;
  lim: Float64Array;
  are: Float64Array;
  aim: Float64Array;
}
const scratch = new Map<number, Scratch>();

/** Frees the FFT tables and scratch buffers (about 45 MB at 2^20). The main-thread fallback calls it after its bake. */
export function releaseBakeCaches(): void {
  tables.clear();
  scratch.clear();
}
function getScratch(n: number): Scratch {
  let s = scratch.get(n);
  if (!s) {
    // Keep only one size around (the worker bakes one size most of the time); 32 MB at 2^20.
    scratch.clear();
    s = {
      lre: new Float64Array(n),
      lim: new Float64Array(n),
      are: new Float64Array(n),
      aim: new Float64Array(n),
    };
    scratch.set(n, s);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Building blocks (typed versions of Moon's)
// ---------------------------------------------------------------------------------------------------------------

/** Moon's band shape: a high-pass slope `a` below `lo` and a low-pass slope `b` above `hi` (amplitude). */
export const bp = (f: number, lo: number, hi: number, a: number, b: number): number =>
  1 / Math.sqrt((1 + Math.pow(lo / f, 2 * a)) * (1 + Math.pow(f / hi, 2 * b)));

/** Random phases are drawn from a 2^13-entry unit circle (steps of 0.044°, far below anything audible), which saves
 * four transcendental calls per bin. */
const PHASES = 8192;
const PH_C = new Float64Array(PHASES),
  PH_S = new Float64Array(PHASES);
for (let i = 0; i < PHASES; i++) {
  PH_C[i] = Math.cos((TAU * i) / PHASES);
  PH_S[i] = Math.sin((TAU * i) / PHASES);
}

export interface Comp {
  gain: number;
  shape: (f: number) => number;
  /** Shape-table step for narrow components (Hz); default SHAPE_STEP_HZ. */
  stepHz?: number;
}

interface Bake {
  n: number; // FFT length
  len: number; // output length (n for loops; content length for one-shots)
  sr: number;
  loop: boolean;
  T: number; // n / sr
  M: number; // control-rate envelope length
  dt: number; // control-rate step (s)
  s: Scratch;
  notes: string[];
  ffts: number;
  seed: number;
}

function rng(b: Bake, name: string): () => number {
  return mulberry32(hash32(b.seed, name));
}

/**
 * Stereo noise with the spectrum Σ gain_i·shape_i (power-summed), written into `b.s.lre/lim` (re → L, im → R).
 * Each channel's RMS is √Σgain² (Moon's normalisation), whatever n is. Bins above `fmax` (and above the guard) are empty.
 */
export function noiseMulti(b: Bake, comps: Comp[], rnd: () => number, fmax: number): void {
  const { n, sr } = b;
  const re = b.s.lre,
    im = b.s.lim;
  re.fill(0);
  im.fill(0);
  const fTop = Math.min(fmax, K.NYQ_GUARD * sr);
  const kmax = Math.min(n / 2 - 1, Math.floor((fTop * n) / sr));
  const stepHz = Math.min(K.SHAPE_STEP_HZ, ...comps.map((c) => c.stepHz ?? K.SHAPE_STEP_HZ));
  const STEP = Math.max(1, Math.round((stepHz * n) / sr));
  const S = comps.map(() => 0);
  for (let k = STEP; k <= kmax; k += STEP) {
    const f = (k * sr) / n;
    comps.forEach((c, i) => {
      const m = c.shape(f);
      S[i] = S[i]! + m * m;
    });
  }
  const w = comps.map((c, i) => (S[i]! > 0 ? c.gain / Math.sqrt(S[i]!) : 0));
  const Tn = Math.floor(kmax / STEP) + 2;
  const tab = new Float64Array(Tn);
  for (let j = 1; j < Tn; j++) {
    const f = (j * STEP * sr) / n;
    let p = 0;
    comps.forEach((c, i) => {
      const m = w[i]! * c.shape(f);
      p += m * m;
    });
    tab[j] = Math.sqrt(p);
  }
  let sum = 0;
  for (let k = 1; k <= kmax; k++) {
    const j = (k / STEP) | 0,
      fr = (k - j * STEP) / STEP;
    const m = tab[j]! + (tab[j + 1]! - tab[j]!) * fr;
    if (!(m > 0)) continue;
    let ph = (rnd() * PHASES) | 0;
    re[k] = m * PH_C[ph]!;
    im[k] = m * PH_S[ph]!;
    ph = (rnd() * PHASES) | 0;
    re[n - k] = m * PH_C[ph]!;
    im[n - k] = m * PH_S[ph]!;
    sum += 2 * m * m;
  }
  fft(re, im, true);
  b.ffts++;
  let G = 0;
  for (const c of comps) G += c.gain * c.gain;
  const sc = Math.sqrt(G) / Math.sqrt(sum / 2 || 1);
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! * sc;
    im[i] = im[i]! * sc;
  }
}

/** Adds the layer times a control-rate envelope (length M, linearly interpolated) to the accumulator. */
function mixEnv(b: Bake, env: Float64Array): void {
  const { len, s } = b;
  const M = env.length,
    D = len / M;
  const lre = s.lre,
    lim = s.lim,
    are = s.are,
    aim = s.aim;
  for (let i = 0; i < len; i++) {
    const j = (i / D) | 0,
      fr = (i - j * D) / D;
    const j1 = j + 1 < M ? j + 1 : b.loop ? 0 : -1;
    const e0 = env[j]!,
      e = e0 + ((j1 >= 0 ? env[j1]! : 0) - e0) * fr;
    are[i] = are[i]! + lre[i]! * e;
    aim[i] = aim[i]! + lim[i]! * e;
  }
}

/** Adds the layer times a sample-rate envelope (clicks; length = b.len). */
function mixEnvFull(b: Bake, env: Float32Array): void {
  const { len, s } = b;
  for (let i = 0; i < len; i++) {
    const e = env[i]!;
    if (e === 0) continue;
    s.are[i] = s.are[i]! + s.lre[i]! * e;
    s.aim[i] = s.aim[i]! + s.lim[i]! * e;
  }
}

/** Adds the layer unchanged (flat envelope). */
function mixFlat(b: Bake, gain = 1): void {
  const { len, s } = b;
  for (let i = 0; i < len; i++) {
    s.are[i] = s.are[i]! + s.lre[i]! * gain;
    s.aim[i] = s.aim[i]! + s.lim[i]! * gain;
  }
}

/**
 * Unit-variance gust noise n(t) at control rate: Σ_{k=1..24} k^-0.83 sin(2πk j/M + φ_k), a whole number of cycles per
 * loop so it is periodic. Power falls as f^-5/3 [SS 1.3].
 */
export function gustNoise(
  M: number,
  rnd: () => number,
  sines = K.GUST_SINES,
  slope = K.GUST_SLOPE,
): Float64Array {
  const amp: number[] = [],
    ph: number[] = [];
  let v = 0;
  for (let k = 1; k <= sines; k++) {
    const a = Math.pow(k, slope);
    amp.push(a);
    ph.push(TAU * rnd());
    v += (a * a) / 2;
  }
  const norm = 1 / Math.sqrt(v);
  const out = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    let x = 0;
    for (let k = 0; k < sines; k++) x += amp[k]! * Math.sin((TAU * (k + 1) * j) / M + ph[k]!);
    out[j] = x * norm;
  }
  return out;
}

/** g(t)^pow with g = max(0, 1 + Iu·n(t)), RMS-normalised to 1 (all-zero input stays zero). */
export function gustEnvelope(noise: Float64Array, Iu: number, pow: number): Float64Array {
  const M = noise.length,
    e = new Float64Array(M);
  let ms = 0;
  for (let j = 0; j < M; j++) {
    const g = Math.max(0, 1 + Iu * noise[j]!);
    const y = Math.pow(g, pow);
    e[j] = y;
    ms += y * y;
  }
  const sc = ms > 0 ? 1 / Math.sqrt(ms / M) : 0;
  for (let j = 0; j < M; j++) e[j] = e[j]! * sc;
  return e;
}

export interface Ev {
  t: number;
  amp: number;
  rise: number;
  tau: number;
  end?: number;
}

/**
 * Moon's event envelope: a quadratic rise then an exponential decay per event, summed. `dt` is the envelope step (s).
 * Loops wrap modulo the length; one-shots drop what falls outside. `end` (s after onset) cuts an event short.
 */
export function eventEnv<T extends Float32Array | Float64Array>(
  out: T,
  dt: number,
  evs: Ev[],
  wrap: boolean,
): T {
  const M = out.length;
  for (const ev of evs) {
    const start = Math.floor((ev.t - ev.rise) / dt);
    let tot = Math.ceil((ev.rise + 7 * ev.tau) / dt);
    if (ev.end !== undefined) tot = Math.min(tot, Math.ceil((ev.rise + ev.end) / dt));
    if (wrap) tot = Math.min(tot, M);
    const kDecay = Math.exp(-dt / ev.tau);
    let dec = 1;
    for (let i = 0; i < tot; i++) {
      const tt = i * dt;
      let v: number;
      if (tt < ev.rise) v = (tt / ev.rise) * (tt / ev.rise);
      else {
        v = dec;
        dec *= kDecay;
      }
      let idx = start + i;
      if (wrap) idx = ((idx % M) + M) % M;
      else if (idx < 0 || idx >= M) continue;
      out[idx] = out[idx]! + ev.amp * v;
    }
  }
  return out;
}

/** A damped sine a·r^i·sin(w·i) by a two-pole recurrence, panned (L = 1−pan, R = pan) into the accumulator. */
function addPing(b: Bake, t0: number, f: number, tauS: number, a: number, pan: number): boolean {
  if (!(f > 0) || f >= K.NYQ_GUARD * b.sr) return false;
  const { sr, len, s } = b;
  const r = Math.exp(-1 / (tauS * sr)),
    w = (TAU * f) / sr;
  const c = 2 * r * Math.cos(w),
    r2 = r * r;
  const n = Math.min(Math.floor(6 * tauS * sr), len);
  const gl = 1 - pan,
    gr = pan;
  let y2 = 0,
    y1 = a * r * Math.sin(w);
  for (let i = 1; i < n; i++) {
    let k = t0 + i;
    if (b.loop) k %= len;
    else if (k >= len) break;
    s.are[k] = s.are[k]! + y1 * gl;
    s.aim[k] = s.aim[k]! + y1 * gr;
    const y = c * y1 - r2 * y2;
    y2 = y1;
    y1 = y;
  }
  return true;
}

export interface Tap {
  delayS: number;
  gain: number;
  extraM: number;
}

/**
 * Echo taps applied to the accumulator by spectral multiplication (circular, for loops). Each tap is a delayed copy
 * blurred by the absorption of its extra path: H(f) = 1 + Σ g·exp(−absK2·Δd·f²)·exp(−2πi f τ). Closed-form, so it costs
 * one forward and one inverse FFT.
 */
function applyTaps(b: Bake, taps: Tap[], absK2: number): void {
  const { n, sr, s } = b;
  const re = s.are,
    im = s.aim;
  fft(re, im, false);
  b.ffts++;
  const half = n / 2;
  const Hr = new Float64Array(half + 1),
    Hi = new Float64Array(half + 1);
  Hr.fill(1);
  const df = sr / n;
  for (const t of taps) {
    const d = t.delayS * sr; // delay in samples (may be fractional)
    const stepR = Math.cos((-TAU * d) / n),
      stepI = Math.sin((-TAU * d) / n);
    const a = absK2 * t.extraM * df * df; // Gaussian exp(-a k²) by recurrence
    let gk = 1,
      q = Math.exp(-a);
    const q2 = q * q;
    let pr = 1,
      pi = 0;
    for (let k = 0; k <= half; k++) {
      const amp = t.gain * gk;
      Hr[k] = Hr[k]! + amp * pr;
      Hi[k] = Hi[k]! + amp * pi;
      const nr = pr * stepR - pi * stepI;
      pi = pr * stepI + pi * stepR;
      pr = nr;
      gk *= q;
      q *= q2;
      if (gk < 1e-12) break;
    }
  }
  const inv = 1 / n;
  for (let k = 0; k <= half; k++) {
    const hr = Hr[k]! * inv,
      hi = Hi[k]! * inv;
    let a = re[k]!,
      c = im[k]!;
    re[k] = a * hr - c * hi;
    im[k] = a * hi + c * hr;
    if (k > 0 && k < half) {
      // Negative frequency bin uses the conjugate response (real impulse response).
      const m = n - k;
      a = re[m]!;
      c = im[m]!;
      re[m] = a * hr + c * hi;
      im[m] = -a * hi + c * hr;
    }
  }
  fft(re, im, true);
  b.ffts++;
}

/** Moon's phaser, as 4 first-order all-pass stages swept between PHASER_LO and PHASER_HI, mixed 50/50 with the dry
 * signal. Run twice round the loop so the filter state at the seam matches. */
function applyPhaser(b: Bake, cycles: number): void {
  const { len, sr, s } = b;
  const lo = K.PHASER_LO_HZ,
    hi = Math.min(K.PHASER_HI_HZ, 0.45 * sr);
  const ctrl = K.ENV_DECIM,
    nc = Math.ceil(len / ctrl);
  const coef = new Float64Array(nc + 1);
  for (let j = 0; j <= nc; j++) {
    const ph = (TAU * cycles * j * ctrl) / len;
    const fc = lo * Math.pow(hi / lo, 0.5 + 0.5 * Math.sin(ph));
    const t = Math.tan((Math.PI * fc) / sr);
    coef[j] = (t - 1) / (t + 1);
  }
  for (const buf of [s.are, s.aim]) {
    const x1 = new Float64Array(4),
      y1 = new Float64Array(4);
    const out = new Float64Array(len);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        const j = (i / ctrl) | 0,
          fr = (i - j * ctrl) / ctrl;
        const a = coef[j]! + (coef[j + 1]! - coef[j]!) * fr;
        let x = buf[i]!;
        for (let st = 0; st < 4; st++) {
          const y = a * x + x1[st]! - a * y1[st]!;
          x1[st] = x;
          y1[st] = y;
          x = y;
        }
        if (pass === 1) out[i] = 0.5 * (buf[i]! + x);
      }
    }
    buf.set(out);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Loudness (ITU-R BS.1770: K-weighting, 400 ms blocks, 75 % overlap, absolute and relative gates)
// ---------------------------------------------------------------------------------------------------------------

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** K-weighting filters for any sample rate, in libebur128's parameter form (reproduces the BS.1770 48 kHz table). */
export function kWeighting(sr: number): [Biquad, Biquad] {
  // Stage 1: high shelf.
  let f0 = 1681.974450955533,
    Q = 0.7071752369554196;
  const G = 3.999843853973347;
  let Kt = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20),
    Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + Kt / Q + Kt * Kt;
  const shelf: Biquad = {
    b0: (Vh + (Vb * Kt) / Q + Kt * Kt) / a0,
    b1: (2 * (Kt * Kt - Vh)) / a0,
    b2: (Vh - (Vb * Kt) / Q + Kt * Kt) / a0,
    a1: (2 * (Kt * Kt - 1)) / a0,
    a2: (1 - Kt / Q + Kt * Kt) / a0,
  };
  // Stage 2: RLB high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  Kt = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + Kt / Q + Kt * Kt;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (Kt * Kt - 1)) / a0,
    a2: (1 - Kt / Q + Kt * Kt) / a0,
  };
  return [shelf, hp];
}

/** Squared K-weighted samples summed over channels, per 100 ms step chunk. */
function kChunkEnergy(
  chs: ArrayLike<number>[],
  len: number,
  sr: number,
  loop: boolean,
): Float64Array {
  const step = Math.max(1, Math.round(K.LUFS_STEP_S * sr));
  const nChunks = Math.max(1, Math.floor(len / step));
  const E = new Float64Array(nChunks);
  const [f1, f2] = kWeighting(sr);
  for (const x of chs) {
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0,
      u1 = 0,
      u2 = 0,
      z1 = 0,
      z2 = 0;
    const passes = loop ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const record = pass === passes - 1;
      for (let i = 0; i < len; i++) {
        const xi = x[i]!;
        const y = f1.b0 * xi + f1.b1 * x1 + f1.b2 * x2 - f1.a1 * y1 - f1.a2 * y2;
        x2 = x1;
        x1 = xi;
        y2 = y1;
        y1 = y;
        const z = f2.b0 * y + f2.b1 * u1 + f2.b2 * u2 - f2.a1 * z1 - f2.a2 * z2;
        u2 = u1;
        u1 = y;
        z2 = z1;
        z1 = z;
        if (record) {
          const c = (i / step) | 0;
          if (c < nChunks) E[c] = E[c]! + z * z;
        }
      }
    }
  }
  return E;
}

/** Integrated loudness (LUFS) of a stereo (or mono) signal; loops use circular blocks. −Infinity when all gated. */
export function measureLufs(chs: ArrayLike<number>[], sr: number, loop: boolean): number {
  const len = chs[0]?.length ?? 0;
  if (!len) return -Infinity;
  const step = Math.max(1, Math.round(K.LUFS_STEP_S * sr));
  const per = Math.round(K.LUFS_BLOCK_S / K.LUFS_STEP_S); // 4 chunks per block
  const E = kChunkEnergy(chs, len, sr, loop);
  const nC = E.length;
  const blocks: number[] = [];
  const nBlocks = loop ? nC : Math.max(1, nC - per + 1);
  for (let j = 0; j < nBlocks; j++) {
    let e = 0,
      cnt = 0;
    for (let q = 0; q < per; q++) {
      const c = loop ? (j + q) % nC : j + q;
      if (c >= nC) break;
      e += E[c]!;
      cnt++;
    }
    blocks.push(e / (cnt * step));
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > K.LUFS_ABS_GATE);
  if (!abs.length) return -Infinity;
  const relGate = lk(abs.reduce((a, z) => a + z, 0) / abs.length) + K.LUFS_REL_GATE;
  const rel = abs.filter((z) => lk(z) > relGate);
  if (!rel.length) return -Infinity;
  return lk(rel.reduce((a, z) => a + z, 0) / rel.length);
}

// ---------------------------------------------------------------------------------------------------------------
// Bed recipes (§7, §8.4)
// ---------------------------------------------------------------------------------------------------------------

const P = (spec: BedSpec, k: string): number => spec.params[k]!;
const has = (spec: BedSpec, k: string): boolean => typeof spec.params[k] === 'number';

function rumbleComp(Uref: number, gain = 1): Comp {
  const hi = 40 + 5 * Uref;
  return { gain, shape: (f) => bp(f, 18, hi, 2, 7 / 6) };
}
function hissComp(fc: number, gain = 1): Comp {
  return { gain, shape: (f) => bp(f, 0.5 * fc, 3 * fc, 1.5, 1.2) };
}

function bakeWind(b: Bake, spec: BedSpec, pow: number, comps: Comp[], fmax: number): void {
  const n = gustNoise(b.M, rng(b, 'gust'));
  noiseMulti(b, comps, rng(b, 'noise'), fmax);
  mixEnv(b, gustEnvelope(n, P(spec, 'Iu'), pow));
}

function bakeS3(b: Bake, spec: BedSpec): void {
  const tones: number[] = [];
  for (const k of ['fWhistle1_Hz', 'fWhistle2_Hz', 'fWhistle3_Hz']) {
    if (!has(spec, k)) continue;
    const f0 = P(spec, k);
    if (f0 >= K.NYQ_GUARD * b.sr) b.notes.push(`${k} ${f0.toFixed(0)} Hz above the guard: dropped`);
    else tones.push(f0);
  }
  if (!tones.length)
    throw new BakeRefusedError(spec.id, spec.variant, ['fWhistle*: none below the guard']);
  const shape = (f: number) => {
    let s = 0;
    for (const f0 of tones) {
      const x = (f - f0) / (f0 / (2.355 * K.WHISTLE_Q));
      s += Math.exp(-0.5 * x * x);
    }
    return s;
  };
  // A narrow tone (σ = f0/(2.355·Q), under 1 Hz below ~59 Hz) needs a finer table so Q ≈ 25 holds.
  const stepHz = Math.min(...tones) / (2.355 * K.WHISTLE_Q) / 4;
  bakeWind(b, spec, K.WHISTLE_ENV_POW, [{ gain: 1, shape, stepHz }], 1.3 * Math.max(...tones));
}

function surfWaves(b: Bake, spec: BedSpec, air: AirModel) {
  const Hs = P(spec, 'Hs_m'),
    Tp = P(spec, 'Tp_s');
  const fall = Math.sqrt((2 * Hs) / air.gv);
  const nW = Math.max(1, Math.round(b.T / Tp));
  if (Tp > b.T) b.notes.push(`Tp ${Tp.toFixed(1)} s longer than the loop: 1 wave per loop`);
  return { Hs, Tp, fall, nW };
}

function bakeS4(b: Bake, spec: BedSpec, air: AirModel): void {
  const mf = P(spec, 'mf');
  const { Tp, fall, nW } = surfWaves(b, spec, air);
  const r = rng(b, 'events');
  const cr: Ev[] = [],
    fo: Ev[] = [];
  for (let i = 0; i < nW; i++) {
    const t = ((i + 0.5 + (r() - 0.5) * 0.35) * b.T) / nW,
      amp = 0.6 + 0.4 * r(),
      rise = 0.25 + 0.5 * fall;
    cr.push({ t, amp, rise, tau: 0.5 + 1.2 * fall });
    fo.push({ t: t + rise * 0.6, amp, rise: 0.4 + fall, tau: 0.22 * Tp + 0.5 });
  }
  const crashHi = 900 * Math.sqrt(mf);
  noiseMulti(
    b,
    [{ gain: 1.5, shape: (f) => bp(f, 45, crashHi, 1.5, 1) }],
    rng(b, 'crash'),
    9 * crashHi,
  );
  mixEnv(b, eventEnv(new Float64Array(b.M), b.dt, cr, true));
  if (700 * mf < K.NYQ_GUARD * b.sr) {
    noiseMulti(
      b,
      [{ gain: 0.9, shape: (f) => bp(f, 700 * mf, 5200 * mf, 1.5, 1.3) }],
      rng(b, 'foam'),
      15000,
    );
    mixEnv(b, eventEnv(new Float64Array(b.M), b.dt, fo, true));
  } else b.notes.push('foam band above the guard: dropped');
  // Moon's cliff behind the shore plus scattered reflections (artistic geometry; blur model_dependent).
  const c0 = air.c0,
    rt = rng(b, 'taps');
  const taps: Tap[] = [
    { delayS: (2 * K.SURF_CLIFF_M) / c0, gain: K.SURF_CLIFF_GAIN, extraM: 2 * K.SURF_CLIFF_M },
  ];
  for (let i = 0; i < K.SURF_SCATTER_TAPS; i++) {
    const path = (0.15 + 1.05 * rt()) * 340; // metres of extra path (Moon: delay·c with 340 m units)
    const sign = rt() < 0.5 ? -1 : 1;
    taps.push({
      delayS: path / c0,
      gain: K.SURF_SCATTER_GAIN * Math.exp(-(path / 340) * 1.6) * sign,
      extraM: path,
    });
  }
  applyTaps(b, taps, P(spec, 'absK2'));
}

function bakeS5(b: Bake, spec: BedSpec, air: AirModel): void {
  const mf = P(spec, 'mf'),
    rate = P(spec, 'whitecapRate_per_s');
  const { fall, nW } = surfWaves(b, spec, air);
  const r = rng(b, 'events');
  const ph = TAU * r();
  noiseMulti(b, [{ gain: 0.9, shape: (f) => bp(f, 25, 180, 2, 1.5) }], rng(b, 'swell'), 2000);
  const sw = new Float64Array(b.M);
  for (let j = 0; j < b.M; j++) {
    const s = 0.55 + 0.45 * Math.sin((TAU * nW * j) / b.M + ph);
    sw[j] = s * s * 1.6;
  }
  mixEnv(b, sw);
  const nc = Math.round(rate * b.T);
  if (nc > 0) {
    const caps: Ev[] = [];
    for (let i = 0; i < nc; i++) {
      caps.push({
        t: r() * b.T,
        amp: 0.3 + 0.7 * r(),
        rise: 0.08 + 0.12 * r(),
        tau: (0.35 + 0.55 * r()) * (1 + fall * 0.5),
      });
    }
    noiseMulti(
      b,
      [{ gain: 1.1, shape: (f) => bp(f, 350 * Math.sqrt(mf), 4500 * mf, 1.5, 1.2) }],
      rng(b, 'caps'),
      15000,
    );
    mixEnv(b, eventEnv(new Float64Array(b.M), b.dt, caps, true));
    const nb = Math.min(
      K.SEA_PINGS_MAX,
      Math.round(K.SEA_PINGS_PER_S * b.T * Math.min(2, Math.max(0.1, rate))),
    );
    const rp = rng(b, 'pings');
    let dropped = 0;
    for (let i = 0; i < nb; i++) {
      const u = rp(),
        f = mf * (700 + u * rp() * 5000),
        a = 0.3 * rp() * rp(),
        pan = rp(),
        t0 = Math.floor(rp() * b.len);
      if (!addPing(b, t0, f, 8 / f, a, pan)) dropped++;
    }
    if (dropped) b.notes.push(`${dropped} of ${nb} bubble pings above the guard: dropped`);
  }
}

function bakeS6(b: Bake, spec: BedSpec): void {
  const p = P(spec, 'rainPitch'),
    mf = P(spec, 'mf'),
    size = 1 / p,
    p3 = p * p * p;
  noiseMulti(
    b,
    [{ gain: 1, shape: (f) => bp(f, 900 * p, 7000 * p, 1.2, 1.5) }],
    rng(b, 'hiss'),
    15500,
  );
  mixEnv(b, gustEnvelope(gustNoise(b.M, rng(b, 'wander')), K.RAIN_ENV_DEPTH, 1));
  // Patter: short clicks, so a sample-rate envelope (a 4 ms control step would smear them).
  const r = rng(b, 'patter');
  const npRaw = Math.round(K.RAIN_PATTER_PER_S * b.T * p3);
  const np = Math.min(K.RAIN_PATTER_MAX, npRaw);
  if (np < npRaw) b.notes.push(`rain patter capped at ${np} of ${npRaw} events`);
  if (np > 0) {
    const pat: Ev[] = [];
    for (let i = 0; i < np; i++)
      pat.push({ t: r() * b.T, amp: 0.4 + 1.2 * r() * r(), rise: 0.004, tau: 0.03 * size });
    noiseMulti(
      b,
      [{ gain: 0.7, shape: (f) => bp(f, 140 * p, 800 * p, 1.5, 1.2) }],
      rng(b, 'patterNoise'),
      6000,
    );
    mixEnvFull(b, eventEnv(new Float32Array(b.len), 1 / b.sr, pat, true));
  }
  // Impact drops (Moon's falling chirps) and, for some, the small-drop bubble ring at 14 kHz·m_f [SS 4.3].
  const rd = rng(b, 'drops');
  const nd = Math.min(K.RAIN_DROPS_MAX, Math.round(K.RAIN_DROPS_PER_S * b.T * p3));
  const ringF = K.RAIN_RING_HZ_EARTH * mf;
  const ringOk = ringF < K.NYQ_GUARD * b.sr;
  if (!ringOk)
    b.notes.push(`rain bubble ring ${(ringF / 1000).toFixed(1)} kHz above the guard: dropped`);
  const { sr, len, s } = b;
  let dropped = 0;
  for (let q = 0; q < nd; q++) {
    const f = p * (900 + rd() * 3500),
      tau = (0.004 + 0.012 * rd()) * size,
      a = 1.6 * Math.pow(rd(), 3);
    const pan = rd(),
      t0 = Math.floor(rd() * len),
      ring = rd() < K.RAIN_RING_FRACTION,
      ringJit = rd();
    if (f >= K.NYQ_GUARD * sr) {
      dropped++;
      continue;
    }
    const n = Math.floor(6 * tau * sr),
      dec = Math.exp(-1 / (tau * sr));
    let phs = 0,
      env = a;
    for (let i = 0; i < n; i++) {
      phs += (TAU * f * (1 - (0.15 * i) / n)) / sr;
      const v = env * Math.sin(phs),
        k = (t0 + i) % len;
      s.are[k] = s.are[k]! + v * (1 - pan);
      s.aim[k] = s.aim[k]! + v * pan;
      env *= dec;
    }
    if (ring && ringOk) {
      const fr = ringF * (0.93 + 0.14 * ringJit);
      addPing(b, t0, fr, 8 / fr, 0.3 * a, pan);
    }
  }
  if (dropped) b.notes.push(`${dropped} of ${nd} impact drops above the guard: dropped`);
}

function bakeS7(b: Bake, spec: BedSpec): void {
  const mf = P(spec, 'mf');
  noiseMulti(b, [{ gain: 1, shape: (f) => bp(f, 300, 4000, 1.5, 1.5) }], rng(b, 'noise'), 12000);
  mixFlat(b);
  const r = rng(b, 'pings');
  const n = Math.round(K.RIVER_PINGS_PER_S * b.T);
  const ia = Math.pow(K.RIVER_R_MIN_M, -0.5),
    ib = Math.pow(K.RIVER_R_MAX_M, -0.5);
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    const R = Math.pow(ia - r() * (ia - ib), -2); // inverse CDF of N(R) ∝ R^-3/2 on [Rmin, Rmax]
    const f = (K.MINNAERT_FR * mf) / R,
      tau = 1 / (Math.PI * f * K.BUBBLE_DAMPING);
    const a = 0.5 * r() * r(),
      pan = r(),
      t0 = Math.floor(r() * b.len);
    if (!addPing(b, t0, f, tau, a, pan)) dropped++;
  }
  if (dropped) b.notes.push(`${dropped} of ${n} river bubbles above the guard: dropped`);
}

function clickEvents(
  b: Bake,
  r: () => number,
  count: number,
  weight?: (t: number) => number,
): Ev[] {
  const evs: Ev[] = [];
  for (let i = 0; i < count; i++) {
    const t = r() * b.T,
      amp = (0.3 + 0.7 * r()) * (weight ? weight(t) : 1);
    evs.push({ t, amp, rise: 0.0005, tau: 0.002 + 0.008 * r() });
  }
  return evs;
}

function bakeS8(b: Bake): void {
  noiseMulti(b, [{ gain: 1, shape: (f) => bp(f, 25, 200, 2, 1.5) }], rng(b, 'roar'), 2000);
  mixEnv(b, gustEnvelope(gustNoise(b.M, rng(b, 'wander')), K.LAVA_ROAR_DEPTH, 1));
  const n = Math.round(K.LAVA_CRACKLE_PER_S * b.T);
  if (n > 0) {
    noiseMulti(
      b,
      [{ gain: 0.5, shape: (f) => bp(f, 1000, 6000, 1.5, 1.5) }],
      rng(b, 'crackleNoise'),
      14000,
    );
    mixEnvFull(
      b,
      eventEnv(new Float32Array(b.len), 1 / b.sr, clickEvents(b, rng(b, 'crackle'), n), true),
    );
  }
}

function bakeS10(b: Bake, spec: BedSpec): void {
  const g = gustNoise(b.M, rng(b, 'gust'));
  const env = gustEnvelope(g, P(spec, 'Iu'), K.HISS_ENV_POW);
  noiseMulti(b, [{ gain: 1, shape: (f) => bp(f, 2000, 10000, 1.5, 1.5) }], rng(b, 'noise'), 15000);
  mixEnv(b, env);
  const n = Math.round(K.SAND_CLICKS_PER_S * b.T);
  if (n > 0) {
    const at = (t: number) => env[Math.min(b.M - 1, Math.floor(t / b.dt))]!;
    noiseMulti(
      b,
      [{ gain: 0.6, shape: (f) => bp(f, 3000, 12000, 1.5, 1.5) }],
      rng(b, 'clickNoise'),
      15000,
    );
    mixEnvFull(
      b,
      eventEnv(new Float32Array(b.len), 1 / b.sr, clickEvents(b, rng(b, 'clicks'), n, at), true),
    );
  }
}

function bakeS12(b: Bake, spec: BedSpec): void {
  const Iu = has(spec, 'Iu') ? P(spec, 'Iu') : K.GAS_IU;
  const n = gustNoise(b.M, rng(b, 'gust'));
  noiseMulti(
    b,
    [
      { gain: 1, shape: (f) => bp(f, 15, 120, 2, 1.5) },
      { gain: 0.5, shape: (f) => bp(f, 300, 2000, 1.5, 1.5) },
    ],
    rng(b, 'noise'),
    8000,
  );
  mixEnv(b, gustEnvelope(n, Iu, K.RUMBLE_ENV_POW));
  applyPhaser(b, Math.max(1, Math.round(K.PHASER_HZ * b.T)));
}

/** §8.4 thunder, linear: band-pass at f_m (Q 0.7) plus a 20–60 Hz rumble under a roll, and a crack when near. */
function bakeThunder(b: Bake, spec: BedSpec, dur: number): void {
  const fm = P(spec, 'fm_Hz'),
    Q = K.THUNDER_Q;
  const kq = Math.sqrt(1 + 1 / (4 * Q * Q)),
    hq = 1 / (2 * Q);
  const lo = fm * (kq - hq),
    hi = fm * (kq + hq);
  const pad = K.ONE_SHOT_PAD_S,
    r = rng(b, 'roll');
  const near = P(spec, 'crack') >= 0.5;
  // Event times are peak times (Moon's convention), so each onset (t − rise) is at or after the pad.
  const rollRise = Math.min(0.5, 0.1 * dur);
  const evs: Ev[] = [
    near
      ? { t: pad + 0.012, amp: 1, rise: 0.012, tau: 0.45 }
      : {
          t: pad + K.THUNDER_FAR_RISE_S,
          amp: K.THUNDER_FAR_AMP,
          rise: K.THUNDER_FAR_RISE_S,
          tau: 0.8,
        },
    { t: pad + 0.1 + rollRise, amp: 0.5, rise: rollRise, tau: dur / 5, end: dur },
  ];
  const nSub = 5 + Math.round(dur / 2);
  for (let i = 0; i < nSub; i++) {
    const rise = 0.012 + 0.04 * r();
    evs.push({
      t: pad + 0.1 + 0.8 * dur * r() + rise,
      amp: 0.3 + 0.4 * r(),
      rise,
      tau: 0.2 + 0.3 * r(),
    });
  }
  noiseMulti(
    b,
    [
      { gain: 1, shape: (f) => bp(f, lo, hi, 1, 1) },
      { gain: K.THUNDER_RUMBLE_GAIN, shape: (f) => bp(f, 20, 60, 2, 2) },
    ],
    rng(b, 'noise'),
    Math.max(6000, 4 * hi),
  );
  mixEnv(b, eventEnv(new Float64Array(b.M), b.dt, evs, false));
  if (near) {
    noiseMulti(
      b,
      [{ gain: K.THUNDER_CRACK_GAIN, shape: (f) => bp(f, 300, 8000, 1, 1.5) }],
      rng(b, 'crack'),
      15000,
    );
    const crack: Ev[] = [
      { t: pad + 0.002, amp: 1, rise: 0.002, tau: 0.03, end: K.THUNDER_CRACK_S },
    ];
    mixEnvFull(b, eventEnv(new Float32Array(b.len), 1 / b.sr, crack, false));
  }
}

/** S8 variant 1: a vent burst, linear. A thud standing in for the 2–9 Hz infrasound of a burst, plus spatter. */
function bakeVent(b: Bake): void {
  const pad = K.ONE_SHOT_PAD_S,
    r = rng(b, 'burst');
  const evs: Ev[] = [{ t: pad + 0.02, amp: 1, rise: 0.02, tau: 0.35 }];
  for (let i = 0; i < 8; i++)
    evs.push({
      t: pad + 0.205 + 2.3 * r(),
      amp: 0.2 + 0.3 * r(),
      rise: 0.005,
      tau: 0.05 + 0.1 * r(),
    });
  noiseMulti(
    b,
    [
      { gain: 1, shape: (f) => bp(f, 30, 80, 2, 2) },
      { gain: 0.5, shape: (f) => bp(f, 800, 5000, 1.5, 1.5) },
    ],
    rng(b, 'noise'),
    12000,
  );
  mixEnv(b, eventEnv(new Float64Array(b.M), b.dt, evs, false));
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------

export interface BakeOutput {
  result: BakeResult;
  notes: string[];
  ffts: number;
  peakDbfs: number;
}

function nextPow2(x: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, x)));
}

/** One-shot content length in seconds (thunder: `dur_s` capped at THUNDER_MAX_S; vent: VENT_DUR_S). */
function oneShotDur(spec: BedSpec): number {
  return spec.id === 'thunder' ? Math.min(spec.params.dur_s ?? 0, K.THUNDER_MAX_S) : K.VENT_DUR_S;
}

/** Samples per channel `bakeBed` will return for this spec (for the palette's memory budget). */
export function bakedLength(spec: BedSpec): number {
  if (!isOneShot(spec.id, spec.variant)) return spec.N;
  return Math.ceil((K.ONE_SHOT_PAD_S + oneShotDur(spec) + K.ONE_SHOT_TAIL_S) * spec.sampleRate);
}

/** `bakeBed` plus the dev notes, the FFT count and the final sample peak (outside `BakeResult`, so the contract stays verbatim). */
export function bakeBedDetailed(spec: BedSpec, air: AirModel): BakeOutput {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  validate(spec, air);
  const sr = spec.sampleRate;
  const oneShot = isOneShot(spec.id, spec.variant);
  const notes: string[] = [];
  let len = spec.N,
    n = spec.N,
    dur = 0;
  if (oneShot) {
    dur = oneShotDur(spec);
    if (spec.id === 'thunder' && P(spec, 'dur_s') > K.THUNDER_MAX_S) {
      notes.push(`thunder ${P(spec, 'dur_s').toFixed(1)} s capped at ${K.THUNDER_MAX_S} s`);
    }
    len = bakedLength(spec);
    n = nextPow2(len);
    notes.push(`one-shot: ${len} samples (spec.N ${spec.N} not used for its length)`);
  }
  const s = getScratch(n);
  s.are.fill(0);
  s.aim.fill(0);
  const M = Math.max(8, Math.floor(len / K.ENV_DECIM));
  const b: Bake = {
    n,
    len,
    sr,
    loop: !oneShot,
    T: len / sr,
    M,
    dt: len / sr / M,
    s,
    notes,
    ffts: 0,
    seed: spec.seed >>> 0,
  };

  switch (spec.id) {
    case 'S1_land':
    case 'S1_sea':
      bakeWind(b, spec, K.RUMBLE_ENV_POW, [rumbleComp(spec.Uref)], 9000);
      break;
    case 'S2':
      bakeWind(b, spec, K.HISS_ENV_POW, [hissComp(P(spec, 'fHiss_Hz'))], 12 * P(spec, 'fHiss_Hz'));
      break;
    case 'S3':
      bakeS3(b, spec);
      break;
    case 'S4':
      bakeS4(b, spec, air);
      break;
    case 'S5':
      bakeS5(b, spec, air);
      break;
    case 'S6':
      bakeS6(b, spec);
      break;
    case 'S7':
      bakeS7(b, spec);
      break;
    case 'S8':
      if (spec.variant === 1) bakeVent(b);
      else bakeS8(b);
      break;
    case 'S9': {
      const comps = [rumbleComp(spec.Uref)];
      if (has(spec, 'fHiss_Hz'))
        comps.push(hissComp(P(spec, 'fHiss_Hz'), Math.pow(10, K.STORM_HISS_REL_DB / 20)));
      else notes.push('storm hiss gated (no fHiss_Hz): rumble only');
      bakeWind(
        b,
        spec,
        K.STORM_ENV_POW,
        comps,
        has(spec, 'fHiss_Hz') ? Math.max(9000, 12 * P(spec, 'fHiss_Hz')) : 9000,
      );
      break;
    }
    case 'S10':
      bakeS10(b, spec);
      break;
    case 'S12':
      bakeS12(b, spec);
      break;
    case 'thunder':
      bakeThunder(b, spec, dur);
      break;
  }

  // One-shots: fade the last ONE_SHOT_TAIL_S to zero, so nothing is cut mid-sample.
  if (oneShot) {
    const nf = Math.round(K.ONE_SHOT_TAIL_S * sr);
    for (let i = 0; i < nf; i++) {
      const k = len - nf + i,
        g = 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / nf);
      s.are[k] = s.are[k]! * g;
      s.aim[k] = s.aim[k]! * g;
    }
  }

  // Level: loops to BED_LUFS (gain lowered if the peak would pass −1 dBFS); one-shots to their peak.
  const Lr = s.are.subarray(0, len),
    Rr = s.aim.subarray(0, len);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(Lr[i]!),
      c = Math.abs(Rr[i]!);
    if (a > peak) peak = a;
    if (c > peak) peak = c;
  }
  const lufs0 = measureLufs([Lr, Rr], sr, !oneShot);
  if (!(lufs0 > K.LUFS_ABS_GATE) || !(peak > 0) || !Number.isFinite(peak)) {
    throw new BakeRefusedError(spec.id, spec.variant, ['silent']);
  }
  let gain: number;
  if (oneShot) gain = Math.pow(10, K.ONE_SHOT_PEAK_DBFS / 20) / peak;
  else {
    gain = Math.pow(10, (K.BED_LUFS - lufs0) / 20);
    const ceil = Math.pow(10, K.BED_PEAK_MAX_DBFS / 20);
    if (peak * gain > ceil) {
      gain = ceil / peak;
      notes.push(
        `peak-limited: ${(lufs0 + 20 * Math.log10(gain)).toFixed(2)} LUFS instead of ${K.BED_LUFS}`,
      );
    }
  }
  const L = new Float32Array(len),
    R = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    L[i] = Lr[i]! * gain;
    R[i] = Rr[i]! * gain;
  }
  const lufs = lufs0 + 20 * Math.log10(gain);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    result: { id: spec.id, variant: spec.variant, L, R, sampleRate: sr, ms: t1 - t0, lufs },
    notes,
    ffts: b.ffts,
    peakDbfs: 20 * Math.log10(peak * gain),
  };
}

/** App. B: bake one bed (pure; same spec and air give byte-identical output within one JS engine). Throws
 * `BakeRefusedError` when the bed cannot be baked from what it was given. */
export function bakeBed(spec: BedSpec, air: AirModel): BakeResult {
  return bakeBedDetailed(spec, air).result;
}
