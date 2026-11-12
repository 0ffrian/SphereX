// R8.9, D-10, R13.9 (Q-441): the shared audio output. Every sound of the app goes through one graph
// per AudioContext: three buses (events, spectrum, ambience) into one master gain, one limiter and
// the destination, so sounds from different modules cannot add up past the limiter.
//   events, spectrum: GainNode → master
//   ambience: input → 35 Hz high-pass → duck gain (−9 dB while a data sound plays) → level → master
// The ambience level (ambienceVolume × volume, 0 when sound or ambience is off) comes from a level
// source the app registers (appSound.bind), so a bus made before or after the settings is right.
// Plus the bell (`chime`) synthesis and the harmonic branch hook (R13.9 low end, for #116).
// Nothing here runs at import time; the graph is made on first use for each context.
import {
  AMBIENCE_DUCK_ATTACK_S,
  AMBIENCE_DUCK_DB,
  AMBIENCE_DUCK_RELEASE_S,
  AMBIENCE_HIGHPASS_HZ,
  AMBIENCE_LEVEL_TAU_S,
  BUTTERWORTH_Q,
  CHIME_DECAY_S,
  CHIME_PARTIAL_GAIN,
  CHIME_PARTIAL_RATIO,
  DUCK_TAU_DIVISOR,
  HARMONIC_CURVE_POINTS,
  HARMONIC_IN_HIGH_HZ,
  HARMONIC_IN_LOW_HZ,
  HARMONIC_MIX_DB,
  HARMONIC_OUT_HIGH_HZ,
  HARMONIC_OUT_LOW_HZ,
  HARMONIC_PREGAIN_DB,
  HARMONIC_SHAPER_DRIVE,
  LIMITER_ATTACK_S,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  TONE_ATTACK_S,
} from './tuning';

export type BusName = 'events' | 'spectrum' | 'ambience';

interface Graph {
  readonly master: GainNode;
  readonly events: GainNode;
  readonly spectrum: GainNode;
  /** Where ambience sources connect. */
  readonly ambience: GainNode;
  readonly duck: GainNode;
  readonly level: GainNode;
  /** Every node above plus the limiter and the high-pass: the graph's own, never disconnected. */
  readonly shared: readonly AudioNode[];
  holds: number;
}

const graphs = new WeakMap<BaseAudioContext, Graph>();

/** dB → linear gain. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

let ambienceLevelSource: () => number = () => 0;

function ambienceLevel(): number {
  const v = ambienceLevelSource();
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0;
}

function graph(ctx: BaseAudioContext): Graph {
  const existing = graphs.get(ctx);
  if (existing) return existing;
  const master = ctx.createGain();
  const shared: AudioNode[] = [master];
  if (typeof ctx.createDynamicsCompressor === 'function') {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = LIMITER_THRESHOLD_DB;
    lim.knee.value = 0;
    lim.ratio.value = LIMITER_RATIO;
    lim.attack.value = LIMITER_ATTACK_S;
    lim.release.value = LIMITER_RELEASE_S;
    master.connect(lim);
    lim.connect(ctx.destination);
    shared.push(lim);
  } else {
    master.connect(ctx.destination);
  }
  const events = ctx.createGain();
  events.connect(master);
  const spectrum = ctx.createGain();
  spectrum.connect(master);
  const ambience = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = AMBIENCE_HIGHPASS_HZ;
  hpf.Q.value = BUTTERWORTH_Q;
  const duck = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = ambienceLevel();
  ambience.connect(hpf);
  hpf.connect(duck);
  duck.connect(level);
  level.connect(master);
  shared.push(events, spectrum, ambience, hpf, duck, level);
  const g: Graph = { master, events, spectrum, ambience, duck, level, shared, holds: 0 };
  graphs.set(ctx, g);
  return g;
}

/**
 * The master input of `ctx` (gain → limiter → destination). Prefer `getBus`: a module connected
 * here bypasses the bus split and the ducking.
 */
export function getMasterBus(ctx: BaseAudioContext): AudioNode {
  return graph(ctx).master;
}

/** The graph's own nodes of `ctx` (buses, limiter, ambience chain); tests check nothing else leaks. */
export function sharedNodes(ctx: BaseAudioContext): readonly AudioNode[] {
  return graph(ctx).shared;
}

