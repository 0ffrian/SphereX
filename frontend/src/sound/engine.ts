// R8.8 sound engine (was the haptic engine; haptics cut by D-39, audio only; D-10, D-20, D-21).
// The train re-send logic for a cancelled vibration pattern stays dormant (the audio driver never
// blocks a train, oneShotBlockMs 0); post-event clean-up. Sources call `emit` for one-shots and
// `startTrain` / `updateTrain` / `stopTrain` for pulse trains; the engine applies the honesty gate,
// the R8.3 rate cap and the strength multiplier, then fans every event out to all active drivers.
// Drivers never know about objects. Nothing here runs at import time.
import type {
  HapticChannel,
  HapticDriver,
  HapticEvent,
  HapticVoice,
  Tag,
  ToneId,
  ToneParams,
} from '@/contract';
import { DEFAULT_HONESTY, isTagShown, type HonestyState } from '@/viewer/honesty';
import { getUnlockState, unlockAudio } from './audioContext';
import { AudioDriver } from './voices';
import {
  MAX_EVENTS_PER_SECOND,
  MAX_GROUP_NOTES,
  MIN_TICK_INTERVAL_MS,
  STRENGTH_MULTIPLIER_MAX,
  STRENGTH_MULTIPLIER_MIN,
  TRAIN_LATE_TOLERANCE_MS,
  TRAIN_LEAD_MS,
  TRAIN_MAX_RATE_HZ,
  TRAIN_MIN_RATE_HZ,
  TRAIN_WINDOW_MS,
  TONE_UPDATE_MIN_MS,
} from './tuning';

export type {
  HapticKind,
  HapticEvent,
  HapticDriver,
  HapticVoice,
  HapticChannel,
  HapticProfile,
  TextureHaptic,
  DataHaptic,
  ToneId,
  ToneParams,
} from '@/contract';

/** D-20: the debug hook. A `CustomEvent<HapticEvent>` on `window` for every event that played. */
export const HAPTIC_DEBUG_EVENT = 'spherex:haptic';

/** Injected for tests; defaults to the global timers. */
export interface HapticTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What a source asks for when it starts or updates a pulse train (Q-71). */
export interface TrainParams {
  rateHz: number;
  strength: number;
  tag: Tag;
  pitch?: number;
  pan?: number;
  voice?: HapticVoice;
  /** Display hint for the pulse indicator (Q-85); drivers ignore it. */
  channel?: HapticChannel;
}

/**
 * One window of a pulse train, as the engine sends it to a train-capable driver. Pulse times are
 * explicit, so a driver never has to derive phase from `rateHz` (Q-71). The object and its array
 * are reused: a driver must not keep them after `playTrain` returns.
 */
export interface TrainWindow {
  readonly rateHz: number;
  /** Already multiplied by the strength multiplier and clamped to 0–1. */
  readonly strength: number;
  readonly tag: Tag;
  readonly pitch?: number;
  readonly pan?: number;
  readonly voice?: HapticVoice;
  readonly channel?: HapticChannel;
  /** Start of each pulse in ms from now, ascending, all below TRAIN_WINDOW_MS + TRAIN_LEAD_MS. */
  readonly pulseOffsetsMs: readonly number[];
  /**
   * The first `resentCount` pulses were sent before, in a window that a one-shot then cancelled
   * on the vibration motor. Drivers whose output a one-shot does not cancel (audio) skip them.
   */
  readonly resentCount: number;
  /** Engine-clock time (ms) the offsets count from, so a driver can keep one clock anchor per train. */
  readonly atMs: number;
  /** Changes for every new train (and every single-window `emit(pulseTrain)`). */
  readonly trainSeq: number;
}

/** A driver that plays train windows itself. Others get a `pulseTrain` HapticEvent per window. */
export interface TrainCapableDriver extends HapticDriver {
  playTrain(w: TrainWindow): void;
  /**
   * How long (ms) this driver's output for one-shot `e` blocks a train: `navigator.vibrate`
   * cancels the playing pattern, so the train resumes after it. 0 when one-shots do not interfere.
   */
  oneShotBlockMs(e: HapticEvent): number;
  /**
   * Cancel this driver's train output only (scheduled and playing train pulses). One-shots that
   * are playing or scheduled are left alone. Plain R8.8 drivers get `stop()` instead.
   */
  stopTrain(): void;
}

