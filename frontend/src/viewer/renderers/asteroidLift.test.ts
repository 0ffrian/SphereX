import { describe, expect, it } from 'vitest';
import { defaultContext, planRender } from '../renderPlan';
import {
  ASTEROID_ALBEDO_LIFT,
  ASTEROID_LIFT_TARGET,
  DISPLAY_LIFT_TEXT,
  displayLift,
  rgbLinearLuma,
} from './asteroidLift';
import { fixture } from './fixtures.testutil';
import { gasHiddenText } from './shaderSpec';

/** R6.2 display brightness of the baked map, `clamp(0.12 + 1.6 * albedo, 0.12, 0.8)`, in sRGB. */
const mapBrightness = (albedo: number) => Math.min(0.8, Math.max(0.12, 0.12 + 1.6 * albedo));

describe('asteroid display lift (PR #63 approval follow-up 1)', () => {
  it('lifts a dark C-type map by the cap, as before', () => {
    // The baked C-type fixture map has a mean linear luma of about 0.070.
    expect(displayLift(0.07)).toBeCloseTo(ASTEROID_ALBEDO_LIFT, 6);
  });

  it('a high-albedo card is not clipped: the lift falls toward 1 and never darkens', () => {
    for (const albedo of [0.27, 0.4, 0.5]) {
      const L = mapBrightness(albedo);
      const mean = rgbLinearLuma([L, L, L]);
      const lift = displayLift(mean);
      expect(lift, `albedo ${albedo}`).toBeLessThan(ASTEROID_ALBEDO_LIFT);
      expect(lift).toBeGreaterThanOrEqual(1);
      // The lifted mean reflectance stays at the target or below (no flat white).
      expect(lift * mean).toBeLessThanOrEqual(Math.max(ASTEROID_LIFT_TARGET, mean) + 1e-9);
    }
    // An E-type surface brighter than the target is shown as it is.
    expect(displayLift(rgbLinearLuma([0.8, 0.8, 0.8]))).toBe(1);
  });

  it('an unreadable mean answers the cap', () => {
    expect(displayLift(null)).toBe(ASTEROID_ALBEDO_LIFT);
    expect(displayLift(0)).toBe(ASTEROID_ALBEDO_LIFT);
    expect(displayLift(Number.NaN)).toBe(ASTEROID_ALBEDO_LIFT);
  });

  for (const name of ['asteroid_procedural', 'asteroid_shape']) {
    it(`${name}: the lift is said, as an artistic legend line or a note, never at Measured only`, () => {
      const { card, params } = fixture(name);
      const art = planRender(card, params, defaultContext({ honesty: 'artistic' }));
      expect(art.drawn.find((d) => d.id === 'display_lift')).toMatchObject({
        tag: 'artistic',
        tier: 5,
      });
      expect(art.bodies[0]?.displayLift).toBe(true);
      const est = planRender(card, params, defaultContext({ honesty: 'derived' }));
      expect(est.drawn.find((d) => d.id === 'display_lift')).toBeUndefined();
      expect(est.notes).toContain(DISPLAY_LIFT_TEXT);
      expect(est.bodies[0]?.displayLift).toBe(true);
      const m = planRender(card, params, defaultContext({ honesty: 'measured' }));
      expect(m.bodies[0]?.displayLift ?? false).toBe(false);
      expect(m.notes).not.toContain(DISPLAY_LIFT_TEXT);
    });
  }
});

describe('hidden gas giant text names the colour honestly (PR #63 approval nit)', () => {
  it('says the colour is estimated only when the colour layer is', () => {
    const { params } = fixture('gas_giant');
    expect(gasHiddenText(params)).toMatch(/bands, flattening and colour are estimated/);
    const noTeq = {
      layers: params.layers.map((l) =>
        l.id === 'colour' ? { ...l, tag: 'artistic' as const } : l,
      ),
    };
    expect(gasHiddenText(noTeq)).toMatch(/bands and flattening are estimated/);
    expect(gasHiddenText(noTeq)).toMatch(/colour, storms and swirls are an artist's impression/);
  });
});
