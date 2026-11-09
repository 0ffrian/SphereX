// Issue #68 Part 6 (Q-165): what the alt text and notes of the two demo exoplanets say about the
// star's light and the climate scenario, at each honesty level. Never a measured surface.
import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/sharedFixtures';
import { buildAltText } from './altText';
import type { HonestyState } from './honesty';
import { defaultContext, planRender } from './renderPlan';

const at = (name: string, honesty: HonestyState) => {
  const { card, params } = fixture(name);
  const plan = planRender(card, params, defaultContext({ honesty }));
  return { plan, alt: buildAltText(plan), notes: plan.notes.join(' ') };
};

describe.each(['planet_trappist1f', 'planet_kepler186f'])('%s', (name) => {
  it('Measured only: a plain sphere; the hidden light and scenario say which level shows them', () => {
    const { alt, notes, plan } = at(name, 'measured');
    expect(plan.drawn.map((d) => d.id)).toEqual(['body']);
    for (const text of [alt, notes]) {
      expect(text).toContain('choose + Estimated to see it coloured like its host star');
      expect(text).toMatch(
        /climate scenario .* is hidden here; choose \+ (Estimated|Artistic) to see it/,
      );
    }
    expect(alt).toContain('A plain grey sphere');
  });

  it('+ Estimated: the starlight is said to be an estimate, never a measured colour', () => {
    const { alt, notes } = at(name, 'derived');
    for (const text of [alt, notes])
      expect(text).toMatch(
        /coloured like its host star \(\d+ K\): an estimate from the star's temperature, not a measured colour/,
      );
    // Every mention of a measured surface or image is a denial.
    for (const m of alt.matchAll(/(\w+ ){0,2}measured (surface|image|colour)/g))
      expect(m[0]).toMatch(/not a measured/);
  });

  it('+ Artistic: the scenario is a model, the picture an artist impression', () => {
    const { alt, notes } = at(name, 'artistic');
    expect(alt).toContain("This is an artist's impression, not a measured image.");
    for (const text of [alt, notes]) expect(text).toContain('model scenario');
    expect(alt).toContain('not a measured surface');
  });
});

describe('the scenario each demo planet shows', () => {
  it('TRAPPIST-1 f is a locked eyeball at + Estimated, a smooth sphere with the pattern', () => {
    const { alt, plan } = at('planet_trappist1f', 'derived');
    expect(plan.drawn.map((d) => d.id)).toEqual(['starlight', 'climate']);
    expect(alt).toContain('an eyeball world: tidally locked');
  });

  it('Kepler-186 f is temperate at + Estimated: a plain sphere in star-coloured light', () => {
    // A knife edge (Q-156): t_lock is about 4.17 Gyr against an age of 4.0 Gyr at the Q-155 constants.
    const { alt, plan } = at('planet_kepler186f', 'derived');
    expect(plan.drawn.map((d) => d.id)).toEqual(['starlight', 'body']);
    expect(alt).toContain('a temperate world that is not tidally locked');
    expect(alt).toContain('choose + Artistic to see it');
  });
});

describe('a solar-system card keeps its alt text', () => {
  it('the Eros fixture has no exoplanet sentences', () => {
    const { alt } = at('asteroid_shape', 'derived');
    expect(alt).not.toMatch(/host star|climate scenario/);
  });
});