export function playsTrains(d: HapticDriver): d is TrainCapableDriver {
  return typeof (d as Partial<TrainCapableDriver>).playTrain === 'function';
}

/**
 * A tone as the engine sends it to a driver (R8.8 tone stream, Q-189): the full current state,
 * strength already multiplied by the strength multiplier and clamped to 0–1. The object is reused
 * per tone: a driver must not keep it after the call returns.
 */
export interface ToneOutput {
  readonly pitch: number;
  readonly strength: number;
  readonly tag: Tag;
  readonly pan?: number;
}

/**
 * A driver that plays sustained tones (R8.8, Q-189; audio only). `updateTone` for an id the driver
 * is not playing starts it (with the fade in): that is how a tone started before the unlock, or
 * while the sound was off, begins once output runs. `stop()` must also end every tone.
 */
export interface ToneCapableDriver extends HapticDriver {
  startTone(id: ToneId, t: ToneOutput): void;
  updateTone(id: ToneId, t: ToneOutput): void;
  /** Fade the tone out and release its nodes. A no-op for an id that is not playing. */
  stopTone(id: ToneId): void;
}

export function playsTones(d: HapticDriver): d is ToneCapableDriver {
  return typeof (d as Partial<ToneCapableDriver>).startTone === 'function';
}

export interface SoundEngineOptions {
  /** Milliseconds, monotonic. Default `performance.now`. */
  clock?: () => number;
  timers?: HapticTimers;
  /** D-21 honesty state. Default + Estimated (DEFAULT_HONESTY). */
  honesty?: HonestyState;
  /** R8.7 strength multiplier, 0.5–1.5. Default 1. */
  strengthMultiplier?: number;
  /** Where the D-20 debug event goes. Default `window` when it exists; `null` turns it off. */
  debugTarget?: EventTarget | null;
}

interface Train {
  readonly id: string;
  p: TrainParams;
  periodMs: number;
  /** Engine-clock time of the latest pulse sent to the drivers. */
  lastPulse: number | null;
  /** First pulse to send again after a one-shot cancelled the vibration pattern. */
  resendFrom: number | null;
  /** The last pulse that had already been sent when the one-shot cancelled the pattern. */
  resendTo: number;
  timer: unknown;
  /** Engine-clock time the pending timer fires. */
  wakeAt: number;
  readonly seq: number;
}

interface Tone {
  readonly id: ToneId;
  /** The caller's current params (a private copy, changed in place). */
  readonly p: ToneParams;
  /** Reused per send. */
  readonly out: { pitch: number; strength: number; tag: Tag; pan?: number };
  /** Engine-clock time of the last send to the drivers. */
  lastSent: number;
  /** A flush timer for coalesced updates, or null. */
  timer: unknown;
}

/** updateTrain moves a pending timer only when its fire time changes by more than this (ms). */
const RESCHEDULE_SLACK_MS = 5;

const ONE_SECOND_MS = 1000;
const MAX_PULSES_PER_WINDOW = Math.ceil(
  ((TRAIN_WINDOW_MS + TRAIN_LEAD_MS) * TRAIN_MAX_RATE_HZ) / ONE_SECOND_MS,
);

function clampRate(rateHz: number): number | null {
  if (!Number.isFinite(rateHz) || rateHz <= 0) return null;
  return Math.min(TRAIN_MAX_RATE_HZ, Math.max(TRAIN_MIN_RATE_HZ, rateHz));
}

function clampMultiplier(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.min(STRENGTH_MULTIPLIER_MAX, Math.max(STRENGTH_MULTIPLIER_MIN, m));
}

function defaultTimers(): HapticTimers {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
  };
}

