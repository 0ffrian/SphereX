// R8.4 field source, data channel (R8.5; Q-37 puts `field` in `data`).
//   Comet: pulse rate = clamp(k · Q_selected / r, 2, maxRateHz) Hz while the finger is on the coma,
//     with r the projected distance from the nucleus in coma radii and Q normalised as the drawn
//     shells are (`planShells`: ÷ the largest Q of any gas in any epoch), so the felt density
//     matches the drawn one. Touching the nucleus gives one firm tick. Tag = `profile.data_tag`
//     (Q-17 stays open: which single tag the comet field carries).
//   Nova: the same train, rate ∝ the local point density from the body's point sets
//     (BodyRenderer.pointSets) around the finger's ray. Tag = `profile.data_tag` (artistic).
import type { Tag } from '@/contract';
import type { PointSet } from '@/viewer/renderers/pointClouds';
import {
  DATA_PULSE_STRENGTH,
  DENSITY_K,
  DENSITY_RADIUS,
  DENSITY_RECOUNT_PX,
  FIELD_K,
  FIELD_MAX_HZ,
  FIELD_MIN_HZ,
  STRENGTH_FIRM,
} from '../tuning';
import {
  clamp,
  OneShot,
  TrainSlot,
  type HapticSink,
  type HapticSource,
  type TouchSample,
} from './types';

export const FIELD_TRAIN_ID = 'field';

/** R8.4 comet rate, Hz. `qNorm` is Q ÷ the card's largest Q; `r` in coma radii (> 0). */
export function cometFieldRateHz(qNorm: number, r: number, k: number, maxHz: number): number {
  return clamp((k * qNorm) / Math.max(r, 1e-6), FIELD_MIN_HZ, maxHz);
}

export interface CometFieldOptions {
  /** Selected gas's Q ÷ the largest Q of the card (planShells normalisation), > 0. */
  qNorm: number;
  /**
   * Nucleus radius in the comet plan's scene units (its `nucleus` body), so the felt nucleus is the
   * drawn one; the finger inside it gets the firm tick.
   */
  nucleusRadius: number;
  /** `profile.params.k`, else FIELD_K. */
  k?: number;
  /** `profile.params.maxRateHz`, else FIELD_MAX_HZ. */
  maxRateHz?: number;
}

/** Comet coma field. Probe frame = the comet plan's scene units (coma radius 1, nucleus at 0). */
export class CometFieldSource implements HapticSource {
  readonly id = 'field';
  readonly channel = 'data' as const;
  readonly trigger = 'move' as const;
  private readonly out: OneShot;
  private readonly train: TrainSlot;
  private readonly k: number;
  private readonly maxHz: number;
  private onNucleus = false;

  constructor(
    engine: HapticSink,
    readonly tag: Tag,
    private readonly opts: CometFieldOptions,
  ) {
    this.out = new OneShot(engine, tag, 'data');
    this.train = new TrainSlot(engine, FIELD_TRAIN_ID, tag, 'data');
    this.k = typeof opts.k === 'number' && opts.k > 0 ? opts.k : FIELD_K;
    this.maxHz =
      typeof opts.maxRateHz === 'number' && opts.maxRateHz > FIELD_MIN_HZ
        ? opts.maxRateHz
        : FIELD_MAX_HZ;
  }

  move(s: TouchSample): void {
    const r = s.centreDistance;
    const nucleus = r <= this.opts.nucleusRadius;
    if (nucleus) {
      // On the nucleus: one firm tick on entering, and no coma pulse under it (R8.4).
      this.train.stop();
      if (!this.onNucleus) this.out.play('tick', STRENGTH_FIRM, s.pan);
      this.onNucleus = true;
      return;
    }
    this.onNucleus = false;
    if (!(r <= 1)) {
      // Outside the coma: nothing to feel.
      this.train.stop();
      return;
    }
    this.train.play(
      cometFieldRateHz(this.opts.qNorm, r, this.k, this.maxHz),
      DATA_PULSE_STRENGTH,
      s.pan,
    );
  }

