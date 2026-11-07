// R8.6 spectrum haptics: dragging along a spectrum maps x to λ and plays a tick every 8 px of
// travel. Strength, quiet and pitch come from the shared spectrum mapping (spectrumMapping.ts, the
// same one the Listen sweep uses, so touch and sound match); quiet steps (absorption dips below
// 20% of the peak) emit nothing in either channel. After a noisy point (σ/flux > 0.3) the spacing
// to the next tick jitters by ±30% from a seeded hash (R8.3 roughness), so the same seed and the
// same gesture give the same ticks. Pan follows the finger's x. The tag comes from the spectrum
// response (`measured`). Arrow keys step one tick at a time and emit the same events.
//
// No timers, no allocation per pointermove (the event, sample and step objects are reused), and
// nothing runs at import time. Only the engine's `emit` is used, so its honesty gate and rate cap
// (≥ 25 ms between ticks, 40/s) apply; dropped ticks are never queued.
import type { HapticEvent, Tag } from '@/contract';
import type { SpectrumResponse } from '@/app/api/types';
import { linearScale, type LinearScale } from '@/app/spectrum/scale';
import { clamp01 } from '../pitch';
import {
  buildSpectrumMapping,
  type SpectrumMapping,
  type SpectrumMappingPoint,
  type SpectrumSample,
} from '../spectrumMapping';
import { JITTER_FRACTION, SPECTRUM_DEFAULT_SEED, SPECTRUM_TICK_PX } from '../tuning';

/** Anything with the engine's `emit` (the HapticEngine; a recorder in tests). */
export interface SpectrumSink {
  emit(e: HapticEvent): boolean;
}

/** One 8 px step along the spectrum. The source reuses this object: copy what you keep. */
export interface SpectrumStep {
  /** Screen x of the step (px, same space as the scale's domain). */
  x: number;
  lambdaUm: number;
  /** False when the step falls outside the spectrum's λ range (nothing to feel there). */
  inRange: boolean;
  strength: number;
  quiet: boolean;
  noisy: boolean;
  /** A tick was sent to the engine for this step. */
  emitted: boolean;
  /** The engine played it (false: hidden by the honesty state, or dropped by the rate cap). */
  played: boolean;
  /** Steps since the gesture began, from 0. */
  index: number;
}

export interface SpectrumSourceOptions {
  points: readonly SpectrumMappingPoint[];
  /** The spectrum response's tag (`measured`, R8.6 item 4). */
  tag: SpectrumResponse['tag'] | Tag;
  /** Screen px → λ (µm): `linearScale([x0, x1], [λ0, λ1])` from app/spectrum/scale.ts. */
  xToLambda: LinearScale;
  /** Seed of the ±30% jitter (R8.3). Default SPECTRUM_DEFAULT_SEED. */
  seed?: number;
  /** Called for every step, played or quiet (tests, readouts). */
  onStep?: (step: Readonly<SpectrumStep>) => void;
}

/**
 * px → λ over `[x0, x1]` for a mapping's λ range (or a given one), via app/spectrum/scale.ts. Use
 * the drawn plot's λ domain when the pad sits over a chart, so x lines up with what is drawn.
 */
export function spectrumXToLambda(
  x0: number,
  x1: number,
  lambdaDomain: readonly [number, number],
): LinearScale {
  return linearScale([x0, x1], lambdaDomain);
}

/**
 * Uniform 0–1 from (seed, k): a 32-bit integer hash, so a step's jitter depends only on its index.
 * A seed above 32 bits mixes its high part in, so seeds 1 and 2**32 + 1 differ; a 32-bit seed
 * hashes as before.
 */