/** Mutable view of a TrainWindow, so one object is reused for every window. */
interface WindowBuffer {
  rateHz: number;
  strength: number;
  tag: Tag;
  pitch?: number;
  pan?: number;
  voice?: HapticVoice;
  channel?: HapticChannel;
  pulseOffsetsMs: number[];
  resentCount: number;
  atMs: number;
  trainSeq: number;
}

export class SoundEngine {
  private drivers: HapticDriver[];
  private readonly disabled = new Set<HapticDriver>();
  private active: HapticDriver[] = [];
  private readonly clock: () => number;
  private readonly timers: HapticTimers;
  private readonly debugTarget: EventTarget | null;
  private honestyState: HonestyState;
  private multiplier: number;

  // R8.3 rate cap: ring buffer of the admitted events' times (oldest at `head`).
  private readonly stamps = new Float64Array(MAX_EVENTS_PER_SECOND);
  private stampCount = 0;
  private stampHead = 0;
  private lastTickLike = -Infinity;

  private train: Train | null = null;
  private readonly tones = new Map<ToneId, Tone>();
  /** A one-shot is playing on a driver that cancels trains until this time. */
  private oneShotUntil = -Infinity;

  // Reused per event and per window: no allocation before the rate cap.
  private readonly scratch: HapticEvent = { kind: 'tick', strength: 0, tag: 'measured' };
  private readonly win: WindowBuffer = {
    rateHz: 0,
    strength: 0,
    tag: 'measured',
    pulseOffsetsMs: [],
    resentCount: 0,
    atMs: 0,
    trainSeq: 0,
  };
  private trainSeq = 0;

  constructor(drivers: HapticDriver[], options: SoundEngineOptions = {}) {
    this.drivers = [...drivers];
    this.clock = options.clock ?? (() => performance.now());
    this.timers = options.timers ?? defaultTimers();
    this.honestyState = options.honesty ?? DEFAULT_HONESTY;
    this.multiplier = clampMultiplier(options.strengthMultiplier ?? 1);
    this.debugTarget =
      options.debugTarget !== undefined
        ? options.debugTarget
        : typeof window !== 'undefined'
          ? window
          : null;
    this.refreshActive();
  }

  // ------------------------------------------------------------ settings

  get honesty(): HonestyState {
    return this.honestyState;
  }

  /** D-21. A running train or tone whose tag the new state hides stops at once. */
  setHonesty(state: HonestyState): void {
    this.honestyState = state;
    if (this.train && !isTagShown(state, this.train.p.tag)) this.stopTrain();
    for (const t of [...this.tones.values()]) {
      if (!isTagShown(state, t.p.tag)) this.stopTone(t.id);
    }
  }

  get strengthMultiplier(): number {
    return this.multiplier;
  }

  /** R8.7: applied here, so both drivers get it: strength' = min(1, strength × multiplier). */
  setStrengthMultiplier(m: number): void {
    this.multiplier = clampMultiplier(m);
  }

  /** Replace the driver list. Drivers that leave are stopped. */
  setDrivers(drivers: HapticDriver[]): void {
    for (const d of this.drivers) if (!drivers.includes(d)) d.stop();
    this.drivers = [...drivers];
    for (const d of [...this.disabled]) if (!this.drivers.includes(d)) this.disabled.delete(d);
    this.refreshActive();
  }

  /** The sound switch (R8.7). A disabled driver is stopped and gets no events. */
  setDriverEnabled(driver: HapticDriver, enabled: boolean): void {
    if (enabled) this.disabled.delete(driver);
    else if (!this.disabled.has(driver)) {
      this.disabled.add(driver);
      driver.stop();
    }
    this.refreshActive();
  }

  isDriverEnabled(driver: HapticDriver): boolean {
    return this.drivers.includes(driver) && !this.disabled.has(driver);
  }

  /** Drivers that currently receive events (enabled; `supported` is checked per event). */
  get activeDrivers(): readonly HapticDriver[] {
    return this.active;
  }

  get activeTrainId(): string | null {
    return this.train?.id ?? null;
  }

  /**
   * Create or resume the shared AudioContext (R8.9). Call it synchronously from a `click` handler:
   * that click is also the user activation `navigator.vibrate` needs. Resolves to whether audio runs.
   */
  unlock(): Promise<boolean> {
    return unlockAudio();
  }

