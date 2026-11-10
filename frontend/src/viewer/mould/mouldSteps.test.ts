// Issue #60: the build animation's step → layer mapping and progress math. The last stage must be
// the normal plan (nothing held, every knob 1), no stage may draw a layer the plan does not draw,
// and the timing is the mock-up's (STAGE_S per step, smoothstep).
import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixture, withoutExoplanetFields } from '@/test/sharedFixtures';
import { defaultContext, planRender } from '../renderPlan';
import { stagePlan } from '@/app/build/useMould';
import {
  ease,
  holdAt,
  isDone,
  mouldScript,
  NORMAL_POSE,
  poseAt,
  STAGE_S,
  stageAt,
  stepProgress,
  TINT,
  usesBrowserSeed,
} from './mouldSteps';
import type { HonestyState } from '../honesty';

const HONESTY: HonestyState[] = ['measured', 'derived', 'artistic'];
const planOf = (name: string, honesty: HonestyState, solarSystem = false) => {
  const f = fixture(name);
  const { card, params } = solarSystem ? withoutExoplanetFields(f) : f;
  const ctx = defaultContext({ honesty });
  return { card, params, ctx, plan: planRender(card, params, ctx) };
};

describe('mould timing (mock-up loop)', () => {
  it('eases with smoothstep and runs the steps one after another', () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(1)).toBe(1);
    expect(stepProgress(0, 3)).toEqual([0, 0, 0]);
    expect(stepProgress(STAGE_S / 2, 3)).toEqual([0.5, 0, 0]);
    expect(stepProgress(STAGE_S * 1.5, 3)).toEqual([1, 0.5, 0]);
    expect(stepProgress(STAGE_S * 10, 3)).toEqual([1, 1, 1]);
    expect(stageAt(0, 4)).toBe(0);
    expect(stageAt(STAGE_S * 1.01, 4)).toBe(1);
    expect(stageAt(STAGE_S * 99, 4)).toBe(3);
    expect(isDone(4 * STAGE_S, 4)).toBe(false);
    expect(isDone(4 * STAGE_S + 0.31, 4)).toBe(true);
  });
});

describe('water planet (mock-up PLAN.water)', () => {
  it('has the mock-up steps, in order, at + Artistic', () => {
    const { plan } = planOf('planet_water', 'artistic');
    const s = mouldScript(plan)!;
    expect(s.kind).toBe('water');
    expect(s.steps.map((x) => x.label)).toEqual([
      'Base mould',
      'Terrain',
      'Oceans',
      'Colour',
      'Clouds',
    ]);
    expect(s.steps.map((x) => x.knobs)).toEqual([[], ['terrain'], ['sea'], ['colour'], ['clouds']]);
  });

  it('maps step progress to the mock-up uniforms', () => {
    const s = mouldScript(planOf('planet_water', 'artistic').plan)!;
    const start = poseAt(s, [0, 0, 0, 0, 0]);
    expect(start.scale).toBeCloseTo(0.55);
    expect(start.wire).toBe(0);
    expect([start.terrain, start.sea, start.colour, start.clouds]).toEqual([0, 0, 0, 0]);
    // Base mould done, terrain half way: the wire is .9 * P0 * (1 - P1).
    const mid = poseAt(s, [1, 0.5, 0, 0, 0]);
    expect(mid.scale).toBe(1);
    expect(mid.wire).toBeCloseTo(0.45);
    expect(mid.terrain).toBe(0.5);
    expect(poseAt(s, [1, 1, 1, 1, 1])).toEqual(NORMAL_POSE);
  });

  it('shows only the plain sphere step when the surface is hidden (+ Estimated)', () => {
    const s = mouldScript(planOf('planet_water', 'derived', true).plan);
    expect(s?.steps.map((x) => x.label) ?? []).toEqual(['Base mould']);
  });

  it('an exoplanet at + Estimated builds the starlight step and the climate pattern step', () => {
    // Part 6 (Q-165): the starlight is `derived`, so it is shown from + Estimated and is revealed in
    // the first step after the base mould; the climate pattern (model_dependent) is shown on a
    // smooth sphere in the step that reveals ice and ocean.
    const s = mouldScript(planOf('planet_water', 'derived').plan);
    // Q-166: with no artistic surface drawn, the steps say what they reveal, not "Terrain"/"Colour".
    expect(s?.steps.map((x) => x.label)).toEqual(['Base mould', 'Starlight', 'Climate']);
    expect(s?.steps[1]?.hint).toBe('Light from the host star');
    expect(s?.steps[1]?.reveals).toEqual(['starlight']);
    expect(s?.steps[2]?.reveals).toContain('climate');
  });
});

