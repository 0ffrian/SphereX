// Issue #68 Track B through the viewer: starlight colour (Part 2), the climate scenario and the
// locked pose (Part 3) in the plan, the spec and the lighting. Typed local fixtures: the shared
// card fixtures get the new fields from Track A.
import { describe, expect, it } from 'vitest';
import type { ObjectCard, RenderParams } from '@/contract';
import { kepler186f, trappist1f } from '@/physics/exoplanetFixtures.testutil';
import { starlightColour } from '@/physics/starlight';
import { derivePhysics } from '@/physics';
import { fixture } from '@/test/sharedFixtures';
import { DIRECTIONAL_INTENSITY, buildLights, planLighting } from './lighting';
import { defaultContext, planRender } from './renderPlan';
import { resolveShaderSpec } from './renderers/shaderSpec';
import { fieldHash, generateField } from './fields/fieldGenerator';

function pair(
  card: ObjectCard,
  kind: 'planet_rocky' | 'planet_water' | 'gas_giant' = 'planet_rocky',
) {
  const f = fixture(kind);
  const params: RenderParams = { ...f.params, id: card.id, scale_m: 6.4e6 };
  const c = { ...card, type: kind } as ObjectCard;
  return { card: c, params };
}
const plan = (card: ObjectCard, honesty: 'measured' | 'derived' | 'artistic' = 'artistic') => {
  const p = pair(card);
  return planRender(p.card, p.params, defaultContext({ honesty }));
};
const drawn = (p: ReturnType<typeof plan>, id: string) => p.drawn.find((d) => d.id === id);
const missing = (p: ReturnType<typeof plan>, id: string) => p.missing.find((m) => m.id === id);

describe('starlight (Part 2)', () => {
  it('colours the light by the host Teff at unit luminance and draws the legend line', () => {
    const p = plan(trappist1f(), 'derived');
    expect(p.lighting.colour).toEqual(starlightColour(2566));
    expect(p.lighting.colourTeffK).toBe(2566);
    const l = drawn(p, 'starlight')!;
    expect(l.tag).toBe('derived');
    expect(l.description).toContain('Light coloured like the host star (2566 K)');
  });

  it('is derived for a measured Teff and weaker for a weaker Teff', () => {
    const c = kepler186f();
    c.host_teff_K = { value: 3755, tag: 'model_dependent', source: 'test', assumption: 'test' };
    expect(plan(c, 'derived').lighting.colourTag).toBe('model_dependent');
  });

  it('is hidden at Measured only (derived is not measured): the light stays white', () => {
    const p = plan(trappist1f(), 'measured');
    expect(drawn(p, 'starlight')).toBeUndefined();
    expect(missing(p, 'starlight')).toMatchObject({ reason: 'honesty' });
    expect(p.lighting.colour).toBeNull();
  });

  it('is refused with the field named, and the light is white, when host_teff_K is null', () => {
    const c = trappist1f();
    c.host_teff_K = { value: null, tag: 'measured', source: 'archive: st_teff empty' };
    const p = plan(c);
    expect(missing(p, 'starlight')).toMatchObject({ reason: 'data', fields: ['host_teff_K'] });
    expect(p.lighting.colour).toBeNull();
  });

  it('leaves solar-system bodies and gas-free cards without the fields exactly as they were', () => {
    for (const k of ['planet_rocky', 'planet_water', 'gas_giant'] as const) {
      const f = fixture(k);
      const p = planRender(f.card, f.params, defaultContext({ honesty: 'artistic' }));
      expect(p.lighting.colour, k).toBeNull();
      expect(
        p.drawn.some((d) => d.id === 'starlight'),
        k,
      ).toBe(false);
      expect(
        p.missing.some((m) => m.id === 'starlight' || m.id === 'tidal_locking'),
        k,
      ).toBe(false);
    }
    // Other kinds never take a colour, even with the field.
    const a = fixture('asteroid_procedural');
    const withTeff = { ...a.card, host_teff_K: { value: 3000, tag: 'measured', source: 't' } };
    expect(planLighting(a.params, withTeff as ObjectCard).colour).toBeNull();
  });

  it('colours the Sun light without changing its exposure', () => {
    const p = plan(trappist1f(), 'derived');
    const [sun] = buildLights(p.lighting) as unknown as [
      { color: { r: number; g: number; b: number }; intensity: number },
    ];
    expect(sun.intensity).toBe(DIRECTIONAL_INTENSITY);
    const [r, g, b] = starlightColour(2566)!;
    expect(sun.color.r).toBeCloseTo(r, 5);
    expect(sun.color.g).toBeCloseTo(g, 5);
    expect(sun.color.b).toBeCloseTo(b, 5);
    // A white light for a plan without a colour.
    const f = fixture('planet_rocky');
    const [w] = buildLights(planLighting(f.params, f.card)) as unknown as [
      { color: { r: number; g: number; b: number } },
    ];
    expect([w.color.r, w.color.g, w.color.b]).toEqual([1, 1, 1]);
  });
});