  /**
   * Whether a click has unlocked output (shared by the Sound popover and the panels). Subscribe with
   * `subscribeUnlockState` (audioContext.ts) to follow changes.
   */
  get unlocked(): boolean {
    return getUnlockState().unlocked;
  }

  // ------------------------------------------------------------ one-shots

  /**
   * Play one event. Returns whether it played (false: hidden by the honesty state, a strength that
   * is not a finite number, or dropped by the rate cap; dropped events are never queued). `stop`
   * is exempt from all of these.
   * `pulseTrain` here plays a single 250 ms window from its `rateHz` (R8.8); sources should use
   * `startTrain` instead, which keeps the phase across windows (Q-71).
   */
  emit(e: HapticEvent): boolean {
    if (e.kind === 'stop') {
      this.stop();
      this.dispatchDebug(e);
      return true;
    }
    if (!Number.isFinite(e.strength) || !isTagShown(this.honestyState, e.tag)) return false;
    const now = this.clock();
    if (e.kind === 'pulseTrain') return this.emitSingleWindow(e, now);

    if (now - this.lastTickLike < MIN_TICK_INTERVAL_MS) return false;
    if (!this.admit(now)) return false;
    this.lastTickLike = now;

    const ev = this.prepare(e);
    let blockMs = 0;
    for (const d of this.active) {
      if (!d.supported) continue;
      d.emit(ev);
      if (playsTrains(d)) blockMs = Math.max(blockMs, d.oneShotBlockMs(ev));
    }
    if (blockMs > 0) this.interruptTrain(now, now + blockMs);
    this.dispatchDebug(ev);
    return true;
  }

  /**
   * Play the notes of one moment as ONE event (Q-458): an exposure tick sounds one note per frame at
   * the same time (R8.9.2, two on Eros). The group passes the 25 ms tick gap and the 40 events/s cap
   * once, as a single tick would; each note keeps its own honesty gate (a hidden note is silent, the
   * others play). Returns the number of notes that played (0 when the group was refused or dropped).
   * Every note must be a `tick`, `double` or `heartbeat` with a finite strength; at most
   * MAX_GROUP_NOTES notes. Dropped groups are never queued.
   */
  emitTogether(notes: readonly HapticEvent[]): number {
    const n = notes.length;
    if (n === 0 || n > MAX_GROUP_NOTES) return 0;
    let shown = 0;
    for (const e of notes) {
      if (e.kind === 'stop' || e.kind === 'pulseTrain' || !Number.isFinite(e.strength)) return 0;
      if (isTagShown(this.honestyState, e.tag)) shown++;
    }
    if (shown === 0) return 0;
    const now = this.clock();
    if (now - this.lastTickLike < MIN_TICK_INTERVAL_MS) return 0;
    if (!this.admit(now)) return 0;
    this.lastTickLike = now;
    let blockMs = 0;
    for (const e of notes) {
      if (!isTagShown(this.honestyState, e.tag)) continue;
      const ev = this.prepare(e);
      for (const d of this.active) {
        if (!d.supported) continue;
        d.emit(ev);
        if (playsTrains(d)) blockMs = Math.max(blockMs, d.oneShotBlockMs(ev));
      }
      this.dispatchDebug(ev);
    }
    if (blockMs > 0) this.interruptTrain(now, now + blockMs);
    return shown;
  }

  /** Stop everything: the train, every tone, every driver's pattern and every scheduled sound. */
  stop(): void {
    this.cancelTrain();
    this.cancelTones();
    for (const d of this.drivers) d.stop();
  }

  // ------------------------------------------------------------ tone stream (R8.8, Q-189)

