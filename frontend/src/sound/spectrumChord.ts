// R13.12 (Q-443, Q-446): the spectrum chord. The whole spectrum at once as 12 notes, a steady drone
// toggled by a button, with an A/B switch between "Data" and "Smooth" (smoothed data).
//   - 12 equal-pitch bins over the Q-70 pitch range. pitch.ts is linear in λ, so they are equal-λ bins
//     over 0.75–5.0 µm; each note sits at its bin's centre (≈ 236–1083 Hz, 240 cents apart; long λ low,
//     Q-430).
//   - A bin's level is the mean normalised flux of the usable points inside it (flagged and
//     non-finite points dropped by the shared mapping). A bin with no usable point is silent in both
//     modes and listed in `missing`: nothing is interpolated across a gap (Q-446).
//   - Level over a 30 dB range against the Data bin peak; a bin under 0.2 of that peak is silent.
//   - ISO 226 weights at 60 phon, capped at +6 dB ("Loudness-corrected"; iso226.ts).
//   - Gains power-normalised, g_i = a_i/√Σa_j², with ONE factor from Data used for both modes, and one
//     RMS scale (−18 dBFS) from the Data render used for both buffers, so A/B changes only the bins
//     that differ (Q-446).
//   - A noisy bin (σ/flux > 0.3) beats in amplitude at 2 + 4·clamp(σ/flux, 0, 1) Hz (≤ 6 Hz), never a
//     detune; its gain is raised so the beating does not make it quieter (Q-446).
//   - Smooth = the running median of log flux over 0.5 µm, binned like the data, tagged `derived`
//     ("smoothed data"). It can only remove narrow features, never add a dip (Q-446).
//   - Pre-rendered to two looping AudioBuffers (6 s, every frequency on the 1/6 Hz grid, integer phase,
//     so the loop is exact), seeded random phases (no in-phase spike at onset), 30 ms attack.
// Determinism: the same points, seed and sample rate give byte-identical buffers within one JavaScript
// engine (V8 in Chrome and Node; Q-444). The player copies ListenSweep: shared context, the spectrum
// bus, the duck (with a safety timeout and a heartbeat), the settings, the page lifecycle and the
// honesty filter (D-21). One spectrum sound at a time (spectrumExclusive.ts).
import type { Tag } from '@/contract';
import { isTagShown, weakerOf, type HonestyState } from '@/viewer/honesty';
import { getAudioContext } from './audioContext';
import { dbToGain, getBus, holdDuck, type DuckHold } from './audioGraph';
import { loudnessWeightDb } from './iso226';
import { DOCUMENT_PAGE, type PageVisibility, type SweepSettings } from './listenSweep';
import { pitchToHz, wavelengthToPitch } from './pitch';
import { getSoundSettings, useSoundSettings } from './settings';
import { claimSpectrumSound, type SpectrumClaim } from './spectrumExclusive';
import type { MappedPoint, SpectrumMapping } from './spectrumMapping';
import {
  AUDIO_LOOKAHEAD_S,
  CHORD_AB_FADE_S,
  CHORD_ATTACK_S,
  CHORD_BEAT_DEPTH,
  CHORD_BEAT_MAX_HZ,
  CHORD_BEAT_MIN_HZ,
  CHORD_BEAT_SPAN_HZ,
  CHORD_BINS,
  CHORD_ISO_CAP_DB,
  CHORD_LOOP_S,
  CHORD_RANGE_DB,
  CHORD_RELEASE_S,
  CHORD_SEED,
  CHORD_SMOOTH_WINDOW_UM,
  CHORD_TARGET_RMS_DBFS,
  DUCK_SAFETY_S,
  PITCH_LAMBDA_MAX_UM,
  PITCH_LAMBDA_MIN_UM,
  SPECTRUM_NOISY_SIGMA_RATIO,
  SPECTRUM_QUIET_THRESHOLD,
} from './tuning';

export type ChordMode = 'data' | 'smooth';

/** The Smooth mode's formula (shown with its `derived` badge). */
export const SMOOTH_FORMULA = 'running median of log flux over 0.5 µm, binned like the data';

