// §8.5 overlay geometry (issue #117): counts, determinism, lean, the near plane, the drawn deck and strike classes.
import { describe, expect, it } from 'vitest';
import { projectFly } from '@/engine/worlds/WorldEngine';
import type { Strike } from './types';
import {
  boltPolyline, buildRain, buildSnow, classifyStrike, clipSegmentNear, deckRadius, depthOf, edgeSide, particleCount,
  projectPx, rainLean, smallAreaLimitPx2, streakLengthPx, strikeWorld, tintCss,
} from './weatherDraw';
import { makeBasis } from './weatherDraw.testutil';
import { NEAR_KM } from './tuning';

const W = 800, H = 500;
const strike = (bearing: number, d_m: number, seed = 9): Strike => ({ t0: 1, d_m, bearing, seed, variant: 2, flash: true });

describe('counts and determinism', () => {
  it('N = round(max * density), capped at 600 rain and 400 snow', () => {
    expect(particleCount(0.5, false)).toBe(300);
    expect(particleCount(1, false)).toBe(600);
    expect(particleCount(3, false)).toBe(600);
    expect(particleCount(1, true)).toBe(400);
    expect(particleCount(Number.NaN, false)).toBe(0);
  });

  it('same seed and frame bucket give byte-identical rain; another bucket differs', () => {
    const a = new Float32Array(2400), b = new Float32Array(2400), c = new Float32Array(2400);
    buildRain(a, 600, 42, 1000, W, H, 400, 9.2, 0.1);
    buildRain(b, 600, 42, 1000, W, H, 400, 9.2, 0.1);
    buildRain(c, 600, 42, 1001, W, H, 400, 9.2, 0.1);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    expect(Buffer.from(a.buffer).equals(Buffer.from(c.buffer))).toBe(false);
    const s1 = new Float32Array(1200), s2 = new Float32Array(1200);
    expect(buildSnow(s1, 400, 3, 2.5, W, H, 400, 1)).toEqual([100, 140, 160]);
    buildSnow(s2, 400, 3, 2.5, W, H, 400, 1);
    expect(Buffer.from(s1.buffer).equals(Buffer.from(s2.buffer))).toBe(true);
  });

  it('the bolt polyline is deterministic per seed and runs from top to foot', () => {
    const a = boltPolyline(5, 100, 50, 120, 400);
    const b = boltPolyline(5, 100, 50, 120, 400);
    expect(a.map((l) => Array.from(l))).toEqual(b.map((l) => Array.from(l)));
    expect(a[0]!.length).toBe(18); // 2^3 + 1 vertices
    expect(a.length === 2 || a.length === 3).toBe(true);
    expect([a[0]![0], a[0]![1]]).toEqual([100, 50]);
    expect([a[0]![16], a[0]![17]]).toEqual([120, 400]);
    expect(boltPolyline(5, Number.NaN, 0, 1, 1)).toEqual([]);
  });
});

describe('rain look', () => {
  it('red M8: wind from the north, facing east: the streak bottom moves right; into the wind: vertical', () => {
    const lean = rainLean(0, 5, Math.PI / 2, 9.2);
    expect(lean).toBeGreaterThan(0);
    expect(lean).toBeCloseTo(Math.atan(5 / 9.2), 9);
    expect(Math.abs(rainLean(0, 5, 0, 9.2))).toBeLessThan(1e-9);
    expect(rainLean(null, 5, 0, 9.2)).toBe(0);
  });

  it('streak length follows v_t only (Titan about v_t ratio of Earth)', () => {
    expect(streakLengthPx(1.6, 400, 0) / streakLengthPx(9.2, 400, 0)).toBeCloseTo(1.6 / 9.2, 9);
    expect(streakLengthPx(9.2, 400, 2)).toBeCloseTo(streakLengthPx(9.2, 400, 0) * 0.35, 9);
  });

  it('red M1: the 0..1 tint becomes a visible CSS colour', () => {
    expect(tintCss([0.55, 0.55, 0.57], 0.5)).toBe('rgba(140,140,145,0.500)');
    expect(tintCss([2, -1, Number.NaN], 9)).toBe('rgba(255,0,0,1.000)');
  });
});

