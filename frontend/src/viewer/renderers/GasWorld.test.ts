// Issue #71 stream E: the solved gas world builds without a GPU (jsdom), stays hidden while it
// settles, appears formed, keeps the honesty filter, and refuses rather than invents.
import { describe, expect, it } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { ALL_TAGS } from './bodyRenderer';
import { GasWorld, classifyRing } from './GasWorld';
import { gasWorldInput, withGasWorldLayerTags, withGasWorldMotion } from './gasWorldInput';
import { fixture } from './fixtures.testutil';
import { handleGasRequest, type GasHost } from '../fields/gasWorker';
import type { GasSolver, GasFrame } from '../fields/gasClient';
import { resolveMotion } from '../motion/motion';
import type { GasInput } from '@/physics/gasDynamics';

function reference(id: string, over: Record<string, unknown> = {}) {
  const f = fixture('gas_giant');
  const card = f.card as unknown as Record<string, unknown>;
  const tv = (value: number) => ({ value, tag: 'measured', source: 'test' });
  card.id = id;
  card.radius_rjup = tv(1);
  card.mass_mearth = tv(317.83);
  card.teq_K = tv(110);
  card.rot_period_h = tv(9.925);
  delete card.orbital_period_d;
  Object.assign(card, over);
  return f;
}

