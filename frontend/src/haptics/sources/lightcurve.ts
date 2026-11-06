// R8.5 light-curve data haptics, driven by the light-curve scrubber (not the finger on the body).
// Both reuse the viewer's light-curve rules (Star.ts: `usableLightcurve`, `lightcurveScrub`,
// `screenOpacity`), so the felt step is the drawn step. Tag = `profile.data_tag` (`measured`).
//   - star_mira: a heartbeat per scrub step; strength = the scrubbed flux ÷ the brightest point.
//   - star_ttauri: a steady pulse that weakens and thins out as you scrub into the dimming:
//     strength = DATA_PULSE_STRENGTH × (1 − depth) and rate = TTAURI_PULSE_HZ × (1 − depth),
//     depth = the dust-screen opacity clamp(1 − flux/median, 0, 0.9). The rate drop is the "dropped beats ∝ depth"; true
//     irregular dropping needs per-pulse masks in the engine train (Q-68).
import type { ObjectCard, Tag } from '@/contract';
import { lightcurveScrub, screenOpacity, usableLightcurve } from '@/viewer/renderers/Star';
import { DATA_PULSE_STRENGTH, TTAURI_PULSE_HZ } from '../tuning';
import { OneShot, TrainSlot, type HapticSink, type HapticSource } from './types';

export const DIMMING_TRAIN_ID = 'dimming';

/** True when the card has at least one usable light-curve point (else the haptic is refused). */
export function hasUsableLightcurve(card: ObjectCard): boolean {
  return usableLightcurve(card).length > 0;
}

/** star_mira: one heartbeat per scrub step. */
export class MiraHeartbeatSource implements HapticSource {
  readonly id = 'heartbeat';
  readonly channel = 'data' as const;
  readonly trigger = 'scrub' as const;
  private readonly out: OneShot;
  private last = -1;

  constructor(
    engine: HapticSink,
    private readonly card: ObjectCard,
    readonly tag: Tag,
  ) {
    this.out = new OneShot(engine, tag);
  }

  move(): void {}

  scrub(index: number): void {
    const step = lightcurveScrub(this.card, index);
    if (!step || step.index === this.last) return;
    this.last = step.index;
    this.out.play('heartbeat', step.brightness, 0);
  }

  release(): void {
    this.last = -1;
  }
}

/** star_ttauri: the dimming pulse. */
export class TTauriDimmingSource implements HapticSource {
  readonly id = 'dimming';
  readonly channel = 'data' as const;
  readonly trigger = 'scrub' as const;
  private readonly train: TrainSlot;

  constructor(
    engine: HapticSink,
    private readonly card: ObjectCard,
    readonly tag: Tag,
  ) {
    this.train = new TrainSlot(engine, DIMMING_TRAIN_ID, tag);
  }

  move(): void {}

  /** Depth 0–0.9 at scrub step `index`, or null without a usable point. */
  depthAt(index: number): number | null {
    return screenOpacity(this.card, index);
  }

  scrub(index: number): void {
    const depth = this.depthAt(index);
    if (depth === null) {
      this.train.stop();
      return;
    }
    const keep = 1 - depth;
    this.train.play(TTAURI_PULSE_HZ * keep, DATA_PULSE_STRENGTH * keep, 0);
  }

  release(): void {
    this.train.stop();
  }
}
