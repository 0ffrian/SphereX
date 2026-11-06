// Test helper (src/test/ is test-only code): a fake clock with timers, a recording HapticDriver
// and a recording navigator.vibrate, so the haptics can be tested without a phone. App modules
// must never import this (fixtures.test.ts checks it).
import type { HapticDriver, HapticEvent } from '@/contract';
import type { HapticTimers, TrainCapableDriver, TrainWindow } from '@/haptics/haptics';

/** A manual clock. `advance` runs due timers in time order, setting `now` to each one's time. */
export class FakeClock implements HapticTimers {
  now = 0;
  private seq = 0;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  readonly clock = (): number => this.now;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of this.pending) {
        if (t.at <= end && (t.at < nextAt || (t.at === nextAt && id < (nextId ?? Infinity)))) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const t = this.pending.get(nextId)!;
      this.pending.delete(nextId);
      this.now = Math.max(this.now, t.at);
      t.fn();
    }
    this.now = end;
  }
}

export interface RecordedWindow {
  /** Clock time when the window was sent. */
  at: number;
  rateHz: number;
  strength: number;
  tag: HapticEvent['tag'];
  pulseOffsetsMs: number[];
  resentCount: number;
  trainSeq: number;
}

/** Records everything it gets. Copies, because the engine reuses its event and window objects. */
export class FakeDriver implements TrainCapableDriver {
  readonly events: (HapticEvent & { at: number })[] = [];
  readonly windows: RecordedWindow[] = [];
  stops = 0;
  trainStops = 0;

  constructor(
    private readonly clock: () => number,
    readonly supported = true,
    private readonly blockMs = 0,
  ) {}

  emit(e: HapticEvent): void {
    this.events.push({ ...e, at: this.clock() });
  }

  playTrain(w: TrainWindow): void {
    this.windows.push({
      at: this.clock(),
      rateHz: w.rateHz,
      strength: w.strength,
      tag: w.tag,
      pulseOffsetsMs: [...w.pulseOffsetsMs],
      resentCount: w.resentCount,
      trainSeq: w.trainSeq,
    });
  }

  oneShotBlockMs(): number {
    return this.blockMs;
  }

  stop(): void {
    this.stops++;
  }

  stopTrain(): void {
    this.trainStops++;
  }

  /** Absolute times of every pulse sent for the first time (re-sent pulses excluded). */
  freshPulseTimes(): number[] {
    return this.windows.flatMap((w) => w.pulseOffsetsMs.slice(w.resentCount).map((o) => w.at + o));
  }
}

/** A plain R8.8 driver without train support. */
export class PlainDriver implements HapticDriver {
  readonly events: HapticEvent[] = [];
  stops = 0;
  readonly supported = true;
  emit(e: HapticEvent): void {
    this.events.push({ ...e });
  }
  stop(): void {
    this.stops++;
  }
}

/** A recording `navigator.vibrate`. */
export function fakeVibrate(): {
  fn: (p: number | number[]) => boolean;
  calls: (number | number[])[];
} {
  const calls: (number | number[])[] = [];
  return {
    calls,
    fn: (p) => {
      calls.push(Array.isArray(p) ? [...p] : p);
      return true;
    },
  };
}

export interface TimedCall {
  at: number;
  pattern: number | number[];
}

/** A recording `navigator.vibrate` that also notes when each call happened. */
export function timedVibrate(clock: () => number): {
  fn: (p: number | number[]) => boolean;
  calls: TimedCall[];
} {
  const calls: TimedCall[] = [];
  return {
    calls,
    fn: (p) => {
      calls.push({ at: clock(), pattern: Array.isArray(p) ? [...p] : p });
      return true;
    },
  };
}

/**
 * What a phone motor would play for these calls: the start time of every vibration segment that
 * actually starts. Each call replaces the previous pattern, so a segment that has not started
 * when the next call comes never plays (navigator.vibrate semantics).
 */
export function motorOnsets(calls: readonly TimedCall[]): number[] {
  const onsets: number[] = [];
  calls.forEach((c, i) => {
    const next = calls[i + 1]?.at ?? Infinity;
    const p = typeof c.pattern === 'number' ? [c.pattern] : c.pattern;
    let t = c.at;
    p.forEach((v, j) => {
      if (j % 2 === 0 && v > 0 && t < next) onsets.push(t);
      t += v;
    });
  });
  return onsets;
}