  /**
   * Start, or replace, the sustained tone `id` (R8.8). It fades in over TONE_FADE_IN_S. Returns
   * false (and plays nothing; a tone already playing under `id` stops) when the honesty state hides
   * `tag` or `strength` is not a finite number. A locked or suspended AudioContext, or the sound
   * switch off, is not an error: the tone is kept and begins at the first `updateTone` after
   * output runs.
   */
  startTone(id: ToneId, params: ToneParams): boolean {
    if (!Number.isFinite(params.strength) || !isTagShown(this.honestyState, params.tag)) {
      this.stopTone(id);
      return false;
    }
    const prev = this.tones.get(id);
    if (prev && prev.timer !== null) this.timers.clearTimeout(prev.timer);
    const tone: Tone = {
      id,
      p: { ...params },
      out: { pitch: 0, strength: 0, tag: params.tag },
      lastSent: this.clock(),
      timer: null,
    };
    this.tones.set(id, tone);
    this.fillOut(tone);
    for (const d of this.active) {
      if (d.supported && playsTones(d)) d.startTone(id, tone.out);
    }
    return true;
  }

  /**
   * Change the playing tone `id`: pitch, gain and pan glide (TONE_GLIDE_S). Call it as often as the
   * pointer or the replay moves; sends are coalesced to one per TONE_UPDATE_MIN_MS (about one per
   * frame; the last change always lands) and never count against the 40 events/s cap. A tag the
   * honesty state hides stops the tone; a strength that is not finite is refused and the tone plays
   * on unchanged. Returns false in those cases and when `id` is not playing (after `stop()`, a
   * hidden page or a honesty change: call `startTone` again).
   */
  updateTone(id: ToneId, changes: Partial<ToneParams>): boolean {
    const t = this.tones.get(id);
    if (!t) return false;
    const strength = changes.strength ?? t.p.strength;
    if (!Number.isFinite(strength)) return false;
    const tag = changes.tag ?? t.p.tag;
    if (!isTagShown(this.honestyState, tag)) {
      this.stopTone(id);
      return false;
    }
    const p = t.p;
    p.strength = strength;
    p.tag = tag;
    if (changes.pitch !== undefined) p.pitch = changes.pitch;
    if ('pan' in changes) p.pan = changes.pan;
    if ('voice' in changes) p.voice = changes.voice;
    if ('channel' in changes) p.channel = changes.channel;
    const now = this.clock();
    if (now - t.lastSent >= TONE_UPDATE_MIN_MS) {
      if (t.timer !== null) {
        this.timers.clearTimeout(t.timer);
        t.timer = null;
      }
      this.sendTone(t, now);
    } else if (t.timer === null) {
      t.timer = this.timers.setTimeout(() => {
        t.timer = null;
        if (this.tones.get(id) === t) this.sendTone(t, this.clock());
      }, t.lastSent + TONE_UPDATE_MIN_MS - now);
    }
    return true;
  }

  /** Fade the tone `id` out (TONE_FADE_OUT_S) and release it. A no-op when it is not playing. */
  stopTone(id: ToneId): void {
    const t = this.tones.get(id);
    if (!t) return;
    if (t.timer !== null) this.timers.clearTimeout(t.timer);
    t.timer = null;
    this.tones.delete(id);
    for (const d of this.drivers) if (playsTones(d)) d.stopTone(id);
  }

  /** Whether the tone `id` is held by the engine (it may still wait for output to run). */
  hasTone(id: ToneId): boolean {
    return this.tones.has(id);
  }

  // ------------------------------------------------------------ trains (Q-71)

  /**
   * Start a phase-continuous pulse train. Only one train plays at a time: a new id replaces the
   * old one; the same id updates it. Returns false (and plays nothing) when the honesty state
   * hides `tag`, the rate is not a positive number or the strength is not a finite number.
   */
  startTrain(id: string, params: TrainParams): boolean {
    if (this.train?.id === id) return this.updateTrain(id, params);
    const rate = clampRate(params.rateHz);
    if (rate === null || !Number.isFinite(params.strength)) return false;
    if (!isTagShown(this.honestyState, params.tag)) return false;
    this.stopTrain();
    this.train = {
      id,
      p: { ...params },
      periodMs: ONE_SECOND_MS / rate,
      lastPulse: null,
      resendFrom: null,
      resendTo: -Infinity,
      timer: null,
      wakeAt: -Infinity,
      seq: ++this.trainSeq,
    };
    this.issueWindow(this.train);
    return true;
  }

