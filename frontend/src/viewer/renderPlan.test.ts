// Render plans for the baked types (R7.1 to R7.6) against the synthetic shared fixtures, and the
// R11 acceptance tests that touch the viewer: honesty, refusal and comet. All pure: no GPU.
import { describe, expect, it } from 'vitest';
import type { CometEpoch, Layer, ObjectCard, Tag } from '@/contract';
import { BAKED_NAMES, FIXTURE_NAMES, fixture } from '@/test/sharedFixtures';
import { HONESTY_STATES, isTagShown, type HonestyState } from './honesty';
import { MAX_AMBIENT_INTENSITY } from './lighting';
import { defaultContext, planRender, CANDIDATE_MESSAGE, UNSUPPORTED_MESSAGE } from './renderPlan';
import { planBrownDwarf, EMISSIVE_FLOOR } from './renderers/BrownDwarf';
import { gasQForEpoch, GAS_STYLE, MAX_TOTAL_POINTS, planShells } from './renderers/Comet';
import { lightcurveScrub, planStar, screenOpacity } from './renderers/Star';
import type { PlanInput } from './planCommon';
import type { RenderPlan } from './planTypes';

const tv = (value: number, tag: Tag = 'measured') => ({ value, tag, source: 'test' });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const missing = (plan: RenderPlan, id: string) => plan.missing.find((m) => m.id === id);

describe('every baked-type fixture plans without throwing', () => {
  it('found the baked fixtures', () => {
    for (const name of BAKED_NAMES) expect(FIXTURE_NAMES).toContain(name);
  });

  for (const name of BAKED_NAMES) {
    for (const honesty of HONESTY_STATES) {
      it(`${name} at ${honesty}: only allowed tags are drawn, ambient stays small`, () => {
        const { card, params } = fixture(name);
        const plan = planRender(card, params, defaultContext({ honesty }));
        expect(plan.type).toBe(params.type);
        for (const l of plan.drawn) expect(isTagShown(honesty, l.tag)).toBe(true);
        expect(plan.lighting.ambient).toBeLessThanOrEqual(MAX_AMBIENT_INTENSITY);
        // A drawn body is never next to an empty legend (B6).
        if (plan.bodies.length > 0) expect(plan.drawn.length).toBeGreaterThan(0);
        // Everything in `missing` has a reason and none of it is also drawn.
        for (const m of plan.missing) {
          expect(m.reason).toBeTruthy();
          expect(ids(plan.drawn)).not.toContain(m.id);
        }
        for (const mode of [null, 'visible', 'spherex_ir'] as const) {
          for (const epoch of ['2025-08', '2025-12'] as CometEpoch[]) {
            expect(() =>
              planRender(card, params, defaultContext({ honesty, mode, epoch })),
            ).not.toThrow();
          }
        }
      });
    }
  }

  it('the five shader kinds get a shader plan, not a message', () => {
    for (const k of ['planet_rocky', 'planet_water', 'gas_giant', 'nebula', 'nova'] as const) {
      const { card, params } = fixture(k);
      const plan = planRender(card, params, defaultContext());
      expect(plan.threeD, k).toBe(true);
      expect(plan.message, k).toBeNull();
      expect(plan.shader, k).not.toBeNull();
      expect(plan.bodies, k).toEqual([]);
    }
  });

  it('a type with no plan gives a message, not a crash', () => {
    const { card, params } = fixture('gas_giant');
    const odd = { ...params, type: 'mystery' } as unknown as typeof params;
    const plan = planRender(card, odd, defaultContext());
    expect(plan.threeD).toBe(false);
    expect(plan.message).toBe(UNSUPPORTED_MESSAGE);
  });

  it('survives params with unusable parts', () => {
    const { card, params } = fixture('asteroid_shape');
    // A malformed reply that slipped through: layers is not a list.
    const broken = { ...params, layers: undefined } as unknown as typeof params;
    const plan = planRender(card, broken, defaultContext());
    expect(plan.threeD).toBe(false);
    expect(plan.missing.length).toBeGreaterThan(0);
  });
});

