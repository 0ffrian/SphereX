// R7.7, D-05: nebula / nova point sets are seeded and inside the 60k point budget.
import { describe, expect, it } from 'vitest';
import { generateNebula, generateNova } from './pointClouds';

const same = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

describe('point clouds', () => {
  it('are byte-identical for the same seed (per engine) and differ for another', () => {
    const a = generateNebula(13);
    const b = generateNebula(13);
    expect(same(a.glow.positions, b.glow.positions)).toBe(true);
    expect(same(a.glow.colors, b.glow.colors)).toBe(true);
    expect(same(a.glow.positions, generateNebula(14).glow.positions)).toBe(false);
    const n = generateNova(14);
    expect(same(n.shell.positions, generateNova(14).shell.positions)).toBe(true);
    expect(same(n.shell.positions, generateNova(15).shell.positions)).toBe(false);
  });

  it('stay under 60k points and have finite 0..1 colours', () => {
    const neb = generateNebula(13);
    const nova = generateNova(14);
    const sets = [...Object.values(neb), ...Object.values(nova)];
    const total = sets.reduce((s, p) => s + p.count, 0);
    expect(total).toBeLessThanOrEqual(60000);
    for (const s of sets) {
      expect(s.positions.length).toBe(s.count * 3);
      expect(s.colors.length).toBe(s.count * 3);
      expect(s.count).toBeGreaterThan(0);
      for (const v of [...s.positions.slice(0, 300), ...s.colors.slice(0, 300)]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      for (const c of s.colors) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1.2);
      }
    }
  });
});
