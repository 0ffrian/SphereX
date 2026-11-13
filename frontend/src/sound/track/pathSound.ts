// #78: Track's path sound "Hear the Shift" (R8.9.2, Q-134, Q-194, Q-458), driven by the Eros card's
// exposure stepping (the Eros card is the event's Track-lite). Two parts:
//   - pure mapping: which frames make one exposure, the drawn x as pan, the tick notes, the path voice;
//   - PathSoundController: start (in the click, unlocks audio) / scrub (every hop or play change) / stop.
// The reference click and its mute are not built here (see Q-459): the card steps exposure to
// exposure and has no continuous observation-time axis to mark hours on.
import type { HapticEvent, Tag, ToneParams } from '@/contract';
import type { AppSound } from '@/sound/appSound';
import { wavelengthToPitch } from '@/sound/pitch';
import {
  EXPOSURE_MATCH_S,
  PATH_VOICE_PITCH,
  PATH_VOICE_STRENGTH,
  TRACK_TICK_STRENGTH,
} from '@/sound/tuning';

/** What the path sound reads from one frame of the card (a subset of `ErosHop`). */
export interface PathFrame {
  mjd_avg: number;
  wl_um: number;
  /** Object position in the cutout, in cutout pixels. */
  x?: number;
  y?: number;
  nx?: number;
  ny?: number;
  /** Pixel vectors of north and east in the cutout. */
  north?: readonly [number, number] | readonly number[];
  east?: readonly [number, number] | readonly number[];
}

/** R8.9.2: "A SPHEREx cutout is `measured`, so the ticks are heard in Measured only." */
export const FRAME_TAG: Tag = 'measured';
/** R8.9.2: "The path comes from JPL Horizons and is `model_dependent`." */
export const PATH_TAG: Tag = 'model_dependent';

const MATCH_DAYS = EXPOSURE_MATCH_S / 86400;

/** True when two frame midpoints belong to one exposure. */
export function sameExposure(a: number, b: number): boolean {
  return Math.abs(a - b) <= MATCH_DAYS;
}

