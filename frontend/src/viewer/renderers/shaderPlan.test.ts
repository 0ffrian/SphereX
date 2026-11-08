// R7.7, Q-45, Q-49: the plan of the shader kinds (pure, no GPU).
import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { buildAltText, canvasLabel, nothingDrawnReason } from '../altText';
import { showsBody } from '../planCommon';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from './fixtures.testutil';

// A gas giant has five layers of its own (issue #62) and is covered by its own tests below.
const KINDS = ['planet_rocky', 'planet_water', 'nebula', 'nova'] as const;

describe('planShaderKind', () => {
  it('at + Estimated: worlds show the plain sphere, clouds show nothing, all say why', () => {
    for (const k of KINDS) {
      const { card, params } = fixture(k);
      const plan = planRender(card, params, defaultContext());
      const layer = k === 'nebula' || k === 'nova' ? 'point_cloud' : 'surface';
      expect(plan.shader, k).toMatchObject({ surface: false, plain: layer === 'surface' });
      expect(
        plan.missing.find((m) => m.id === layer),
        k,
      ).toMatchObject({
        reason: 'honesty',
        tag: 'artistic',
      });
      expect(showsBody(plan), k).toBe(layer === 'surface');
      expect(plan.bodies).toEqual([]);
    }
  });

  it('gas giant (issue #62): five layers, each at its own honesty level', () => {
    const { card, params } = fixture('gas_giant');
    const at = (honesty: 'measured' | 'derived' | 'artistic') =>
      planRender(card, params, defaultContext({ honesty }));
    // + Estimated (the start): the surface follows the data, only the swirl look waits.
    const est = at('derived');
    expect(est.shader).toMatchObject({
      surface: true,
      plain: false,
      gas: { bands: true, flattening: true, colour: true, storms: true, turbulence: false },
    });
    expect(est.missing.find((m) => m.id === 'turbulence')).toMatchObject({
      reason: 'honesty',
      tag: 'artistic',
    });
    expect(est.missing.some((m) => m.id === 'surface')).toBe(false);
    expect(buildAltText(est)).toContain('generated model');
    // + Artistic adds the turbulence.
    expect(at('artistic').shader!.gas).toMatchObject({ turbulence: true });
    // Measured only: nothing about it is measured, so a plain sphere of the measured size.
    const m = at('measured');
    expect(m.shader).toMatchObject({ surface: false, plain: true });
    expect(Object.values(m.shader!.gas!).some(Boolean)).toBe(false);
    expect(showsBody(m)).toBe(true);
  });

  it('gas giant: a refused layer leaves the others, and no radius refuses all of them', () => {
    const { card, params } = fixture('gas_giant');
    const one = planRender(
      card,
      { ...params, missing: ['colour'] },
      defaultContext({ honesty: 'artistic' }),
    );
    expect(one.shader!.gas).toMatchObject({ colour: false, bands: true });
    expect(one.missing.find((m) => m.id === 'colour')?.reason).toBe('backend');
    const none = planRender(
      card,
      { ...params, scale_m: null },
      defaultContext({ honesty: 'artistic' }),
    );
    expect(none.shader).toBeNull();
    expect(none.missing.map((m) => m.id)).toEqual(
      expect.arrayContaining(['bands', 'flattening', 'colour', 'storms', 'turbulence']),
    );
    expect(showsBody(none)).toBe(false);
  });

  it('a nebula or remnant says in plain words that it has no touch feedback (Q-103)', () => {
    for (const k of ['nebula', 'nova'] as const) {
      const { card, params } = fixture(k);
      for (const honesty of ['derived', 'artistic'] as const) {
        const plan = planRender(card, params, defaultContext({ honesty }));
        expect(plan.notes.join(' '), `${k} ${honesty}`).toMatch(/no touch feedback/);
      }
    }
    const { card, params } = fixture('planet_rocky');
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.notes.join(' ')).not.toMatch(/touch feedback/);
  });

  it('at + Artistic the layer is drawn and listed with its tag (the D-02 badge)', () => {
    for (const k of KINDS) {
      const { card, params } = fixture(k);
      const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
      const layer = k === 'nebula' || k === 'nova' ? 'point_cloud' : 'surface';
      expect(plan.shader).toMatchObject({ surface: true, plain: false });
      expect(plan.drawn.find((d) => d.id === layer)?.tag, k).toBe('artistic');
      expect(buildAltText(plan), k).toContain("artist's impression");
      expect(buildAltText(plan), k).toContain(params.alt_text.replace(/\.$/, ''));
    }
  });

  it('honesty is not part of what the body is built from', () => {
    const { card, params } = fixture('planet_water');
    const keys = (['measured', 'derived', 'artistic'] as const).map(
      (honesty) => planRender(card, params, defaultContext({ honesty })).shader!.key,
    );
    expect(new Set(keys).size).toBe(1);
    const other = planRender(card, { ...params, seed: params.seed + 1 }, defaultContext());
    expect(other.shader!.key).not.toBe(keys[0]);
  });

  it('Q-45: the plain sphere at Measured only needs a measured size', () => {
    const { card, params } = fixture('planet_rocky');
    const measured = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(measured.shader!.plain).toBe(true);
    expect(measured.sizeTag).toBe('measured');
    expect(measured.notes.join(' ')).toMatch(/plain grey sphere/);
    const estimated: ObjectCard = {
      ...card,
      radius_rjup: { ...card.radius_rjup!, tag: 'derived', formula: 'R = d / 2' },
    } as ObjectCard;
    const hidden = planRender(estimated, params, defaultContext({ honesty: 'measured' }));
    expect(hidden.shader!.plain).toBe(false);
    expect(showsBody(hidden)).toBe(false);
    expect(hidden.sizeTag).toBeNull();
    expect(hidden.missing.find((m) => m.id === 'body')).toMatchObject({ reason: 'honesty' });
    expect(nothingDrawnReason(hidden).needs).not.toBeNull();
    expect(canvasLabel(hidden)).toMatch(/Nothing is drawn/);
    // At + Estimated the same size is shown, so the plain sphere returns.
    expect(planRender(estimated, params, defaultContext()).shader!.plain).toBe(true);
  });

  it('refuses rather than invents: no size, or a layer the backend lists as missing', () => {
    const { card, params } = fixture('planet_water');
    const noSize = planRender(
      card,
      { ...params, scale_m: null },
      defaultContext({ honesty: 'artistic' }),
    );
    expect(noSize.shader).toBeNull();
    expect(noSize.drawn).toEqual([]);
    expect(noSize.missing.map((m) => m.id)).toContain('surface');
    expect(showsBody(noSize)).toBe(false);
    const listed = planRender(
      card,
      { ...params, missing: ['surface'] },
      defaultContext({ honesty: 'artistic' }),
    );
    expect(listed.shader).toBeNull();
    expect(listed.missing.find((m) => m.id === 'surface')?.reason).toBe('backend');
    const bare = planRender(
      card,
      { ...params, layers: [] },
      defaultContext({ honesty: 'artistic' }),
    );
    expect(bare.shader).toBeNull();
  });

  it('light comes from planLighting: sun_dir here, none for the self-lit clouds', () => {
    const w = fixture('planet_water');
    expect(planRender(w.card, w.params, defaultContext()).lighting.direction).toEqual([1, 0, 0]);
    const n = fixture('nebula');
    expect(planRender(n.card, n.params, defaultContext()).lighting.direction).toBeNull();
  });
});