describe('projection and the near plane (H2)', () => {
  it('projectPx matches WorldEngine.projectFly', () => {
    const b = makeBasis({ head: 0.3, pitch: -0.2, altKm: 2 });
    const p: [number, number, number] = [b.cam[0] + b.fwd[0] * 0.002 + b.rt[0] * 0.0005, b.cam[1] + b.fwd[1] * 0.002 + b.rt[1] * 0.0005, b.cam[2] + b.fwd[2] * 0.002 + b.rt[2] * 0.0005];
    const m = (v: readonly number[]) => [v[0]!, v[1]!, v[2]!] as [number, number, number];
    const f = projectFly({ cam: m(b.cam), fwd: m(b.fwd), rt: m(b.rt), up: m(b.up), fov: b.fov }, W / H, p);
    const px = projectPx(b, W, H, p)!;
    expect(px[0]).toBeCloseTo(((f.x + 1) / 2) * W, 6);
    expect(px[1]).toBeCloseTo(((1 - f.y) / 2) * H, 6);
  });

  it('points behind and just in front of the camera: clipped, never NaN', () => {
    const b = makeBasis({ altKm: 1 });
    const behind: [number, number, number] = [b.cam[0] - b.fwd[0] * 0.01, b.cam[1] - b.fwd[1] * 0.01, b.cam[2] - b.fwd[2] * 0.01];
    const front: [number, number, number] = [b.cam[0] + b.fwd[0] * 0.01, b.cam[1] + b.fwd[1] * 0.01, b.cam[2] + b.fwd[2] * 0.01];
    const eps = (NEAR_KM / b.rkm) * 0.5;
    const justIn: [number, number, number] = [b.cam[0] + b.fwd[0] * eps, b.cam[1] + b.fwd[1] * eps, b.cam[2] + b.fwd[2] * eps];
    expect(projectPx(b, W, H, behind)).toBeNull();
    expect(projectPx(b, W, H, justIn)).toBeNull();
    expect(clipSegmentNear(b, behind, justIn)).toBeNull();
    const seg = clipSegmentNear(b, behind, front)!;
    expect(depthOf(b, seg[0])).toBeCloseTo(NEAR_KM / b.rkm, 12);
    const p = projectPx(b, W, H, seg[0])!;
    expect(p.every(Number.isFinite)).toBe(true);
  });

  it('a strike right under the camera (s = 0), camera pitched down 60 degrees: no throw, finite or null', () => {
    const b = makeBasis({ altKm: 2, pitch: -1.05 });
    const w = strikeWorld(strike(0, 2000), 0, 0, 2, b, 1, () => 0)!;
    expect(w).not.toBeNull();
    const cls = classifyStrike(b, W, H, w, false, false);
    expect(['inView', 'edge']).toContain(cls);
    const seg = clipSegmentNear(b, w.top, w.foot);
    if (seg) for (const q of seg) {
      const p = projectPx(b, W, H, q);
      if (p) expect(p.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('the drawn deck (H3) and strike classes', () => {
  it('deck radius is 1 + max(zc, 0.3) ex / rkm from the datum', () => {
    expect(deckRadius(2, 3, 6371)).toBeCloseTo(1 + 6 / 6371, 12);
    expect(deckRadius(0.1, 3, 6371)).toBeCloseTo(1 + 0.9 / 6371, 12);
    expect(deckRadius(null, 3, 6371)).toBeCloseTo(1 + 10.5 / 6371, 12);
  });

  it('a strike ahead is in view, top above foot; one behind is an edge glow on the right side', () => {
    const b = makeBasis({ head: 0, altKm: 0.5 });
    const ahead = strikeWorld(strike(0, 8000), 0, 0, 0.5, b, 1.5, () => 0)!;
    expect(classifyStrike(b, W, H, ahead, false, false)).toBe('inView');
    const top = projectPx(b, W, H, ahead.top)!, foot = projectPx(b, W, H, ahead.foot)!;
    expect(top[1]).toBeLessThan(foot[1]);
    const right = strikeWorld(strike(2.2, 8000), 0, 0, 0.5, b, 1.5, () => 0)!;
    expect(classifyStrike(b, W, H, right, false, false)).toBe('edge');
    expect(edgeSide(2.2, 0)).toBe(1);
    expect(edgeSide(-2.2, 0)).toBe(-1);
  });

  it('above the drawn deck, or on a gas giant: the deck class', () => {
    const b = makeBasis({ altKm: 0.5 });
    const w = strikeWorld(strike(0, 8000), 0, 0, 0.5, b, 1.5, () => 0)!;
    expect(classifyStrike(b, W, H, w, true, false)).toBe('deck');
    expect(classifyStrike(b, W, H, w, false, true)).toBe('deck');
  });

  it('H4: the small-area limit is 21 824 px2 at 1024 x 768 and scales with the pane', () => {
    expect(smallAreaLimitPx2(1024, 768)).toBeCloseTo(21824, 6);
    expect(smallAreaLimitPx2(512, 768)).toBeCloseTo(10912, 6);
  });
});
