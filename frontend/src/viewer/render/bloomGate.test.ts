// Issue #50 / roadmap 1.3: which plans skip the bloom pass. The pixel check (bloom on and off give
// the same bytes for every plan that skips it) is e2e/bloomGate.spec.ts.
import { describe, expect, it } from 'vitest';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from '../renderers/fixtures.testutil';
import { planMayBloom } from './bloomGate';
import type { HonestyState } from '../honesty';

const plan = (name: string, honesty: HonestyState) => {
  const f = fixture(name);
  return planRender(f.card, f.params, defaultContext({ honesty }));
};

const LEVELS: HonestyState[] = ['measured', 'derived', 'artistic'];

describe('planMayBloom', () => {
  it.each(['nebula', 'nova', 'star'])('%s keeps bloom (HDR cores, flares or volumes)', (name) => {
    // At + Artistic every one of these draws an additive or HDR layer.
    expect(planMayBloom(plan(name, 'artistic'))).toBe(true);
  });

  it.each(['planet_rocky', 'planet_water'])(
    '%s keeps bloom (the Sun glint on water passes it)',
    (name) => {
      expect(planMayBloom(plan(name, 'artistic'))).toBe(true);
    },
  );

  it.each(['gas_giant', 'asteroid_procedural', 'asteroid_shape'])(
    '%s skips bloom at every honesty level (lit, LDR)',
    (name) => {
      for (const h of LEVELS) expect(planMayBloom(plan(name, h)), `${name} ${h}`).toBe(false);
    },
  );

  it('a self-luminous body bright enough to reach the threshold keeps bloom', () => {
    const p = plan('asteroid_procedural', 'measured');
    const bright = {
      ...p,
      bodies: p.bodies.map((b) => ({
        ...b,
        emissive: 3,
        tint: [1, 1, 1] as [number, number, number],
      })),
    };
    expect(planMayBloom(bright)).toBe(true);
  });

  it('nothing in 3D: no bloom', () => {
    const p = plan('asteroid_procedural', 'measured');
    expect(planMayBloom({ ...p, threeD: false })).toBe(false);
  });
});
