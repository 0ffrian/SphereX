// R8.5 steady data pulses, data channel.
//   - `teq_pulse` (gas_giant, planet_water, planet_rocky; D-12): holding still on the body gives a
//     steady pulse, rate ∝ Teq normalised over the TEQ_DISPLAY range, 2–12 Hz. Tag = teq_K's tag
//     (`measured` from pl_eqt plays in Measured only; `derived` does not; D-21).
//   - `flux_pulse` (brown_dwarf): the same, rate ∝ flux_45um ÷ the verified reference. While
//     `BROWN_DWARF_CONFIG.flux45Reference` is null (R12 #15) it is refused, never guessed.
//   - `brown_dwarf_binary`: touching each body gives a pulse whose rate follows its temperature
//     class; the warmer one (T1 in T1+T6) is faster. Tag = spectral_class's tag (what it encodes).
import type { Tag } from '@/contract';
import {
  BINARY_COOL_HZ,
  BINARY_WARM_HZ,
  DATA_PULSE_MAX_HZ,
  DATA_PULSE_MIN_HZ,
  DATA_PULSE_STRENGTH,
  TEQ_DISPLAY_MAX_K,
  TEQ_DISPLAY_MIN_K,
} from '../tuning';
import { clamp, TrainSlot, type HapticSink, type HapticSource, type TouchSample } from './types';

export const DATA_TRAIN_ID = 'data';

/** 0–1 → DATA_PULSE_MIN_HZ–maxHz (R8.5 "2–12 Hz"). */
export function pulseRateHz(normalised: number, maxHz: number = DATA_PULSE_MAX_HZ): number {
  const top = Math.max(DATA_PULSE_MIN_HZ, Math.min(DATA_PULSE_MAX_HZ, maxHz));
  return DATA_PULSE_MIN_HZ + (top - DATA_PULSE_MIN_HZ) * clamp(normalised, 0, 1);
}

/** Teq (K) over the display range → 0–1 (a display scale, not physics; D-13 placeholder). */
export function normaliseTeq(teqK: number): number {
  return clamp((teqK - TEQ_DISPLAY_MIN_K) / (TEQ_DISPLAY_MAX_K - TEQ_DISPLAY_MIN_K), 0, 1);
}

/** A steady pulse at a fixed rate, started by holding still on a body (teq_pulse, flux_pulse). */
export class HoldPulseSource implements HapticSource {
  readonly channel = 'data' as const;
  readonly trigger = 'hold' as const;
  private readonly train: TrainSlot;

  constructor(
    engine: HapticSink,
    readonly id: 'teq_pulse' | 'flux_pulse',
    readonly tag: Tag,
    readonly rateHz: number,
  ) {
    this.train = new TrainSlot(engine, DATA_TRAIN_ID, tag);
  }

  move(s: TouchSample): void {
    // The finger moved off the body while the pulse played: stop.
    if (s.bodyId === null) this.train.stop();
  }

  hold(s: TouchSample): void {
    if (s.bodyId === null) return;
    this.train.play(this.rateHz, DATA_PULSE_STRENGTH, s.pan);
  }

  release(): void {
    this.train.stop();
  }
}

/** "T1" → a sortable temperature rank (smaller = warmer), or null. Sequence O B A F G K M L T Y. */
export function classRank(cls: string): number | null {
  const m = /^([OBAFGKMLTY])\s*(\d+(?:\.\d+)?)?/i.exec(cls.trim());
  if (!m) return null;
  const letter = 'OBAFGKMLTY'.indexOf(m[1]!.toUpperCase());
  const sub = m[2] !== undefined ? Number(m[2]) : 0;
  return letter * 10 + sub;
}

/**
 * Rates for each component, warmer faster (R8.5). Null when the classes cannot be ordered (fewer
 * than two, unparseable, or equal): nothing is guessed.
 */
export function binaryRates(classes: readonly string[]): [number, number] | null {
  if (classes.length < 2) return null;
  const a = classRank(classes[0]!);
  const b = classRank(classes[1]!);
  if (a === null || b === null || a === b) return null;
  return a < b ? [BINARY_WARM_HZ, BINARY_COOL_HZ] : [BINARY_COOL_HZ, BINARY_WARM_HZ];
}

/**
 * Binary brown dwarf: touching a body plays its pulse while the finger stays on it. Body ids are
 * the plan's (`body_a`, `body_b`; a single drawn `body` is the first component).
 */
export class BinaryPulseSource implements HapticSource {
  readonly id = 'binary_pulse';
  readonly channel = 'data' as const;
  readonly trigger = 'move' as const;
  private readonly train: TrainSlot;

  constructor(
    engine: HapticSink,
    readonly tag: Tag,
    private readonly rates: readonly [number, number],
  ) {
    this.train = new TrainSlot(engine, DATA_TRAIN_ID, tag);
  }

  move(s: TouchSample): void {
    const id = s.bodyId;
    if (id === 'body_b') this.train.play(this.rates[1], DATA_PULSE_STRENGTH, s.pan);
    else if (id === 'body_a' || id === 'body')
      this.train.play(this.rates[0], DATA_PULSE_STRENGTH, s.pan);
    else this.train.stop();
  }

  release(): void {
    this.train.stop();
  }
}
