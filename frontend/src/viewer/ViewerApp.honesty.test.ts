// Review NF-2, NF-6: ViewerApp remembers the honesty filter across bodies and while a body loads,
// and uses one light direction for the scene sun and the body. Runs without a GPU: the renderer
// is a stub (ViewerApp only calls setPixelRatio, setClearColor, setSize, render and dispose).
import { describe, expect, it } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { generateField } from './fields/fieldGenerator';
import { ALL_TAGS, ESTIMATED_TAGS, type BodyContext } from './renderers/bodyRenderer';
import { fixture } from './renderers/fixtures.testutil';
import { DEFAULT_SUN_DIR } from './lighting';
import { ViewerApp } from './ViewerApp';

function makeViewer(): ViewerApp {
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render() {},
    dispose: () => Promise.resolve(),
  } as unknown as WebGPURenderer;
  const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
  return new Ctor(document.createElement('canvas'), stub);
}

const ctx: BodyContext = { fieldSource: async (p) => generateField(p, 64, 32) };

describe('ViewerApp honesty filter memory (NF-2)', () => {
  it('starts at + Estimated: artistic surfaces are hidden for a body with no tags passed', async () => {
    const v = makeViewer();
    const f = fixture('gas_giant');
    const body = await v.setBody(f.card, f.params, ctx);
    expect(body!.drawn).toEqual([]);
    expect(body!.hidden).toEqual(['surface']);
    v.dispose();
  });

  it('a filter chosen while a body is loading applies to that body', async () => {
    const v = makeViewer();
    const f = fixture('gas_giant');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const pending = v.setBody(f.card, f.params, {
      visibleTags: ALL_TAGS,
      fieldSource: async (p) => {
        await gate;
        return generateField(p, 64, 32);
      },
    });
    v.setVisibleTags(ESTIMATED_TAGS); // visitor picks Measured/Estimated while it loads
    release();
    const body = await pending;
    expect(body!.drawn).toEqual([]);
    expect(body!.hidden).toEqual(['surface']);
    v.dispose();
  });

  it('the next object keeps the current filter', async () => {
    const v = makeViewer();
    const g = fixture('gas_giant');
    await v.setBody(g.card, g.params, { ...ctx, visibleTags: ALL_TAGS });
    v.setVisibleTags(ALL_TAGS);
    const w = fixture('planet_water');
    const next = await v.setBody(w.card, w.params, ctx); // no tags passed
    expect(next!.drawn).toEqual(['surface']);
    v.setVisibleTags(ESTIMATED_TAGS);
    const again = await v.setBody(g.card, g.params, ctx);
    expect(again!.drawn).toEqual([]);
    v.dispose();
  });
});

describe('ViewerApp light direction (NF-6)', () => {
  it('uses ctx.lightDir for the scene sun and the body, else sun_dir, else the default', async () => {
    const v = makeViewer();
    const f = fixture('planet_water');
    const sunPos = () =>
      (v as unknown as { sun: { position: { x: number; y: number; z: number } } }).sun.position;
    const dirOf = (p: { x: number; y: number; z: number }) => {
      const l = Math.hypot(p.x, p.y, p.z);
      return [p.x / l, p.y / l, p.z / l];
    };
    const unit = (a: readonly number[]) => {
      const l = Math.hypot(a[0]!, a[1]!, a[2]!);
      return a.map((x) => x / l);
    };
    await v.setBody(
      f.card,
      { ...f.params, lighting: { ...f.params.lighting, sun_dir: [0, 0, 1] } },
      {
        ...ctx,
        lightDir: [1, 0, 0],
      },
    );
    dirOf(sunPos()).forEach((x, i) => expect(x).toBeCloseTo([1, 0, 0][i]!, 9));
    await v.setBody(
      f.card,
      { ...f.params, lighting: { ...f.params.lighting, sun_dir: [0, 0, 1] } },
      ctx,
    );
    dirOf(sunPos()).forEach((x, i) => expect(x).toBeCloseTo([0, 0, 1][i]!, 9));
    await v.setBody(
      f.card,
      { ...f.params, lighting: { ...f.params.lighting, sun_dir: undefined } },
      ctx,
    );
    dirOf(sunPos()).forEach((x, i) => expect(x).toBeCloseTo(unit(DEFAULT_SUN_DIR)[i]!, 9));
    v.dispose();
  });
});
