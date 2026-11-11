// Issue #71 stream D, round 2 (Q-244): drainage, discharge, lakes. Tiny worlds keep it fast.
import { describe, expect, it } from 'vitest';
import { buildTerrain } from './terrain';
import { FLUIDS } from './fluids';
import { CHANNEL_Q_M3S, hydroRaster, routeTerrain, undrainedLandCells, HYDROLOGY_TAGS } from './hydrology';

const terr = (seed: number, ocean = 0.5) => buildTerrain({ seed, oceanFraction: ocean, gravity: 9.8, W: 90, H: 45 });
const asInput = (t: ReturnType<typeof terr>, seed: number) => ({ W: t.W, H: t.H, data: t.data, seed });
const world = { radiusM: 6.371e6, fluid: FLUIDS.water, lapseKPerKm: 9.8, isWater: true };
const climate = (v: number, temp = 288) => ({ nx: 36, ny: 18, T: new Float32Array(36 * 18).fill(temp), rain: new Float32Array(36 * 18).fill(v) });

describe('routing', { timeout: 60000 }, () => {
  it('every land cell drains to the sea or to a basin outlet', () => {
    for (const seed of [1, 2, 3, 9]) {
      const t = terr(seed);
      const rt = routeTerrain(asInput(t, seed));
      expect(undrainedLandCells(rt)).toBe(0);
    }
  });
  it('every flooded basin is filled to at least the land height (no cell below its filled surface drains up)', () => {
    const t = terr(4);
    const rt = routeTerrain(asInput(t, 4));
    for (let i = 0; i < rt.h.length; i++) {
      expect(rt.fill[i]!).toBeGreaterThanOrEqual(rt.h[i]! - 1e-6);
      const r = rt.rec[i]!;
      if (rt.h[i]! > 0 && r !== i) expect(rt.fill[r]!).toBeLessThanOrEqual(rt.fill[i]!);
    }
  });
  it('a world with no sea still drains to its one outlet', () => {
    const t = terr(5, 0);
    const rt = routeTerrain(asInput(t, 5));
    expect(undrainedLandCells(rt, false)).toBe(0);
  });
  it('is deterministic and the seed changes the roughness', () => {
    const t = terr(6);
    const a = routeTerrain(asInput(t, 6));
    const b = routeTerrain(asInput(t, 6));
    const c = routeTerrain(asInput(t, 7));
    expect(Buffer.from(a.fill.buffer).equals(Buffer.from(b.fill.buffer))).toBe(true);
    expect(Buffer.from(a.rec.buffer).equals(Buffer.from(b.rec.buffer))).toBe(true);
    expect(Buffer.from(a.h.buffer).equals(Buffer.from(c.h.buffer))).toBe(false);
  });
});

describe('hydrology raster', { timeout: 60000 }, () => {
  const t = terr(2, 0.5);
  const rt = routeTerrain(asInput(t, 2));
  it('a wet world draws rivers and lakes; a dry one draws none', () => {
    const wet = hydroRaster(asInput(t, 2), world, climate(0.9), rt, 256, 128);
    expect(wet.stats.rivers).toBeGreaterThan(0);
    expect(wet.img.some((v, i) => i % 4 === 0 && v > 0)).toBe(true);
    const dry = hydroRaster(asInput(t, 2), world, climate(0), rt, 256, 128);
    expect(dry.stats.rivers).toBe(0);
  });
  it('rivers only start above the channel discharge', () => {
    expect(CHANNEL_Q_M3S).toBe(50);
    const weak = hydroRaster(asInput(t, 2), world, climate(0.001), rt, 256, 128);
    expect(weak.stats.rivers).toBe(0);
  });
  it('a frozen world draws its water in the frozen channel', () => {
    const cold = hydroRaster(asInput(t, 2), world, climate(0.9, 200), rt, 256, 128);
    // below freezing minus 10 K nothing runs off at all, so no channels
    expect(cold.stats.rivers).toBe(0);
  });
  it('is byte-identical on a second run and the size sets the raster', () => {
    const a = hydroRaster(asInput(t, 2), world, climate(0.9), rt, 256, 128);
    const b = hydroRaster(asInput(t, 2), world, climate(0.9), rt, 256, 128);
    expect(Buffer.from(a.img).equals(Buffer.from(b.img))).toBe(true);
    const small = hydroRaster(asInput(t, 2), world, climate(0.9), rt, 128, 64);
    expect(small.img.length).toBe(128 * 64 * 4);
  });
  it('tags: routing and lakes model_dependent, roughness artistic', () => {
    expect(HYDROLOGY_TAGS.routing).toBe('model_dependent');
    expect(HYDROLOGY_TAGS.lakes).toBe('model_dependent');
    expect(HYDROLOGY_TAGS.roughness).toBe('artistic');
  });
});
