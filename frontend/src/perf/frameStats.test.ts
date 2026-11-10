import { describe, expect, it } from 'vitest';
import { percentile } from '@/viewer/ViewerApp';
import { summarizeFrameTimes, verdict } from './frameStats';
import type { VerdictContext } from './frameStats';

const steady = (ms: number, n = 400): number[] => Array.from({ length: n }, () => ms);
const ctx = (over: Partial<VerdictContext> = {}): VerdictContext => ({
  seconds: 20,
  viewerFrames: 400,
  tierStart: 'medium',
  tierEnd: 'medium',
  backend: 'webgpu',
  dropsAbsolute: 0,
  ...over,
});

describe('summarizeFrameTimes', () => {
  it('matches the viewer percentile and derives fps and shares', () => {
    const s = summarizeFrameTimes([5, 1, 3, 2, 4]);
    expect(s.samples).toBe(5);
    expect(s.p50Ms).toBe(3);
    expect(s.p95Ms).toBe(percentile([5, 1, 3, 2, 4], 0.95));
    expect(s.p99Ms).toBe(percentile([5, 1, 3, 2, 4], 0.99));
    expect(s.maxMs).toBe(5);
    expect(s.fpsAtP50).toBeCloseTo(1000 / 3, 10);
    expect(s.over16_7Pct).toBe(0);
  });

  it('counts the share over 33.3 ms and 16.7 ms', () => {
    const s = summarizeFrameTimes([10, 20, 20, 40]);
    expect(s.over16_7Pct).toBe(75);
    expect(s.over33Pct).toBe(25);
  });

  it('is all zeros for an empty run, never Infinity', () => {
    const s = summarizeFrameTimes([]);
    expect(s).toMatchObject({ samples: 0, p50Ms: 0, fpsAtP50: 0, maxMs: 0, longGaps: 0 });
    expect(Number.isFinite(s.fpsAtP50)).toBe(true);
  });

  it('keeps a stall out of the percentiles and counts it', () => {
    const s = summarizeFrameTimes([...steady(16, 99), 300]);
    expect(s.longGaps).toBe(1);
    expect(s.maxGapMs).toBe(300);
    expect(s.samples).toBe(99);
    expect(s.p95Ms).toBe(16);
  });
});

describe('verdict', () => {
  it('Medium at 16 ms meets target and floor', () => {
    const v = verdict(summarizeFrameTimes(steady(16)), ctx());
    expect(v).toMatchObject({ meetsTarget: true, meetsFloor30: true, eventGate: true });
    expect(v.reasons).toEqual([]);
  });

  it('rounding boundaries: 17 ms (59 fps) misses the 60 target, 34 ms (29 fps) misses the floor', () => {
    const a = verdict(summarizeFrameTimes(steady(17)), ctx());
    expect(a.meetsTarget).toBe(false);
    expect(a.meetsFloor30).toBe(true);
    const b = verdict(summarizeFrameTimes(steady(34)), ctx());
    expect(b.meetsFloor30).toBe(false);
  });

  it('a run shorter than 20 s is never the event gate', () => {
    const v = verdict(summarizeFrameTimes(steady(16, 400)), ctx({ seconds: 10 }));
    expect(v.eventGate).toBe(false);
    expect(v.reasons.join('|')).toContain('shorter than');
  });

  it('a vsynced 16.7 ms p50 counts as 60 fps (rounded)', () => {
    expect(verdict(summarizeFrameTimes(steady(16.7)), ctx()).meetsTarget).toBe(true);
  });

  it('25 ms meets the floor only', () => {
    const v = verdict(summarizeFrameTimes(steady(25)), ctx());
    expect(v.meetsFloor30).toBe(true);
    expect(v.meetsTarget).toBe(false);
  });

  it('Low has a 30 fps target', () => {
    const v = verdict(summarizeFrameTimes(steady(33)), ctx({ tierStart: 'low', tierEnd: 'low' }));
    expect(v.targetFps).toBe(30);
    expect(v.meetsTarget).toBe(true);
  });

  it('an empty run fails both with "too few samples"', () => {
    const v = verdict(summarizeFrameTimes([]), ctx({ viewerFrames: 0 }));
    expect(v.meetsFloor30).toBe(false);
    expect(v.meetsTarget).toBe(false);
    expect(v.eventGate).toBe(false);
    expect(v.reasons.join('|')).toContain('too few samples');
  });

  it('a stall fails both', () => {
    const v = verdict(summarizeFrameTimes([...steady(16, 400), 300]), ctx());
    expect(v.meetsFloor30).toBe(false);
    expect(v.meetsTarget).toBe(false);
    expect(v.reasons.join('|')).toContain('stall');
  });

  it('any drop fails both', () => {
    const v = verdict(summarizeFrameTimes(steady(16)), ctx({ dropsAbsolute: 1 }));
    expect(v.meetsFloor30).toBe(false);
    expect(v.meetsTarget).toBe(false);
  });

  it('start medium, end low is judged against 60 and fails', () => {
    const v = verdict(summarizeFrameTimes(steady(33)), ctx({ tierEnd: 'low', dropsAbsolute: 1 }));
    expect(v.targetFps).toBe(60);
    expect(v.meetsTarget).toBe(false);
    expect(v.meetsFloor30).toBe(false);
  });

  it('WebGL2 or a Low start is not the event configuration', () => {
    const webgl = verdict(summarizeFrameTimes(steady(16)), ctx({ backend: 'webgl2' }));
    expect(webgl.eventGate).toBe(false);
    expect(webgl.reasons.join('|')).toContain('not the event configuration');
    const low = verdict(summarizeFrameTimes(steady(16)), ctx({ tierStart: 'low' }));
    expect(low.eventGate).toBe(false);
    expect(low.reasons.join('|')).toContain('not the event configuration');
  });

  it('a viewer that drew fewer frames than were sampled fails', () => {
    const v = verdict(summarizeFrameTimes(steady(16)), ctx({ viewerFrames: 100 }));
    expect(v.meetsFloor30).toBe(false);
    expect(v.reasons.join('|')).toContain('viewer not drawing every frame');
  });

  it('viewer frames above the sample count are allowed (on-change draws)', () => {
    expect(verdict(summarizeFrameTimes(steady(16)), ctx({ viewerFrames: 900 })).meetsTarget).toBe(
      true,
    );
  });
});