describe('R11 honesty', () => {
  it('starts at + Estimated', () => {
    expect(defaultContext().honesty).toBe('derived');
  });

  it('in Measured only no layer with a tag other than measured is drawn', () => {
    for (const name of BAKED_NAMES) {
      const { card, params } = fixture(name);
      const plan = planRender(card, params, defaultContext({ honesty: 'measured' }));
      expect(
        plan.drawn.filter((l) => l.tag !== 'measured'),
        name,
      ).toEqual([]);
    }
  });

  it('hidden layers are listed as honesty refusals and come back at the right level', () => {
    const { card, params } = fixture('asteroid_procedural');
    const estimated = planRender(card, params, defaultContext({ honesty: 'derived' }));
    expect(ids(estimated.drawn)).toContain('ellipsoid');
    expect(ids(estimated.drawn)).toContain('albedo_map');
    expect(ids(estimated.drawn)).not.toContain('relief');
    expect(missing(estimated, 'relief')).toMatchObject({ reason: 'honesty', tag: 'artistic' });

    const artistic = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(ids(artistic.drawn)).toContain('relief');
    expect(artistic.bodies[0]?.normalUrl).toBe(params.textures?.normal);

    // The fixture's diameter is `derived`, so Measured only draws no body (it would show an
    // estimated size) and says so.
    const measured = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(measured.bodies).toEqual([]);
    expect(missing(measured, 'body')).toMatchObject({ reason: 'honesty', tag: 'derived' });

    // With a measured diameter, Measured only is a plain sphere with a flat tint and no textures.
    card.diameter_km = tv(2);
    const plain = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(ids(plain.missing)).toEqual(
      expect.arrayContaining(['ellipsoid', 'albedo_map', 'relief']),
    );
    const body = plain.bodies[0]!;
    expect(body.axes).toEqual([1, 1, 1]);
    expect(body.albedoUrl).toBeNull();
    expect(body.normalUrl).toBeNull();
  });

  it('a hidden colour becomes plain grey, not an invented colour', () => {
    const { card, params } = fixture('asteroid_shape');
    const est = planRender(card, params, defaultContext({ mode: 'visible' }));
    expect(est.tint.tag).toBe('derived');
    const meas = planRender(card, params, defaultContext({ honesty: 'measured', mode: 'visible' }));
    expect(meas.tint.tag).toBeNull();
    expect(meas.tint.rgb).toEqual([0.5, 0.5, 0.5]);
    const ir = planRender(
      card,
      params,
      defaultContext({ honesty: 'measured', mode: 'spherex_ir' }),
    );
    expect(ir.tint.tag).toBe('measured');
  });
});

describe('size is never shown without its label', () => {
  it('a size hidden by the honesty state also leaves the scale bar data and sizeTag empty', () => {
    const { card, params } = fixture('brown_dwarf');
    const radiusTag = card.radius_rjup?.tag;
    expect(radiusTag).toBeDefined();
    for (const honesty of HONESTY_STATES) {
      const plan = planRender(card, params, defaultContext({ honesty }));
      if (isTagShown(honesty, radiusTag!)) expect(plan.scaleM).not.toBeNull();
      else {
        expect(plan.scaleM).toBeNull();
        expect(plan.sizeTag).toBeNull();
      }
    }
  });
});

describe('R11 refusal', () => {
  it('removing diameter_km from an asteroid card puts the mesh in missing, with no crash', () => {
    for (const name of ['asteroid_shape', 'asteroid_procedural']) {
      const { card, params } = fixture(name);
      delete card.diameter_km;
      const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
      expect(plan.bodies).toEqual([]);
      expect(plan.drawn).toEqual([]);
      expect(missing(plan, 'body')).toMatchObject({ reason: 'data', fields: ['diameter_km'] });
      expect(missing(plan, name === 'asteroid_shape' ? 'mesh' : 'ellipsoid')?.reason).toBe('data');
    }
  });

  it('an unknown size (scale_m null) refuses the body', () => {
    const { card, params } = fixture('asteroid_procedural');
    params.scale_m = null;
    const plan = planRender(card, params, defaultContext());
    expect(plan.bodies).toEqual([]);
    expect(plan.scaleM).toBeNull();
  });

  it('a shape_source that is not a mesh file address is a refused mesh and the body stays', () => {
    const { card, params } = fixture('asteroid_shape');
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'mesh')?.reason).toBe('load');
    expect(plan.bodies).toHaveLength(1);
    expect(plan.bodies[0]?.meshUrl).toBeNull();
    expect(plan.relief).toBe('illustrative');
  });

  it('a real mesh address is used, and the relief is then measured', () => {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: '/meshes/bennu.glb', tag: 'measured', source: 'test' };
    const plan = planRender(card, params, defaultContext());
    expect(plan.bodies[0]?.meshUrl).toBe('/meshes/bennu.glb');
    expect(ids(plan.drawn)).toContain('mesh');
    expect(plan.relief).toBe('measured');
    expect(plan.spin).toMatchObject({ speedup: 1000 });
    expect(plan.spin?.periodH).toBeGreaterThan(0);
  });

  it('a mesh or texture that failed to load becomes a refused layer', () => {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: '/meshes/bennu.glb', tag: 'measured', source: 'test' };
    const plan = planRender(card, params, defaultContext({ failed: ['mesh'] }));
    expect(missing(plan, 'mesh')?.reason).toBe('load');
    expect(plan.bodies[0]?.meshUrl).toBeNull();

    const p = fixture('asteroid_procedural');
    const t = planRender(p.card, p.params, defaultContext({ failed: ['albedo_map'] }));
    expect(missing(t, 'albedo_map')?.reason).toBe('load');
    expect(t.bodies[0]?.albedoUrl).toBeNull();
    expect(t.bodies).toHaveLength(1);
  });

  it('missing texture addresses refuse the texture layers, not the body', () => {
    const { card, params } = fixture('asteroid_procedural');
    delete params.textures;
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(missing(plan, 'albedo_map')?.reason).toBe('load');
    expect(missing(plan, 'relief')?.reason).toBe('load');
    expect(plan.bodies).toHaveLength(1);
  });

  it('layers the backend refused stay refused', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'visible')).toBeDefined();
  });
});

