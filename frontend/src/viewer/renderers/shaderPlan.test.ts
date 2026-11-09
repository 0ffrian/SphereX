// R7.7, Q-45, Q-49: the plan of the shader kinds (pure, no GPU).
import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { buildAltText, canvasLabel, nothingDrawnReason } from '../altText';
import { showsBody } from '../planCommon';
import { defaultContext, planRender } from '../renderPlan';
import { resolveMotion } from '../motion/motion';
import { fixture } from './fixtures.testutil';
import { resolveShaderSpec } from './shaderSpec';

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
    // + Estimated (the start): the surface follows the data; the seeded looks wait.
    const est = at('derived');
    expect(est.shader).toMatchObject({
      surface: true,
      plain: false,
      gas: { bands: true, flattening: true, colour: true, storms: false, turbulence: false },
    });
    for (const id of ['storms', 'turbulence']) {
      expect(est.missing.find((m) => m.id === id)).toMatchObject({
        reason: 'honesty',
        tag: 'artistic',
      });
    }
    // The colour is drawn (derived), so the "plain grey" note would contradict the screen.
    expect(est.notes.join(' ')).not.toMatch(/Colour is plain grey/);
    expect(est.missing.some((m) => m.id === 'surface')).toBe(false);
    expect(buildAltText(est)).toContain('generated model');
    // + Artistic adds the storms and the turbulence.
    expect(at('artistic').shader!.gas).toMatchObject({ storms: true, turbulence: true });
    // Measured only: nothing about it is measured, so a plain sphere of the measured size.
    const m = at('measured');
    expect(m.shader).toMatchObject({ surface: false, plain: true });
    expect(Object.values(m.shader!.gas!).some(Boolean)).toBe(false);
    expect(showsBody(m)).toBe(true);
    // The texts say what is Estimated (bands, flattening, colour) and what needs + Artistic.
    const words = [m.notes.join(' '), buildAltText(m)];
    for (const w of words) {
      expect(w).toContain('choose + Estimated to see them');
      expect(w).toContain('+ Artistic');
      expect(w).not.toContain('choose + Artistic to see it');
    }
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

  describe('gas giant legend matches what is drawn (PR #63, D-32, Q-109)', () => {
    const plan = (
      over: Record<string, number> = {},
      honesty: 'derived' | 'artistic' = 'derived',
    ) => {
      const { card, params } = fixture('gas_giant');
      return planRender(card, params, defaultContext({ honesty, overrides: over }));
    };
    const drawnBands = () => {
      const { card, params } = fixture('gas_giant');
      return resolveShaderSpec(card, params, undefined, resolveMotion(card, params)).field!.bands;
    };

    it('takes the weaker tag and the rule that sets the value when dynamics differs from the card', () => {
      const p = plan();
      const bands = p.drawn.find((d) => d.id === 'bands')!;
      const flat = p.drawn.find((d) => d.id === 'flattening')!;
      // The backend says model_dependent (typical spin); dynamics is a 10 h spin at 100 m/s,
      // inferred_from_analog, and that is what is drawn.
      expect(bands.tag).toBe('inferred_from_analog');
      expect(flat.tag).toBe('inferred_from_analog');
      const shown = Number(/about (\d+) bands/.exec(bands.description)![1]);
      expect(shown).toBe(2 * drawnBands());
      expect(shown).not.toBe(22);
    });

    it('a slider override is artistic and says what it set', () => {
      const p = plan({ bands: 7, mass_mearth: 300 }, 'artistic');
      const bands = p.drawn.find((d) => d.id === 'bands')!;
      expect(bands.tag).toBe('artistic');
      expect(bands.description).toContain('about 14 bands');
      expect(p.drawn.find((d) => d.id === 'flattening')!.tag).toBe('artistic');
      // At + Estimated an artistic layer is not shown, so it is refused for its honesty level.
      const est = plan({ bands: 7 });
      expect(est.missing.find((m) => m.id === 'bands')).toMatchObject({
        reason: 'honesty',
        tag: 'artistic',
      });
    });

    it('a layer the backend did not send is refused with a reason, not dropped', () => {
      const { card, params } = fixture('gas_giant');
      const old = { ...params, layers: params.layers.filter((l) => l.id === 'turbulence') };
      const p = planRender(card, old, defaultContext({ honesty: 'artistic' }));
      for (const id of ['bands', 'flattening', 'colour', 'storms']) {
        expect(
          p.missing.find((m) => m.id === id),
          id,
        ).toMatchObject({ reason: 'backend' });
      }
      // Same when the body is not drawable at all.
      const none = planRender(card, { ...old, scale_m: null }, defaultContext());
      expect(none.missing.find((m) => m.id === 'bands')).toMatchObject({ reason: 'backend' });
    });
  });
});
