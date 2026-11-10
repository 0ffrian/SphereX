// Issue #71 stream D (Q-242): plate tectonics terrain. Small grids keep the tests fast.
import { describe, expect, it } from 'vitest';
import { buildTerrain, oceanAreaShare, terrainHash } from './terrain';

const small = { W: 180, H: 90 };

describe('terrain', () => {
  it('is deterministic: the same options give byte-identical data', () => {
    const a = buildTerrain({ seed: 11, oceanFraction: 0.6, gravity: 9.8, ...small });
    const b = buildTerrain({ seed: 11, oceanFraction: 0.6, gravity: 9.8, ...small });
    expect(terrainHash(a)).toBe(terrainHash(b));
    expect(Array.from(a.data.slice(0, 64))).toEqual(Array.from(b.data.slice(0, 64)));
  });

  it('a different seed gives a different world', () => {
    const a = buildTerrain({ seed: 11, oceanFraction: 0.6, gravity: 9.8, ...small });
    const c = buildTerrain({ seed: 12, oceanFraction: 0.6, gravity: 9.8, ...small });
    expect(terrainHash(a)).not.toBe(terrainHash(c));
  });

  it('sea level puts the wanted share of the area under water', () => {
    for (const f of [0.3, 0.6, 0.71]) {
      const t = buildTerrain({ seed: 5, oceanFraction: f, gravity: 9.8, ...small });
      expect(oceanAreaShare(t)).toBeGreaterThan(f - 0.08);
      expect(oceanAreaShare(t)).toBeLessThan(f + 0.08);
    }
  });

  it('a dry world has no ocean and a water world (share 1) is all ocean', () => {
    const dry = buildTerrain({ seed: 5, oceanFraction: 0, gravity: 9.8, ...small });
    expect(oceanAreaShare(dry)).toBeLessThan(0.01);
    const wet = buildTerrain({ seed: 5, oceanFraction: 1, gravity: 9.8, ...small });
    expect(oceanAreaShare(wet)).toBeGreaterThan(0.97);
  });

  it('mountains are taller under lower gravity (h ~ 1/g, Weisskopf 1975)', () => {
    const tall = (g: number) => {
      const t = buildTerrain({ seed: 5, oceanFraction: 0.6, gravity: g, ...small });
      let m = -Infinity;
      for (let i = 0; i < t.data.length; i += 2) m = Math.max(m, t.data[i]!);
      return m;
    };
    expect(tall(4)).toBeGreaterThan(tall(20));
  });

  it('the deep ocean floor is cooler-older-deeper than the ridge: ocean heights span trenches and shelves', () => {
    const t = buildTerrain({ seed: 5, oceanFraction: 0.7, gravity: 9.8, ...small });
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < t.data.length; i += 2) {
      lo = Math.min(lo, t.data[i]!);
      hi = Math.max(hi, t.data[i]!);
    }
    expect(lo).toBeLessThan(-3);
    expect(hi).toBeGreaterThan(1);
  });

  it('rivers do not leave one-cell spikes: no east-west neighbour jump above the tectonic relief', () => {
    const t = buildTerrain({ seed: 7, oceanFraction: 0.6, gravity: 9.8, ...small });
    let worst = 0;
    for (let j = 0; j < t.H; j++) {
      for (let i = 0; i < t.W; i++) {
        const a = t.data[(j * t.W + i) * 2]!;
        const b = t.data[(j * t.W + ((i + 1) % t.W)) * 2]!;
        worst = Math.max(worst, Math.abs(a - b));
      }
    }
    // Collision ranges (5.5 km x gravity factor up to 2.5) rise over a few 2-degree cells; a needle
    // spike from a runaway river solve would exceed the whole model range (20 km).
    expect(worst).toBeLessThan(18);
  });

  it('samplers wrap in longitude and clamp in latitude', () => {
    const t = buildTerrain({ seed: 5, oceanFraction: 0.6, gravity: 9.8, ...small });
    expect(t.heightAt(Math.PI - 1e-6, 0.3)).toBeCloseTo(t.heightAt(-Math.PI - 1e-6 + 2 * Math.PI, 0.3), 4);
    expect(Number.isFinite(t.heightAt(0, Math.PI / 2))).toBe(true);
    expect(Number.isFinite(t.boundaryAt(0, -Math.PI / 2))).toBe(true);
  });
});
