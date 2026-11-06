// A8 data sweep ("Listen"), R8.6 item 3, R8.9. Plays the spectrum from short to long λ as one tone:
//   - pitch from λ and gain from the normalised flux, both from the shared `spectrumMapping`, so the
//     sweep and the spectrum touch haptics (#10) match: the same λ gives the same pitch, and a quiet
//     dip (< 20%) is silent here too;
//   - stereo pan from left to right as it goes;
//   - a bell chime at each comet gas feature (A4.3: H₂O 2.7 µm, CO₂ 4.25 µm, CO 4.67 µm), only for
//     the gases that have a Q in the selected epoch (no Q, no chime).
// It uses the shared AudioContext (audioContext.ts), follows the settings volume live and the
// "sound" switch (off = no sweep), limits its own output like the audio driver, schedules everything
// on the audio clock (currentTime + lookahead), and disconnects every node when it ends or is
// stopped. It does not go through the haptic engine: it is a sound, not a HapticEvent.
import type { CometEpoch, ObjectCard } from '@/contract';
import { gasQForEpoch } from '@/viewer/renderers/Comet';
import { getAudioContext } from '../audioContext';
import { pitchToHz, wavelengthToPitch } from '../pitch';
import { useHapticSettings } from '../settings';
import type { SpectrumMapping, SpectrumSample } from '../spectrumMapping';
import {
  AUDIO_LOOKAHEAD_S,
  CHIME_DECAY_S,
  CHIME_PARTIAL_GAIN,
  CHIME_PARTIAL_RATIO,
  LIMITER_ATTACK_S,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  SWEEP_CHIME_GAIN,
  SWEEP_DURATION_S,
  SWEEP_EDGE_S,
  SWEEP_PAN,
  SWEEP_PEAK_GAIN,
  SWEEP_SAMPLES_PER_POINT,
  SWEEP_STEPS,
  SWEEP_WAVE,
  TONE_ATTACK_S,
} from '../tuning';

export type SweepGas = 'h2o' | 'co2' | 'co';

/** A4.3 comet gas features (µm): water 2.7, CO₂ 4.25, CO 4.67 (docs/architecture/pipeline.md). */
export const GAS_LINES_UM: Readonly<Record<SweepGas, number>> = { h2o: 2.7, co2: 4.25, co: 4.67 };

export interface GasLine {
  gas: SweepGas;
  lambdaUm: number;
}

/** Gas lines to chime for a comet in `epoch`: only gases with a positive Q there (Comet.ts rule). */
export function gasLinesForEpoch(card: ObjectCard, epoch: CometEpoch): GasLine[] {
  if (card.type !== 'comet') return [];
  const q = gasQForEpoch(card, epoch);
  const out: GasLine[] = [];
  for (const gas of ['h2o', 'co2', 'co'] as const) {
    const v = q?.[gas]?.value;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out.push({ gas, lambdaUm: GAS_LINES_UM[gas] });
    }
  }
  return out;
}

export interface SweepStep {
  /** Seconds from the start of the sweep. */
  t: number;
  lambdaUm: number;
  hz: number;
  /** Normalised flux 0–1 (0 when quiet: silent). */
  level: number;
  quiet: boolean;
}

export interface SweepChime {
  t: number;
  gas: SweepGas;
  lambdaUm: number;
  hz: number;
}

export interface SweepPlan {
  durationS: number;
  steps: SweepStep[];
  chimes: SweepChime[];
}

/**
 * The sweep as data (pure, testable): `steps + 1` points evenly spaced in λ over the mapping's
 * usable range, and the chimes that fall inside it. Null when the spectrum has nothing to play.
 * By default there are SWEEP_SAMPLES_PER_POINT samples per spectrum point (at least SWEEP_STEPS),
 * so a dip one channel wide is quiet here as it is under the finger (R8.6 item 3).
 */
export function planSweep(
  mapping: SpectrumMapping,
  lines: readonly GasLine[] = [],
  durationS: number = SWEEP_DURATION_S,
  steps: number = Math.max(SWEEP_STEPS, SWEEP_SAMPLES_PER_POINT * mapping.count),
): SweepPlan | null {
  if (mapping.empty || !(durationS > 0) || steps < 1) return null;
  const lo = mapping.lambdaMinUm;
  const hi = mapping.lambdaMaxUm;
  const span = hi - lo;
  const out: SweepStep[] = [];
  const s = {} as SpectrumSample;
  for (let i = 0; i <= steps; i++) {
    const lambda = span > 0 ? lo + (span * i) / steps : lo;
    const got = mapping.sampleAt(lambda, s);
    const quiet = !got || got.quiet;
    out.push({
      t: (durationS * i) / steps,
      lambdaUm: lambda,
      hz: pitchToHz(got ? got.pitch : wavelengthToPitch(lambda)),
      level: quiet ? 0 : got.strength,
      quiet,
    });
  }
  const chimes: SweepChime[] = [];
  for (const l of lines) {
    if (!(l.lambdaUm >= lo && l.lambdaUm <= hi)) continue;
    chimes.push({
      t: span > 0 ? (durationS * (l.lambdaUm - lo)) / span : 0,
      gas: l.gas,
      lambdaUm: l.lambdaUm,
      hz: pitchToHz(wavelengthToPitch(l.lambdaUm)),
    });
  }
  return { durationS, steps: out, chimes };
}