  /**
   * Change a running train. The change applies from the next window (≤ 250 ms). A tag the honesty
   * state hides, or a rate that is not a positive number, stops the train. A strength that is not
   * finite is refused and the train plays on unchanged. Returns false in those cases and when `id`
   * is not the running train.
   */
  updateTrain(id: string, changes: Partial<TrainParams>): boolean {
    const t = this.train;
    if (!t || t.id !== id) return false;
    // Called on nearly every pointer move: validate, then change in place (no allocation).
    const strength = changes.strength ?? t.p.strength;
    if (!Number.isFinite(strength)) return false;
    const rateHz = changes.rateHz ?? t.p.rateHz;
    const tag = changes.tag ?? t.p.tag;
    const rate = clampRate(rateHz);
    if (rate === null || !isTagShown(this.honestyState, tag)) {
      this.stopTrain();
      return false;
    }
    const p = t.p;
    p.strength = strength;
    p.rateHz = rateHz;
    p.tag = tag;
    if ('pitch' in changes) p.pitch = changes.pitch;
    if ('pan' in changes) p.pan = changes.pan;
    if ('voice' in changes) p.voice = changes.voice;
    if ('channel' in changes) p.channel = changes.channel;
    const period = ONE_SECOND_MS / rate;
    if (period !== t.periodMs) {
      t.periodMs = period;
      if (t.resendFrom === null && t.lastPulse !== null) {
        const at = Math.max(this.clock(), t.lastPulse + period - this.lead(t));
        if (t.timer === null || Math.abs(at - t.wakeAt) > RESCHEDULE_SLACK_MS) this.schedule(t, at);
      }
    }
    return true;
  }

  /**
   * Stop the running train (only if it is `id`, when given) and cancel its output. One-shots that
   * are playing are left alone on train-capable drivers; a plain R8.8 driver gets `stop()`.
   */
  stopTrain(id?: string): void {
    if (!this.train || (id !== undefined && this.train.id !== id)) return;
    this.cancelTrain();
    this.stopTrainOutput();
  }

  /** Stop timers. Call when the engine is dropped. */
  dispose(): void {
    this.stop();
  }

  // ------------------------------------------------------------ internals

  private fillOut(t: Tone): void {
    const o = t.out;
    o.pitch = t.p.pitch;
    o.strength = this.scale(t.p.strength);
    o.tag = t.p.tag;
    o.pan = t.p.pan;
  }

  private sendTone(t: Tone, now: number): void {
    this.fillOut(t);
    t.lastSent = now;
    for (const d of this.active) {
      if (d.supported && playsTones(d)) d.updateTone(t.id, t.out);
    }
  }

  private cancelTones(): void {
    for (const t of this.tones.values()) {
      if (t.timer !== null) this.timers.clearTimeout(t.timer);
      t.timer = null;
    }
    this.tones.clear();
  }

  private stopTrainOutput(): void {
    for (const d of this.active) {
      if (playsTrains(d)) d.stopTrain();
      else d.stop();
    }
  }

  private refreshActive(): void {
    this.active = this.drivers.filter((d) => !this.disabled.has(d));
  }

  /** Sliding 1 s window over all kinds but `stop` (R8.3). Records the event when admitted. */
  private admit(now: number): boolean {
    const n = MAX_EVENTS_PER_SECOND;
    if (this.stampCount < n) {
      this.stamps[(this.stampHead + this.stampCount) % n] = now;
      this.stampCount++;
      return true;
    }
    if (now - this.stamps[this.stampHead]! < ONE_SECOND_MS) return false;
    this.stamps[this.stampHead] = now;
    this.stampHead = (this.stampHead + 1) % n;
    return true;
  }

  /** Non-finite strengths are refused before this. */
  private scale(strength: number): number {
    const s = strength * this.multiplier;
    return s <= 0 ? 0 : Math.min(1, s);
  }