describe('modes (R5.2, D-23)', () => {
  it('lists unavailable modes in missing and falls back to one that works', () => {
    const { card, params } = fixture('comet'); // visible unavailable, IR available
    const plan = planRender(card, params, defaultContext({ mode: 'visible' }));
    expect(plan.modes.find((m) => m.id === 'visible')?.available).toBe(false);
    expect(plan.mode).toBe('spherex_ir');
    expect(missing(plan, 'visible')).toBeDefined();
  });

  it('brown dwarfs open in the infrared view (R7.4)', () => {
    const { card, params } = fixture('brown_dwarf');
    expect(planRender(card, params, defaultContext()).mode).toBe('spherex_ir');
  });

  it('a mode with available true but no colour is treated as unavailable', () => {
    const { card, params } = fixture('asteroid_shape');
    params.view_modes.visible.rgb = null;
    const plan = planRender(card, params, defaultContext({ mode: 'visible' }));
    expect(plan.modes.find((m) => m.id === 'visible')?.available).toBe(false);
    expect(plan.mode).toBe('spherex_ir');
  });

  it('a candidate has no usable mode', () => {
    const { card, params } = fixture('candidate');
    expect(planRender(card, params, defaultContext()).modes.every((m) => !m.available)).toBe(true);
  });
});

describe('lighting (R5.1)', () => {
  it('uses the phase angle for the Sun and none for self-luminous bodies', () => {
    const a = fixture('asteroid_shape');
    const lit = planRender(a.card, a.params, defaultContext());
    expect(lit.lighting.mode).toBe('sun');
    expect(lit.lighting.phaseAngleDeg).toBe(30);
    expect(lit.lighting.direction![0]).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(lit.lighting.direction![2]).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(lit.bodies[0]?.emissive).toBe(0);

    const s = fixture('star');
    const star = planRender(s.card, s.params, defaultContext());
    expect(star.lighting).toMatchObject({
      mode: 'self',
      direction: null,
      ambient: 0,
      emissive: true,
    });
    expect(star.bodies[0]?.emissive).toBeGreaterThan(0);
  });

  it('without a phase angle, lighting is refused and the fallback is labelled artistic', () => {
    const { card, params } = fixture('asteroid_shape');
    delete params.lighting.phase_angle_deg;
    delete params.lighting.sun_dir;
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'lighting')).toBeDefined();
    expect(plan.lighting.tag).toBe('artistic');
    expect(plan.bodies).toHaveLength(1);
  });
});

/** The Q-42 proposal: gas_Q keyed by epoch. Test numbers, not physical claims. */
function keyedComet(): { card: ObjectCard; params: ReturnType<typeof fixture>['params'] } {
  const { card, params } = fixture('comet');
  const keyed = {
    '2025-08': { co2: tv(1e26), h2o: tv(2e26), co: tv(4e26) },
    '2025-12': { co2: tv(3e26), h2o: tv(5e26), co: tv(1e26) },
  };
  card.gas_Q = keyed as unknown as ObjectCard['gas_Q'];
  card.epochs = ['2025-08', '2025-12'];
  const dust: Layer = {
    id: 'dust',
    tag: 'artistic',
    description: 'Dust cloud (R7.3).',
    requires: [],
  };
  const tail: Layer = { id: 'tail', tag: 'artistic', description: 'Tail.', requires: [] };
  params.layers.push(dust, tail);
  return { card, params };
}

