// Issue #114 (sound spec §3.3): the read-only accessors the ambience uses, on a headless engine (WebGL stub).
import { describe, expect, it } from 'vitest';
import { FLY_FOV, WorldEngine } from './WorldEngine';
import { stubCanvas, stubGL } from './glStub.testutil';
import type { WorldEngineLike } from '@/sound/ambience/types';

// Compile-time check: WorldEngine is the engine surface the ambience reads (Appendix B).
const asLike = (e: WorldEngine): WorldEngineLike => e;

describe('WorldEngine sound accessors', () => {
  const e = new WorldEngine(stubCanvas(stubGL().gl), { role: 'globe' });
  const core = (
    e as unknown as { core: { EB: any; W: any; groundKm(lo: number, la: number): number } }
  ).core;

  it('rocky world: weather arrays are the energy budget arrays, cyclones are copied; no gas field', () => {
    e.setPreset('earth');
    expect(asLike(e)).toBe(e);
    expect(core.EB.ready).toBe(true); // setPreset runs ebInit
    const w = e.weatherFields();
    expect(w).not.toBeNull();
    expect(w!.NX * w!.NY * 4).toBe(w!.out.length);
    expect(w!.iceH).toBe(core.EB.h);
    expect(w!.snow).toBe(core.EB.s);
    expect(w!.out2).toBe(core.EB.out2);
    core.EB.cyc = [{ lon: 0.1, lat: 0.2, r: 0.06, s: 1, born: 3, drift: -0.0009 }];
    const c = e.weatherFields()!.cyclones;
    expect(c).toEqual([{ lon: 0.1, lat: 0.2, r: 0.06, s: 1 }]);
    expect(c).not.toBe(core.EB.cyc);
    expect(e.gasField()).toBeNull();
  });

  it('groundKm is core.groundKm (raw cell, clamped at sea level on ocean worlds)', () => {
    e.setPreset('earth');
    for (const [lo, la] of [
      [0, 0],
      [1.2, -0.4],
      [-3.1, 1.5],
    ] as const)
      expect(e.groundKm(lo, la)).toBe(core.groundKm(lo, la));
    expect(e.groundKm(0.3, 0.3)).toBeGreaterThanOrEqual(0);
  });

  it('flyCameraBasis: an orthonormal basis, fov 0.62, ex 3 on a rocky world', () => {
    e.setPreset('earth');
    e.setFlyPlace(0.4, 0.2);
    const b = e.flyCameraBasis()!;
    const dot = (a: number[], c: number[]) => a[0]! * c[0]! + a[1]! * c[1]! + a[2]! * c[2]!;
    expect(b.fov).toBe(FLY_FOV);
    expect(b.ex).toBe(3);
    for (const v of [b.fwd, b.rt, b.up]) expect(dot(v, v)).toBeCloseTo(1, 9);
    expect(dot(b.fwd, b.rt)).toBeCloseTo(0, 9);
    expect(dot(b.rt, b.up)).toBeCloseTo(0, 9);
    expect(Math.hypot(...b.cam)).toBeGreaterThan(1);
  });

  it('gas giant: the gas field is 256 x 128 x 4; the previous rocky weather is not returned', () => {
    e.setPreset('jup');
    const f = e.gasField();
    expect(f).toBeInstanceOf(Float32Array);
    expect(f!.length).toBe(256 * 128 * 4);
    expect(e.weatherFields()).toBeNull();
    expect(e.flyCameraBasis()!.ex).toBe(2);
  });
});
