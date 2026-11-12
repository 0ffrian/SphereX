// Issue #71 stream G: the star close-up scene and `closeUpFor`.
import { describe, expect, it } from 'vitest';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { STAR_CONFIG, planStar } from './Star';
import { StarCloseUpScene, classOfEnergy, closeUpGroup } from './starCloseUpScene';
import { closeUpFor } from '@/app/starCloseUp';
import { StillStarCache } from './stillStarCache';
import { HalfFloatType, Vector2, type Mesh, type WebGPURenderer } from 'three/webgpu';

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

describe('the still star, cached (issue #93 W1, render notes 1.12)', () => {
  const props = () => closeUpFor(plan(), { open: true, energyErg: 2e31 })!;
  /** What a stand-in renderer saw at each render: the target and what the scene would draw. */
  interface Seen {
    target: unknown;
    mode: string;
    lines: boolean;
    quad: boolean;
    sphereMat: unknown;
  }
  const fakeRenderer = (s: StarCloseUpScene, size = { w: 640, h: 400 }) => {
    const seen: Seen[] = [];
    let target: unknown = null;
    const quad = s.scene.children.find((o) => (o as Mesh).isMesh) as Mesh;
    const root = s.scene.children.find((o) => !(o as Mesh).isMesh)!;
    const lines = root.children.find(
      (o) => (o as unknown as { isLineSegments?: boolean }).isLineSegments,
    )!;
    const sphere = (root.children[0]!.children[0]!.children[0] as Mesh)!;
    const r = {
      samples: 4,
      getDrawingBufferSize: (v: Vector2) => v.set(size.w, size.h),
      getOutputBufferType: () => HalfFloatType,
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
      },
      render: () =>
        seen.push({
          target,
          mode: s.stillMode,
          lines: lines.visible,
          quad: quad.visible,
          sphereMat: sphere.material,
        }),
    };
    return { r: r as unknown as WebGPURenderer, seen, size, sphere };
  };

  it('draws the star alone into a target once, then the picture behind the plasma', () => {
    const s = new StarCloseUpScene(props());
    const starMat = (s as unknown as { starMaterial: unknown }).starMaterial;
    const { r, seen, sphere } = fakeRenderer(s);
    const cache = new StillStarCache(s);
    s.setStage(0.3);
    cache.render(r);
    s.setStage(0.4);
    cache.render(r);
    expect(cache.bakes).toBe(1);
    // The bake: into its own target, star only, with the star's shader.
    expect(seen[0]).toMatchObject({ mode: 'bake', lines: false, quad: false, sphereMat: starMat });
    expect(seen[0]!.target).not.toBeNull();
    // Each frame: to the screen, the cached picture and the plasma; the sphere writes depth only.
    for (const f of seen.slice(1)) {
      expect(f).toMatchObject({ target: null, mode: 'cached', lines: true, quad: true });
      expect(f.sphereMat).not.toBe(starMat);
      expect((f.sphereMat as { colorWrite: boolean }).colorWrite).toBe(false);
    }
    cache.dispose();
    expect(s.stillMode).toBe('live');
    expect(sphere.material).toBe(starMat);
  });

  it('draws the star again when the size or the window shape changes, and only then', () => {
    const s = new StarCloseUpScene(props());
    const f = fakeRenderer(s);
    const cache = new StillStarCache(s);
    cache.render(f.r);
    cache.render(f.r);
    expect(cache.bakes).toBe(1);
    f.size.w = 800;
    cache.render(f.r);
    expect(cache.bakes).toBe(2);
    s.setAspect(2);
    cache.render(f.r);
    expect(cache.bakes).toBe(3);
    // Back to live in between (a host or a test): the next frame shows the picture again without redrawing it.
    s.setStill('live');
    cache.render(f.r);
    expect(cache.bakes).toBe(3);
    expect(f.seen.at(-1)).toMatchObject({ mode: 'cached', quad: true });
    cache.dispose();
  });
});