describe('baked albedo and the view mode (B3)', () => {
  it('a baked asteroid albedo is white in the visible view and dropped in the infrared view', () => {
    const { card, params } = fixture('asteroid_procedural');
    params.view_modes.spherex_ir = fixture('asteroid_shape').params.view_modes.spherex_ir;
    const vis = planRender(card, params, defaultContext({ mode: 'visible' }));
    expect(vis.bodies[0]?.albedoUrl).toBe(params.textures?.albedo);
    expect(vis.bodies[0]?.tint).toEqual([1, 1, 1]);
    expect(ids(vis.drawn)).not.toContain('tint');
    const ir = planRender(card, params, defaultContext({ mode: 'spherex_ir' }));
    expect(ir.bodies[0]?.albedoUrl).toBeNull();
    expect(ir.bodies[0]?.tint).toEqual(ir.tint.rgb);
    expect(missing(ir, 'albedo_map')).toMatchObject({ reason: 'mode' });
    expect(ids(ir.drawn)).not.toContain('albedo_map');
  });
});

describe('R11 comet (R7.3)', () => {
  it('toggling Aug/Dec changes the CO and H2O shells', () => {
    const { card, params } = keyedComet();
    const aug = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    const dec = planRender(card, params, defaultContext({ epoch: '2025-12' }));
    const count = (p: RenderPlan, id: string) => p.shells.find((s) => s.id === id)?.count;
    expect(count(aug, 'co')).not.toBe(count(dec, 'co'));
    expect(count(aug, 'h2o')).not.toBe(count(dec, 'h2o'));
    expect(aug.shells.map((s) => s.id)).toEqual(['co2', 'h2o', 'co']);
    expect(aug.epoch).toBe('2025-08');
    expect(dec.epoch).toBe('2025-12');
    // Count and brightness are proportional to Q: normalised by the largest Q of any gas in any epoch.
    const co = aug.shells.find((s) => s.id === 'co')!;
    const h2o = aug.shells.find((s) => s.id === 'h2o')!;
    expect(co.brightness).toBeCloseTo(0.8); // 4e26 of the 5e26 maximum (H2O in December)
    expect(h2o.brightness).toBeCloseTo(0.4);
    expect(h2o.count / co.count).toBeCloseTo(0.5, 1);
  });

  it('draws no tail in August, and never draws one (the card holds no published tail result)', () => {
    const { card, params } = keyedComet();
    for (const epoch of ['2025-08', '2025-12'] as CometEpoch[]) {
      const plan = planRender(card, params, defaultContext({ epoch, honesty: 'artistic' }));
      expect(ids(plan.drawn)).not.toContain('tail');
      expect(missing(plan, 'tail')).toBeDefined();
    }
  });

  it('draws dust in December only', () => {
    const { card, params } = keyedComet();
    const aug = planRender(card, params, defaultContext({ epoch: '2025-08', honesty: 'artistic' }));
    const dec = planRender(card, params, defaultContext({ epoch: '2025-12', honesty: 'artistic' }));
    expect(aug.dust).toBeNull();
    expect(missing(aug, 'dust')?.reason).toBe('epoch');
    expect(dec.dust).not.toBeNull();
    // Sun-pointing: along the light direction.
    expect(dec.dust?.direction).toEqual(dec.lighting.direction);
    // At + Estimated the dust is artistic, so it is hidden.
    const est = planRender(card, params, defaultContext({ epoch: '2025-12' }));
    expect(est.dust).toBeNull();
    expect(missing(est, 'dust')?.reason).toBe('honesty');
  });

  it('shells are deterministic: the same card and seed give the same plan', () => {
    const { card, params } = keyedComet();
    const a = planRender(card, params, defaultContext());
    const b = planRender(structuredClone(card), structuredClone(params), defaultContext());
    expect(b).toEqual(a);
  });

  it('a card with one epoch of Q (the R3.2 shape) does not invent the other epoch', () => {
    const { card, params } = fixture('comet'); // epochs: ['2025-08']
    expect(gasQForEpoch(card, '2025-08')).not.toBeNull();
    expect(gasQForEpoch(card, '2025-12')).toBeNull();
    const dec = planRender(card, params, defaultContext({ epoch: '2025-12' }));
    expect(dec.shells).toEqual([]);
    expect(missing(dec, 'gas_shells')?.reason).toBe('epoch');
    const aug = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(aug.shells).toHaveLength(3);
    expect(aug.epochs).toEqual(['2025-08']);
  });

  it('the R3.2 shape is one epoch only: with both epochs listed it is refused for both (B1)', () => {
    const { card, params } = fixture('comet');
    card.epochs = ['2025-08', '2025-12'];
    expect(gasQForEpoch(card, '2025-08')).toBeNull();
    expect(gasQForEpoch(card, '2025-12')).toBeNull();
    for (const epoch of ['2025-08', '2025-12'] as CometEpoch[]) {
      const plan = planRender(card, params, defaultContext({ epoch }));
      expect(plan.shells).toEqual([]);
      expect(missing(plan, 'gas_shells')).toMatchObject({ reason: 'epoch' });
      expect(missing(plan, 'gas_shells')?.note).toMatch(/both epochs/);
      expect(plan.epochs).toEqual([]);
    }
    // One epoch listed, and it is the selected one: used. The other epoch gets nothing.
    card.epochs = ['2025-12'];
    expect(planRender(card, params, defaultContext({ epoch: '2025-12' })).shells).toHaveLength(3);
    expect(planRender(card, params, defaultContext({ epoch: '2025-08' })).shells).toEqual([]);
  });

  it('the nucleus is an upper limit in the plan (B2)', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(plan.sizeQualifier).toBe('upper_limit');
    expect(plan.sizeTag).toBe('measured');
    // Hidden by the honesty state: no size, no qualifier.
    const hidden = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(hidden.sizeQualifier).toBe('upper_limit'); // nucleus is measured on the fixture
    card.nucleus_radius_km_max = tv(1, 'derived');
    const est = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(est.sizeQualifier).toBeNull();
    expect(est.scaleM).toBeNull();
    // Worded by cause (N3): the size is known but hidden.
    expect(est.notes.join(' ')).toMatch(/hidden at this level/);
    expect(est.notes.join(' ')).not.toMatch(/not known/);
  });

  it('the nucleus keeps its size across epochs and honesty levels while the coma radius is known (N2)', () => {
    const { card, params } = keyedComet();
    const radii = new Set<number>();
    for (const epoch of ['2025-08', '2025-12'] as CometEpoch[]) {
      for (const honesty of ['measured', 'derived', 'artistic'] as HonestyState[]) {
        radii.add(planRender(card, params, defaultContext({ epoch, honesty })).bodies[0]!.axes[0]);
      }
    }
    expect(radii.size).toBe(1);
  });

  it('with no coma radius the nucleus says it is not to scale (N2)', () => {
    const { card, params } = fixture('comet');
    delete card.coma_radius_km;
    const plan = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(plan.notes.join(' ')).toMatch(/not drawn to scale/);
  });

  it('never exceeds 60k points with every gas at its maximum plus the dust (R5.5, N4)', () => {
    const { card, params } = keyedComet();
    card.gas_Q = {
      '2025-08': { co2: tv(1e26), h2o: tv(1e26), co: tv(1e26) },
      '2025-12': { co2: tv(1e26), h2o: tv(1e26), co: tv(1e26) },
    } as unknown as ObjectCard['gas_Q'];
    const plan = planRender(
      card,
      params,
      defaultContext({ epoch: '2025-12', honesty: 'artistic' }),
    );
    expect(plan.shells).toHaveLength(3);
    expect(plan.dust).not.toBeNull();
    const total = plan.shells.reduce((n, s) => n + s.count, 0) + plan.dust!.count;
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_POINTS);
    expect(MAX_TOTAL_POINTS).toBe(60_000);
  });

  it('shells are measured Q with the 1/r^2 profile labelled model_dependent, and the legend has colours', () => {
    const { card, params } = fixture('comet');
    const plan = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    const shells = plan.drawn.find((l) => l.id === 'gas_shells')!;
    expect(shells.tag).toBe('model_dependent');
    expect(shells.swatches?.map((s) => s.label)).toEqual(GAS_STYLE.map((g) => g.label));
    // At Measured only the shells (model_dependent) are not drawn.
    const m = planRender(card, params, defaultContext({ epoch: '2025-08', honesty: 'measured' }));
    expect(m.shells).toEqual([]);
    expect(missing(m, 'gas_shells')?.reason).toBe('honesty');
  });

  it('the nucleus is a point when its size is missing, and is labelled an upper limit when known', () => {
    const { card, params } = fixture('comet');
    const known = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(known.notes.join(' ')).toMatch(/upper limit/);
    delete card.nucleus_radius_km_max;
    const point = planRender(card, params, defaultContext({ epoch: '2025-08' }));
    expect(missing(point, 'nucleus')?.reason).toBe('data');
    expect(point.bodies).toHaveLength(1);
    expect(point.notes.join(' ')).toMatch(/point/);
  });

  it('planShells with no Q gives no shells', () => {
    const { card } = fixture('comet');
    delete card.gas_Q;
    expect(planShells(card, '2025-08', 1)).toEqual([]);
  });
});