describe('climate and pose (Part 3)', () => {
  it('TRAPPIST-1 f: eyeball field, locked pose, no spin, a legend line that names the formula inputs', () => {
    const { card, params } = pair(trappist1f());
    const spec = resolveShaderSpec(card, params);
    expect(spec.planet!.scenario).toBe('eyeball');
    expect(spec.field!.substellar).toBe(true);
    expect(spec.field!.iceAngleRad!).toBeCloseTo((51.85 * Math.PI) / 180, 3);
    const p = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(p.spin).toBeNull();
    const l = drawn(p, 'climate')!;
    expect(l.tag).toBe('model_dependent');
    expect(l.description).toMatch(/^Eyeball: bare ground within 52° of the star-facing point/);
    expect(l.description).toContain('no heat spread, no greenhouse');
    expect(p.notes.join(' ')).toContain('tidally locked');
  });

  it('a water world says open water', () => {
    const p = pair(trappist1f(), 'planet_water');
    const l = drawn(
      planRender(p.card, p.params, defaultContext({ honesty: 'artistic' })),
      'climate',
    )!;
    expect(l.description).toMatch(/^Eyeball: open water within 52°/);
    expect(resolveShaderSpec(p.card, p.params).field!.seaLevel).toBeGreaterThan(0);
  });

  it('Kepler-186 f: temperate, polar rule as before, still spinning, weakened to model_dependent', () => {
    const { card, params } = pair(kepler186f());
    const spec = resolveShaderSpec(card, params);
    expect(spec.planet!.scenario).toBe('temperate');
    expect(spec.field!.substellar).toBeUndefined();
    expect(spec.field!.iceExtent).toBeGreaterThan(0); // 177 K < 330 K: polar ice as before
    const p = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    const l = drawn(p, 'climate')!;
    expect(l.tag).toBe('model_dependent');
    expect(l.description).toContain('Not tidally locked');
    expect(p.spin).not.toBeNull();
  });

  it('a card with a teq_K but none of the new fields keeps the rule unchanged', () => {
    const f = fixture('planet_water');
    const card = {
      ...f.card,
      teq_K: { value: 250, tag: 'derived', source: 't', formula: 'x' },
    } as ObjectCard;
    const spec = resolveShaderSpec(card, f.params);
    expect(spec.planet!.scenario).toBeNull();
    expect(spec.field!.substellar).toBeUndefined();
    expect(spec.planet!.climate!.tag).toBe('derived');
  });

  it('lava and hot_dry exoplanets keep the existing rule and do not run the locking rule', () => {
    const c = trappist1f();
    c.teq_K = { value: 900, tag: 'measured', source: 't' };
    const { card, params } = pair(c);
    const spec = resolveShaderSpec(card, params);
    expect(spec.planet!.scenario).toBe('lava');
    expect(spec.field!.substellar).toBeUndefined();
    expect(spec.field!.heat).toBeGreaterThan(0);
  });

  it('lists a refused locking rule as missing with the field it lacked', () => {
    const c = trappist1f();
    c.orbit_au = { value: null, tag: 'measured', source: 'archive: empty' };
    const p = plan(c);
    expect(missing(p, 'tidal_locking')).toMatchObject({ reason: 'data', fields: ['orbit_au'] });
    // The body is still drawn, by the polar rule.
    expect(drawn(p, 'climate')).toBeDefined();
  });

  it('is deterministic: the same card gives the same plan', () => {
    const a = plan(trappist1f());
    const b = plan(trappist1f());
    expect(JSON.stringify(a.drawn)).toBe(JSON.stringify(b.drawn));
    const sa = pair(trappist1f());
    const sb = pair(trappist1f());
    expect(JSON.stringify(resolveShaderSpec(sa.card, sa.params))).toBe(
      JSON.stringify(resolveShaderSpec(sb.card, sb.params)),
    );
  });
});