/** The real solver on the main thread, without a Worker. */
async function inlineSolver(input: GasInput): Promise<GasSolver & { first: GasFrame }> {
  const state: { host: GasHost | null } = { host: null };
  const init = handleGasRequest(state, { id: 0, kind: 'init', input });
  if (!init.ok) throw new Error(init.error);
  return {
    first: { steps: 0, field: init.field, storms: init.storms },
    threaded: false,
    async advance(steps) {
      const r = handleGasRequest(state, { id: 1, kind: 'advance', steps });
      if (!r.ok) throw new Error(r.error);
      return { steps: r.steps, field: r.field, storms: r.storms };
    },
    dispose() {},
  };
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 4000 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('withGasWorldLayerTags (Q-291)', () => {
  it('storms and turbulence of a solved world carry the solver tags, so they show at + Estimated', () => {
    const f = reference('ref-jupiter');
    f.params.layers = ['storms', 'turbulence', 'colour'].map((id) => ({
      id,
      tag: 'artistic' as const,
      tier: 3 as const,
      description: 'x',
      requires: [],
    }));
    const out = withGasWorldLayerTags(f.card, f.params);
    const tag = (id: string) => out.layers.find((l) => l.id === id)!.tag;
    expect(tag('storms')).toBe('inferred_from_analog');
    expect(tag('turbulence')).toBe('model_dependent');
    expect(tag('colour')).toBe('artistic');
  });
  it('leaves a giant that is not a solved world as it was', () => {
    const f = reference('ref-jupiter');
    delete (f.card as unknown as Record<string, unknown>).rot_period_h;
    delete (f.params as unknown as Record<string, unknown>).dynamics;
    expect(withGasWorldLayerTags(f.card, f.params)).toBe(f.params);
  });
});

describe('gasWorldInput', () => {
  it('needs radius, mass, temperature and a spin; a missing one refuses', () => {
    const f = reference('ref-jupiter');
    expect(gasWorldInput(f.card, f.params)?.reference).toBe('jup');
    const g = reference('ref-jupiter');
    delete (g.card as unknown as Record<string, unknown>).rot_period_h;
    delete (g.params as unknown as Record<string, unknown>).dynamics;
    expect(gasWorldInput(g.card, g.params)).toBeNull();
    const h = reference('ref-jupiter', { mass_mearth: { value: null, tag: 'measured', source: 'x' } });
    expect(gasWorldInput(h.card, h.params)).toBeNull();
  });
  it('a short-orbit giant with no measured spin is taken as locked: spin = orbital period', () => {
    const f = reference('other', { orbital_period_d: { value: 2.2, tag: 'measured', source: 'x' }, teq_K: { value: 1209, tag: 'measured', source: 'x' } });
    delete (f.card as unknown as Record<string, unknown>).rot_period_h;
    const input = gasWorldInput(f.card, f.params)!;
    expect(input.locked).toBe(true);
    expect(input.rotPeriodH).toBeCloseTo(2.2 * 24, 6);
  });
  it('the winds process runs at 5 minutes per second by default and one day per second on request', () => {
    const f = reference('ref-jupiter');
    const m = withGasWorldMotion(resolveMotion(f.card, f.params), f.card, f.params);
    expect(m.processes.find((p) => p.id === 'winds')?.speedup).toBe(300);
    const d = withGasWorldMotion(resolveMotion(f.card, f.params), f.card, f.params, { gas_pacing: 1 });
    expect(d.processes.find((p) => p.id === 'winds')?.speedup).toBe(86400);
  });
});

describe('GasWorld', () => {
  it('is hidden while it settles, then appears already formed; step count is a function of time', async () => {
    const f = reference('ref-jupiter');
    const world = GasWorld.start(f.card, f.params, { visibleTags: ALL_TAGS }, { solver: inlineSolver })!;
    expect(world).not.toBeNull();
    expect(world.status.state).toBe('hidden');
    expect(world.drawn).toEqual([]);
    world.prepareFrame({} as unknown as WebGPURenderer); // no GPU: the tracer falls back, the bands still draw
    await until(() => world.ready);
    expect(world.ready).toBe(true);
    expect(world.steps).toBe(420);
    expect(world.status.state).toBe('drawn');
    expect(world.drawn).toEqual(['bands', 'flattening', 'colour', 'storms', 'turbulence']);
    // The clock moves the world on: one day per second pacing gives tens of steps per second.
    world.setTime(() => 0);
    world.setTime((id) => (id === 'winds' ? 86400 : 0));
    await until(() => world.steps > 420);
    expect(world.steps).toBeGreaterThan(420);
    expect(world.steps % 4).toBe(0);
    world.dispose();
  }, 60_000);

  it('keeps the honesty filter: at Measured only the artistic layers are hidden', async () => {
    const f = reference('ref-jupiter');
    const world = GasWorld.start(f.card, f.params, { visibleTags: ['measured'] }, { solver: inlineSolver })!;
    world.prepareFrame({} as unknown as WebGPURenderer);
    await until(() => world.ready);
    expect(world.drawn).not.toContain('colour');
    world.setVisibleTags(ALL_TAGS);
    expect(world.drawn).toContain('colour');
    world.dispose();
  }, 60_000);

  it('the haptic field answers with the drawn bands, wind and storms', async () => {
    const f = reference('ref-jupiter');
    const world = GasWorld.start(f.card, f.params, { visibleTags: ALL_TAGS }, { solver: inlineSolver })!;
    world.prepareFrame({} as unknown as WebGPURenderer);
    await until(() => world.ready);
    const field = world.field!;
    const bands = new Set<number>();
    for (let lat = -80; lat <= 80; lat += 2) {
      const r = (lat * Math.PI) / 180;
      bands.add(field.sampleDirection([Math.cos(r), Math.sin(r), 0]).band);
    }
    expect(bands.size).toBeGreaterThan(8);
    expect(field.flow!.ring).toBeNull(); // Jupiter has no rings
    const w = (deg: number) => field.flow!.wind([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0]);
    expect(Math.abs(w(24))).toBeGreaterThan(0.5); // the strongest jet is near 24 N
    expect(field.currentStorms?.length).toBeGreaterThan(20);
    world.dispose();
  }, 60_000);

  it('exposes orbitSources for the orbit camera', async () => {
    const f = reference('ref-jupiter');
    const world = GasWorld.start(f.card, f.params, { visibleTags: ALL_TAGS }, { solver: inlineSolver })!;
    const o = world.orbitSources;
    expect(o.radiusKm).toBeCloseTo(71492, 0);
    expect(o.scaleHeightKm).toBeGreaterThan(15);
    expect(o.velocity && o.bands && o.noise).toBeTruthy();
    expect(o.ready).toBe(false);
    world.dispose();
  });

  it('Saturn has rings, felt with measured radii', async () => {
    const f = reference('ref-saturn', { radius_rjup: { value: 0.843, tag: 'measured', source: 't' }, mass_mearth: { value: 95.16, tag: 'measured', source: 't' }, teq_K: { value: 81.1, tag: 'measured', source: 't' }, rot_period_h: { value: 10.656, tag: 'measured', source: 't' } });
    const world = GasWorld.start(f.card, f.params, { visibleTags: ALL_TAGS }, { solver: inlineSolver })!;
    expect(world.object.children[0]!.children.length).toBe(2); // planet and rings
    expect(world.suggestedDistance).toBeGreaterThan(5);
    expect(world.field!.flow!.ring).not.toBeNull();
    expect(classifyRing(1.7)).toBe('ring');
    expect(classifyRing(1.99)).toBe('gap');
    expect(classifyRing(3)).toBe('none');
    world.dispose();
  }, 60_000);

  it('refuses rather than invents: no spin, no world', () => {
    const f = reference('x');
    delete (f.card as unknown as Record<string, unknown>).rot_period_h;
    delete (f.params as unknown as Record<string, unknown>).dynamics;
    expect(GasWorld.start(f.card, f.params)).toBeNull();
  });
});

describe('GasWorld and the clock', () => {
  it('a paused or reduced-motion clock stops the world; playing moves it', async () => {
    const { SimClock } = await import('../render/clock');
    let now = 0;
    const clock = new SimClock(() => now);
    clock.setProcess({ id: 'winds', label: 'Winds', speedup: 86400 });
    const f = reference('ref-jupiter');
    const world = GasWorld.start(f.card, f.params, { visibleTags: ALL_TAGS }, { solver: inlineSolver })!;
    world.prepareFrame({} as unknown as WebGPURenderer);
    await until(() => world.ready);
    const frame = (ms: number) => {
      now += ms;
      clock.tick();
      world.setTime((id) => clock.simTime(id));
    };
    frame(0);
    for (let i = 0; i < 10; i++) frame(100);
    await until(() => !world.ready || world.steps > 420);
    const moved = world.steps;
    expect(moved).toBeGreaterThan(420);
    for (const reason of ['user', 'reduced-motion'] as const) {
      // Let the steps already asked for finish: wait until the count is still for a moment.
      for (let last = -1, same = 0; same < 6; ) {
        await new Promise((r) => setTimeout(r, 100));
        frame(0); // the viewer calls setTime every frame, so the world catches up to the clock
        same = world.steps === last ? same + 1 : 0;
        last = world.steps;
      }
      clock.pause(reason);
      const before = world.steps;
      for (let i = 0; i < 10; i++) frame(100);
      await new Promise((r) => setTimeout(r, 200));
      expect(world.steps).toBe(before);
      clock.resume(reason);
    }
    world.dispose();
  }, 60_000);
});
