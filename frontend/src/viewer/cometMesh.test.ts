// Issue #68, Q-162: a comet whose card names a registered shape model (67P) draws its nucleus from
// the mesh; the coma stays. Pure plan test: no GPU.
import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/sharedFixtures';
import { defaultContext, planRender } from './renderPlan';

const MESH = '/data/shapes/c67p-shap5.glb';

function cometPlan(withMesh: boolean) {
  const { card, params } = fixture('comet');
  card.epochs = ['2025-12'];
  if (withMesh) {
    card.shape_source = { value: MESH, tag: 'measured', source: 'SPC SHAP5 (Q-162 test)' };
    params.layers.push({
      id: 'mesh',
      tag: 'measured',
      tier: 1,
      description: 'Nucleus drawn from the shape model (R7.3).',
      requires: ['shape_source', 'nucleus_radius_km_max'],
    } as (typeof params.layers)[number]);
  }
  return planRender(card, params, defaultContext({ honesty: 'artistic', epoch: '2025-12' }));
}

describe('comet nucleus from a registered mesh (R7.3, Q-162)', () => {
  it('uses the mesh for the nucleus and keeps the coma', () => {
    const plan = cometPlan(true);
    expect(plan.bodies[0]?.meshUrl).toBe(MESH);
    expect(plan.drawn.some((d) => d.id === 'mesh')).toBe(true);
    expect(plan.volumes.length).toBeGreaterThan(0);
  });

  it('a comet without a shape model keeps the plain sphere', () => {
    const plan = cometPlan(false);
    expect(plan.bodies[0]?.meshUrl ?? null).toBeNull();
    expect(plan.missing.some((m) => m.id === 'mesh')).toBe(false);
  });
});
