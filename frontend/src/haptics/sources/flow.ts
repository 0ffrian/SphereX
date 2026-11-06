// R8.4, D-12 flow source (gas_giant): no surface, so the finger feels the flow. Every event carries
// `texture_tag` (`artistic`, D-12). Band index and storm id come from the SAME shared field the
// shader draws (BodyRenderer.field); the zonal wind, the storm centres and the ring gaps come from
// the functions the shader uses (fieldGenerator.ts), so the felt edges are the drawn edges (R11).
//   - Band boundary: a soft tick each time the band index changes, voice `tone`, pitch from latitude.
//     "Strength = band contrast": the gas field has no per-boundary contrast (every boundary crosses
//     the same 0–1 profile), so the soft-tick strength is used (Q-67).
//   - Jet: a train at clamp(k · |wind| / max|wind|, 2, 20) Hz; max |wind| is 1 by construction.
//   - Storm: a firm tick at its edge, then a "swirl" train whose rate rises towards the centre.
//   - Rings: a tick on entering each gap, when the rings are drawn and the ray meets them first.
import type { Tag } from '@/contract';
import type { FieldParams, FieldSampler, Storm } from '@/viewer/fields/fieldGenerator';
import {
  MAX_STORMS,
  ringGapAt,
  ringT,
  STORM_EDGE_FACTOR,
  stormsFor,
  zonalWind,
} from '@/viewer/fields/fieldGenerator';
import { latitudeToPitch } from '../pitch';
import {
  FLOW_JET_K,
  FLOW_JET_MAX_HZ,
  FLOW_JET_MIN_HZ,
  FLOW_JET_MIN_WIND,
  PLAIN_TICK_STRENGTH,
  RING_GAP_THRESHOLD,
  STORM_SWIRL_CENTRE_HZ,
  STORM_SWIRL_EDGE_HZ,
  STRENGTH_FIRM,
  STRENGTH_SOFT,
} from '../tuning';
import {
  clamp,
  OneShot,
  TrainSlot,
  type HapticSink,
  type HapticSource,
  type TouchSample,
} from './types';

export const JET_TRAIN_ID = 'flow:jet';
export const STORM_TRAIN_ID = 'flow:storm';

/** D-12 jet rate, Hz. `wind` is the zonal wind in units of the strongest jet (−1..1). */
export function jetRateHz(wind: number, k: number = FLOW_JET_K): number {
  return clamp(k * Math.abs(wind), FLOW_JET_MIN_HZ, FLOW_JET_MAX_HZ);
}

/** Storm swirl rate, Hz: the edge rate at the felt edge, rising linearly to the centre rate. */
export function swirlRateHz(ratio: number): number {
  const t = 1 - clamp(ratio / STORM_EDGE_FACTOR, 0, 1);
  return STORM_SWIRL_EDGE_HZ + (STORM_SWIRL_CENTRE_HZ - STORM_SWIRL_EDGE_HZ) * t;
}

export interface FlowOptions {
  /** `profile.params.k`, else FLOW_JET_K. */
  k?: number;
  /** The gas giant's ring opacity (ShaderSpec.gas.rings); rings are felt only when drawn. */
  rings?: number;
}

const DEG = 180 / Math.PI;

export class FlowSource implements HapticSource {
  readonly id = 'flow';
  readonly channel = 'texture' as const;
  readonly trigger = 'move' as const;
  private readonly out: OneShot;
  private readonly jet: TrainSlot;
  private readonly swirl: TrainSlot;
  /** Every storm the field can hold: storm i depends only on (i, seed), not on the count. */
  private readonly storms: readonly Storm[];
  private readonly k: number;
  private readonly rings: boolean;
  private band = NaN;
  /** Storm id of the previous sample (0 = none); NaN before the first, so a first touch inside a storm is not an edge. */
  private storm = NaN;
  private inGap = false;

  constructor(
    engine: HapticSink,
    private readonly field: FieldSampler,
    private readonly params: FieldParams,
    readonly tag: Tag,
    options: FlowOptions = {},
  ) {
    this.out = new OneShot(engine, tag);
    this.jet = new TrainSlot(engine, JET_TRAIN_ID, tag, 'tone');
    this.swirl = new TrainSlot(engine, STORM_TRAIN_ID, tag, 'tone');
    this.storms = stormsFor(params.seed, MAX_STORMS);
    this.k = typeof options.k === 'number' && options.k > 0 ? options.k : FLOW_JET_K;
    this.rings = (options.rings ?? 0) > 0.01;
  }

  /** Whether the rings are drawn, so felt: the probe must then report `ringRadius`. */
  get feelsRings(): boolean {
    return this.rings;
  }

  move(s: TouchSample): void {
    // Rings first: the ray meets the ring plane in front of the planet (or misses the planet).
    const onRing = this.rings && this.ringMove(s);
    if (s.bodyId === null || onRing) {
      this.leaveBody();
      return;
    }
    const d = s.dir;
    const pitch = latitudeToPitch(Math.asin(clamp(d[1], -1, 1)) * DEG);
    const f = this.field.sampleUV(s.u, s.v);

    // Band boundary: the field's band index changed.
    if (Number.isFinite(this.band) && f.band !== this.band) {
      this.out.play('tick', STRENGTH_SOFT, s.pan, 'tone', pitch);
    }
    this.band = f.band;

    if (f.storm > 0) {
      if (Number.isFinite(this.storm) && f.storm !== this.storm) {
        this.out.play('tick', STRENGTH_FIRM, s.pan, 'tone', pitch);
      }
      this.storm = f.storm;
      const st = this.storms[f.storm - 1];
      const ratio = st ? angularDistance(d, st.center) / st.size : STORM_EDGE_FACTOR;
      this.jet.stop();
      this.swirl.play(swirlRateHz(ratio), PLAIN_TICK_STRENGTH, s.pan, pitch);
      return;
    }
    this.storm = 0;
    this.swirl.stop();
    const wind = zonalWind(d, this.params);
    if (Math.abs(wind) >= FLOW_JET_MIN_WIND && wind !== 0) {
      this.jet.play(jetRateHz(wind, this.k), PLAIN_TICK_STRENGTH, s.pan, pitch);
    } else {
      this.jet.stop();
    }
  }

  /** Ring-gap ticks. Returns whether the finger is on the ring (so the planet is not felt). */
  private ringMove(s: TouchSample): boolean {
    const t = ringT(s.ringRadius);
    if (!(t >= 0 && t <= 1)) {
      this.inGap = false;
      return false;
    }
    const gap = ringGapAt(t) >= RING_GAP_THRESHOLD;
    if (gap && !this.inGap) this.out.play('tick', PLAIN_TICK_STRENGTH, s.pan, 'tone');
    this.inGap = gap;
    return true;
  }

  private leaveBody(): void {
    this.jet.stop();
    this.swirl.stop();
    this.band = NaN;
    this.storm = NaN;
  }

  release(): void {
    this.leaveBody();
    this.inGap = false;
  }
}

function angularDistance(a: readonly number[], b: readonly number[]): number {
  return Math.acos(clamp(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!, -1, 1));
}
