import { describe, expect, it } from 'vitest';
import {
  FrameGovernor,
  initialTier,
  lowerTier,
  capIntervalMs,
  FrameCap,
  PHONE_FPS_CAP,
  qualityFromSearch,
  SLOW_FRAME_MS,
  SLOW_WINDOW_MS,
  TIERS,
} from './quality';

describe('quality levels (R5.7)', () => {
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

describe('qualityFromSearch and capIntervalMs', () => {
  it('reads ?quality= and ignores anything else', () => {
    expect(qualityFromSearch('?quality=high')).toBe('high');
    expect(qualityFromSearch('?a=1&quality=low')).toBe('low');
    expect(qualityFromSearch('?quality=ultra')).toBeNull();
    expect(qualityFromSearch('')).toBeNull();
  });

  it('caps only the low quality level on a coarse pointer (phones)', () => {
    expect(capIntervalMs('low', true)).toBeCloseTo(1000 / PHONE_FPS_CAP);
    expect(capIntervalMs('low', false)).toBeNull();
    expect(capIntervalMs('medium', true)).toBeNull();
    expect(capIntervalMs('high', false)).toBeNull();
  });
});

describe('FrameCap', () => {
  /** Drawn frames in `seconds` of animation frames at `hz`. */
  function drawn(cap: FrameCap, hz: number, seconds = 10): number {
    let n = 0;
    for (let i = 0; i < hz * seconds; i++) if (cap.shouldDraw((i * 1000) / hz)) n++;
    return n / seconds;
  }

  it.each([60, 75, 90, 120, 144, 165])('averages 30 fps at %i Hz', (hz) => {
    const fps = drawn(new FrameCap(1000 / 30), hz);
    expect(fps).toBeGreaterThanOrEqual(29.5);
    expect(fps).toBeLessThanOrEqual(30.5);
  });

  it.each([60, 75, 90, 144])('draws every frame at %i Hz when uncapped', (hz) => {
    expect(drawn(new FrameCap(null), hz)).toBe(hz);
  });

  it('a 30 Hz display (energy saver) draws every frame under a 30 fps cap', () => {
    expect(drawn(new FrameCap(1000 / 30), 30)).toBe(30);
  });

  it('restarts after a stall instead of drawing a burst to catch up', () => {
    const cap = new FrameCap(1000 / 30);
    expect(cap.shouldDraw(0)).toBe(true);
    expect(cap.shouldDraw(5000)).toBe(true);
    expect(cap.shouldDraw(5000 + 1000 / 60)).toBe(false);
  });
});
