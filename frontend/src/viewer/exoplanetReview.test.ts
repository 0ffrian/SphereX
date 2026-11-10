// Issue #68 review fixes: wording that must follow what is on screen (starlit sphere, pattern,
// refused locking), the legend swatches, the jargon-free legend, and the held-pattern renderer switch.
import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { fixture, withoutExoplanetFields } from '@/test/sharedFixtures';
import { buildAltText } from './altText';
import type { HonestyState } from './honesty';
import { defaultContext, planRender } from './renderPlan';
import { resolveShaderSpec } from './renderers/shaderSpec';
import { STARLIT_SPHERE_NOTE } from './planCommon';

const planOf = (name: string, honesty: HonestyState, edit?: (c: ObjectCard) => void) => {
  const { card, params } = fixture(name);
  edit?.(card);
  const plan = planRender(card, params, defaultContext({ honesty }));
  return { plan, alt: buildAltText(plan), notes: plan.notes.join(' ') };
};

describe('a starlit sphere is not called grey', () => {
  it('a plain sphere (Kepler-186 f with a 3 Gyr star, so unlocked) at + Estimated: legend, note and alt text say it is lit in the star colour', () => {
    const { plan, alt, notes } = planOf('planet_kepler186f', 'derived', (c) => {
      c.host_age_gyr = { value: 3, tag: 'measured', source: 'test: younger than t_lock' };
    });
    expect(plan.drawn.map((d) => d.id)).toContain('starlight');
    expect(notes).not.toMatch(/plain grey/i);
    expect(alt).not.toMatch(/plain grey/i);
    expect(notes).toContain(STARLIT_SPHERE_NOTE);
    expect(plan.drawn.find((d) => d.id === 'body')?.description).toBe(STARLIT_SPHERE_NOTE);
    expect(alt).toContain('A smooth sphere lit in the colour of its host star (an estimate)');
  });

  it('Measured only keeps the grey wording: no colour is shown', () => {
    const { alt, notes } = planOf('planet_kepler186f', 'measured');
    expect(notes).toMatch(/plain grey/);
    expect(alt).toContain('A plain grey sphere');
  });
});

describe('the pattern alt text follows the planet kind and scenario', () => {
  it('TRAPPIST-1 f (rocky): bare ground, not water', () => {
    const { plan, alt } = planOf('planet_trappist1f', 'derived');
    expect(plan.shader?.pattern).toBe(true);
    expect(alt).toMatch(
      /only (where the model puts bare ground and ice on a tidally locked planet|the model's ice, over the whole surface)/,
    );
    expect(alt).not.toMatch(/puts water/);
  });

  it('the pattern legend names ice and the ground or water in its swatches', () => {
    const { plan } = planOf('planet_trappist1f', 'derived');
    const labels = plan.drawn.find((d) => d.id === 'climate')?.swatches?.map((s) => s.label);
    expect(labels).toContain('Ice');
    expect(labels?.some((l) => l === 'Bare ground') || labels?.length === 1).toBe(true);
  });

  it('the legend line has no locking-time numbers or spec ids; they are in the formula', () => {
    for (const h of ['derived', 'artistic'] as const) {
      const e = planOf('planet_trappist1f', h).plan.drawn.find((d) => d.id === 'climate')!;
      expect(e.description).not.toMatch(/Gyr|\[verify\]|R7\.5|locking time/);
    }
    // The numbers stay available in the layer's formula (the disclosure).
    const { card, params } = fixture('planet_trappist1f');
    expect(resolveShaderSpec(card, params).planet?.climate?.formula).toMatch(/locking time/);
  });
});

describe('a refused locking rule is not "not tidally locked"', () => {
  const noMass = (c: ObjectCard) => {
    delete (c as unknown as Record<string, unknown>).host_mass_msun;
  };
  it.each(['derived', 'artistic'] as const)('at %s, the words say it could not be tested', (h) => {
    const { plan, alt, notes } = planOf('planet_trappist1f', h, noMass);
    expect(plan.missing.some((m) => m.id === 'tidal_locking')).toBe(true);
    for (const text of [alt, notes]) {
      expect(text).toContain('could not be tested');
      expect(text).not.toMatch(/temperate|not tidally locked/);
    }
    const look = plan.drawn.find((d) => d.id === 'look');
    if (look) expect(look.description).toMatch(/could not be tested/);
    if (look) expect(look.description).not.toMatch(/temperate/);
  });

  it('a tested, unlocked planet is still called temperate', () => {
    const { alt } = planOf('planet_kepler186f', 'derived', (c) => {
      c.host_age_gyr = { value: 3, tag: 'measured', source: 'test: younger than t_lock' };
    });
    expect(alt).toContain('temperate world that is not tidally locked');
  });
});

describe('the Measured-only binary brown dwarf draws no body and says no "first body"', () => {
  it('brown_dwarf_binary at Measured only', () => {
    const f = withoutExoplanetFields(fixture('brown_dwarf_binary'));
    const plan = planRender(f.card, f.params, defaultContext({ honesty: 'measured' }));
    expect(plan.drawn.some((d) => d.id === 'body')).toBe(false);
    expect(plan.notes.join(' ')).not.toMatch(/Only the first body/);
  });
});