describe('brown dwarfs (R7.4)', () => {
  it('the glow is not invented: while the normalisation is [verify], the emissive layer is refused', () => {
    const { card, params } = fixture('brown_dwarf');
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'emissive')?.reason).toBe('unverified');
    expect(plan.bodies[0]?.emissive).toBe(1);
  });

  it('with a reference value the glow follows the measured flux', () => {
    const { card, params } = fixture('brown_dwarf');
    const input: PlanInput = { card, params, ctx: defaultContext() };
    const plan = planBrownDwarf(input, { flux45Reference: 1e12 });
    expect(ids(plan.drawn)).toContain('emissive');
    expect(plan.bodies[0]?.emissive).toBe(EMISSIVE_FLOOR);
    const big = planBrownDwarf(input, { flux45Reference: 1e-12 });
    expect(big.bodies[0]?.emissive).toBe(1);
  });

  it('draws the band texture only at + Artistic, and only in the visible view (B3)', () => {
    const { card, params } = fixture('brown_dwarf');
    const at = (honesty: HonestyState, mode: 'visible' | 'spherex_ir') =>
      planRender(card, params, defaultContext({ honesty, mode }));
    expect(at('derived', 'visible').bodies[0]?.albedoUrl).toBeNull();
    const vis = at('artistic', 'visible');
    expect(vis.bodies[0]?.albedoUrl).toBe(params.textures?.albedo);
    // The baked map holds the colour, so the tint is white and not applied a second time.
    expect(vis.bodies[0]?.tint).toEqual([1, 1, 1]);
    // In the infrared view the visible-palette map is dropped, and the SPHEREx average shows.
    const ir = at('artistic', 'spherex_ir');
    expect(ir.bodies[0]?.albedoUrl).toBeNull();
    expect(missing(ir, 'bands')?.reason).toBe('mode');
    expect(ir.bodies[0]?.tint).toEqual(ir.tint.rgb);
  });

  it('the binary has two bodies only with the illustrative orbit, and no numbers are shown', () => {
    const { card, params } = fixture('brown_dwarf_binary');
    const est = planRender(card, params, defaultContext());
    expect(est.bodies).toHaveLength(1);
    expect(missing(est, 'orbit')?.reason).toBe('honesty');
    const art = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(art.bodies).toHaveLength(2);
    expect(art.bodies[0]!.position[0]).toBeLessThan(0);
    expect(art.bodies[1]!.position[0]).toBeGreaterThan(0);
    expect(JSON.stringify(art.notes)).not.toMatch(/\d+\s*(yr|years|AU)/);
  });
});