export function jitterUnit(seed: number, k: number): number {
  const lo = seed | 0;
  const hi = Math.trunc((seed - lo) / 4294967296) | 0;
  const s = lo ^ Math.imul(hi, 0x27d4eb2f);
  let h = (Math.imul(s, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export class SpectrumHapticSource {
  readonly mapping: SpectrumMapping;
  private readonly sink: SpectrumSink;
  private readonly tag: Tag;
  private readonly seed: number;
  private readonly onStep: ((s: Readonly<SpectrumStep>) => void) | undefined;
  private scale: LinearScale;

  /** Last pointer x of the gesture, or null when no drag is active. */
  private lastX: number | null = null;
  /** Keyboard / last step position (px, and λ for when the scale changes), kept across gestures. */
  private cursor: number | null = null;
  private cursorLambda = 0;
  private cursorScale: LinearScale | null = null;
  /** Travel since the last step (px) and the travel the next step needs. */
  private travelled = 0;
  private gap = SPECTRUM_TICK_PX;
  private stepIndex = 0;

  // Reused per step: no allocation in the pointermove path.
  private readonly sample: SpectrumSample = {
    wavelengthUm: 0,
    strength: 0,
    quiet: true,
    noisy: false,
    pitch: 0,
  };
  // R8.2, Q-85: a spectrum tick is a data haptic; the pulse indicator labels it "Data".
  private readonly event: HapticEvent = {
    kind: 'tick',
    strength: 0,
    tag: 'measured',
    channel: 'data',
  };
  private readonly step: SpectrumStep = {
    x: 0,
    lambdaUm: 0,
    inRange: false,
    strength: 0,
    quiet: true,
    noisy: false,
    emitted: false,
    played: false,
    index: 0,
  };
  private hasStep = false;

  constructor(sink: SpectrumSink, options: SpectrumSourceOptions) {
    this.sink = sink;
    this.mapping = buildSpectrumMapping(options.points);
    this.tag = options.tag;
    this.seed = options.seed ?? SPECTRUM_DEFAULT_SEED;
    this.onStep = options.onStep;
    this.scale = options.xToLambda;
  }

  /** The px → λ scale changed (the plot moved or resized). Call at the start of a gesture. */
  setScale(xToLambda: LinearScale): void {
    this.scale = xToLambda;
  }

  /** Nothing to feel: no usable point (the pad shows a refusal instead). */
  get empty(): boolean {
    return this.mapping.empty;
  }

  /** The latest step (reused object), or null before the first one. */
  get lastStep(): Readonly<SpectrumStep> | null {
    return this.hasStep ? this.step : null;
  }

  /** Where the keyboard cursor (or the last step) is, in px; null before any step. */
  get cursorX(): number | null {
    if (this.cursor === null || this.cursorScale === this.scale) return this.cursor;
    // The plot moved or resized since: the same λ, on the new scale.
    return linearScale(this.scale.range, this.scale.domain)(this.cursorLambda);
  }

  /** Pointer down at `x`: a drag begins. Plays nothing; the first tick comes after 8 px. */
  begin(x: number): void {
    if (!Number.isFinite(x)) return;
    this.lastX = x;
    this.travelled = 0;
    this.gap = SPECTRUM_TICK_PX;
    this.stepIndex = 0;
  }

  /**
   * The finger moved to `x`. Every 8 px (jittered after noisy points) of travel is one step. When
   * one move crosses several steps, only the last is played: earlier ones are where the finger
   * no longer is, and the engine would drop them under its 25 ms rule anyway. Returns the number
   * of steps crossed.
   */
  move(x: number): number {
    const from = this.lastX;
    if (from === null || !Number.isFinite(x)) return 0;
    this.lastX = x;
    const d = x - from;
    let remaining = Math.abs(d);
    if (remaining === 0) return 0;
    const dir = d > 0 ? 1 : -1;
    let pos = from;
    let crossed = 0;
    while (this.travelled + remaining >= this.gap) {
      const need = this.gap - this.travelled;
      pos += dir * need;
      remaining -= need;
      this.travelled = 0;
      crossed++;
      this.advanceTo(pos);
      // Only the step where the finger is now (the last one, after the new gap) plays.
      this.finish(remaining < this.gap);
    }
    this.travelled += remaining;
    return crossed;
  }

  /** Pointer up or cancel. */
  end(): void {
    this.lastX = null;
  }

  /**
   * Keyboard: move `steps` steps left (−1) or right (+1) and play where it lands, like one drag
   * move. The first press starts at the end of the plot it moves away from. A move past an edge
   * stops on the edge, so the last pixels are reachable; at the edge it returns false (no step).
   */
  stepBy(dir: -1 | 1, steps = 1): boolean {
    const [lo, hi] = this.bounds();
    if (this.cursor === null) {
      this.stepIndex = 0;
      return this.jumpTo(dir > 0 ? 'start' : 'end');
    }
    const cur = this.cursorX!;
    const next = Math.min(hi, Math.max(lo, cur + dir * this.gap * Math.max(1, Math.floor(steps))));
    if (Math.abs(next - cur) < 1e-9) return false;
    this.advanceTo(next);
    this.finish(true);
    return true;
  }

  /** Keyboard Home / End: a step at the start or end of the plot. */
  jumpTo(edge: 'start' | 'end'): boolean {
    const [lo, hi] = this.bounds();
    this.advanceTo(edge === 'start' ? lo : hi);
    this.finish(true);
    return true;
  }

  // ------------------------------------------------------------ internals

  /** Move to the step at `x`: sample it, and set the spacing to the next step. Plays nothing. */
  private advanceTo(x: number): void {
    const lambda = this.scale(x);
    const s = this.mapping.sampleAt(lambda, this.sample);
    const st = this.step;
    st.x = x;
    st.lambdaUm = lambda;
    st.index = this.stepIndex;
    st.inRange = s !== null;
    st.strength = s ? s.strength : 0;
    st.quiet = s ? s.quiet : true;
    st.noisy = s ? s.noisy : false;
    st.emitted = false;
    st.played = false;
    this.hasStep = true;
    this.cursor = x;
    this.cursorLambda = lambda;
    this.cursorScale = this.scale;
    // R8.3 roughness: after a noisy point the spacing to the next step jitters ±30%.
    // At least 1 px, whatever JITTER_FRACTION is tuned to, so a step always moves.
    this.gap = st.noisy
      ? Math.max(
          1,
          SPECTRUM_TICK_PX *
            (1 + JITTER_FRACTION * (2 * jitterUnit(this.seed, this.stepIndex) - 1)),
        )
      : SPECTRUM_TICK_PX;
    this.stepIndex++;
  }

  /** Play the current step unless it is quiet or out of range (quiet = nothing in either channel). */
  private finish(play: boolean): void {
    const st = this.step;
    if (play && st.inRange && !st.quiet) {
      const e = this.event;
      e.strength = st.strength;
      e.tag = this.tag;
      e.pitch = this.sample.pitch;
      e.pan = this.panAt(st.x);
      st.played = this.sink.emit(e);
      st.emitted = true;
    }
    this.onStep?.(st);
  }

  private bounds(): [number, number] {
    const [a, b] = this.scale.domain;
    return [Math.min(a, b), Math.max(a, b)];
  }

  /** −1 at the left of the plot, 1 at the right (R8.9 pan from the finger's x). */
  private panAt(x: number): number {
    const [a, b] = this.scale.domain;
    if (a === b) return 0;
    return clamp01((x - Math.min(a, b)) / Math.abs(b - a)) * 2 - 1;
  }
}