describe.each(['planet_trappist1f', 'planet_kepler186f'])('%s (the demo exoplanets)', (name) => {
  it('Measured only: a plain sphere, one step, no starlight', () => {
    const p = planOf(name, 'measured').plan;
    const s = mouldScript(p)!;
    expect(s.steps.map((x) => x.label)).toEqual(['Base mould']);
    expect(p.drawn.map((d) => d.id)).not.toContain('starlight');
    expect(p.lighting.colour).toBeNull();
  });

  it('+ Estimated: starlight comes in the first step after the base mould; the climate pattern follows (both are locked)', () => {
    const s = mouldScript(planOf(name, 'derived').plan)!;
    expect(s.steps[0]!.label).toBe('Base mould');
    expect(s.steps[1]!.label).toBe('Starlight');
    expect(s.steps[1]!.reveals).toContain('starlight');
    // Both are locked (eyeball or snowball pattern on a smooth sphere). Kepler-186 f is locked by a
    // knife edge (Q-155: 3.99 against 4.0 Gyr), which follows from the constants, not from the test.
    const colour = s.steps.find((x) => x.label === 'Climate');
    expect(colour?.reveals).toContain('climate');
    expect(colour?.hint).toMatch(/^(Ice and bare ground|Ice over the whole surface) \(a model\)$/);
  });

  it('+ Artistic: every step reveals a drawn layer or runs a knob; starlight is first', () => {
    const { plan } = planOf(name, 'artistic');
    const s = mouldScript(plan)!;
    expect(s.kind).toBe('rocky');
    expect(s.steps.map((x) => x.label)).toEqual(['Base mould', 'Terrain', 'Colour', 'Air']);
    expect(s.steps[1]!.reveals).toContain('starlight');
    expect(s.steps[2]!.reveals).toContain('climate');
    for (const st of s.steps)
      expect(st.reveals.length + (st.knobs?.length ?? 0)).toBeGreaterThan(0);
  });
});

describe.each(HONESTY)('every fixture at %s', (honesty) => {
  it.each(FIXTURE_NAMES)('%s: stages only hold layers; the last stage is the plan', (name) => {
    const { card, params, ctx, plan } = planOf(name, honesty);
    const s = mouldScript(plan);
    if (!s) {
      expect(plan.threeD && plan.drawn.length > 0 && name !== 'candidate').toBe(false);
      return;
    }
    const drawn = new Set(plan.drawn.map((d) => d.id));
    // Every drawn layer is revealed by exactly one step; nothing else is.
    const all = s.steps.flatMap((x) => x.reveals);
    expect(new Set(all).size).toBe(all.length);
    for (const id of drawn) expect(all).toContain(id);
    for (const id of all) expect(id === TINT || drawn.has(id)).toBe(true);
    // The last stage holds nothing and is the very same plan.
    const last = s.steps.length - 1;
    expect(holdAt(s, last)).toEqual([]);
    expect(stagePlan(card, params, ctx, plan, s, last)).toBe(plan);
    // Earlier stages draw a subset of the plan's layers and are framed like it.
    for (let i = 0; i < last; i++) {
      const sp = stagePlan(card, params, ctx, plan, s, i);
      for (const d of sp.drawn) {
        // The base mould may be the plain body at the size on the card, which the plan shows
        // under its own layer (the ellipsoid, the mesh): the same body and size, not a new layer.
        const ok = drawn.has(d.id) || (d.id === 'body' && plan.sizeTag !== null);
        expect(ok, `${name} stage ${i}: ${d.id}`).toBe(true);
      }
      for (const id of holdAt(s, i)) expect(sp.drawn.some((d) => d.id === id)).toBe(false);
      expect(sp.extent).toBe(plan.extent);
      // A held layer is a presentation step, not a refusal.
      const refused = new Set(sp.missing.map((m) => m.id));
      for (const id of holdAt(s, i)) expect(refused.has(id), `${name}: ${id} refused`).toBe(false);
    }
    // At progress 1 every knob is the normal render.
    expect(
      poseAt(
        s,
        s.steps.map(() => 1),
      ),
    ).toEqual(NORMAL_POSE);
  });
});

