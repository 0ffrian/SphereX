// The shader kinds go through the one entry point (setObject -> renderPlan -> buildScene): the
// honesty state, one light direction, the Q-45 plain-sphere rule, and no field regeneration on an
// honesty toggle (PR #31 B5). Runs without a GPU: the renderer is a stub (ViewerApp only calls
// setPixelRatio, setClearColor, setSize, render and dispose).
import { describe, expect, it, vi } from 'vitest';
import type { DirectionalLight, WebGPURenderer } from 'three/webgpu';
import type { ObjectCard, RenderParams } from '@/contract';
import { generateField, type FieldParams } from './fields/fieldGenerator';
import type { HonestyState } from './honesty';
import { defaultContext, planRender } from './renderPlan';
import { fixture } from './renderers/fixtures.testutil';
import type { ShaderBody } from './renderers/ShaderBody';
import { ViewerApp } from './ViewerApp';

function makeViewer(): { v: ViewerApp; fieldCalls: FieldParams[] } {
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render() {},
    dispose: () => Promise.resolve(),
  } as unknown as WebGPURenderer;
  const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
  const v = new Ctor(document.createElement('canvas'), stub);
  const fieldCalls: FieldParams[] = [];
  v.setShaderOptions({
    fieldSource: async (p) => {
      fieldCalls.push(p);
      return generateField(p, 64, 32);
    },
  });
  return { v, fieldCalls };
}

function show(v: ViewerApp, card: ObjectCard, params: RenderParams, honesty?: HonestyState) {
  const plan = planRender(card, params, defaultContext(honesty ? { honesty } : {}));
  v.showPlan(plan);
  return plan;
}

/** Waits until the body has its field (the surface is built, hidden or not). */
async function built(v: ViewerApp): Promise<ShaderBody> {
  await vi.waitFor(() => expect(v.body?.field ?? v.body?.pointSets).toBeTruthy());
  return v.body as ShaderBody;
}

const plainVisible = (b: ShaderBody) =>
  (b as unknown as { plain: { visible: boolean } | null }).plain?.visible ?? false;

