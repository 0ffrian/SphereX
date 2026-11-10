// Issue #68 Part 3e: a locked planet is posed so its star-facing point (+X) faces the light and
// keeps facing it when the light moves or the clock runs; an unlocked one spins as before.
import { describe, expect, it } from 'vitest';
import { Vector3, type Object3D } from 'three/webgpu';
import type { ObjectCard } from '@/contract';
import { kepler186f, trappist1f } from '@/physics/exoplanetFixtures.testutil';
import { generateField } from '../fields/fieldGenerator';
import { ALL_TAGS, type BodyContext } from './bodyRenderer';
import { ShaderBody, patternMode } from './ShaderBody';
import { fixture } from './fixtures.testutil';
import { tinyWorldSource } from './worldFixtures.testutil';

const ctx: BodyContext = {
  visibleTags: ALL_TAGS,
  fieldSource: async (p) => generateField(p, 64, 32),
  worldSource: tinyWorldSource,
};

async function body(card: ObjectCard, light: [number, number, number]) {
  const f = fixture('planet_rocky');
  return ShaderBody.create(
    card,
    { ...f.params, id: card.id, scale_m: 6.4e6 },
    { ...ctx, lightDir: light },
  );
}
const surfaceGroup = (b: ShaderBody): Object3D => {
  const g = b.object.children.find((c) => c.type === 'Group' && c.children.length > 0);
  if (!g) throw new Error('no surface group');
  return g;
};
const substellarWorld = (g: Object3D): Vector3 => {
  g.updateWorldMatrix(true, false);
  return new Vector3(1, 0, 0).transformDirection(g.matrixWorld);
};
const unit = (v: [number, number, number]): Vector3 => new Vector3(...v).normalize();

describe('climate pattern at + Estimated', () => {
  it('shows the pattern (not the artistic surface) with the estimated tags, and keeps the pose', async () => {
    const light: [number, number, number] = [0.3, 0.4, 0.86];
    const f = fixture('planet_rocky');
    const card = trappist1f() as ObjectCard;
    const b = await ShaderBody.create(
      card,
      { ...f.params, id: card.id, scale_m: 6.4e6 },
      {
        ...ctx,
        visibleTags: ['measured', 'derived', 'model_dependent', 'inferred_from_analog'],
        lightDir: light,
      },
    );
    expect(b.drawn).toEqual(['climate']);
    expect(b.hidden).toEqual(['surface']);
    expect(substellarWorld(surfaceGroup(b)).distanceTo(unit(light))).toBeLessThan(1e-6);
    b.setVisibleTags(['measured']);
    expect(b.drawn).toEqual([]);
    b.setVisibleTags(ALL_TAGS);
    expect(b.drawn).toEqual(['surface']);
    b.dispose();
  });
});

describe('pattern mode reads the ice mask alone', () => {
  it('snowball is uniform ice; the open cap is uniform water or ground', () => {
    expect(patternMode('planet_rocky', 0)).toBe('ice');
    expect(patternMode('planet_water', 0)).toBe('ice');
    expect(patternMode('planet_water', 0.9)).toBe('water');
    expect(patternMode('planet_rocky', 0.9)).toBe('ground');
  });
});

describe('locked pose', () => {
  it('TRAPPIST-1 f: +X points at the light, whatever the clock says', async () => {
    const light: [number, number, number] = [0.3, 0.4, 0.86];
    const b = await body(trappist1f() as ObjectCard, light);
    const g = surfaceGroup(b);
    for (const t of [0, 3600, 1e7]) {
      b.setTime((id) => (id === 'spin' ? t : 0));
      expect(substellarWorld(g).distanceTo(unit(light))).toBeLessThan(1e-6);
    }
    // The light moves: the planet follows it.
    b.setSunDirection([-0.5, 0.1, 0.8]);
    expect(substellarWorld(g).distanceTo(unit([-0.5, 0.1, 0.8]))).toBeLessThan(1e-6);
    b.dispose();
  });

  it('is deterministic: the same light gives the same pose', async () => {
    const a = await body(trappist1f() as ObjectCard, [0, 0.45, 0.9]);
    const c = await body(trappist1f() as ObjectCard, [0, 0.45, 0.9]);
    expect(surfaceGroup(a).quaternion.toArray()).toEqual(surfaceGroup(c).quaternion.toArray());
    a.dispose();
    c.dispose();
  });

  it('Kepler-186 f is locked too (KNIFE EDGE, Q-155): +X points at the light, whatever the clock says', async () => {
    const light: [number, number, number] = [0.3, 0.4, 0.86];
    const b = await body(kepler186f() as ObjectCard, light);
    const g = surfaceGroup(b);
    for (const t of [0, 3600, 1e7]) {
      b.setTime((id) => (id === 'spin' ? t : 0));
      expect(substellarWorld(g).distanceTo(unit(light))).toBeLessThan(1e-6);
    }
    b.dispose();
  });

  it('an unlocked planet (Kepler-186 f with a 3 Gyr star) still spins with the clock', async () => {
    const young = kepler186f();
    young.host_age_gyr = { value: 3, tag: 'measured', source: 'test: younger than t_lock' };
    const b = await body(young as ObjectCard, [0, 0.45, 0.9]);
    const g = surfaceGroup(b);
    b.setTime((id) => (id === 'spin' ? 0 : 0));
    const y0 = g.rotation.y;
    b.setTime((id) => (id === 'spin' ? 5000 : 0));
    expect(g.rotation.y).not.toBe(y0);
    b.dispose();
  });
});

describe("the plan's pattern switch (issue #68 review)", () => {
  it('a held climate hides the pattern at + Estimated, and showing it again draws it', async () => {
    const f = fixture('planet_rocky');
    const card = trappist1f() as ObjectCard;
    const b = await ShaderBody.create(
      card,
      { ...f.params, id: card.id, scale_m: 6.4e6 },
      {
        ...ctx,
        visibleTags: ['measured', 'derived', 'model_dependent', 'inferred_from_analog'],
        pattern: false,
      },
    );
    expect(b.drawn).toEqual([]);
    b.setPatternSwitch(true);
    expect(b.drawn).toEqual(['climate']);
    b.setPatternSwitch(false);
    expect(b.drawn).toEqual([]);
    b.setPatternSwitch(null); // no plan: the tags decide again
    expect(b.drawn).toEqual(['climate']);
    b.dispose();
  });
});

describe('the substellar ice edge does not depend on the artist look freq', () => {
  it('the substellar ice is the same for two freq values; the terrain still reads freq', async () => {
    const { terrainAt } = await import('../fields/fieldGenerator');
    const base = {
      kind: 'terrain' as const,
      seed: 5,
      seaLevel: 0.3,
      iceExtent: 0.5,
      heat: 0,
      bands: 0,
      turbulence: 0,
      storms: 0,
    };
    const d: [number, number, number] = [0.6, 0.48, 0.64];
    const sub = (freq: number) =>
      terrainAt(d, { ...base, freq, substellar: true, iceAngleRad: 0.9 }).ice;
    expect(sub(1.9)).toBe(sub(3.1));
    const polar = (freq: number) => terrainAt(d, { ...base, freq }).height;
    expect(polar(1.9)).not.toBe(polar(3.1));
  });
});
