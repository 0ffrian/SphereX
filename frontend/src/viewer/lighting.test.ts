// R5.1 lighting plan: the display tilt of a bare `sun_dir` (Q-107 item 1) and the asteroid exposure.
import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/sharedFixtures';
import { DIRECTIONAL_INTENSITY, directionFromPhaseAngle, planLighting } from './lighting';
import { GAS_NIGHT_FLOOR, MINNAERT_MU0_FLOOR } from './renderers/jetSurface';
import { MAX_AMBIENT_INTENSITY } from './lighting';

const sunOnly = (kind: string) => {
  const f = fixture(kind);
  delete f.params.lighting.phase_angle_deg;
  return planLighting(f.params, f.card);
};

describe('Sun direction hint', () => {
  it('is not left in the image plane: the terminator of a gas giant or a planet is not a straight line', () => {
    for (const kind of ['gas_giant', 'planet_rocky', 'planet_water']) {
      const plan = sunOnly(kind);
      expect(plan.source).toBe('sun_dir');
      expect(plan.tag).toBe('artistic');
      // The fixtures' sun_dir is [1, 0, 0] (90 degrees from the view): a straight terminator.
      expect(plan.direction![2]).toBeGreaterThan(0.3);
      expect(Math.hypot(...plan.direction!)).toBeCloseTo(1, 12);
    }
  });

  it('is left as given for a comet, whose tail it aims', () => {
    const f = fixture('comet');
    delete f.params.lighting.phase_angle_deg;
    const plan = planLighting(f.params, f.card);
    const [x, y, z] = f.params.lighting.sun_dir!;
    const n = Math.hypot(x, y, z);
    plan.direction!.forEach((v, i) => expect(v).toBeCloseTo([x, y, z][i]! / n, 12));
  });

  it('never moves a phase angle the card gives', () => {
    const f = fixture('planet_rocky');
    f.params.lighting.phase_angle_deg = 90;
    const plan = planLighting(f.params, f.card);
    expect(plan.source).toBe('phase_angle');
    plan.direction!.forEach((v, i) => expect(v).toBeCloseTo(directionFromPhaseAngle(90)[i]!, 12));
  });
});

describe('light exposure and night floor (artistic)', () => {
  it('keeps one exposure for every kind and the ambient at the R5.1 cap', () => {
    for (const kind of ['asteroid_procedural', 'gas_giant', 'planet_rocky']) {
      const f = fixture(kind);
      const plan = planLighting(f.params, f.card);
      expect(plan.intensity).toBe(DIRECTIONAL_INTENSITY);
      expect(plan.ambient).toBeLessThanOrEqual(MAX_AMBIENT_INTENSITY);
    }
  });

  it('keeps the gas giant night floor tiny and the Minnaert floor off the terminator step', () => {
    expect(GAS_NIGHT_FLOOR).toBeGreaterThan(0);
    expect(GAS_NIGHT_FLOOR).toBeLessThan(0.03);
    // Below the floor the Minnaert factor is constant, so the lit side fades with Lambert's slope.
    expect(MINNAERT_MU0_FLOOR).toBeGreaterThan(0.04);
    expect(MINNAERT_MU0_FLOOR).toBeLessThan(1);
  });
});