/** The input of one bus of `ctx`; connect a module's own output (after its volume) to it. */
export function getBus(ctx: BaseAudioContext, name: BusName): AudioNode {
  return graph(ctx)[name];
}

/**
 * Register what the ambience level is (`soundOn && ambienceOn ? ambienceVolume × volume : 0`);
 * null resets it to 0. Events and spectrum keep their own per-producer volume, so the master
 * volume is never applied twice. Call `refreshAmbienceLevel` after a change.
 */
export function setAmbienceLevelSource(source: (() => number) | null): void {
  ambienceLevelSource = source ?? (() => 0);
}

/** Apply the registered ambience level to the graph of `ctx`, if it has one. */
export function refreshAmbienceLevel(ctx: BaseAudioContext | null): void {
  const g = ctx ? graphs.get(ctx) : undefined;
  if (!g || !ctx) return;
  const t = ctx.currentTime;
  g.level.gain.cancelScheduledValues(t);
  g.level.gain.setTargetAtTime(ambienceLevel(), t, AMBIENCE_LEVEL_TAU_S);
}

/** The ambience level the registered source gives now (tests, the sound-check page). */
export function ambienceLevelNow(): number {
  return ambienceLevel();
}

/** One producer's hold on the ambience duck. */
export interface DuckHold {
  /** Let go (idempotent). The last release brings the ambience back over the release time. */
  release(): void;
  /** Release by itself after `seconds` unless extended again (the safety timeout). */
  extend(seconds: number): void;
  readonly released: boolean;
}

/**
 * Duck the ambience while a data sound plays (R13.9, §11.5): reference-counted per context. The
 * first hold ramps the duck gain to AMBIENCE_DUCK_DB over the attack; the last release ramps it
 * back to 1 over the release. `safetyS` arms the safety timeout (see `extend`), so a producer
 * that misses an end path cannot leave the ambience ducked.
 */
export function holdDuck(ctx: BaseAudioContext, safetyS?: number): DuckHold {
  const g = graph(ctx);
  g.holds++;
  if (g.holds === 1) {
    const t = ctx.currentTime;
    g.duck.gain.cancelScheduledValues(t);
    g.duck.gain.setTargetAtTime(
      dbToGain(AMBIENCE_DUCK_DB),
      t,
      AMBIENCE_DUCK_ATTACK_S / DUCK_TAU_DIVISOR,
    );
  }
  let released = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hold: DuckHold = {
    get released() {
      return released;
    },
    release() {
      if (released) return;
      released = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      g.holds = Math.max(0, g.holds - 1);
      if (g.holds === 0) {
        const t = ctx.currentTime;
        g.duck.gain.cancelScheduledValues(t);
        g.duck.gain.setTargetAtTime(1, t, AMBIENCE_DUCK_RELEASE_S / DUCK_TAU_DIVISOR);
      }
    },
    extend(seconds) {
      if (released) return;
      if (timer !== null) clearTimeout(timer);
      const ms = Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000;
      timer = setTimeout(() => hold.release(), ms);
    },
  };
  if (safetyS !== undefined) hold.extend(safetyS);
  return hold;
}

/** Live holds on the duck of `ctx` (tests: 0 after every stop path). */
export function duckHolds(ctx: BaseAudioContext): number {
  return graphs.get(ctx)?.holds ?? 0;
}

/** The harmonic branch's shaper on its normalised input u in [−1, 1]: tanh(DRIVE·u). */
export function harmonicShape(u: number): number {
  const x = Math.max(-1, Math.min(1, u));
  return Math.tanh(HARMONIC_SHAPER_DRIVE * x);
}

/** The WaveShaper curve: HARMONIC_CURVE_POINTS samples of `harmonicShape`, deterministic. */
export function harmonicCurve(): Float32Array<ArrayBuffer> {
  const n = HARMONIC_CURVE_POINTS;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = harmonicShape((2 * i) / (n - 1) - 1);
  return curve;
}

/**
 * The branch from input sample to output sample without its filters and mix: pre-gain, shaper,
 * make-up. Pure; the harmonic test runs a sine through it.
 */
export function harmonicBranchSample(x: number): number {
  return harmonicShape(x * dbToGain(HARMONIC_PREGAIN_DB)) * dbToGain(-HARMONIC_PREGAIN_DB);
}