describe('stars (R7.5)', () => {
  it('colour (derived) and limb darkening (model_dependent) are drawn at + Estimated', () => {
    const { card, params } = fixture('star');
    const plan = planRender(card, params, defaultContext());
    expect(ids(plan.drawn)).toEqual(expect.arrayContaining(['colour', 'limb_darkening']));
    expect(plan.bodies[0]?.limbDarkening).toBe(true);
    expect(plan.bodies[0]?.tint).toEqual(plan.tint.rgb);
    const m = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(m.bodies[0]?.tint).toEqual([0.5, 0.5, 0.5]);
  });

  it('the star motion trail is not drawn until the SPHEREx time span is verified', () => {
    const { card, params } = fixture('star');
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'motion_trail')?.reason).toBe('unverified');
    const withSpan = planStar({ card, params, ctx: defaultContext() }, { spherexBaselineYears: 1 });
    expect(withSpan.trails).toHaveLength(1);
    expect(withSpan.trails[0]?.pm).toEqual(card.pm_mas_yr?.value);
  });

  it('Mira brightness follows the light curve as you scrub, and flagged points are left out', () => {
    const { card, params } = fixture('star_mira');
    card.lightcurve = [
      { t_mjd: 1, flux: 10, sigma: 1, lambda_um: 1, flags: 0 },
      { t_mjd: 2, flux: 2, sigma: 1, lambda_um: 1, flags: 0 },
      { t_mjd: 3, flux: 100, sigma: 1, lambda_um: 1, flags: 1 },
    ];
    expect(lightcurveScrub(card, 0)).toMatchObject({ count: 2, flagged: 1, brightness: 1 });
    expect(lightcurveScrub(card, 1)?.brightness).toBeCloseTo(0.2);
    expect(lightcurveScrub(card, 99)?.index).toBe(1);
    const bright = planRender(card, params, defaultContext({ scrubIndex: 0 }));
    const dim = planRender(card, params, defaultContext({ scrubIndex: 1 }));
    expect(bright.bodies[0]!.emissive).toBeGreaterThan(dim.bodies[0]!.emissive);
    // Pulsation is artistic: only at + Artistic.
    const pulse = planRender(card, params, defaultContext({ scrubIndex: 1, honesty: 'artistic' }));
    expect(pulse.bodies[0]!.axes[0]).toBeLessThan(1);
    expect(bright.bodies[0]!.axes[0]).toBe(1);
  });

  it('T Tauri: disc and dust screen are artistic, with opacity = clamp(1 - flux/median, 0, 0.9)', () => {
    const { card, params } = fixture('star_ttauri');
    card.lightcurve = [
      { t_mjd: 1, flux: 10, sigma: 1, lambda_um: 1, flags: 0 },
      { t_mjd: 2, flux: 10, sigma: 1, lambda_um: 1, flags: 0 },
      { t_mjd: 3, flux: 1, sigma: 1, lambda_um: 1, flags: 0 },
    ];
    expect(screenOpacity(card, 0)).toBe(0);
    expect(screenOpacity(card, 2)).toBeCloseTo(0.9);
    const est = planRender(card, params, defaultContext({ scrubIndex: 2 }));
    expect(est.discs).toEqual([]);
    expect(est.screens).toEqual([]);
    const art = planRender(card, params, defaultContext({ scrubIndex: 2, honesty: 'artistic' }));
    expect(art.discs).toHaveLength(1);
    expect(art.screens[0]?.opacity).toBeCloseTo(0.9);
  });
});

