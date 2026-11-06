// R8.4, R8.5, R8.8: what every texture and data source shares (issue #11).
//   - `TouchSample`: one pointer sample, already turned into a body hit by `probe.ts`. One object
//     is reused for every pointermove. The sources and the probe allocate nothing of their own per
//     sample; the viewer helpers they call (FieldSampler.sampleUV, directionToUV, zonalWind,
//     BodyRenderer.worldToBody) still return small objects.
//   - `HapticSource`: a source reads samples (or a scrub index) and emits through the engine. It
//     owns no timers: one-shots go to `emit`, pulse trains to `startTrain` / `updateTrain` /
//     `stopTrain` (Q-59), so the engine keeps their phase, the rate cap and the honesty gate.
//   - `TrainSlot`: one source's train, started or updated only when something changed.
import type { HapticEvent, HapticVoice, Tag } from '@/contract';
import type { HapticEngine, TrainParams } from '../haptics';

/** The engine calls a source needs. `HapticEngine` satisfies it; tests may pass a fake. */
export type HapticSink = Pick<
  HapticEngine,
  'emit' | 'startTrain' | 'updateTrain' | 'stopTrain' | 'activeTrainId'
>;

export type Vec3 = [number, number, number];

/** One pointer sample in Touch mode, filled in place by `TouchProbe` (probe.ts). */
export interface TouchSample {
  /** Engine-clock time of the sample (ms). */
  timeMs: number;
  /** Pointer position in CSS px (spacing rules and holding still are in px). */
  xPx: number;
  yPx: number;
  /** −1 (left) to 1 (right), from the finger's x (R8.8 `pan`). */
  pan: number;
  /** Id of the body the ray meets first (`body`, `body_a`, `nucleus`, …), or null when it misses. */
  bodyId: string | null;
  /**
   * Unit direction of the hit on the body's unit sphere, in the body frame (an ellipsoid hit is
   * divided by its axes first, as the texture is wrapped). Valid only when `bodyId` is set.
   */
  dir: Vec3;
  /** Equirectangular texture coordinates of `dir` (R6.1, `directionToUV`). */
  u: number;
  v: number;
  /** Surface normal at the hit, body frame. A mesh raycast fills it; analytic bodies give theirs. */
  normal: Vec3;
  /** The pointer ray in the probe frame: origin and unit direction. */
  rayOrigin: Vec3;
  rayDir: Vec3;
  /** Distance from the frame's origin to the ray: the projected distance from the centre. */
  centreDistance: number;
  /** Radius where the ray crosses the ring plane (y = 0) in front of any body hit; NaN otherwise. */
  ringRadius: number;
}

export function createTouchSample(): TouchSample {
  return {
    timeMs: 0,
    xPx: 0,
    yPx: 0,
    pan: 0,
    bodyId: null,
    dir: [0, 0, 1],
    u: 0,
    v: 0,
    normal: [0, 0, 1],
    rayOrigin: [0, 0, 0],
    rayDir: [0, 0, -1],
    centreDistance: Infinity,
    ringRadius: NaN,
  };
}

/** How a source is driven (R8.5). */
export type SourceTrigger =
  /** Every pointer sample (texture sources, the comet and point-density fields). */
  | 'move'
  /** A steady pulse once the finger has been still for HOLD_STILL_MS ("holding still"). */
  | 'hold'
  /** The light-curve scrubber, not the finger on the body. */
  | 'scrub';

export interface HapticSource {
  /** The `HapticProfile` value it implements (`terrain`, `teq_pulse`, …). */
  readonly id: string;
  readonly channel: 'texture' | 'data';
  readonly trigger: SourceTrigger;
  /** The tag every event of this source carries (R8.2: texture_tag, data_tag, or teq_K's tag). */
  readonly tag: Tag;
  /** A pointer sample while the finger moves ('move'; 'hold' sources may track the body). */
  move(s: TouchSample): void;
  /** 'hold' sources: the finger has been still long enough on `s`. */
  hold?(s: TouchSample): void;
  /** 'scrub' sources: the scrubber moved to light-curve step `index`. */
  scrub?(index: number): void;
  /** Finger up, finger left the canvas, scrub ended or the source is dropped: stop and reset. */
  release(): void;
}

/** A one-shot event. One reused object per source, so emitting does not allocate. */
export class OneShot {
  private readonly e: HapticEvent = { kind: 'tick', strength: 0, tag: 'artistic' };

  constructor(
    private readonly engine: HapticSink,
    tag: Tag,
  ) {
    this.e.tag = tag;
  }

  play(
    kind: 'tick' | 'double' | 'heartbeat',
    strength: number,
    pan: number,
    voice?: HapticVoice,
    pitch?: number,
  ): boolean {
    const e = this.e;
    e.kind = kind;
    e.strength = strength;
    e.pan = pan;
    e.voice = voice;
    e.pitch = pitch;
    return this.engine.emit(e);
  }
}

/** Relative change of rate, strength or pitch below which a running train is not updated. Engineering. */
const TRAIN_UPDATE_EPSILON = 0.02;
/** Change of pan (−1..1) below which a running train is not updated. Engineering. */
const TRAIN_PAN_EPSILON = 0.05;

/**
 * One source's pulse train. `play` starts it (or takes it back after another train replaced it)
 * and updates it only when the rate, strength, pitch (2%) or pan (0.05) moved, so a pointermove
 * does not re-send the same train. The params object is reused; the engine copies it.
 */
export class TrainSlot {
  private readonly p: TrainParams;
  private running = false;

  constructor(
    private readonly engine: HapticSink,
    readonly id: string,
    tag: Tag,
    voice?: HapticVoice,
  ) {
    this.p = { rateHz: 1, strength: 0, tag, voice };
  }

  play(rateHz: number, strength: number, pan: number, pitch?: number): void {
    const p = this.p;
    const mine = this.running && this.engine.activeTrainId === this.id;
    if (
      mine &&
      Math.abs(rateHz - p.rateHz) <= TRAIN_UPDATE_EPSILON * p.rateHz &&
      Math.abs(strength - p.strength) <= TRAIN_UPDATE_EPSILON &&
      Math.abs((pitch ?? 0) - (p.pitch ?? 0)) <= TRAIN_UPDATE_EPSILON &&
      Math.abs(pan - (p.pan ?? 0)) <= TRAIN_PAN_EPSILON
    ) {
      return;
    }
    p.rateHz = rateHz;
    p.strength = strength;
    p.pan = pan;
    p.pitch = pitch;
    this.running = mine ? this.engine.updateTrain(this.id, p) : this.engine.startTrain(this.id, p);
  }

  /**
   * Stop the train if it is this slot's (the engine ignores another source's id). Always asked,
   * so a train the engine still runs after a refused update cannot leak.
   */
  stop(): void {
    this.engine.stopTrain(this.id);
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running && this.engine.activeTrainId === this.id;
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
