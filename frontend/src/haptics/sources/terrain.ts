// R8.4, D-12 terrain source (planet_rocky, planet_water). Every event carries `texture_tag`, which
// is `artistic` on these kinds (D-12), so the engine's honesty gate keeps them silent below
// + Artistic (D-21). It samples the SAME shared field the shader draws (BodyRenderer.field), so
// the finger and the picture agree (D-12, R1 principle 6).
//   - Land: height ticks with the R8.4 rule (relief.ts), voice `click` ("land is clicks").
//   - Coastline: one firm tick when the ocean mask changes between consecutive samples.
//   - Open ocean: a near-silent slow swell, a 1–2 Hz train at the lowest level, voice `surf`.
//   - Polar ice: dense, fine, soft ticks, one every ICE_TICK_SPACING_PX of travel.
//   - Lava cracks (planet_rocky): a double tick on entering a crack (texture B, channel B).
//   - Clouds: not felt (the optional "feel clouds" toggle is not built).
import type { Tag } from '@/contract';
import type { FieldSampler, FieldSample } from '@/viewer/fields/fieldGenerator';
import { FIELD_HEIGHT, FIELD_WIDTH } from '@/viewer/fields/fieldGenerator';
import {
  HEIGHT_TAU_FRACTION,
  ICE_TICK_SPACING_PX,
  MASK_THRESHOLD,
  OCEAN_SWELL_HZ,
  OCEAN_SWELL_STRENGTH,
  PLAIN_TICK_STRENGTH,
  STRENGTH_FIRM,
  STRENGTH_SOFT,
} from '../tuning';
import { PeakDetector, ReliefStats } from './relief';
import { OneShot, TrainSlot, type HapticSink, type HapticSource, type TouchSample } from './types';

/** Train id of the ocean swell. */
export const SWELL_TRAIN_ID = 'terrain:swell';

/** Local relief std of the field's land (ocean texels left out), on a half-resolution grid. */
export function terrainReliefStats(field: FieldSampler): ReliefStats {
  const w = FIELD_WIDTH / 2;
  const h = FIELD_HEIGHT / 2;
  return new ReliefStats(w, h, (c, r) => {
    const s = field.sampleUV((c + 0.5) / w, (r + 0.5) / h);
    return s.ocean >= MASK_THRESHOLD ? NaN : s.height;
  });
}

export interface TerrainOptions {
  /** `profile.params.tau`, else HEIGHT_TAU_FRACTION. */
  tauFraction?: number;
  /** Lava cracks are felt only on planet_rocky (R8.4 item 6). */
  lava?: boolean;
}

type Zone = 'none' | 'land' | 'ocean' | 'ice';

export class TerrainSource implements HapticSource {
  readonly id = 'terrain';
  readonly channel = 'texture' as const;
  readonly trigger = 'move' as const;
  private readonly out: OneShot;
  private readonly swell: TrainSlot;
  private readonly peaks = new PeakDetector();
  private readonly stats: ReliefStats;
  private readonly tauFraction: number;
  private readonly lava: boolean;
  private zone: Zone = 'none';
  private inLava = false;
  private iceTravel = 0;
  private lastX = NaN;
  private lastY = NaN;

  constructor(
    engine: HapticSink,
    private readonly field: FieldSampler,
    readonly tag: Tag,
    options: TerrainOptions = {},
  ) {
    this.out = new OneShot(engine, tag);
    this.swell = new TrainSlot(engine, SWELL_TRAIN_ID, tag, 'surf');
    this.stats = terrainReliefStats(field);
    const t = options.tauFraction;
    this.tauFraction = typeof t === 'number' && t > 0 ? t : HEIGHT_TAU_FRACTION;
    this.lava = options.lava ?? false;
  }

  move(s: TouchSample): void {
    if (s.bodyId === null) {
      this.leave();
      return;
    }
    const f: FieldSample = this.field.sampleUV(s.u, s.v);
    const ocean = f.ocean >= MASK_THRESHOLD;
    const zone: Zone = ocean ? 'ocean' : f.ice >= MASK_THRESHOLD ? 'ice' : 'land';
    const travel = Number.isFinite(this.lastX)
      ? Math.hypot(s.xPx - this.lastX, s.yPx - this.lastY)
      : 0;
    this.lastX = s.xPx;
    this.lastY = s.yPx;

    // Coastline: the ocean mask changed between consecutive samples.
    const wasOcean = this.zone === 'ocean';
    if (this.zone !== 'none' && ocean !== wasOcean) {
      this.out.play('tick', STRENGTH_FIRM, s.pan, 'click');
    }

    if (ocean) {
      this.peaks.reset();
      this.inLava = false;
      this.swell.play(OCEAN_SWELL_HZ, OCEAN_SWELL_STRENGTH, s.pan);
    } else {
      this.swell.stop();
      if (zone === 'ice') {
        // Dense, fine, soft ticks by distance travelled (the 25 ms rule drops the excess).
        this.iceTravel += travel;
        if (this.zone !== 'ice') this.iceTravel = 0;
        if (this.iceTravel >= ICE_TICK_SPACING_PX) {
          this.iceTravel %= ICE_TICK_SPACING_PX;
          this.out.play('tick', STRENGTH_SOFT, s.pan, 'click');
        }
      }
      // Lava cracks: a double tick on entering one.
      const lava = this.lava && f.lava >= MASK_THRESHOLD;
      if (lava && !this.inLava) this.out.play('double', PLAIN_TICK_STRENGTH, s.pan, 'click');
      this.inLava = lava;
      // Land relief (ice included: it lies on land).
      const strength = this.peaks.step(f.height, this.tauFraction * this.stats.at(s.u, s.v));
      if (strength >= 0) this.out.play('tick', strength, s.pan, 'click');
    }
    this.zone = zone;
  }

  private leave(): void {
    this.swell.stop();
    this.peaks.reset();
    this.zone = 'none';
    this.inLava = false;
    this.iceTravel = 0;
    this.lastX = NaN;
    this.lastY = NaN;
  }

  release(): void {
    this.leave();
  }
}