/** Pan at `t` seconds into a sweep of `durationS`: left to right (−SWEEP_PAN → SWEEP_PAN). */
export function sweepPanAt(t: number, durationS: number): number {
  const f = durationS > 0 ? Math.min(1, Math.max(0, t / durationS)) : 0;
  return -SWEEP_PAN + 2 * SWEEP_PAN * f;
}

/** What the sweep reads from the haptics settings (R8.7). */
export interface SweepSettings {
  get(): { volume: number; soundOn: boolean };
  /** Called on every settings change; returns the unsubscribe function. */
  subscribe(fn: (s: { volume: number; soundOn: boolean }) => void): () => void;
}

const SETTINGS: SweepSettings = {
  get: () => useHapticSettings.getState(),
  subscribe: (fn) => useHapticSettings.subscribe(fn),
};

export interface ListenSweepOptions {
  /** Default: the shared context, once unlocked. */
  context?: () => AudioContext | null;
  /** Default: the haptics settings store: its volume (followed live) and its sound switch. */
  settings?: SweepSettings;
}

interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

function release(v: Voice, cancel: boolean): void {
  for (const s of v.sources) {
    if (cancel) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
    }
    s.disconnect();
  }
  for (const n of v.nodes) n.disconnect();
}

/**
 * Plays a `SweepPlan`. One sweep at a time; `play` stops the previous one. "Sound off" in the
 * settings means off: `play` refuses, and switching sound off mid-sweep stops it. The volume is
 * followed live through the sweep's own master gain, which feeds a limiter like the audio
 * driver's, so the tone and overlapping chimes do not clip.
 */
export class ListenSweep {
  private readonly getContext: () => AudioContext | null;
  private readonly settings: SweepSettings;
  private readonly live = new Set<Voice>();
  /** Master gain and limiter of the current sweep (freed when the last voice ends). */
  private bus: Voice | null = null;
  private unsubscribe: (() => void) | null = null;
  private startAt = 0;
  private duration = 0;
  private active = false;
  private ctx: AudioContext | null = null;
  private run = 0;
  /** Called once when the sweep tone ends on its own or is stopped. */
  onEnd: (() => void) | null = null;

  constructor(options: ListenSweepOptions = {}) {
    this.getContext = options.context ?? getAudioContext;
    this.settings = options.settings ?? SETTINGS;
  }

  get playing(): boolean {
    return this.active;
  }

  /** Voices still connected, the bus included (tests: nothing leaks after the end or `stop`). */
  get liveVoices(): number {
    return this.live.size + (this.bus ? 1 : 0);
  }

  /** 0–1 through the sweep, or null when not playing. */
  progress(): number | null {
    if (!this.active || !this.ctx || !(this.duration > 0)) return null;
    return Math.min(1, Math.max(0, (this.ctx.currentTime - this.startAt) / this.duration));
  }

  /**
   * Schedule the sweep. Returns false (and plays nothing) when sound is switched off or there is
   * no running AudioContext: call `engine.unlock()` from the click first.
   */
  play(plan: SweepPlan): boolean {
    this.stop();
    const st0 = this.settings.get();
    if (!st0.soundOn) return false;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return false;
    const my = ++this.run;
    this.ctx = ctx;
    const base = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    const end = base + plan.durationS;
    const master = this.makeBus(ctx, st0.volume);

    const osc = ctx.createOscillator();
    osc.type = SWEEP_WAVE;
    const gain = ctx.createGain();
    osc.connect(gain);
    const voice: Voice = { sources: [osc], nodes: [gain] };
    let out: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(-SWEEP_PAN, base);
      pan.pan.linearRampToValueAtTime(SWEEP_PAN, end);
      gain.connect(pan);
      out = pan;
      voice.nodes.push(pan);
    }
    out.connect(master);
    this.scheduleGain(gain.gain, osc.frequency, plan, base);
    osc.onended = () => {
      if (this.live.delete(voice)) release(voice, false);
      this.freeBusIfIdle();
      if (my === this.run) this.ended();
    };
    osc.start(base);
    osc.stop(end + SWEEP_EDGE_S + 0.05);
    this.live.add(voice);

