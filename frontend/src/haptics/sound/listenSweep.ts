// A8 data sweep ("Listen"), R8.6 item 3, R8.9. Plays the spectrum from short to long λ as one tone:
//   - pitch from λ and gain from the normalised flux, both from the shared `spectrumMapping`, so the
//     sweep and the spectrum touch haptics (#10) match: the same λ gives the same pitch, and a quiet
//     dip (< 20%) is silent here too;
//   - stereo pan from left to right as it goes;
//   - a bell chime at each comet gas feature (A4.3: H₂O 2.7 µm, CO₂ 4.25 µm, CO 4.67 µm), only for
//     the gases that have a Q in the selected epoch (no Q, no chime).
// It uses the shared AudioContext (audioContext.ts) and the settings volume, schedules everything on
// the audio clock (currentTime + lookahead), and disconnects every node when it ends or is stopped.
// It does not go through the haptic engine: it is a sound, not a HapticEvent.
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
  SWEEP_CHIME_GAIN,
  SWEEP_DURATION_S,
  SWEEP_PAN,
  SWEEP_PEAK_GAIN,
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
 */
export function planSweep(
  mapping: SpectrumMapping,
  lines: readonly GasLine[] = [],
  durationS: number = SWEEP_DURATION_S,
  steps: number = SWEEP_STEPS,
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

export interface ListenSweepOptions {
  /** Default: the shared context, once unlocked. */
  context?: () => AudioContext | null;
  /** 0–1. Default: the haptics settings volume (R8.7). */
  volume?: () => number;
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

/** Plays a `SweepPlan`. One sweep at a time; `play` stops the previous one. */
export class ListenSweep {
  private readonly getContext: () => AudioContext | null;
  private readonly volume: () => number;
  private readonly live = new Set<Voice>();
  private startAt = 0;
  private duration = 0;
  private active = false;
  private ctx: AudioContext | null = null;
  private run = 0;
  /** Called once when the sweep tone ends on its own or is stopped. */
  onEnd: (() => void) | null = null;

  constructor(options: ListenSweepOptions = {}) {
    this.getContext = options.context ?? getAudioContext;
    this.volume = options.volume ?? (() => useHapticSettings.getState().volume);
  }

  get playing(): boolean {
    return this.active;
  }

  /** Nodes still connected (tests: nothing leaks after the end or `stop`). */
  get liveVoices(): number {
    return this.live.size;
  }

  /** 0–1 through the sweep, or null when not playing. */
  progress(): number | null {
    if (!this.active || !this.ctx || !(this.duration > 0)) return null;
    return Math.min(1, Math.max(0, (this.ctx.currentTime - this.startAt) / this.duration));
  }

  /**
   * Schedule the sweep. Returns false (and plays nothing) without a running AudioContext: call
   * `engine.unlock()` from the click first.
   */
  play(plan: SweepPlan): boolean {
    this.stop();
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return false;
    const vol = Math.min(1, Math.max(0, this.volume()));
    const my = ++this.run;
    this.ctx = ctx;
    const base = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    const end = base + plan.durationS;

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
    out.connect(ctx.destination);

    const g = gain.gain;
    g.setValueAtTime(0, base);
    let prevQuiet = true;
    plan.steps.forEach((st, i) => {
      const at = base + st.t;
      const level = st.level * SWEEP_PEAK_GAIN * vol;
      if (i === 0) osc.frequency.setValueAtTime(st.hz, at);
      else osc.frequency.linearRampToValueAtTime(st.hz, at);
      // Quiet steps are silent: jump to 0 and back rather than ramping across the dip.
      if (st.quiet) g.setValueAtTime(0, at);
      else if (prevQuiet) g.setValueAtTime(level, at);
      else g.linearRampToValueAtTime(level, at);
      prevQuiet = st.quiet;
    });
    g.linearRampToValueAtTime(0, end + 0.05);
    osc.onended = () => {
      if (this.live.delete(voice)) release(voice, false);
      if (my === this.run) this.ended();
    };
    osc.start(base);
    osc.stop(end + 0.1);
    this.live.add(voice);

    for (const c of plan.chimes) this.bell(ctx, base + c.t, c.hz, SWEEP_CHIME_GAIN * vol);

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
    this.ended();
  }

  private bell(ctx: AudioContext, when: number, hz: number, peak: number): void {
    if (!(peak > 0)) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + TONE_ATTACK_S);
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
    env.connect(ctx.destination);
    const voice: Voice = { sources: [o1, o2], nodes: [env, g2] };
    // The bell may ring past the sweep's end; it frees itself when it stops.
    o1.onended = () => {
      if (this.live.delete(voice)) release(voice, false);
    };
    for (const o of voice.sources) {
      o.start(when);
      o.stop(when + CHIME_DECAY_S + 0.05);
    }
    this.live.add(voice);
  }

  private ended(): void {
    if (!this.active) return;
    this.active = false;
    this.onEnd?.();
  }
}
