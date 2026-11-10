// A8 data sweep ("Listen"), R8.6 item 3, R8.9. Plays the spectrum from short to long λ as one tone:
//   - pitch from λ and gain from the normalised flux, both from the shared `spectrumMapping`, so the
//     sweep and the spectrum touch haptics (#10) match: the same λ gives the same pitch, and a quiet
//     dip (< 20%) is silent here too;
//   - stereo pan from left to right as it goes;
//   - a bell chime at each comet gas feature (A4.3: H₂O 2.7 µm, CO₂ 4.25 µm, CO 4.67 µm), only for
//     the gases that have a Q in the selected epoch (no Q, no chime);
//   - the honesty filter (D-21): the tone carries the spectrum's tag and each chime its Q's tag, and
//     what the current state hides does not sound (a model_dependent Q is silent in Measured only).
// It uses the shared AudioContext (audioContext.ts) and the shared master bus with its limiter
// (audioGraph.ts), follows the settings volume live and the "sound" switch (off = no sweep),
// schedules everything on the audio clock (currentTime + lookahead), and disconnects every node of
// its own when it ends or is stopped. It does not go through the haptic engine: it is a sound, not
// a HapticEvent.
import type { CometEpoch, ObjectCard, Tag } from '@/contract';
import { isTagShown, type HonestyState } from '@/viewer/honesty';
import { gasQForEpoch } from '@/viewer/renderers/Comet';
import { getAudioContext } from '../audioContext';
import { getMasterBus, playBell } from '../audioGraph';
import { pitchToHz, wavelengthToPitch } from '../pitch';
import { getHapticSettings, stopWhenHidden, useHapticSettings } from '../settings';
import type { SpectrumMapping, SpectrumSample } from '../spectrumMapping';
import {
  AUDIO_LOOKAHEAD_S,
  SWEEP_CHIME_GAIN,
  SWEEP_DURATION_S,
  SWEEP_EDGE_S,
  SWEEP_MAX_STEPS,
  SWEEP_PAN,
  SWEEP_PEAK_GAIN,
  SWEEP_SAMPLES_PER_POINT,
  SWEEP_STEPS,
  SWEEP_WAVE,
} from '../tuning';

export type SweepGas = 'h2o' | 'co2' | 'co';

/** A4.3 comet gas features (µm): water 2.7, CO₂ 4.25, CO 4.67 (docs/architecture/pipeline.md). */
export const GAS_LINES_UM: Readonly<Record<SweepGas, number>> = { h2o: 2.7, co2: 4.25, co: 4.67 };

export interface GasLine {
  gas: SweepGas;
  lambdaUm: number;
  /** The tag of the Q that backs the chime (D-21: hidden tags do not chime). */
  tag: Tag;
}

/**
 * Gas lines to chime for a comet in `epoch`: only gases with a positive Q there (Comet.ts rule),
 * each carrying its Q's tag.
 */
export function gasLinesForEpoch(card: ObjectCard, epoch: CometEpoch): GasLine[] {
  if (card.type !== 'comet') return [];
  const q = gasQForEpoch(card, epoch);
  const out: GasLine[] = [];
  for (const gas of ['h2o', 'co2', 'co'] as const) {
    const tv = q?.[gas];
    const v = tv?.value;
    if (tv && typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out.push({ gas, lambdaUm: GAS_LINES_UM[gas], tag: tv.tag });
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
  tag: Tag;
}

export interface SweepPlan {
  durationS: number;
  /** The spectrum's tag (SpectrumResponse.tag, `measured`): the tone sounds only when it is shown. */
  tag: Tag;
  steps: SweepStep[];
  chimes: SweepChime[];
}

export interface PlanSweepOptions {
  /** Default SWEEP_DURATION_S. */
  durationS?: number;
  /** Default max(SWEEP_STEPS, SWEEP_SAMPLES_PER_POINT × points). */
  steps?: number;
  /** The spectrum's tag. Default `measured` (SpectrumResponse.tag). */
  tag?: Tag;
}

/**
 * The sweep as data (pure, testable): `steps + 1` points evenly spaced in λ over the mapping's
 * usable range, and the chimes that fall inside it. Null when the spectrum has nothing to play:
 * no usable point, or a single wavelength, which the spectrum pad cannot sweep either (R8.6 item 3).
 * By default there are SWEEP_SAMPLES_PER_POINT samples per spectrum point (at least SWEEP_STEPS),
 * so a dip one channel wide is quiet here as it is under the finger, up to SWEEP_MAX_STEPS (512
 * points; a SPHEREx spectrum has about 102), so one click cannot schedule millions of events.
 */
export function planSweep(
  mapping: SpectrumMapping,
  lines: readonly GasLine[] = [],
  options: PlanSweepOptions = {},
): SweepPlan | null {
  const durationS = options.durationS ?? SWEEP_DURATION_S;
  const steps = Math.min(
    SWEEP_MAX_STEPS,
    options.steps ?? Math.max(SWEEP_STEPS, SWEEP_SAMPLES_PER_POINT * mapping.count),
  );
  if (mapping.empty || mapping.count < 2 || !(durationS > 0) || steps < 1) return null;
  const lo = mapping.lambdaMinUm;
  const hi = mapping.lambdaMaxUm;
  const span = hi - lo;
  const out: SweepStep[] = [];
  const s = {} as SpectrumSample;
  for (let i = 0; i <= steps; i++) {
    const lambda = span > 0 ? lo + (span * i) / steps : lo;
    const got = mapping.sampleAt(lambda, s);
    // A non-finite strength (overflowing flux) is treated as quiet: never scheduled as NaN.
    const quiet = !got || got.quiet || !Number.isFinite(got.strength);
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
      tag: l.tag,
    });
  }
  return { durationS, tag: options.tag ?? 'measured', steps: out, chimes };
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
  // Lazy: the first read loads the stored settings, so the sweep never sees unloaded defaults.
  get: () => getHapticSettings(),
  subscribe: (fn) => useHapticSettings.subscribe(fn),
};

