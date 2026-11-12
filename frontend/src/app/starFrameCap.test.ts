// Issue #93 W1 (render notes 0.2, star host only): the star engine's 60 Hz cap must not fight the prototype's own
// resolution scalers, which shrink the picture above an average frame time of 42 ms (surface) or 36 ms (plasma) and
// only grow it again below 19 ms and 20 ms. This replays animation frames of common panels through the stage's cap
// and the scalers' own averages (protoStar1.js StarGL.draw, protoStar4.js frame).
import { describe, expect, it } from 'vitest';
import { FrameCap } from '@/viewer/render/quality';
import { STAR_FPS_CAP } from './StarEngineStage';

function replay(displayHz: number, seconds = 10) {
  const cap = new FrameCap(STAR_FPS_CAP ? 1000 / STAR_FPS_CAP : null);
  const step = 1000 / displayHz;
  let last: number | null = null;
  let ema = 16; // StarGL: ema * 0.92 + interval * 0.08
  let plEma = 16; // protoStar4 frame: PL.ema * 0.93 + dt * 70 (dt in s)
  let maxEma = 0;
  let maxPl = 0;
  let drawn = 0;
  for (let now = step; now < seconds * 1000; now += step) {
    if (!cap.shouldDraw(now)) continue;
    drawn++;
    if (last !== null) {
      const dt = now - last;
      ema = ema * 0.92 + dt * 0.08;
      plEma = plEma * 0.93 + Math.min(0.06, dt / 1000) * 70;
      if (now > 1000) {
        maxEma = Math.max(maxEma, ema);
        maxPl = Math.max(maxPl, plEma);
      }
    }
    last = now;
  }
  return { fps: drawn / seconds, maxEma, maxPl };
}

describe('the star engine frame cap (issue #93 W1)', () => {
  it('is 60 a second', () => {
    expect(STAR_FPS_CAP).toBe(60);
  });
  for (const hz of [60, 75, 100, 120, 144, 165, 240]) {
    it(`on a ${hz} Hz panel: about 60 frames a second at most, and both scalers stay in their "grow" range`, () => {
      const r = replay(hz);
      expect(r.fps).toBeLessThanOrEqual(Math.min(hz, 61) + 0.5);
      // Never near 53 a second (Moon's limit), where the surface scaler would stop growing.
      expect(r.fps).toBeGreaterThan(Math.min(hz, 55));
      expect(r.maxEma).toBeLessThan(19);
      expect(r.maxPl).toBeLessThan(20);
    });
  }
});