  private prepare(e: HapticEvent): HapticEvent {
    const s = this.scratch;
    s.kind = e.kind;
    s.strength = this.scale(e.strength);
    s.rateHz = e.rateHz;
    s.tag = e.tag;
    s.pitch = e.pitch;
    s.pan = e.pan;
    s.sharpness = e.sharpness;
    s.voice = e.voice;
    s.channel = e.channel;
    return s;
  }

  private dispatchDebug(e: HapticEvent): void {
    const target = this.debugTarget;
    if (!target || typeof CustomEvent !== 'function') return;
    target.dispatchEvent(new CustomEvent<HapticEvent>(HAPTIC_DEBUG_EVENT, { detail: { ...e } }));
  }

  private lead(t: Train): number {
    return Math.min(TRAIN_LEAD_MS, t.periodMs / 2);
  }

  private schedule(t: Train, at: number): void {
    if (t.timer !== null) this.timers.clearTimeout(t.timer);
    const now = this.clock();
    const delay = Math.max(0, at - now);
    t.wakeAt = now + delay;
    t.timer = this.timers.setTimeout(() => {
      t.timer = null;
      if (this.train === t) this.issueWindow(t);
    }, delay);
  }

  private cancelTrain(): void {
    const t = this.train;
    if (!t) return;
    if (t.timer !== null) this.timers.clearTimeout(t.timer);
    t.timer = null;
    this.train = null;
  }

  /**
   * The first pulse on the train's grid from grid time `g`. Of the pulses already due, only the
   * latest is kept, and only if it is at most TRAIN_LATE_TOLERANCE_MS late (it then plays at once).
   * The grid itself never moves, so a late timer does not shift the phase.
   */
  private gridFrom(g: number, periodMs: number, now: number): number {
    if (g >= now) return g;
    const due = g + Math.floor((now - g) / periodMs) * periodMs;
    return due < now - TRAIN_LATE_TOLERANCE_MS ? due + periodMs : due;
  }

  /** Send the pulses of [now, now + 250 ms) and schedule the next window from the train's phase. */
  private issueWindow(t: Train): void {
    const now = this.clock();
    if (now < this.oneShotUntil) {
      this.schedule(t, this.oneShotUntil);
      return;
    }
    // Grid time of the window's first pulse (if slightly past, it plays now).
    let p: number;
    let resendTo = -Infinity;
    if (t.resendFrom !== null) {
      p = this.gridFrom(t.resendFrom, t.periodMs, now);
      resendTo = t.resendTo;
      t.resendFrom = null;
    } else {
      p = t.lastPulse === null ? now : this.gridFrom(t.lastPulse + t.periodMs, t.periodMs, now);
    }
    const end = now + TRAIN_WINDOW_MS;
    if (p >= end) {
      this.schedule(t, p - this.lead(t));
      return;
    }

    const w = this.win;
    w.pulseOffsetsMs.length = 0;
    w.resentCount = 0;
    let last = p;
    while (p < end && w.pulseOffsetsMs.length < MAX_PULSES_PER_WINDOW) {
      w.pulseOffsetsMs.push(Math.max(0, p - now));
      if (p <= resendTo) w.resentCount++;
      last = p;
      p += t.periodMs;
    }
    t.lastPulse = Math.max(t.lastPulse ?? -Infinity, last);
    // Pulses after the re-sent ones are new to every driver.
    const fresh = w.resentCount < w.pulseOffsetsMs.length;
    // A window counts as one event (R8.3), unless it only repeats pulses already counted.
    // A capped window is dropped; the phase goes on.
    if (!fresh || this.admit(now)) {
      w.rateHz = ONE_SECOND_MS / t.periodMs;
      w.strength = this.scale(t.p.strength);
      w.tag = t.p.tag;
      w.pitch = t.p.pitch;
      w.pan = t.p.pan;
      w.voice = t.p.voice;
      w.channel = t.p.channel;
      w.atMs = now;
      w.trainSeq = t.seq;
      for (const d of this.active) {
        if (!d.supported) continue;
        if (playsTrains(d)) d.playTrain(w);
        else if (fresh) d.emit(this.trainEvent(w));
      }
      if (fresh) this.dispatchDebug(this.trainEvent(w));
    }
    this.schedule(t, t.lastPulse + t.periodMs - this.lead(t));
  }