/** What the sweep reads from the page lifecycle: a hidden page stops it and blocks a start. */
export interface PageVisibility {
  isHidden(): boolean;
  /** Called when the page is hidden or unloaded; returns the unsubscribe function. */
  onHidden(fn: () => void): () => void;
}

export const DOCUMENT_PAGE: PageVisibility = {
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  onHidden: (fn) => stopWhenHidden({ stop: fn }),
};

export interface ListenSweepOptions {
  /** Default: the shared context, once unlocked. */
  context?: () => AudioContext | null;
  /** Default: the haptics settings store: its volume (followed live) and its sound switch. */
  settings?: SweepSettings;
  /** Default: `document.hidden`, `visibilitychange` and `pagehide`. A hidden page stops the sweep (R8.8). */
  page?: PageVisibility;
}

interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** The tag behind the sound (the spectrum's or the chime's Q): `setHonesty` silences hidden ones. */
  tag: Tag;
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
 * followed live through the sweep's own volume gain, which feeds the shared master bus and its
 * limiter (audioGraph.ts), so the sweep and the haptics audio cannot add up past it.
 */
export class ListenSweep {
  private readonly getContext: () => AudioContext | null;
  private readonly settings: SweepSettings;
  private readonly page: PageVisibility;
  private readonly live = new Set<Voice>();
  /** This sweep's volume gain into the master bus (freed when the last voice ends). */
  private volumeGain: GainNode | null = null;
  private unsubscribe: (() => void) | null = null;
  private unhook: (() => void) | null = null;
  private startAt = 0;
  private duration = 0;
  private active = false;
  private ctx: AudioContext | null = null;
  private run = 0;
  private honesty: HonestyState = 'derived';
  /** Called once when the sweep's last sound ends, or when it is stopped. */
  onEnd: (() => void) | null = null;

  constructor(options: ListenSweepOptions = {}) {
    this.getContext = options.context ?? getAudioContext;
    this.settings = options.settings ?? SETTINGS;
    this.page = options.page ?? DOCUMENT_PAGE;
  }

  get playing(): boolean {
    return this.active;
  }

  /** Voices still connected, the volume gain included (tests: nothing leaks after the end or `stop`). */
  get liveVoices(): number {
    return this.live.size + (this.volumeGain ? 1 : 0);
  }

  /** 0–1 through the sweep, or null when not playing. */
  progress(): number | null {
    if (!this.active || !this.ctx || !(this.duration > 0)) return null;
    return Math.min(1, Math.max(0, (this.ctx.currentTime - this.startAt) / this.duration));
  }