export interface HarmonicBranch {
  /** Connect a low bed (S1 rumble, S8 lava, S12 gas roar, thunder) here. */
  readonly input: AudioNode;
  /** Disconnect every node of the branch. */
  dispose(): void;
}

function pass(ctx: BaseAudioContext, type: BiquadFilterType, hz: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = BUTTERWORTH_Q;
  return f;
}

/**
 * R13.9 (§11.7) missing-fundamental branch into the ambience bus: 40–120 Hz (high-pass + low-pass)
 * → +18 dB → WaveShaper tanh(3x) → −18 dB → 200–600 Hz → −12 dB → ambience input. No caller in
 * #111; the ambience mixer (#116) connects the low beds. Null where WaveShaperNode is missing.
 */
export function createHarmonicBranch(ctx: BaseAudioContext): HarmonicBranch | null {
  if (typeof ctx.createWaveShaper !== 'function') return null;
  const inHp = pass(ctx, 'highpass', HARMONIC_IN_LOW_HZ);
  const inLp = pass(ctx, 'lowpass', HARMONIC_IN_HIGH_HZ);
  const pre = ctx.createGain();
  pre.gain.value = dbToGain(HARMONIC_PREGAIN_DB);
  const shaper = ctx.createWaveShaper();
  shaper.curve = harmonicCurve();
  shaper.oversample = '2x';
  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(-HARMONIC_PREGAIN_DB);
  const outHp = pass(ctx, 'highpass', HARMONIC_OUT_LOW_HZ);
  const outLp = pass(ctx, 'lowpass', HARMONIC_OUT_HIGH_HZ);
  const mix = ctx.createGain();
  mix.gain.value = dbToGain(HARMONIC_MIX_DB);
  const chain: AudioNode[] = [inHp, inLp, pre, shaper, makeup, outHp, outLp, mix];
  for (let i = 0; i + 1 < chain.length; i++) chain[i]!.connect(chain[i + 1]!);
  mix.connect(getBus(ctx, 'ambience'));
  return {
    input: inHp,
    dispose() {
      for (const n of chain) n.disconnect();
    },
  };
}

export interface BellOptions {
  freqHz: number;
  /** Start time on the context clock (s). */
  when: number;
  /** Peak gain. */
  gain: number;
  /** Default TONE_ATTACK_S. */
  attackS?: number;
  /** Default CHIME_DECAY_S. */
  decayS?: number;
  /** Second partial: frequency ratio and gain. Defaults CHIME_PARTIAL_RATIO, CHIME_PARTIAL_GAIN. */
  partialRatio?: number;
  partialGain?: number;
}

/** The nodes of one scheduled bell. Stop and disconnect them to cancel it; `end` is when it is silent. */
export interface ScheduledSound {
  readonly sources: AudioScheduledSourceNode[];
  readonly nodes: AudioNode[];
  readonly end: number;
}

/**
 * Schedule a bell into `dest`: two sine partials (f and ratio·f) under one envelope with a short
 * attack and an exponential decay. The sources are started and stopped here; the caller keeps the
 * returned nodes to cancel the bell or to disconnect them when it ends (`sources[0].onended`).
 */
export function playBell(ctx: BaseAudioContext, dest: AudioNode, o: BellOptions): ScheduledSound {
  const attack = o.attackS ?? TONE_ATTACK_S;
  const end = o.when + (o.decayS ?? CHIME_DECAY_S);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, o.when);
  env.gain.linearRampToValueAtTime(Math.max(o.gain, 0.0002), o.when + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);
  const o1 = ctx.createOscillator();
  o1.frequency.value = o.freqHz;
  o1.connect(env);
  const o2 = ctx.createOscillator();
  o2.frequency.value = o.freqHz * (o.partialRatio ?? CHIME_PARTIAL_RATIO);
  const g2 = ctx.createGain();
  g2.gain.value = o.partialGain ?? CHIME_PARTIAL_GAIN;
  o2.connect(g2);
  g2.connect(env);
  for (const s of [o1, o2]) {
    s.start(o.when);
    s.stop(end + 0.01);
  }
  return { sources: [o1, o2], nodes: [env, g2], end };
}