export interface ChordBin {
  /** 0..11 in ascending λ (so descending pitch, Q-430). */
  index: number;
  lambdaLoUm: number;
  lambdaHiUm: number;
  lambdaUm: number;
  /** On the loop grid (an integer number of cycles in CHORD_LOOP_S). */
  hz: number;
  /** Usable points inside the bin. 0 → silent in both modes, listed in `missing`. */
  points: number;
  /** Mean normalised flux of the bin's points (Data), and of their smoothed values (Smooth). */
  level: number;
  smoothLevel: number;
  /** 20·log10(level / Data peak) in [−CHORD_RANGE_DB, 0], or null when silent. */
  levelDb: number | null;
  smoothLevelDb: number | null;
  /** Silent in that mode: no point, or under SPECTRUM_QUIET_THRESHOLD of the Data peak. */
  quiet: boolean;
  smoothQuiet: boolean;
  /** Mean of the points' σ/flux (each capped at 1); NaN when no point has a σ. */
  sigmaRatio: number;
  noisy: boolean;
  /** Beat rate (Hz, on the loop grid) of a noisy bin; null when not noisy. */
  beatHz: number | null;
  /** ISO 226 weight (dB), capped at +CHORD_ISO_CAP_DB. */
  isoDb: number;
}

export interface ChordPartial {
  bin: number;
  /** Cycles in one loop: hz = cycles / CHORD_LOOP_S. */
  cycles: number;
  /** Linear gain after the power normalisation (Data's factor for both modes). */
  gain: number;
  /** Start phase, 0..1 of a cycle. */
  phase: number;
  /** Beat cycles in one loop (0 = no beating), its phase (0..1) and depth. */
  beatCycles: number;
  beatPhase: number;
  beatDepth: number;
}

export interface ChordPlan {
  /** The spectrum's tag (Data mode). */
  tag: Tag;
  /** Smooth is a derived quantity: weakerOf(tag, 'derived'). */
  smoothTag: Tag;
  smoothFormula: string;
  bins: ChordBin[];
  data: ChordPartial[];
  smooth: ChordPartial[];
  /** Silent bins without data: `chord.bin.<i>.no-data`. */
  missing: string[];
  seed: number;
}

/** mulberry32, the generator hearAudio's noise uses. Returns 0..1. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Beat rate for σ/flux (SPEC R13.12 item 6), before the loop grid. */
export function beatRateHz(ratio: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  return Math.min(CHORD_BEAT_MAX_HZ, CHORD_BEAT_MIN_HZ + CHORD_BEAT_SPAN_HZ * r);
}