describe('a star without a radius (B5, B6)', () => {
  it('is still drawn as a unit sphere with colour and limb darkening, but no scale bar', () => {
    const { card, params } = fixture('star');
    delete card.radius_rsun;
    const plan = planRender(card, params, defaultContext());
    expect(plan.bodies).toHaveLength(1);
    expect(plan.bodies[0]?.axes).toEqual([1, 1, 1]);
    expect(plan.bodies[0]?.limbDarkening).toBe(true);
    expect(ids(plan.drawn)).toEqual(expect.arrayContaining(['colour', 'limb_darkening']));
    expect(plan.scaleM).toBeNull();
    expect(plan.sizeTag).toBeNull();
    expect(missing(plan, 'size')).toMatchObject({ reason: 'data', fields: ['radius_rsun'] });
    expect(missing(plan, 'body')).toBeUndefined();
    expect(plan.notes.join(' ')).toMatch(/no scale bar/);
  });

  it('draws no bare grey ball when nothing can be shown on it', () => {
    const { card, params } = fixture('star');
    delete card.radius_rsun;
    const plan = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(plan.bodies).toEqual([]);
    expect(missing(plan, 'body')).toMatchObject({ reason: 'data' });
  });

  it('a drawn star has a legend line for the sphere at the radius on the card', () => {
    const { card, params } = fixture('star');
    for (const honesty of HONESTY_STATES) {
      const plan = planRender(card, params, defaultContext({ honesty }));
      if (plan.bodies.length > 0) {
        expect(ids(plan.drawn)).toContain('body');
        expect(plan.drawn.length).toBeGreaterThan(0);
      }
    }
    expect(planRender(card, params, defaultContext()).drawn[0]).toMatchObject({ id: 'body' });
  });

  it('the T Tauri disc and star trail are inside the framed view (N17)', () => {
    const { card, params } = fixture('star_ttauri');
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.discs).toHaveLength(1);
    expect(plan.extent).toBeGreaterThanOrEqual(plan.discs[0]!.outerRadius);
    const sphere = planRender(
      ...(Object.values(fixture('asteroid_shape')) as [ObjectCard, never]),
      defaultContext(),
    );
    expect(sphere.extent).toBe(1);
  });
});

