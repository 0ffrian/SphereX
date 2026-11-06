// R7.7, D-01, D-21: each shader kind builds from the shared fixtures without a GPU (jsdom), keeps
// the honesty filter, and refuses rather than invents.
import { describe, expect, it } from 'vitest';
import { generateField } from '../fields/fieldGenerator';
import { createBodyRenderer } from './bodyRenderer';
import './registry';
import { ShaderBody } from './ShaderBody';
import { fixture } from './fixtures.testutil';
import type { BodyContext } from './bodyRenderer';

// Small field keeps jsdom tests fast; the real size is covered in fieldGenerator.test.ts.
const ctx: BodyContext = { fieldSource: async (p) => generateField(p, 64, 32) };

const KINDS = ['planet_rocky', 'planet_water', 'gas_giant', 'nebula', 'nova'] as const;

describe('ShaderBody', () => {
  for (const k of KINDS) {
    it(`builds ${k} from its fixture`, async () => {
      const f = fixture(k);
      const body = await ShaderBody.create(f.card, f.params, ctx);
      const layer = k === 'nebula' || k === 'nova' ? 'point_cloud' : 'surface';
      expect(body.drawn).toEqual([layer]);
      expect(body.hidden).toEqual([]);
      expect(body.object.children.length).toBeGreaterThan(0);
      expect(body.suggestedDistance).toBeGreaterThan(1);
      body.dispose();
    });
  }

  it('lists params.missing and keeps drawing (rocky: teq_pulse)', async () => {
    const f = fixture('planet_rocky');
    const body = await ShaderBody.create(f.card, f.params, ctx);
    expect(body.missing).toEqual(['teq_pulse']);
    expect(body.drawn).toEqual(['surface']);
  });

  it('draws nothing and lists the layer when the size is unknown', async () => {
    const f = fixture('gas_giant');
    const body = await ShaderBody.create(f.card, { ...f.params, scale_m: null }, ctx);
    expect(body.drawn).toEqual([]);
    expect(body.missing).toContain('surface');
    expect(body.object.children.every((c) => !c.visible)).toBe(true);
  });

  it('hides artistic layers outside "+ Artistic" (D-21) and shows them again', async () => {
    const f = fixture('planet_water');
    const body = await ShaderBody.create(f.card, f.params, {
      ...ctx,
      visibleTags: ['measured', 'derived', 'model_dependent', 'inferred_from_analog'],
    });
    expect(body.drawn).toEqual([]);
    expect(body.hidden).toEqual(['surface']);
    // A plain sphere stands in for the hidden surface.
    expect(body.object.children.some((c) => c.visible)).toBe(true);
    body.setVisibleTags([
      'measured',
      'derived',
      'model_dependent',
      'inferred_from_analog',
      'artistic',
    ]);
    expect(body.drawn).toEqual(['surface']);
    expect(body.hidden).toEqual([]);
  });

  it('nebula and nova draw nothing when artistic is hidden (nothing is measured)', async () => {
    const f = fixture('nova');
    const body = await ShaderBody.create(f.card, f.params, { ...ctx, visibleTags: ['measured'] });
    expect(body.drawn).toEqual([]);
    expect(body.hidden).toEqual(['point_cloud']);
    expect(body.object.children.every((c) => !c.visible)).toBe(true);
  });

  it('rebuilds with new field-affecting overrides', async () => {
    const f = fixture('planet_water');
    const seen: number[] = [];
    const body = await ShaderBody.create(f.card, f.params, {
      fieldSource: async (p) => {
        seen.push(p.seaLevel);
        return generateField(p, 64, 32);
      },
    });
    await body.setOverrides({ sea_level: 0.55 });
    expect(seen).toEqual([0.4, 0.55]);
    expect(body.drawn).toEqual(['surface']);
  });
});

describe('body registry', () => {
  it('resolves the five shader kinds and returns null for baked types', async () => {
    for (const k of KINDS) {
      const f = fixture(k);
      const pending = createBodyRenderer(f.card, f.params, ctx);
      expect(pending, k).not.toBeNull();
      (await pending!).dispose();
    }
    const a = fixture('asteroid_shape');
    expect(createBodyRenderer(a.card, a.params, ctx)).toBeNull();
  });
});