describe('shader kinds through the plan path (B5)', () => {
  it('starts at + Estimated: the artistic surface is hidden, the plain sphere stands in', async () => {
    const { v } = makeViewer();
    const f = fixture('gas_giant');
    const plan = show(v, f.card, f.params);
    expect(plan.threeD).toBe(true);
    expect(plan.shader).toMatchObject({ surface: false, plain: true });
    expect(plan.missing.find((m) => m.id === 'surface')).toMatchObject({
      reason: 'honesty',
      tag: 'artistic',
    });
    const body = await built(v);
    expect(body.drawn).toEqual([]);
    expect(body.hidden).toEqual(['surface']);
    expect(plainVisible(body)).toBe(true);
    v.dispose();
  });

  it('an honesty toggle updates the body in place and does not regenerate the field', async () => {
    const { v, fieldCalls } = makeViewer();
    const f = fixture('planet_water');
    show(v, f.card, f.params);
    const body = await built(v);
    expect(fieldCalls).toHaveLength(1);
    show(v, f.card, f.params, 'artistic');
    expect(v.body).toBe(body);
    expect(body.drawn).toEqual(['surface']);
    expect(plainVisible(body)).toBe(false);
    show(v, f.card, f.params, 'measured');
    show(v, f.card, f.params, 'derived');
    show(v, f.card, f.params, 'artistic');
    expect(v.body).toBe(body);
    expect(fieldCalls).toHaveLength(1);
    // A different object does rebuild.
    const g = fixture('gas_giant');
    show(v, g.card, g.params, 'artistic');
    await vi.waitFor(() => expect(fieldCalls).toHaveLength(2));
    expect(v.body).not.toBe(body);
    v.dispose();
  });

  it('nebula and nova: hidden at + Estimated, drawn at + Artistic, points made once', async () => {
    const { v } = makeViewer();
    const points = vi.fn();
    const f = fixture('nova');
    v.setShaderOptions({
      pointSource: async (...a) => {
        points(...a);
        const { requestPoints } = await import('./fields/fieldClient');
        return requestPoints(...a);
      },
    });
    const p1 = show(v, f.card, f.params);
    expect(p1.shader).toMatchObject({ surface: false, plain: false });
    expect(p1.missing.map((m) => m.id)).toContain('point_cloud');
    await built(v);
    show(v, f.card, f.params, 'artistic');
    expect(v.body!.drawn).toEqual(['point_cloud']);
    show(v, f.card, f.params, 'derived');
    expect(v.body!.drawn).toEqual([]);
    expect(points).toHaveBeenCalledTimes(1);
    v.dispose();
  });

  it('uses one light direction, from planLighting, for the scene sun and the body', async () => {
    const { v } = makeViewer();
    const f = fixture('planet_water');
    const sun = () =>
      (v as unknown as { lights: unknown[] }).lights.find(
        (l) => (l as DirectionalLight).isDirectionalLight,
      ) as DirectionalLight | undefined;
    const unit = (x: number, y: number, z: number) => {
      const l = Math.hypot(x, y, z);
      return [x / l, y / l, z / l];
    };
    const lit = (params: RenderParams) => {
      const plan = show(v, f.card, params);
      const s = sun()!;
      const dir = unit(s.position.x, s.position.y, s.position.z);
      dir.forEach((x, i) => expect(x).toBeCloseTo(plan.lighting.direction![i]!, 9));
      const body = v.body as ShaderBody;
      const u = (body as unknown as { sun: { value: { x: number; y: number; z: number } } }).sun
        .value;
      [u.x, u.y, u.z].forEach((x, i) => expect(x).toBeCloseTo(dir[i]!, 9));
      return plan;
    };
    lit({ ...f.params, lighting: { mode: 'sun', sun_dir: [0, 1, 0] } });
    // No phase angle and no sun_dir: head-on (planLighting), not a private default.
    const plan = lit({ ...f.params, lighting: { mode: 'sun' } });
    expect(plan.lighting.direction).toEqual([0, 0, 1]);
    lit({ ...f.params, lighting: { mode: 'sun', phase_angle_deg: 90 } });
    // Self-lit: no light, no direction.
    const nebula = fixture('nebula');
    const self = show(v, nebula.card, nebula.params);
    expect(self.lighting.direction).toBeNull();
    expect(sun()).toBeUndefined();
    v.dispose();
  });

  it('Q-45: Measured only keeps the plain sphere only when the size is measured', async () => {
    const f = fixture('gas_giant');
    const cases: [string, ObjectCard, boolean][] = [
      ['measured size', f.card, true],
      [
        'derived size',
        {
          ...f.card,
          radius_rjup: { ...f.card.radius_rjup!, tag: 'derived', formula: 'R = d / 2' },
        } as ObjectCard,
        false,
      ],
    ];
    for (const [name, card, plainAtMeasured] of cases) {
      const { v } = makeViewer();
      show(v, card, f.params, 'measured');
      const body = await built(v);
      expect(plainVisible(body), name).toBe(plainAtMeasured);
      // The plan and the body apply the same rule at every honesty level.
      for (const h of ['measured', 'derived', 'artistic'] as const) {
        const plan = show(v, card, f.params, h);
        expect(plainVisible(body), `${name} @ ${h}`).toBe(plan.shader!.plain);
      }
      v.dispose();
    }
  });

  it('a failed field is reported as a load failure and the plain sphere stays', async () => {
    const { v } = makeViewer();
    const failed: string[] = [];
    v.setLoadFailedHandler((id) => failed.push(id));
    v.setShaderOptions({ fieldSource: () => Promise.reject(new Error('worker down')) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture('planet_rocky');
    show(v, f.card, f.params, 'artistic');
    await vi.waitFor(() => expect(failed).toEqual(['surface']));
    expect(plainVisible(v.body as ShaderBody)).toBe(true);
    warn.mockRestore();
    v.dispose();
  });
});
