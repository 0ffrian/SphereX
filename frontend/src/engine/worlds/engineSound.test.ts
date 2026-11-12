// Issue #114 (sound spec §3.3): the read-only accessors the ambience uses, on a headless engine (WebGL stub).
import { describe, expect, it } from 'vitest';
import { FLY_FOV, projectFly, WorldEngine } from './WorldEngine';
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
    // the engine's own drift (core.js cloudStep): lon + (W.step - born) * drift, wrapped with 6.2832
    const drawn = (c: { lon: number; born: number; drift: number }) => {
      const lon = c.lon + (core.W.step - c.born) * c.drift;
      return ((((lon + Math.PI) % 6.2832) + 6.2832) % 6.2832) - Math.PI;
    };
    core.W.step = 1150;
    const raw = [
      { lon: 0.1, lat: 0.2, r: 0.06, s: 1, born: 1000, drift: -0.0009 },
      { lon: -3.1, lat: -0.3, r: 0.07, s: -1, born: 1100, drift: -0.0009 },
    ];
    core.EB.cyc = raw;
    const c = e.weatherFields()!.cyclones;
    expect(c).toHaveLength(2);
    expect(c[0]!.lon).toBeCloseTo(drawn(raw[0]!), 12);
    expect(c[0]!.lon).toBeCloseTo(0.1 - 150 * 0.0009, 12);
    expect(c[1]!.lon).toBeCloseTo(drawn(raw[1]!), 12); // wrapped across -pi
    expect(c[1]!.lon).toBeGreaterThan(3);
    expect(c[0]).toEqual({ lon: c[0]!.lon, lat: 0.2, r: 0.06, s: 1 });
    core.EB.cyc = Array.from({ length: 14 }, (_, i) => ({ ...raw[0]!, lat: i * 0.01 }));
    expect(e.weatherFields()!.cyclones).toHaveLength(12); // cloudStep draws the first 12
    expect(e.gasField()).toBeNull();
  });

  it('reads the EB arrays on every call: a swapped EB.out2 or EB.out is what the next call returns', () => {
    e.setPreset('earth');
    const before = e.weatherFields()!;
    const out2 = new Float32Array(before.out2.length).fill(0.25);
    const out = new Float32Array(before.out.length).fill(280);
    const [o2, o1] = [core.EB.out2, core.EB.out];
    core.EB.out2 = out2;
    core.EB.out = out;
    try {
      const after = e.weatherFields()!;
      expect(after.out2).toBe(out2);
      expect(after.out).toBe(out);
      expect(after.out2[0]).toBe(0.25);
    } finally {
      core.EB.out2 = o2;
      core.EB.out = o1;
    }
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

  it('projectFly inverts the fly shader ray (rd = fwd + q.x fov rt + q.y fov up) on the engine basis', () => {
    e.setPreset('earth');
    e.setFlyPlace(0.4, 0.2);
    const b = e.flyCameraBasis()!;
    const aspect = 1.6;
    for (const [qx, qy, t] of [
      [0, 0, 0.01],
      [1.6, 1, 0.003],
      [-0.8, -0.5, 0.02],
      [0.3, 0.9, 0.5],
    ] as const) {
      const rd = [0, 1, 2].map((k) => b.fwd[k]! + qx * b.fov * b.rt[k]! + qy * b.fov * b.up[k]!);
      const p = [0, 1, 2].map((k) => b.cam[k]! + rd[k]! * t) as [number, number, number];
      const r = projectFly(b, aspect, p);
      expect(r.inFront).toBe(true);
      expect(r.x).toBeCloseTo(qx / aspect, 9);
      expect(r.y).toBeCloseTo(qy, 9);
    }
    // cam + fwd + 0.62 up is the top edge
    const top = [0, 1, 2].map((k) => b.cam[k]! + b.fwd[k]! + 0.62 * b.up[k]!) as [
      number,
      number,
      number,
    ];
    expect(projectFly(b, aspect, top).y).toBeCloseTo(1, 12);
    const behind = [0, 1, 2].map((k) => b.cam[k]! - b.fwd[k]!) as [number, number, number];
    expect(projectFly(b, aspect, behind).inFront).toBe(false);
  });
});
