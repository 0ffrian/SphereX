// R8.3, D-09: the navigator.vibrate driver: quantised levels, fixed patterns, train windows,
// the pattern cap, the R8.9 delay and the silent no-op where vibrate is missing.
import { describe, expect, it } from 'vitest';
import type { HapticEvent } from '@/contract';
import { fakeVibrate } from '@/test/fakeHaptics';
import type { TrainWindow } from '../haptics';
import { MAX_PATTERN, WHISPER_PATTERN } from '../tuning';
import { WebVibrateDriver, quantise } from './webVibrate';

const ev = (kind: HapticEvent['kind'], strength = 0.5): HapticEvent => ({
  kind,
  strength,
  tag: 'measured',
});

const train = (rateHz: number, offsets: number[], strength = 0.5): TrainWindow => ({
  rateHz,
  strength,
  tag: 'measured',
  pulseOffsetsMs: offsets,
  resentCount: 0,
});

describe('quantisation (D-09)', () => {
  it('splits 0–1 into 3 equal bins', () => {
    expect([0, 0.33, 0.34, 0.66, 0.67, 1].map((s) => quantise(s, 3))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('splits 0–1 into 4 equal bins', () => {
    expect([0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 1].map((s) => quantise(s, 4))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it('clamps out-of-range and NaN strengths', () => {
    expect([-1, NaN, 7].map((s) => quantise(s, 3))).toEqual([0, 0, 2]);
  });

  it('ticks are 8, 15 and 25 ms by default (R8.3)', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    for (const s of [0.1, 0.5, 0.9]) d.emit(ev('tick', s));
    expect(v.calls).toEqual([8, 15, 25]);
  });

  it('a calibrated whisper is level 0 of 4 and plays its pulse-width pattern', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    expect(d.setLevels([WHISPER_PATTERN, 10, 15, 25])).toBe(true);
    d.emit(ev('tick', 0.1));
    d.emit(ev('tick', 0.3));
    expect(v.calls).toEqual([[4, 4, 4, 4, 4], 10]);
  });

  it('ignores invalid level sets', () => {
    const d = new WebVibrateDriver({ vibrate: fakeVibrate().fn });
    expect(d.setLevels([])).toBe(false);
    expect(d.setLevels([1, 2, 3, 4, 5])).toBe(false);
    expect(d.setLevels([8, -1, 25])).toBe(false);
    expect(d.levels).toEqual([8, 15, 25]);
  });
});

describe('patterns (R8.3)', () => {
  it('double, heartbeat and stop', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    d.emit(ev('double'));
    d.emit(ev('heartbeat'));
    d.emit(ev('stop'));
    d.stop(); // nothing playing since the last stop: no call
    expect(v.calls).toEqual([[12, 40, 12], [20, 120, 12], 0]);
  });

  it('a train window becomes one pattern with explicit gaps, pulses at most half the period', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    d.playTrain(train(4, [20], 1)); // one firm pulse after 20 ms
    d.playTrain(train(20, [0, 50, 100, 150, 200], 1)); // firm = 25 ms = half of 50
    d.playTrain(train(40, [0, 25, 50], 1)); // capped to 12 ms
    expect(v.calls).toEqual([
      [0, 20, 25],
      [25, 25, 25, 25, 25, 25, 25, 25, 25],
      [12, 13, 12, 13, 12],
    ]);
  });

  it('never sends more than MAX_PATTERN entries', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    const offsets = Array.from({ length: 80 }, (_, i) => i * 30);
    d.playTrain(train(33, offsets, 0));
    const p = v.calls[0] as number[];
    expect(p.length).toBe(MAX_PATTERN);
  });

  it('a delay (R8.9 offset) leads every pattern with a silent gap', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    d.setDelayMs(30);
    d.emit(ev('tick', 0));
    d.emit(ev('double'));
    d.playTrain(train(4, [10], 0));
    expect(v.calls).toEqual([
      [0, 30, 8],
      [0, 30, 12, 40, 12],
      [0, 40, 8],
    ]);
    expect(d.oneShotBlockMs(ev('double'))).toBe(30 + 64);
  });

  it('reports how long a one-shot blocks a train', () => {
    const d = new WebVibrateDriver({ vibrate: fakeVibrate().fn });
    expect(d.oneShotBlockMs(ev('tick', 1))).toBe(25);
    expect(d.oneShotBlockMs(ev('heartbeat'))).toBe(152);
    expect(d.oneShotBlockMs(ev('pulseTrain'))).toBe(0);
  });
});

describe('stop', () => {
  it('does not call vibrate before anything played (no blocked call before the first tap)', () => {
    const v = fakeVibrate();
    const d = new WebVibrateDriver({ vibrate: v.fn });
    d.stop();
    expect(v.calls).toEqual([]);
  });
});

describe('unsupported (iPhone, iPad, desktop; R11)', () => {
  it('is a silent no-op', () => {
    const d = new WebVibrateDriver({ vibrate: null });
    expect(d.supported).toBe(false);
    expect(() => {
      d.emit(ev('tick'));
      d.playTrain(train(4, [0]));
      d.stop();
    }).not.toThrow();
    expect(d.oneShotBlockMs(ev('tick'))).toBe(0);
  });

  it('jsdom has no navigator.vibrate, so the default driver is unsupported', () => {
    expect(new WebVibrateDriver().supported).toBe(typeof navigator.vibrate === 'function');
  });
});