/** The frames of `frames` taken at `hop`'s exposure (its midpoint), in list order. */
export function exposureFrames<F extends PathFrame>(frames: readonly F[], hop: PathFrame): F[] {
  return frames.filter((f) => sameExposure(f.mjd_avg, hop.mjd_avg));
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * R8.9.2, Q-194 item 5: pan = the object's x in the card's cutout (the detail view), −1 at the left
 * edge and +1 at the right. Uses the cutout's north-up, east-left drawing (`erosDraw.drawCutout`), so
 * the pan follows what is drawn. Null when the frame lacks the geometry (no pan is guessed).
 */
export function drawnPan(f: Partial<PathFrame>): number | null {
  const { x, y, nx, ny, north, east } = f;
  if (!fin(x) || !fin(y) || !fin(nx) || !fin(ny) || !north || !east) return null;
  const [e0, e1] = east;
  const [n0, n1] = north;
  if (!fin(e0) || !fin(e1) || !fin(n0) || !fin(n1)) return null;
  const det = e0 * n1 - n0 * e1;
  if (!(Math.abs(det) > 1e-12)) return null;
  // Screen x offset from the centre = s · (M00·dx + M01·dy), M = −inverse([e n]); half width = s·(N+2)/2.
  const m00 = -n1 / det;
  const m01 = n0 / det;
  const dx = x - (nx - 1) / 2;
  const dy = y - (ny - 1) / 2;
  const pan = (2 * (m00 * dx + m01 * dy)) / (Math.max(nx, ny) + 2);
  if (!fin(pan)) return null;
  return pan < -1 ? -1 : pan > 1 ? 1 : pan;
}

/**
 * R8.9.2 exposure tick (Q-194 items 3 and 4): one note per frame of the exposure, each pitched by its
 * own wavelength (Q-70, Q-430), tagged as its frame, voice `tone`, channel `data`. A frame with no
 * finite wavelength gives no note (refused, not guessed). Send the result with `emitTogether`.
 */
export function exposureTickNotes(frames: readonly PathFrame[]): HapticEvent[] {
  const notes: HapticEvent[] = [];
  for (const f of frames) {
    if (!fin(f.wl_um) || f.wl_um <= 0) continue;
    const pan = drawnPan(f);
    notes.push({
      kind: 'tick',
      strength: TRACK_TICK_STRENGTH,
      tag: FRAME_TAG,
      pitch: wavelengthToPitch(f.wl_um),
      ...(pan === null ? {} : { pan }),
      voice: 'tone',
      channel: 'data',
    });
  }
  return notes;
}

/** R8.9.2 path voice (Q-194 item 1): fixed pitch and strength, pan from the drawn x, Estimated. */
export function pathVoiceParams(f: PathFrame): ToneParams {
  const pan = drawnPan(f);
  return {
    pitch: PATH_VOICE_PITCH,
    strength: PATH_VOICE_STRENGTH,
    tag: PATH_TAG,
    ...(pan === null ? {} : { pan }),
    voice: 'tone',
    channel: 'data',
  };
}

/** What the controller needs from the app's sound (a subset of `AppSound`, so tests can fake it). */
export type PathSoundOutput = Pick<
  AppSound,
  'unlock' | 'startTone' | 'updateTone' | 'stopTone' | 'hasTone' | 'emitTogether'
>;

/** The card's replay state at one moment. */
export interface PathScrub {
  /** The frame on show, or null when there is none (no list). */
  hop: PathFrame | null;
  /** The frames the card steps through (the detector filter applied). */
  frames: readonly PathFrame[];
  /** The player is running (R8.9.2: the path voice sounds "while the replay runs"). */
  playing: boolean;
}

/**
 * Start / scrub / stop for the path sound. Off until `start()`, which must be called inside the
 * click (it unlocks audio, Q-73). After the unlock resolves, every `scrub` that reaches a new
 * exposure sounds its tick, and while `playing` the path voice follows the drawn x. `stop()` (and a
 * scrub with no hop) releases the path tone; the tone holds the ambience duck, so callers must stop
 * on unmount.
 */
export class PathSoundController {
  private on = false;
  private ready = false;
  private gen = 0;
  private lastExposure: number | null = null;
  private latest: PathScrub | null = null;
  /** This controller started the `path` tone and has not released it (so it never stops another owner's). */
  private ownsTone = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly sound: PathSoundOutput) {}

  get active(): boolean {
    return this.on;
  }

  /** Whether the path sound is on (for `useSyncExternalStore`). */
  readonly getActive = (): boolean => this.on;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Call synchronously from the click. Resolves to whether audio is running, or null when a later
   * `stop()` (or `start()`) cancelled this start before its unlock resolved.
   */
  start(): Promise<boolean | null> {
    if (this.on) return Promise.resolve(true);
    this.on = true;
    this.ready = false;
    this.lastExposure = null;
    const g = ++this.gen;
    this.notify();
    return this.sound.unlock().then(
      (running) => {
        if (g !== this.gen || !this.on) return null;
        // The tick and voice wait for the unlock: a tick sent to a locked context is silent but
        // still takes the 25 ms gap (R8.3), which would swallow the first audible one.
        this.ready = true;
        this.apply();
        return running;
      },
      () => (g !== this.gen || !this.on ? null : false),
    );
  }

  /** Feed the card's state; call on every hop, list, play or honesty change. */
  scrub(state: PathScrub): void {
    this.latest = state;
    // The list went away (no hop): the sound turns off; a new list needs a new click.
    if (!state.hop) {
      if (this.on) this.stop();
      return;
    }
    if (this.on && this.ready) this.apply();
  }

  stop(): void {
    const was = this.on;
    this.on = false;
    this.ready = false;
    this.gen++;
    this.lastExposure = null;
    this.releaseTone();
    if (was) this.notify();
  }

  private releaseTone(): void {
    if (!this.ownsTone) return;
    this.ownsTone = false;
    this.sound.stopTone('path');
  }

  private apply(): void {
    const s = this.latest;
    if (!s || !s.hop) {
      this.lastExposure = null;
      this.releaseTone();
      return;
    }
    const hop = s.hop;
    if (this.lastExposure === null || !sameExposure(this.lastExposure, hop.mjd_avg)) {
      this.lastExposure = hop.mjd_avg;
      const notes = exposureTickNotes(exposureFrames(s.frames, hop));
      if (notes.length > 0) this.sound.emitTogether(notes);
    }
    if (!s.playing) {
      this.releaseTone();
      return;
    }
    const params = pathVoiceParams(hop);
    // updateTone is false after stop(), a hidden page or a honesty change: start the tone again.
    if (this.ownsTone && this.sound.hasTone('path') && this.sound.updateTone('path', params)) return;
    this.ownsTone = this.sound.startTone('path', params);
  }
}