describe('step → layer mapping per kind', () => {
  it('asteroid with a shape model: mesh in Shape, shading in Relief', () => {
    const { card, params } = fixture('asteroid_shape');
    // A loadable same-origin model address (the fixture's own is deliberately not loadable).
    card.shape_source = { ...card.shape_source!, value: '/meshes/fixture.glb' };
    const s = mouldScript(planRender(card, params, defaultContext({ honesty: 'artistic' })))!;
    const by = Object.fromEntries(s.steps.map((x) => [x.label, x.reveals]));
    expect(by['Shape']).toContain('mesh');
    expect(s.steps.find((x) => x.label === 'Shape')!.knobs).toEqual(['shape']);
    expect(by['Relief']).toEqual(expect.arrayContaining(['reflectance']));
  });

  it('procedural asteroid: ellipsoid in Shape, relief map in Relief, albedo in Colour', () => {
    const s = mouldScript(planOf('asteroid_procedural', 'artistic').plan)!;
    const by = Object.fromEntries(s.steps.map((x) => [x.label, x.reveals]));
    expect(by['Shape']).toEqual(['ellipsoid']);
    expect(by['Relief']).toContain('relief');
    expect(by['Colour']).toContain('albedo_map');
  });

  it('a held tint draws the body plain grey until the Colour step', () => {
    const { card, params, ctx, plan } = planOf('asteroid_procedural', 'measured');
    const s = mouldScript(plan)!;
    const first = stagePlan(card, params, ctx, plan, s, 0);
    if (s.all.includes(TINT)) expect(first.tint.tag).toBeNull();
  });

  it('nova: Spark then Blast, growing from .03 of its size (mock-up)', () => {
    const s = mouldScript(planOf('nova', 'artistic').plan)!;
    expect(s.steps.map((x) => x.label)).toEqual(['Spark', 'Blast']);
    expect(poseAt(s, [1, 0]).scale).toBeCloseTo(0.03 / 0.925);
    expect(poseAt(s, [1, 1]).scale).toBe(1);
  });

  it('gas giant (issue #62): Bands, Storms, Colour reveal the five layers one after another', () => {
    const { card, params, ctx, plan } = planOf('gas_giant', 'artistic');
    const s = mouldScript(plan)!;
    expect(s.kind).toBe('gas');
    expect(s.steps.map((x) => x.label)).toEqual(['Base mould', 'Bands', 'Storms', 'Colour']);
    const reveals = s.steps.map((x) => x.reveals);
    expect(reveals[1]).toEqual(
      expect.arrayContaining(['bands', 'flattening', 'turbulence', 'jets']),
    );
    expect(reveals[2]).toEqual(expect.arrayContaining(['storms', 'storm_drift']));
    expect(reveals[3]).toEqual(['colour']);
    // The stage plans switch the layers the body draws: bands first, storms next, colour last.
    const on = (i: number) => stagePlan(card, params, ctx, plan, s, i).shader!.gas;
    expect(on(0)).toMatchObject({ bands: false, storms: false, colour: false });
    expect(on(1)).toMatchObject({ bands: true, flattening: true, storms: false, colour: false });
    expect(on(2)).toMatchObject({ bands: true, storms: true, colour: false });
    expect(on(3)).toMatchObject({ bands: true, storms: true, colour: true, turbulence: true });
    // At + Estimated the swirl look is not drawn, so it is not in any step.
    const est = mouldScript(planOf('gas_giant', 'derived').plan)!;
    expect(est.steps.flatMap((x) => x.reveals)).not.toContain('turbulence');
  });

  it('brown dwarf: limb darkening is revealed with the colour', () => {
    const s = mouldScript(planOf('brown_dwarf', 'artistic').plan)!;
    expect(s.steps.find((x) => x.label === 'Colour')?.reveals).toContain('limb_darkening');
  });

  it('candidate has nothing to build', () => {
    expect(mouldScript(planOf('candidate', 'artistic').plan)).toBeNull();
  });
});

describe('New seed only where the browser uses the seed', () => {
  it('baked asteroids are the same for any seed; generated bodies are not', () => {
    expect(usesBrowserSeed(planOf('asteroid_procedural', 'artistic').plan)).toBe(false);
    expect(usesBrowserSeed(planOf('planet_water', 'artistic').plan)).toBe(true);
    expect(usesBrowserSeed(planOf('gas_giant', 'artistic').plan)).toBe(true);
    expect(usesBrowserSeed(planOf('nebula', 'artistic').plan)).toBe(true);
  });
});