    for (const c of plan.chimes) {
      this.bell(ctx, master, base + c.t, c.hz, sweepPanAt(c.t, plan.durationS));
    }

    // Follow the volume live; "sound off" stops the sweep.
    this.unsubscribe = this.settings.subscribe((s) => {
      if (!s.soundOn) {
        this.stop();
        return;
      }
      const g = this.bus?.nodes[0] as GainNode | undefined;
      g?.gain.setTargetAtTime(clampVolume(s.volume), ctx.currentTime, 0.02);
    });

    this.startAt = base;
    this.duration = plan.durationS;
    this.active = true;
    return true;
  }

  /** Stop at once (sweep and chimes) and free every node. */
  stop(): void {
    this.run++;
    for (const v of this.live) release(v, true);
    this.live.clear();
    this.freeBusIfIdle();
    this.ended();
  }

  /**
   * Gain per step with short ramps (SWEEP_EDGE_S) at the start, the end and every quiet edge, so
   * nothing clicks; a quiet step is at 0 (silent) at its own time, as the finger's quiet step is.
   */
  private scheduleGain(g: AudioParam, freq: AudioParam, plan: SweepPlan, base: number): void {
    g.setValueAtTime(0, base);
    let prevAt = base;
    let prevLevel = 0;
    let prevQuiet = true;
    plan.steps.forEach((st, i) => {
      const level = st.quiet ? 0 : st.level * SWEEP_PEAK_GAIN;
      if (i === 0) {
        freq.setValueAtTime(st.hz, base);
        g.linearRampToValueAtTime(level, base + SWEEP_EDGE_S);
        prevAt = base + SWEEP_EDGE_S;
      } else {
        const at = Math.max(base + st.t, prevAt + 1e-4);
        freq.linearRampToValueAtTime(st.hz, at);
        // Into or out of a quiet run: hold, then a short edge ramp.
        if (st.quiet !== prevQuiet && at - SWEEP_EDGE_S > prevAt) {
          g.setValueAtTime(prevLevel, at - SWEEP_EDGE_S);
        }
        g.linearRampToValueAtTime(level, at);
        prevAt = at;
      }
      prevLevel = level;
      prevQuiet = st.quiet;
    });
    g.linearRampToValueAtTime(0, prevAt + SWEEP_EDGE_S);
  }

  /** Master gain (volume) → limiter → destination, for this sweep. */
  private makeBus(ctx: AudioContext, volume: number): GainNode {
    const master = ctx.createGain();
    master.gain.value = clampVolume(volume);
    const bus: Voice = { sources: [], nodes: [master] };
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = LIMITER_THRESHOLD_DB;
      lim.knee.value = 0;
      lim.ratio.value = LIMITER_RATIO;
      lim.attack.value = LIMITER_ATTACK_S;
      lim.release.value = LIMITER_RELEASE_S;
      master.connect(lim);
      lim.connect(ctx.destination);
      bus.nodes.push(lim);
    } else {
      master.connect(ctx.destination);
    }
    this.bus = bus;
    return master;
  }

  private freeBusIfIdle(): void {
    if (this.live.size > 0 || !this.bus) return;
    release(this.bus, false);
    this.bus = null;
  }

  private bell(ctx: AudioContext, master: AudioNode, when: number, hz: number, pan: number): void {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(SWEEP_CHIME_GAIN, when + TONE_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(0.0001, when + CHIME_DECAY_S);
    const o1 = ctx.createOscillator();
    o1.frequency.value = hz;
    o1.connect(env);
    const o2 = ctx.createOscillator();
    o2.frequency.value = hz * CHIME_PARTIAL_RATIO;
    const g2 = ctx.createGain();
    g2.gain.value = CHIME_PARTIAL_GAIN;
    o2.connect(g2);
    g2.connect(env);
    const voice: Voice = { sources: [o1, o2], nodes: [env, g2] };
    // Panned where the sweep is when the chime rings.
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      p.connect(master);
      voice.nodes.push(p);
    } else {
      env.connect(master);
    }
    // The bell may ring past the sweep's end; it frees itself when it stops.
    o1.onended = () => {
      if (this.live.delete(voice)) release(voice, false);
      this.freeBusIfIdle();
    };
    for (const o of voice.sources) {
      o.start(when);
      o.stop(when + CHIME_DECAY_S + 0.05);
    }
    this.live.add(voice);
  }

  private ended(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.active) return;
    this.active = false;
    this.onEnd?.();
  }
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