/** Mean power of the beat envelope e = 1 − d(1 − cos)/2: (1 − d/2)² + d²/8. */
export function beatMeanPower(depth: number): number {
  return (1 - depth / 2) ** 2 + depth ** 2 / 8;
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const m = n >> 1;
  return n % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/**
 * Smoothed strength per point: the median of log(strength) over the points within ±window/2 µm,
 * the window shrunk symmetrically near the ends of the spectrum (so a monotone edge is not pulled
 * down or up by its one-sided neighbours). A non-positive strength enters as −∞, so it can only
 * lower a median, never raise one. O(n²) on ~100 points.
 */
export function smoothStrengths(points: readonly MappedPoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  const first = points[0]!.wavelengthUm;
  const last = points[n - 1]!.wavelengthUm;
  const logs = points.map((p) => (p.strength > 0 ? Math.log(p.strength) : -Infinity));
  return points.map((p) => {
    const l = p.wavelengthUm;
    const half = Math.min(CHORD_SMOOTH_WINDOW_UM / 2, l - first, last - l);
    const win: number[] = [];
    for (let j = 0; j < n; j++) {
      const d = points[j]!.wavelengthUm - l;
      if (d >= -half - 1e-12 && d <= half + 1e-12) win.push(logs[j]!);
    }
    const m = median(win.sort((a, b) => a - b));
    return Number.isFinite(m) ? Math.exp(m) : 0;
  });
}

const PERIOD_CYCLES = (hz: number) => Math.max(1, Math.round(hz * CHORD_LOOP_S));

/**
 * The chord as data (pure). Null when there is nothing to play: no usable point, fewer than two
 * distinct λ, or no bin with a positive level.
 */
export function planChord(
  mapping: SpectrumMapping,
  opts: { tag?: Tag; seed?: number } = {},
): ChordPlan | null {
  if (mapping.empty || mapping.count < 2) return null;
  const tag = opts.tag ?? 'measured';
  const seed = opts.seed ?? CHORD_SEED;
  const pts = mapping.points();
  const smoothed = smoothStrengths(pts);
  const width = (PITCH_LAMBDA_MAX_UM - PITCH_LAMBDA_MIN_UM) / CHORD_BINS;

  const sum = new Array<number>(CHORD_BINS).fill(0);
  const sumS = new Array<number>(CHORD_BINS).fill(0);
  const count = new Array<number>(CHORD_BINS).fill(0);
  const ratioSum = new Array<number>(CHORD_BINS).fill(0);
  const ratioN = new Array<number>(CHORD_BINS).fill(0);
  pts.forEach((p, i) => {
    const l = p.wavelengthUm;
    if (!(l >= PITCH_LAMBDA_MIN_UM && l <= PITCH_LAMBDA_MAX_UM)) return;
    const b = Math.min(CHORD_BINS - 1, Math.floor((l - PITCH_LAMBDA_MIN_UM) / width));
    sum[b]! += p.strength;
    sumS[b]! += smoothed[i]!;
    count[b]!++;
    if (!Number.isNaN(p.sigmaRatio)) {
      ratioSum[b]! += Math.min(1, p.sigmaRatio);
      ratioN[b]!++;
    }
  });

  const level = sum.map((s, b) => (count[b]! > 0 ? s / count[b]! : 0));
  const smoothLevel = sumS.map((s, b) => (count[b]! > 0 ? s / count[b]! : 0));
  const peak = Math.max(...level.filter((_, b) => count[b]! > 0));
  if (!(peak > 0) || !Number.isFinite(peak)) return null;

  const rand = mulberry32(seed);
  const phases = Array.from({ length: CHORD_BINS }, () => rand());
  const beatPhases = Array.from({ length: CHORD_BINS }, () => rand());

  const toDb = (v: number, has: boolean): number | null => {
    if (!has || !(v / peak >= SPECTRUM_QUIET_THRESHOLD)) return null;
    return Math.max(-CHORD_RANGE_DB, Math.min(0, 20 * Math.log10(v / peak)));
  };

  const bins: ChordBin[] = [];
  const missing: string[] = [];
  for (let b = 0; b < CHORD_BINS; b++) {
    const lo = PITCH_LAMBDA_MIN_UM + b * width;
    const centre = lo + width / 2;
    const cycles = PERIOD_CYCLES(pitchToHz(wavelengthToPitch(centre)));
    const hz = cycles / CHORD_LOOP_S;
    const has = count[b]! > 0;
    if (!has) missing.push(`chord.bin.${b}.no-data`);
    const ratio = ratioN[b]! > 0 ? ratioSum[b]! / ratioN[b]! : NaN;
    const noisy = ratio > SPECTRUM_NOISY_SIGMA_RATIO;
    const levelDb = toDb(level[b]!, has);
    const smoothLevelDb = toDb(smoothLevel[b]!, has);
    bins.push({
      index: b,
      lambdaLoUm: lo,
      lambdaHiUm: lo + width,
      lambdaUm: centre,
      hz,
      points: count[b]!,
      level: level[b]!,
      smoothLevel: smoothLevel[b]!,
      levelDb,
      smoothLevelDb,
      quiet: levelDb === null,
      smoothQuiet: smoothLevelDb === null,
      sigmaRatio: ratio,
      noisy,
      beatHz: noisy ? PERIOD_CYCLES(beatRateHz(ratio)) / CHORD_LOOP_S : null,
      isoDb: Math.min(CHORD_ISO_CAP_DB, loudnessWeightDb(hz)),
    });
  }

  const amp = (bin: ChordBin, db: number): number => {
    const comp = bin.noisy ? 1 / Math.sqrt(beatMeanPower(CHORD_BEAT_DEPTH)) : 1;
    return dbToGain(db) * dbToGain(bin.isoDb) * comp;
  };
  const dataAmps = bins.map((bin) => (bin.levelDb === null ? 0 : amp(bin, bin.levelDb)));
  const norm = Math.sqrt(dataAmps.reduce((s, a) => s + a * a, 0));
  const partials = (pick: (bin: ChordBin) => number | null): ChordPartial[] =>
    bins.flatMap((bin) => {
      const db = pick(bin);
      if (db === null) return [];
      return [
        {
          bin: bin.index,
          cycles: Math.round(bin.hz * CHORD_LOOP_S),
          gain: amp(bin, db) / norm,
          phase: phases[bin.index]!,
          beatCycles: bin.beatHz === null ? 0 : Math.round(bin.beatHz * CHORD_LOOP_S),
          beatPhase: beatPhases[bin.index]!,
          beatDepth: bin.beatHz === null ? 0 : CHORD_BEAT_DEPTH,
        },
      ];
    });

  return {
    tag,
    smoothTag: weakerOf(tag, 'derived'),
    smoothFormula: SMOOTH_FORMULA,
    bins,
    data: partials((bin) => bin.levelDb),
    smooth: partials((bin) => bin.smoothLevelDb),
    missing,
    seed,
  };
}

/** One period of sin(2π j / period), j = 0..period−1, per period length (cached). */
const sineTables = new Map<number, Float64Array>();
function sineTable(period: number): Float64Array {
  let t = sineTables.get(period);
  if (!t) {
    t = new Float64Array(period);
    for (let j = 0; j < period; j++) t[j] = Math.sin((2 * Math.PI * j) / period);
    sineTables.set(period, t);
  }
  return t;
}

/**
 * Sum the partials (pure, deterministic; no scaling). `samples` defaults to one loop. Every phase is
 * an integer index into one period ((cycles·n + phase·period) mod period), read from a sine table,
 * so sample `period` equals sample 0 exactly and no float drift builds up over the loop.
 */
export function renderPartials(
  partials: readonly ChordPartial[],
  sampleRate: number,
  samples: number = Math.round(CHORD_LOOP_S * sampleRate),
): Float64Array {
  const period = Math.round(CHORD_LOOP_S * sampleRate);
  const sin = sineTable(period);
  const quarter = period / 4;
  const out = new Float64Array(samples);
  for (const p of partials) {
    const k = p.cycles % period;
    const ph = Math.floor(p.phase * period) % period;
    const kb = p.beatCycles % period;
    // cos(x) = sin(x + π/2): a quarter period on; exact when the period is a multiple of 4.
    const phb = (Math.floor(p.beatPhase * period) + Math.round(quarter)) % period;
    let j = ph;
    let jb = phb;
    for (let n = 0; n < samples; n++) {
      let v = p.gain * sin[j]!;
      if (kb > 0) v *= 1 - (p.beatDepth * (1 - sin[jb]!)) / 2;
      out[n]! += v;
      j += k;
      if (j >= period) j -= period;
      jb += kb;
      if (jb >= period) jb -= period;
    }
  }
  return out;
}

function rms(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

export interface ChordBuffers {
  data: Float32Array<ArrayBuffer>;
  smooth: Float32Array<ArrayBuffer>;
  /** The one scale (from Data) that brings Data to CHORD_TARGET_RMS_DBFS; applied to both. */
  scale: number;
}

/** Both loops for `plan` at `sampleRate`, scaled by one factor from the Data render (pure). */
export function renderChord(plan: ChordPlan, sampleRate: number): ChordBuffers {
  const d = renderPartials(plan.data, sampleRate);
  const s = renderPartials(plan.smooth, sampleRate);
  const r = rms(d);
  const scale = r > 0 ? dbToGain(CHORD_TARGET_RMS_DBFS) / r : 0;
  return {
    data: Float32Array.from(d, (v) => v * scale),
    smooth: Float32Array.from(s, (v) => v * scale),
    scale,
  };
}

/** FNV-1a (32 bit) over the bytes of a buffer: the golden-hash form of the determinism test. */
export function fnv1a(buf: Float32Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface SpectrumChordOptions {
  context?: () => AudioContext | null;
  settings?: SweepSettings;
  page?: PageVisibility;
}

const SETTINGS: SweepSettings = {
  get: () => getSoundSettings(),
  subscribe: (fn) => useSoundSettings.subscribe(fn),
};

interface Voice {
  sources: AudioBufferSourceNode[];
  nodes: AudioNode[];
  freed: boolean;
}

function freeVoice(v: Voice): void {
  if (v.freed) return;
  v.freed = true;
  for (const s of v.sources) {
    s.onended = null;
    s.disconnect();
  }
  for (const n of v.nodes) n.disconnect();
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * Plays a ChordPlan as a looping drone. `start` refuses (returns false) when sound is off, the page
 * is hidden, there is no running context, or the honesty state hides the spectrum's tag. Smooth
 * plays only where its `derived` tag is shown; otherwise the chord plays Data.
 */
export class SpectrumChord {
  private readonly getContext: () => AudioContext | null;
  private readonly settings: SweepSettings;
  private readonly page: PageVisibility;
  private readonly cache = new WeakMap<ChordPlan, { rate: number; buffers: ChordBuffers }>();
  private readonly live = new Set<Voice>();
  private voice: Voice | null = null;
  private dataGain: GainNode | null = null;
  private smoothGain: GainNode | null = null;
  private env: GainNode | null = null;
  private volume: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private plan: ChordPlan | null = null;
  private duck: DuckHold | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private claim: SpectrumClaim | null = null;
  private unsubscribe: (() => void) | null = null;
  private unhook: (() => void) | null = null;
  private active = false;
  private startAt = 0;
  private current: ChordMode | null = null;
  /** The Smooth share (0 = Data, 1 = Smooth) and its linear fade. */
  private fade = { from: 0, to: 0, t0: 0, t1: 0 };
  private honesty: HonestyState = 'derived';
  /** Called once when the chord stops (any path). */
  onEnd: (() => void) | null = null;

  constructor(options: SpectrumChordOptions = {}) {
    this.getContext = options.context ?? getAudioContext;
    this.settings = options.settings ?? SETTINGS;
    this.page = options.page ?? DOCUMENT_PAGE;
  }

  get playing(): boolean {
    return this.active;
  }
  get mode(): ChordMode | null {
    return this.active ? this.current : null;
  }
  get ducking(): boolean {
    return this.duck !== null && !this.duck.released;
  }
  /** Voices still connected (tests: nothing leaks after a stop). */
  get liveVoices(): number {
    return this.live.size;
  }
  get honestyState(): HonestyState {
    return this.honesty;
  }

  /** Whether `mode` may play under `state`. */
  static modeShown(plan: ChordPlan, mode: ChordMode, state: HonestyState): boolean {
    return isTagShown(state, mode === 'smooth' ? plan.smoothTag : plan.tag);
  }

  start(plan: ChordPlan, mode: ChordMode, honesty: HonestyState): boolean {
    this.stop();
    if (this.page.isHidden()) return false;
    const st = this.settings.get();
    if (!st.soundOn) return false;
    if (!isTagShown(honesty, plan.tag)) return false;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return false;
    const playMode: ChordMode = SpectrumChord.modeShown(plan, mode, honesty) ? mode : 'data';
    this.claim = claimSpectrumSound(() => this.stop());

    const rate = ctx.sampleRate;
    let cached = this.cache.get(plan);
    if (!cached || cached.rate !== rate) {
      cached = { rate, buffers: renderChord(plan, rate) };
      this.cache.set(plan, cached);
    }
    const { buffers } = cached;
    const base = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    const volume = ctx.createGain();
    volume.gain.value = clampVolume(st.volume);
    volume.connect(getBus(ctx, 'spectrum'));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, base);
    env.gain.linearRampToValueAtTime(1, base + CHORD_ATTACK_S);
    env.connect(volume);
    const share = playMode === 'smooth' ? 1 : 0;
    const make = (data: Float32Array<ArrayBuffer>, g: number) => {
      const buf = ctx.createBuffer(1, data.length, rate);
      buf.getChannelData(0).set(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = g;
      gain.gain.setValueAtTime(g, base);
      src.connect(gain);
      gain.connect(env);
      return { src, gain };
    };
    const d = make(buffers.data, 1 - share);
    const s = make(buffers.smooth, share);
    const voice: Voice = {
      sources: [d.src, s.src],
      nodes: [d.gain, s.gain, env, volume],
      freed: false,
    };
    d.src.onended = () => {
      if (this.live.delete(voice)) freeVoice(voice);
      if (this.voice === voice) this.finish();
    };
    d.src.start(base);
    s.src.start(base);
    this.live.add(voice);

    this.ctx = ctx;
    this.plan = plan;
    this.voice = voice;
    this.dataGain = d.gain;
    this.smoothGain = s.gain;
    this.env = env;
    this.volume = volume;
    this.current = playMode;
    this.honesty = honesty;
    this.fade = { from: share, to: share, t0: base, t1: base };
    this.startAt = base;

    // R13.9 duck through the bus API: the safety timeout, kept alive by a heartbeat while the
    // context runs, so a missed stop path cannot leave the ambience ducked.
    const safety = CHORD_LOOP_S + DUCK_SAFETY_S;
    this.duck = holdDuck(ctx, safety);
    this.heartbeat = setInterval(() => {
      if (this.active && this.ctx === ctx && ctx.state === 'running') this.duck?.extend(safety);
    }, CHORD_LOOP_S * 1000);

    this.unsubscribe = this.settings.subscribe((next) => {
      if (!next.soundOn) {
        this.stop();
        return;
      }
      this.volume?.gain.setTargetAtTime(clampVolume(next.volume), ctx.currentTime, 0.02);
    });
    this.unhook = this.page.onHidden(() => this.stop());
    this.active = true;
    return true;
  }

  /** The Smooth share now (0..1), from the linear fade. */
  private shareAt(t: number): number {
    const f = this.fade;
    if (t >= f.t1 || f.t1 <= f.t0) return f.to;
    if (t <= f.t0) return f.from;
    return f.from + ((f.to - f.from) * (t - f.t0)) / (f.t1 - f.t0);
  }

  /**
   * A/B: a linear crossfade over CHORD_AB_FADE_S (the gains always sum to 1; the two loops are
   * phase-locked, so this interpolates each partial's level). Returns false when the mode is not
   * allowed by the honesty state (Smooth is `derived`) or nothing plays.
   */
  setMode(mode: ChordMode): boolean {
    if (!this.active || !this.ctx || !this.plan || !this.dataGain || !this.smoothGain) return false;
    if (!SpectrumChord.modeShown(this.plan, mode, this.honesty)) return false;
    if (mode === this.current) return true;
    const t = this.ctx.currentTime;
    const from = this.shareAt(t);
    const to = mode === 'smooth' ? 1 : 0;
    const t1 = t + CHORD_AB_FADE_S;
    for (const [g, a, b] of [
      [this.dataGain, 1 - from, 1 - to],
      [this.smoothGain, from, to],
    ] as const) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(a, t);
      g.gain.linearRampToValueAtTime(b, t1);
    }
    this.fade = { from, to, t0: t, t1 };
    this.current = mode;
    return true;
  }

  /**
   * D-21: a hidden spectrum tag stops the chord; a hidden Smooth tag switches it to Data. Widening
   * the state again does not switch back by itself.
   */
  setHonesty(state: HonestyState): void {
    this.honesty = state;
    if (!this.active || !this.plan) return;
    if (!isTagShown(state, this.plan.tag)) {
      this.stop();
      return;
    }
    if (this.current === 'smooth' && !isTagShown(state, this.plan.smoothTag)) this.setMode('data');
  }

  /** Stop with a short release; the nodes are freed when the sources end (or after a fallback). */
  stop(): void {
    const voice = this.voice;
    const ctx = this.ctx;
    if (voice && ctx && this.env) {
      const t = ctx.currentTime;
      const env = this.env.gain;
      env.cancelScheduledValues(t);
      env.setValueAtTime(this.active ? Math.min(1, Math.max(0, envLevel(t, this.startAt))) : 0, t);
      env.linearRampToValueAtTime(0, t + CHORD_RELEASE_S);
      for (const s of voice.sources) {
        try {
          s.stop(t + CHORD_RELEASE_S);
        } catch {
          // Already stopped.
        }
      }
      // A suspended context never fires `onended`: free the nodes anyway.
      setTimeout(
        () => {
          if (this.live.delete(voice)) freeVoice(voice);
        },
        (CHORD_RELEASE_S + 0.1) * 1000,
      );
    }
    this.voice = null;
    this.finish();
  }

  private finish(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.duck?.release();
    this.duck = null;
    this.claim?.release();
    this.claim = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unhook?.();
    this.unhook = null;
    this.dataGain = null;
    this.smoothGain = null;
    this.env = null;
    this.volume = null;
    if (!this.active) return;
    this.active = false;
    this.current = null;
    this.onEnd?.();
  }
}

/** The envelope's level at `t` for a chord whose attack starts at `t0`. */
function envLevel(t: number, t0: number): number {
  if (t <= t0) return 0;
  return Math.min(1, (t - t0) / CHORD_ATTACK_S);
}
