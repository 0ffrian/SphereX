import { describe, expect, it } from 'vitest';
import {
  DYNRES_LOWER_MS,
  DYNRES_MIN_SCALE,
  DYNRES_RAISE_MS,
  DYNRES_STEP,
  DYNRES_WINDOW,
  DynamicResolution,
  dynamicResolutionFromSearch,
  gpuTimingFlags,
  RollingStats,
} from './gpuTiming';

describe('gpuTimingFlags (roadmap 0.1, dev only)', () => {
  it('reads ?gputime=1 and ?inspector=1 only in a dev build', () => {
    expect(gpuTimingFlags('?gputime=1', true)).toEqual({ timing: true, inspector: false });
    expect(gpuTimingFlags('?inspector=1', true)).toEqual({ timing: true, inspector: true });
    expect(gpuTimingFlags('', true)).toEqual({ timing: false, inspector: false });
    expect(gpuTimingFlags('?gputime=1&inspector=1', false)).toEqual({
      timing: false,
      inspector: false,
    });
  });
  it('dynamic resolution is on unless ?dynres=0', () => {
    expect(dynamicResolutionFromSearch('')).toBe(true);
    expect(dynamicResolutionFromSearch('?dynres=0')).toBe(false);
  });
});

describe('RollingStats', () => {
  it('keeps the last N finite samples and gives nearest-rank percentiles', () => {
    const s = new RollingStats(4);
    expect(s.percentile(0.5)).toBeNull();
    for (const v of [9, 1, 2, 3, 4, Number.NaN, -1]) s.push(v);
    expect(s.count).toBe(4);
    expect(s.percentile(0.5)).toBe(2);
    expect(s.percentile(0.95)).toBe(4);
    expect(s.mean()).toBe(2.5);
  });
});

describe('DynamicResolution (roadmap 2.5)', () => {
  const feedN = (d: DynamicResolution, ms: number, n = DYNRES_WINDOW) => {
    let last: number | null = null;
    for (let i = 0; i < n; i++) last = d.feed(ms) ?? last;
    return last;
  };

  it('steps down while over budget, never below the floor', () => {
    const d = new DynamicResolution(0.75);
    expect(feedN(d, DYNRES_LOWER_MS + 5)).toBe(0.75 - DYNRES_STEP);
    for (let i = 0; i < 10; i++) feedN(d, 40);
    expect(d.scale).toBe(DYNRES_MIN_SCALE);
  });

  it('steps back up while well under budget, never above the base', () => {
    const d = new DynamicResolution(0.75);
    for (let i = 0; i < 10; i++) feedN(d, 40);
    for (let i = 0; i < 10; i++) feedN(d, DYNRES_RAISE_MS - 1);
    expect(d.scale).toBe(0.75);
  });

  it('holds between the two thresholds (no oscillation)', () => {
    const d = new DynamicResolution(0.75);
    feedN(d, 40);
    const s = d.scale;
    for (let i = 0; i < 10; i++) feedN(d, (DYNRES_LOWER_MS + DYNRES_RAISE_MS) / 2);
    expect(d.scale).toBe(s);
  });

  it('reset puts the base back (settled frames are drawn at the base scale)', () => {
    const d = new DynamicResolution(0.75);
    feedN(d, 40);
    d.reset();
    expect(d.scale).toBe(0.75);
    d.reset(1);
    expect(d.scale).toBe(1);
    expect(d.baseScale).toBe(1);
  });

  it('a base already under the floor stays put', () => {
    const d = new DynamicResolution(0.4);
    feedN(d, 40);
    expect(d.scale).toBe(0.4);
  });
});