describe('derivePlanet reads mass_mearth from the card (Part 1, Q-58 b)', () => {
  const base = () => ({ ...trappist1f() }) as ObjectCard;
  it('derives density, gravity and escape speed from the card mass with the card tag', () => {
    const r = derivePhysics(base());
    expect(r.missing).not.toContain('density_g_cm3');
    const rho = r.values.density_g_cm3!;
    expect(rho.value as number).toBeCloseTo((5.51 * 1.039) / 1.045 ** 3, 2);
    expect(rho.tag).toBe('derived');
    expect(r.values.gravity_m_s2!.value as number).toBeGreaterThan(8);
  });
  it('a model_dependent card mass gives model_dependent outputs', () => {
    const r = derivePhysics({ ...kepler186f() } as ObjectCard);
    expect(r.values.density_g_cm3!.tag).toBe('model_dependent');
  });
  it('a mass slider wins and the outputs are artistic', () => {
    const r = derivePhysics(base(), { mass_mearth: 2 });
    expect(r.values.density_g_cm3!.tag).toBe('artistic');
    expect(r.values.density_g_cm3!.value as number).toBeCloseTo((5.51 * 2) / 1.045 ** 3, 2);
  });
  it('without a card mass or a slider the outputs are refused as before', () => {
    const c = base();
    delete c.mass_mearth;
    expect(derivePhysics(c).missing).toContain('density_g_cm3');
  });
});

describe('eyeball planet at each honesty level (R5.3, Q-156)', () => {
  const at = (h: 'measured' | 'derived' | 'artistic') => plan(trappist1f(), h);

  it('Measured only: a plain sphere in white light; climate and starlight are hidden', () => {
    const p = at('measured');
    expect(p.shader).toMatchObject({ surface: false, pattern: false, plain: true });
    expect(p.lighting.colour).toBeNull();
    expect(missing(p, 'climate')).toMatchObject({ reason: 'honesty' });
    expect(missing(p, 'starlight')).toMatchObject({ reason: 'honesty' });
    expect(missing(p, 'surface')).toMatchObject({ reason: 'honesty' });
    expect(p.drawn.map((d) => d.id)).not.toContain('climate');
  });

  it('+ Estimated: starlight and the climate pattern on a smooth sphere, the artistic terrain hidden, no artistic layer drawn, the locked pose applies', () => {
    const p = at('derived');
    expect(p.shader).toMatchObject({ surface: false, pattern: true, plain: false });
    expect(p.lighting.colour).not.toBeNull();
    expect(drawn(p, 'climate')!.tag).toBe('model_dependent');
    expect(drawn(p, 'starlight')).toBeDefined();
    expect(missing(p, 'surface')).toMatchObject({ reason: 'honesty' });
    expect(p.drawn.every((d) => d.tag !== 'artistic')).toBe(true);
    expect(p.spin).toBeNull();
    expect(p.notes.join(' ')).toContain('tidally locked');
    expect(p.sizeTag).not.toBeNull();
  });

  it('+ Artistic: the full surface, the climate text and the starlight', () => {
    const p = at('artistic');
    expect(p.shader).toMatchObject({ surface: true, pattern: false, plain: false });
    expect(drawn(p, 'surface')).toBeDefined();
    expect(drawn(p, 'climate')).toBeDefined();
    expect(drawn(p, 'starlight')).toBeDefined();
  });

  it('temperate, lava and hot_dry add nothing at + Estimated', () => {
    const k = plan(kepler186f(), 'derived');
    expect(k.shader).toMatchObject({ surface: false, pattern: false, plain: true });
    const hot = trappist1f();
    hot.teq_K = { value: 900, tag: 'measured', source: 't' };
    expect(plan(hot, 'derived').shader).toMatchObject({ pattern: false, plain: true });
  });

  it('the field at + Estimated is the one field: deterministic bytes, same as the artistic level', () => {
    const { card, params } = pair(trappist1f());
    const a = resolveShaderSpec(card, params).field!;
    const b = resolveShaderSpec(card, params).field!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(fieldHash(generateField(a, 64, 32))).toBe(fieldHash(generateField(b, 64, 32)));
  });
});