describe('display defaults and the lighting tag (N10)', () => {
  it('a light from the front is a listed default, and its tag is not measured', () => {
    const { card, params } = fixture('asteroid_shape');
    delete params.lighting.phase_angle_deg;
    delete params.lighting.sun_dir;
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'lighting')?.defaultShown).toMatch(/light comes from the front/);
    expect(plan.lighting.tag).toBe('artistic');
    // A phase angle that the card does not tag is not claimed as measured either.
    const q = fixture('asteroid_shape');
    delete q.card.phase_angle_deg;
    expect(planRender(q.card, q.params, defaultContext()).lighting.tag).toBe('artistic');
  });

  it('the brown dwarf glow at the default level is a listed default', () => {
    const { card, params } = fixture('brown_dwarf');
    const plan = planRender(card, params, defaultContext());
    expect(missing(plan, 'emissive')?.defaultShown).toMatch(/fixed level/);
  });
});

describe('Measured only prefers a measured infrared tint to plain grey (N8)', () => {
  it('opens on the mode whose colour passes the honesty state', () => {
    const { card, params } = fixture('asteroid_shape');
    const plan = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(plan.mode).toBe('spherex_ir');
    expect(plan.tint.tag).toBe('measured');
    // The user's own choice is kept.
    const chosen = planRender(
      card,
      params,
      defaultContext({ honesty: 'measured', mode: 'visible' }),
    );
    expect(chosen.mode).toBe('visible');
    expect(chosen.tint.tag).toBeNull();
    // At + Estimated the usual default stays.
    expect(planRender(card, params, defaultContext()).mode).toBe('visible');
  });
});

describe('mesh addresses (Q-44)', () => {
  it('a cross-origin address is a refused mesh layer; a same-origin path is used', () => {
    const { card, params } = fixture('asteroid_shape');
    card.shape_source = { value: 'https://example.org/bennu.glb', tag: 'measured', source: 't' };
    const remote = planRender(card, params, defaultContext());
    expect(missing(remote, 'mesh')?.reason).toBe('load');
    expect(remote.bodies[0]?.meshUrl).toBeNull();
    card.shape_source = { value: '//example.org/bennu.glb', tag: 'measured', source: 't' };
    expect(planRender(card, params, defaultContext()).bodies[0]?.meshUrl).toBeNull();
    card.shape_source = { value: '/meshes/bennu.glb', tag: 'measured', source: 't' };
    expect(planRender(card, params, defaultContext()).bodies[0]?.meshUrl).toBe('/meshes/bennu.glb');
  });
});

describe('size explanation (B4)', () => {
  it('carries the formula, assumption or source of the size into the plan', () => {
    const { card, params } = fixture('brown_dwarf');
    card.radius_rjup = {
      value: 1,
      tag: 'model_dependent',
      source: 'src',
      assumption: 'about 1 Jupiter radius',
    };
    expect(planRender(card, params, defaultContext()).sizeWhy).toBe('about 1 Jupiter radius');
    card.radius_rjup = { value: 1, tag: 'derived', source: 'src', formula: 'R = f(L)' };
    expect(planRender(card, params, defaultContext()).sizeWhy).toBe('R = f(L)');
    card.radius_rjup = { value: 1, tag: 'measured', source: 'a catalogue' };
    expect(planRender(card, params, defaultContext()).sizeWhy).toBe('a catalogue');
    // No size shown, no explanation of it.
    card.radius_rjup = { value: 1, tag: 'derived', source: 'src', formula: 'R = f(L)' };
    expect(planRender(card, params, defaultContext({ honesty: 'measured' })).sizeWhy).toBeNull();
  });
});

describe('candidate (R7.6)', () => {
  it('has no 3D and shows the R7.6 message', () => {
    const { card, params } = fixture('candidate');
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.threeD).toBe(false);
    expect(plan.bodies).toEqual([]);
    expect(plan.message).toBe(CANDIDATE_MESSAGE);
    expect(plan.message).toMatch(/Not enough data for a 3D model: distance and albedo unknown/);
  });
});
