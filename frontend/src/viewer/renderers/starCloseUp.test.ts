// Issue #71 stream G: the star close-up scene and `closeUpFor`.
import { describe, expect, it } from 'vitest';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { STAR_CONFIG, planStar } from './Star';
import { StarCloseUpScene, classOfEnergy, closeUpGroup } from './starCloseUpScene';
import { closeUpFor } from '@/app/starCloseUp';

const config = {
  ...STAR_CONFIG,
  massMsun: () => ({ value: 0.7, tag: 'measured' as const, source: 't' }),
};
const plan = () => {
  const { card, params } = fixture('star');
  return planStar({ card, params, ctx: defaultContext({ honesty: 'artistic' }) }, config);
};

describe('closeUpFor', () => {
  it('gives props for a star with physics and null for anything else', () => {
    const p = closeUpFor(plan());
    expect(p?.physics.teffK).toBeGreaterThan(0);
    expect(p?.flare).toBeNull();
    const { card, params } = fixture('gas_giant');
    expect(
      closeUpFor(planRender(card, params, defaultContext({ honesty: 'artistic' }))),
    ).toBeNull();
  });
});

describe('StarCloseUpScene', () => {
  const props = () => closeUpFor(plan(), { open: false, energyErg: 2e30 })!;
  it('takes the kind and class from the flare event', () => {
    const s = new StarCloseUpScene(props());
    expect(s.flareKind).toEqual({ open: false, cls: 'm' });
    expect(s.caption).toMatch(/Closed \(confined\) · Class M/);
    s.setFlare(null);
    expect(s.flareKind).toEqual({ open: true, cls: 'x' });
    expect(classOfEnergy(5e29)).toBe('c');
  });
  it('is a pure function of the stage time, and open differs from closed', () => {
    const a = new StarCloseUpScene(props());
    const b = new StarCloseUpScene(props());
    a.setStage(0.5);
    b.setStage(0.5);
    expect(a.streakCount).toBeGreaterThan(100);
    expect(a.streakCount).toBe(b.streakCount);
    b.setFlare({ open: true, energyErg: 2e30 });
    b.setStage(0.5);
    expect(b.streakCount).not.toBe(a.streakCount);
  });
  it('the group is at the pole with unit tangents', () => {
    const g = closeUpGroup();
    expect(Math.hypot(...g.centre)).toBeCloseTo(1, 10);
    expect(Math.hypot(...g.polarityAxis)).toBeCloseTo(1, 10);
    expect(g.centre[1]).toBeGreaterThan(0.99);
  });
});
