import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { ARTIFACT_PRESET_BY_ID, cardToRock, classFamily, rockSeed } from './cardToRock';
import { radialHeights } from './meshRadial';

const tv = (value: unknown, tag = 'measured') => ({ value, tag }) as never;
const card = (o: Partial<Record<string, unknown>>): ObjectCard =>
  ({ id: 'x:1', name: 'X', type: 'asteroid_procedural', ...o }) as unknown as ObjectCard;

describe('cardToRock', () => {
  it('refuses without a size (D-32: the three.js body is kept)', () => {
    const r = cardToRock(card({}), { seed: 1 });
    expect('refused' in r && r.missing).toEqual(['diameter_km']);
  });
  it('uses the card for any other asteroid, with analog density and albedo from the class', () => {
    const r = cardToRock(
      card({
        diameter_km: tv(17),
        lightcurve_amp_mag: tv(0.4),
        rot_period_h: tv(5.27),
        spectral_class: tv('S'),
      }),
      { seed: 12345 },
    );
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.D).toBe(17);
    expect(r.preset.ab).toBeCloseTo(Math.pow(10, 0.16), 6);
    expect(r.preset.rho).toBe(2670);
    expect(r.preset.A).toBe(0.25);
    expect(r.inputs.density.tag).toBe('inferred_from_analog');
    expect(r.inputs.strength.tag).toBe('artistic');
  });
  it('a missing spin or albedo falls back and says so', () => {
    const r = cardToRock(card({ diameter_km: tv(2) }), { seed: 3 });
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.P).toBe(Infinity);
    expect(r.inputs.albedo.tag).toBe('inferred_from_analog');
    expect(r.inputs.spin.tag).toBe('artistic');
  });
  it('a comet gets the nucleus defaults and takes its size from the radius', () => {
    const r = cardToRock(card({ type: 'comet', nucleus_radius_km_max: tv(2.5) }), { seed: 3 });
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.comet).toBe(true);
    expect(r.preset.D).toBe(5);
    expect(r.preset.rho).toBe(530);
  });
  it("the artifact's own bodies use its seed and values (1:1)", () => {
    expect(Object.keys(ARTIFACT_PRESET_BY_ID)).toHaveLength(3);
    const r = cardToRock(card({ id: 'sbdb-50788063', diameter_km: tv(0.5) }), { seed: 999 });
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.seed).toBe(5);
    expect(r.preset.ab).toBe(10);
    expect(r.preset.D).toBe(0.204);
  });
  it('is deterministic', () => {
    const c = card({ diameter_km: tv(3), rot_period_h: tv(4) });
    expect(cardToRock(c, { seed: 77 })).toEqual(cardToRock(c, { seed: 77 }));
    expect(rockSeed(2518080627)).toBeLessThan(97);
    expect(rockSeed(2518080627)).toBe(rockSeed(2518080627));
    expect(classFamily('Cb')).toBe('C');
    expect(classFamily('X')).toBeNull();
  });
});

describe('radialHeights', () => {
  it('a convex cover of the unit sphere has no holes and no large dents', () => {
    // A coarse octahedron-ish cover of a sphere: 8 triangles on the axes, radius 1 (convex, star-shaped).
    const v = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const f = [
      [0, 2, 4],
      [4, 2, 1],
      [1, 2, 5],
      [5, 2, 0],
      [4, 3, 0],
      [1, 3, 4],
      [5, 3, 1],
      [0, 3, 5],
    ];
    const tris = new Float32Array(f.flatMap((t) => t.flatMap((i) => v[i]!)));
    const m = radialHeights(tris, 64, 32);
    expect(m.holes).toBe(0);
    expect(m.ext).toBeGreaterThan(1);
    expect(Math.min(...m.h)).toBeGreaterThan(-0.5);
  });
  it('an artifact body shows the values it draws and notes where the card differs', () => {
    const r = cardToRock(
      card({ id: 'sbdb-50788063', diameter_km: tv(0.5), rot_period_h: tv(8.1), albedo: tv(0.1) }),
      { seed: 1 },
    );
    if ('refused' in r) throw new Error('refused');
    expect(r.inputs.size.value).toBe('204 m');
    expect(r.inputs.spin.value).toBe('7.9 h');
    expect(r.inputs.albedo.value).toBe('4%');
    expect(r.mismatches.some((m) => m.startsWith('size:'))).toBe(true);
    expect(r.mismatches.some((m) => m.startsWith('reflectivity:'))).toBe(true);
    const plain = cardToRock(card({ diameter_km: tv(2) }), { seed: 1 });
    if ('refused' in plain) throw new Error('refused');
    expect(plain.mismatches).toEqual([]);
  });
});

