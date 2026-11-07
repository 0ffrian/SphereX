import { describe, expect, it } from 'vitest';
import {
  FrameGovernor,
  initialTier,
  lowerTier,
  minFrameIntervalMs,
  qualityFromSearch,
  SLOW_FRAME_MS,
  SLOW_WINDOW_MS,
  TIERS,
} from './quality';

describe('quality tiers (R5.7)', () => {
  it('match the R5.7 table', () => {
    expect(TIERS.high).toMatchObject({
      octaves: 6,
      volumeSteps: 96,
      bloomScale: 1,
      aa: 'taau',
      targetFps: 60,
    });
    expect(TIERS.medium).toMatchObject({
      octaves: 5,
      volumeSteps: 64,
      bloomScale: 0.5,
      aa: 'taau',
      targetFps: 60,
    });
    expect(TIERS.low).toMatchObject({
      octaves: 4,
      volumeSteps: 40,
      bloomScale: 0.5,
      aa: 'smaa',
      targetFps: 30,
    });
  });
  it('lowerTier steps down and stops at low', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });
});

describe('initialTier', () => {
  it('webgl2 or a coarse pointer starts low', () => {
    expect(initialTier({ backend: 'webgl2', coarsePointer: false })).toBe('low');
    expect(initialTier({ backend: 'webgpu', coarsePointer: true })).toBe('low');
  });
  it('desktop webgpu starts medium (high is never guessed)', () => {
    expect(initialTier({ backend: 'webgpu', coarsePointer: false })).toBe('medium');
  });
});

describe('FrameGovernor', () => {
  const run = (g: FrameGovernor, ms: number, from: number, to: number, step = 40) => {
    for (let t = from; t <= to; t += step) {
      const e = g.feed(ms, t);
      if (e) return e;
    }
    return null;
  };

  it('does not drop for slow frames shorter than two seconds', () => {
    const g = new FrameGovernor('high');
    expect(run(g, 50, 0, SLOW_WINDOW_MS - 1)).toBeNull();
  });

  it('drops one tier after two seconds of slow frames, and reports it', () => {
    const g = new FrameGovernor('high');
    const e = run(g, SLOW_FRAME_MS + 1, 0, 3000);
    expect(e).toEqual({ kind: 'drop', from: 'high', to: 'medium' });
    expect(g.tier).toBe('medium');
  });

  it('one fast frame resets the streak', () => {
    const g = new FrameGovernor('high');
    expect(run(g, 50, 0, 1800)).toBeNull();
    expect(g.feed(16, 1840)).toBeNull();
    expect(run(g, 50, 1880, 3800)).toBeNull();
  });

  it('a gap in feeding (not continuous rendering) resets the streak', () => {
    const g = new FrameGovernor('high');
    g.feed(50, 0);
    g.feed(50, 1000);
    expect(g.feed(50, 5000)).toBeNull();
  });

  it('never raises and never drops below low', () => {
    const g = new FrameGovernor('low');
    expect(run(g, 80, 0, 10_000)).toBeNull();
    expect(g.tier).toBe('low');
    const fast = new FrameGovernor('medium');
    run(fast, 5, 0, 10_000);
    expect(fast.tier).toBe('medium');
  });

  it('drops once per two seconds, stepping down', () => {
    const g = new FrameGovernor('high');
    expect(run(g, 60, 0, 3000)?.to).toBe('medium');
    expect(run(g, 60, 3040, 6000)?.to).toBe('low');
  });
});

describe('FrameGovernor at a steady 30 fps', () => {
  it('medium drops to low: 33.3 ms misses the 60 fps target (R5.7)', () => {
    const g = new FrameGovernor('medium');
    let drop = null;
    for (let t = 0; t <= 5000; t += 1000 / 30) drop = drop ?? g.feed(1000 / 30, t);
    expect(drop?.to).toBe('low');
  });

  it('low is the floor and does not report a drop', () => {
    const g = new FrameGovernor('low');
    let drop = null;
    for (let t = 0; t <= 5000; t += 1000 / 30) drop = drop ?? g.feed(1000 / 30, t);
    expect(drop).toBeNull();
  });
});

describe('qualityFromSearch and minFrameIntervalMs', () => {
  it('reads ?quality= and ignores anything else', () => {
    expect(qualityFromSearch('?quality=high')).toBe('high');
    expect(qualityFromSearch('?a=1&quality=low')).toBe('low');
    expect(qualityFromSearch('?quality=ultra')).toBeNull();
    expect(qualityFromSearch('')).toBeNull();
  });

  it('caps the low quality tier at 30 fps and leaves 60 fps tiers at the display rate', () => {
    expect(minFrameIntervalMs('low')).toBeCloseTo(1000 / 30 - 2);
    expect(minFrameIntervalMs('medium')).toBeLessThan(1000 / 60);
  });
});