  private trainEvent(w: TrainWindow): HapticEvent {
    const s = this.scratch;
    s.kind = 'pulseTrain';
    s.strength = w.strength;
    s.rateHz = w.rateHz;
    s.tag = w.tag;
    s.pitch = w.pitch;
    s.pan = w.pan;
    s.sharpness = undefined;
    s.voice = w.voice;
    s.channel = w.channel;
    return s;
  }

  /**
   * A one-shot just cancelled the vibration pattern of the running train (navigator.vibrate
   * replaces the pattern). Pulses already sent after `until` are sent again once it ends; the
   * train then carries on from its phase.
   */
  private interruptTrain(now: number, until: number): void {
    this.oneShotUntil = Math.max(this.oneShotUntil, until);
    const t = this.train;
    if (!t) return;
    if (t.lastPulse !== null && t.lastPulse >= now) {
      const k = Math.floor((t.lastPulse - this.oneShotUntil) / t.periodMs);
      if (k >= 0) {
        const from = t.lastPulse - k * t.periodMs;
        t.resendFrom = t.resendFrom === null ? from : Math.max(t.resendFrom, from);
        t.resendTo = t.lastPulse;
      } else {
        t.resendFrom = null;
      }
    }
    this.schedule(t, this.oneShotUntil);
  }

  /** R8.8's `emit(pulseTrain)`: one window from offset 0, no phase kept. Replaces any train. */
  private emitSingleWindow(e: HapticEvent, now: number): boolean {
    const rate = clampRate(e.rateHz ?? NaN);
    if (rate === null) return false;
    if (!this.admit(now)) return false;
    if (this.train) {
      this.cancelTrain();
      this.stopTrainOutput();
    }
    const w = this.win;
    w.pulseOffsetsMs.length = 0;
    w.resentCount = 0;
    const period = ONE_SECOND_MS / rate;
    for (
      let p = 0;
      p < TRAIN_WINDOW_MS && w.pulseOffsetsMs.length < MAX_PULSES_PER_WINDOW;
      p += period
    ) {
      w.pulseOffsetsMs.push(p);
    }
    w.rateHz = rate;
    w.strength = this.scale(e.strength);
    w.tag = e.tag;
    w.pitch = e.pitch;
    w.pan = e.pan;
    w.voice = e.voice;
    w.channel = e.channel;
    w.atMs = now;
    w.trainSeq = ++this.trainSeq;
    const ev = this.trainEvent(w);
    for (const d of this.active) {
      if (!d.supported) continue;
      if (playsTrains(d)) d.playTrain(w);
      else d.emit(ev);
    }
    this.dispatchDebug(ev);
    return true;
  }
}

/** The engine with the audio driver: all the event app has (Q-132, R8.8.1 item 1). */
export interface SoundOutputs {
  readonly engine: SoundEngine;
  readonly audio: AudioDriver;
}

/**
 * Build the engine with its AudioDriver (Q-132, D-39: sound only; R8.8.1 item 1; R11 Sound). Creates
 * no AudioContext (that waits for `engine.unlock()` in a click). Wire the settings with `bindEngine`
 * (settings.ts).
 */
export function createSoundEngine(options: SoundEngineOptions = {}): SoundOutputs {
  const audio = new AudioDriver();
  const engine = new SoundEngine([audio], options);
  return { engine, audio };
}

/**
 * Keep the engine's honesty state in step with the app's honesty toggle (D-21): applies it now and
 * on every change. `get` reads the toggle (for example the app store's honesty state) and
 * `subscribe` calls back on change (a Zustand store's `subscribe` fits). Returns the unsubscribe.
 * Anything with `setHonesty` can be bound the same way, e.g. the Listen sweep (`ListenSweep`), so a
 * sound whose tag the new state hides stops at once.
 */
export function bindHonesty(
  engine: Pick<SoundEngine, 'setHonesty'>,
  get: () => HonestyState,
  subscribe: (listener: () => void) => () => void,
): () => void {
  engine.setHonesty(get());
  return subscribe(() => engine.setHonesty(get()));
}