  /**
   * Schedule the sweep under the honesty state `honesty` (D-21): the tone plays only when the
   * spectrum's tag is shown, and each chime only when its Q's tag is. Returns false (and plays
   * nothing) when sound is switched off, there is no running AudioContext (call `engine.unlock()`
   * from the click first), the page is hidden, or the honesty state hides everything.
   */
  play(plan: SweepPlan, honesty: HonestyState): boolean {
    this.stop();
    if (this.page.isHidden()) return false;
    const st0 = this.settings.get();
    if (!st0.soundOn) return false;
    const toneShown = isTagShown(honesty, plan.tag);
    const chimes = plan.chimes.filter((c) => isTagShown(honesty, c.tag));
    if (!toneShown && chimes.length === 0) return false;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return false;
    const my = ++this.run;
    this.ctx = ctx;
    this.honesty = honesty;
    const base = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    const end = base + plan.durationS;
    const volume = ctx.createGain();
    volume.gain.value = clampVolume(st0.volume);
    volume.connect(getMasterBus(ctx));
    this.volumeGain = volume;

    // The sweep ends with its last sound (the tone or a chime still ringing after it), so the
    // settings subscription and `playing` last as long as anything is audible.
    const finish = () => {
      this.freeIfIdle();
      if (my === this.run && this.live.size === 0) this.ended();
    };

    if (toneShown) {
      const osc = ctx.createOscillator();
      osc.type = SWEEP_WAVE;
      const gain = ctx.createGain();
      osc.connect(gain);
      const voice: Voice = { sources: [osc], nodes: [gain], tag: plan.tag };
      let out: AudioNode = gain;
      if (typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.setValueAtTime(-SWEEP_PAN, base);
        pan.pan.linearRampToValueAtTime(SWEEP_PAN, end);
        gain.connect(pan);
        out = pan;
        voice.nodes.push(pan);
      }
      out.connect(volume);
      this.scheduleGain(gain.gain, osc.frequency, plan, base);
      osc.onended = () => {
        if (this.live.delete(voice)) release(voice, false);
        finish();
      };
      osc.start(base);
      osc.stop(end + SWEEP_EDGE_S + 0.05);
      this.live.add(voice);
    }

    for (const c of chimes) {
      // Panned where the sweep is when the chime rings.
      let dest: AudioNode = volume;
      const extra: AudioNode[] = [];
      if (typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = sweepPanAt(c.t, plan.durationS);
        p.connect(volume);
        dest = p;
        extra.push(p);
      }
      const bell = playBell(ctx, dest, { freqHz: c.hz, when: base + c.t, gain: SWEEP_CHIME_GAIN });
      const voice: Voice = {
        sources: [...bell.sources],
        nodes: [...bell.nodes, ...extra],
        tag: c.tag,
      };
      bell.sources[0]!.onended = () => {
        if (this.live.delete(voice)) release(voice, false);
        finish();
      };
      this.live.add(voice);
    }

    // Follow the volume live; "sound off" stops the sweep.
    this.unsubscribe = this.settings.subscribe((s) => {
      if (!s.soundOn) {
        this.stop();
        return;
      }
      this.volumeGain?.gain.setTargetAtTime(clampVolume(s.volume), ctx.currentTime, 0.02);
    });

    // A hidden page stops the sweep (R8.8 page lifecycle); the hook lives as long as the sweep.
    this.unhook = this.page.onHidden(() => this.stop());

    this.startAt = base;
    this.duration = plan.durationS;
    this.active = true;
    return true;
  }

  /**
   * D-21: the honesty state changed while the sweep plays. Every scheduled or ringing sound whose
   * tag is now hidden stops at once (as the engine stops a hidden train); when nothing is left, the
   * sweep ends. Sounds already silenced do not come back if the state widens again.
   */
  setHonesty(state: HonestyState): void {
    this.honesty = state;
    if (!this.active) return;
    for (const v of [...this.live]) {
      if (isTagShown(state, v.tag)) continue;
      this.live.delete(v);
      release(v, true);
    }
    this.freeIfIdle();
    if (this.live.size === 0) {
      this.run++;
      this.ended();
    }
  }

  /** The honesty state of the current (or last) sweep. */
  get honestyState(): HonestyState {
    return this.honesty;
  }

  /** Stop at once (sweep and chimes) and free every node of the sweep. */
  stop(): void {
    this.run++;
    for (const v of this.live) release(v, true);
    this.live.clear();
    this.freeIfIdle();
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

  /** Disconnect the volume gain once no voice uses it (the shared master bus stays). */
  private freeIfIdle(): void {
    if (this.live.size > 0 || !this.volumeGain) return;
    this.volumeGain.disconnect();
    this.volumeGain = null;
  }

  private ended(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unhook?.();
    this.unhook = null;
    if (!this.active) return;
    this.active = false;
    this.onEnd?.();
  }
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