  release(): void {
    this.train.stop();
    this.onNucleus = false;
  }
}

/**
 * Points of `sets` within `radius` of the ray (origin o, unit direction d), all in the body frame.
 * The finger is 2D, so this is the density of the cloud as seen along the ray. No allocation.
 */
export function pointsNearRay(
  sets: readonly PointSet[],
  o: readonly number[],
  d: readonly number[],
  radius: number,
): number {
  const r2 = radius * radius;
  const ox = o[0]!;
  const oy = o[1]!;
  const oz = o[2]!;
  const dx = d[0]!;
  const dy = d[1]!;
  const dz = d[2]!;
  let n = 0;
  for (const set of sets) {
    const p = set.positions;
    for (let i = 0; i < set.count; i++) {
      const px = p[3 * i]! - ox;
      const py = p[3 * i + 1]! - oy;
      const pz = p[3 * i + 2]! - oz;
      // |w × d|² with |d| = 1.
      const cx = py * dz - pz * dy;
      const cy = pz * dx - px * dz;
      const cz = px * dy - py * dx;
      if (cx * cx + cy * cy + cz * cz <= r2) n++;
    }
  }
  return n;
}

export interface DensityOptions {
  /** `profile.params.maxRateHz`, else FIELD_MAX_HZ. */
  maxRateHz?: number;
}

/** Nova (the nebula has no haptics, Q-103): rate ∝ local point density (R8.4 item 4). */
export class PointDensitySource implements HapticSource {
  readonly id = 'field';
  readonly channel = 'data' as const;
  readonly trigger = 'move' as const;
  private readonly train: TrainSlot;
  private readonly sets: PointSet[];
  /** Points a uniform disc of radius 1 would put inside DENSITY_RADIUS: the reference density. */
  private readonly uniform: number;
  private readonly maxHz: number;
  private lastX = NaN;
  private lastY = NaN;
  private rate = 0;
  private counts = 0;

  constructor(
    engine: HapticSink,
    pointSets: Readonly<Record<string, PointSet>>,
    readonly tag: Tag,
    options: DensityOptions = {},
  ) {
    this.train = new TrainSlot(engine, FIELD_TRAIN_ID, tag, 'data');
    this.sets = Object.values(pointSets);
    const total = this.sets.reduce((n, s) => n + s.count, 0);
    this.uniform = total * DENSITY_RADIUS * DENSITY_RADIUS;
    this.maxHz =
      typeof options.maxRateHz === 'number' && options.maxRateHz > FIELD_MIN_HZ
        ? options.maxRateHz
        : FIELD_MAX_HZ;
  }

  /** Rate for `count` points near the ray, or 0 (silent) when there are none. */
  rateFor(count: number): number {
    if (count <= 0 || !(this.uniform > 0)) return 0;
    return clamp((DENSITY_K * count) / this.uniform, FIELD_MIN_HZ, this.maxHz);
  }

  move(s: TouchSample): void {
    // The count is O(points) (about 20k): skip it while the finger moved less than
    // DENSITY_RECOUNT_PX since the last count (the camera does not move while touching).
    const moved = Math.hypot(s.xPx - this.lastX, s.yPx - this.lastY);
    if (!(moved < DENSITY_RECOUNT_PX)) {
      this.lastX = s.xPx;
      this.lastY = s.yPx;
      this.rate = this.rateFor(pointsNearRay(this.sets, s.rayOrigin, s.rayDir, DENSITY_RADIUS));
      this.counts++;
    }
    if (this.rate > 0) this.train.play(this.rate, DATA_PULSE_STRENGTH, s.pan);
    else this.train.stop();
  }

  /** How many times the points were counted (tests). */
  get recounts(): number {
    return this.counts;
  }

  release(): void {
    this.train.stop();
    this.lastX = NaN;
    this.lastY = NaN;
  }
}