describe('review fixes (#71)', () => {
  it('Bennu-class density is 1,190 kg/m3 (Lauretta et al. 2019)', () => {
    const r = cardToRock(card({ diameter_km: tv(0.49), spectral_class: tv('B') }), { seed: 1 });
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.rho).toBe(1190);
    expect(r.inputs.density.value).toBe('1,190 kg/m³');
  });
  it("a preset body's badges show the drawn values and say what the card has", () => {
    // 'Oumuamua: no class on the card, so the card-side analog is 1,500; the preset draws 2,000.
    const r = cardToRock(card({ id: 'sbdb-50788063', diameter_km: tv(0.5) }), { seed: 1 });
    if ('refused' in r) throw new Error('refused');
    expect(r.preset.rho).toBe(2000);
    expect(r.inputs.density.value).toBe('2,000 kg/m³');
    expect(r.inputs.density.tag).toBe('artistic');
    expect(r.inputs.density.why).toMatch(/the card says 1,500 kg\/m³/);
    expect(r.inputs.size.why).toMatch(/the card says 500 m/);
  });
  it('folds the seed into a small float range with few collisions', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 5000; s++) {
      const v = rockSeed(s * 2654435761);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(97);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(4950); // the old `% 97` gave at most 97
    // The artifact's own bodies keep their integer seeds (the parity look).
    const eros = cardToRock(card({ id: 'sbdb-20000433', diameter_km: tv(16.8) }), { seed: 123 });
    if ('refused' in eros) throw new Error('refused');
    expect(eros.preset.seed).toBe(29);
  });
  it('a card body gets a vec3 offset and its full seed hash; the artifact bodies do not (#93 2.8)', () => {
    const a = cardToRock(card({ diameter_km: tv(2) }), { seed: 1 });
    const b = cardToRock(card({ diameter_km: tv(2) }), { seed: 2 });
    if ('refused' in a || 'refused' in b) throw new Error('refused');
    expect(a.preset.seed3).toHaveLength(3);
    expect(a.preset.seed3).not.toEqual(b.preset.seed3);
    expect(a.preset.seedHash).not.toBe(b.preset.seedHash);
    // 40 bodies: no two share a crater layout (the old seed * 31 + 7 had about 3,000)
    const hs = new Set<number>();
    for (let s = 0; s < 40; s++) {
      const r = cardToRock(card({ diameter_km: tv(2) }), { seed: s });
      if (!('refused' in r)) hs.add(r.preset.seedHash!);
    }
    expect(hs.size).toBe(40);
    const eros = cardToRock(card({ id: 'sbdb-20000433', diameter_km: tv(16.8) }), { seed: 9 });
    if ('refused' in eros) throw new Error('refused');
    expect(eros.preset.seed3).toBeUndefined();
    expect(eros.preset.seedHash).toBeUndefined();
  });
  it('tags the lighting model artistic', () => {
    const r = cardToRock(card({ diameter_km: tv(2) }), { seed: 1 });
    if ('refused' in r) throw new Error('refused');
    expect(r.inputs.light.tag).toBe('artistic');
    expect(r.inputs.light.why).toMatch(/no brightening at opposition/);
  });
});
