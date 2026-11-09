// R7.7, D-01, D-21: each shader kind builds from the shared fixtures without a GPU (jsdom), keeps
// the honesty filter, and refuses rather than invents.
import { describe, expect, it, vi } from 'vitest';
import { DataTexture, Texture } from 'three/webgpu';
import { generateField } from '../fields/fieldGenerator';
import { ALL_TAGS, ESTIMATED_TAGS } from './bodyRenderer';
import { ShaderBody } from './ShaderBody';
import { resolveShaderSpec } from './shaderSpec';
import { resolveMotion } from '../motion/motion';
import { fixture } from './fixtures.testutil';
import type { BodyContext } from './bodyRenderer';

// Small field keeps jsdom tests fast; the real size is covered in fieldGenerator.test.ts.
// Honesty: these tests show the artistic layers, so they pass ALL_TAGS explicitly (D-21 default
// is + Estimated, which hides them; see the "default" test below).
const ctx: BodyContext = {
  visibleTags: ALL_TAGS,
  fieldSource: async (p) => generateField(p, 64, 32),
};

const KINDS = ['planet_rocky', 'planet_water', 'gas_giant', 'nebula', 'nova'] as const;
/** Issue #62: a gas giant's surface is these five layers, not one `surface`. */
const GAS = ['bands', 'flattening', 'colour', 'storms', 'turbulence'];
const layersOf = (k: (typeof KINDS)[number]) =>
  k === 'nebula' || k === 'nova' ? ['point_cloud'] : k === 'gas_giant' ? GAS : ['surface'];

describe('ShaderBody', () => {
  for (const k of KINDS) {
    it(`builds ${k} from its fixture`, async () => {
      const f = fixture(k);
      const body = await ShaderBody.create(f.card, f.params, ctx);
      expect(body.drawn).toEqual(layersOf(k));
      expect(body.hidden).toEqual([]);
      expect(body.object.children.length).toBeGreaterThan(0);
      expect(body.suggestedDistance).toBeGreaterThan(1);
      body.dispose();
    });
  }

  it('lists params.missing and keeps drawing (rocky: teq_pulse)', async () => {
    const f = fixture('planet_rocky');
    const body = await ShaderBody.create(f.card, f.params, ctx);
    expect(body.missing).toEqual(['teq_pulse']);
    expect(body.drawn).toEqual(['surface']);
  });

  it('draws nothing and lists the layer when the size is unknown', async () => {
    const f = fixture('gas_giant');
    const body = await ShaderBody.create(f.card, { ...f.params, scale_m: null }, ctx);
    expect(body.drawn).toEqual([]);
    expect(body.missing).toEqual(expect.arrayContaining(GAS));
    expect(body.object.children.every((c) => !c.visible)).toBe(true);
  });

  it('gas giant: each layer follows its own tag (issue #62, D-21)', async () => {
    const f = fixture('gas_giant');
    const at = (visibleTags: BodyContext['visibleTags']) =>
      ShaderBody.create(f.card, f.params, { ...ctx, visibleTags });
    // Measured only: nothing of it is measured, so a plain sphere stands in.
    const measured = await at(['measured']);
    expect(measured.drawn).toEqual([]);
    expect(measured.hidden).toEqual(GAS);
    expect(measured.status.state).toBe('hidden');
    expect(measured.status.message).toContain('choose + Estimated to see them');
    // + Estimated: bands, flattening and colour; the storms and the swirl are seeded looks.
    const est = await at(ESTIMATED_TAGS);
    expect(est.drawn).toEqual(['bands', 'flattening', 'colour']);
    expect(est.hidden).toEqual(['storms', 'turbulence']);
    expect(est.status).toMatchObject({ state: 'drawn' });
    // The fixture has no spin on the card, so bands and flattening are tier 4 (Q-119 b).
    expect([...est.status.tags].sort()).toEqual(['derived', 'inferred_from_analog']);
    // + Artistic adds the storms and the turbulence, and their tag shows in the status.
    est.setVisibleTags(ALL_TAGS);
    expect(est.drawn).toEqual(GAS);
    expect(est.status.tags).toContain('artistic');
    // The plan's own switches (they carry the build holds) win over the tags.
    est.setGasLayers({
      bands: true,
      flattening: false,
      colour: false,
      storms: false,
      turbulence: false,
    });
    expect(est.drawn).toEqual(['bands']);
    est.setGasLayers(null);
    expect(est.drawn).toEqual(GAS);
    for (const b of [measured, est]) b.dispose();
  });

  it('gas giant: a layer refused for missing data leaves the others drawn', async () => {
    const f = fixture('gas_giant');
    const body = await ShaderBody.create(f.card, { ...f.params, missing: ['storms'] }, ctx);
    expect(body.drawn).toEqual(['bands', 'flattening', 'colour', 'turbulence']);
    expect(body.missing).toContain('storms');
    body.dispose();
  });

  it('hides artistic layers outside "+ Artistic" (D-21) and shows them again', async () => {
    const f = fixture('planet_water');
    const body = await ShaderBody.create(f.card, f.params, {
      ...ctx,
      visibleTags: ['measured', 'derived', 'model_dependent', 'inferred_from_analog'],
    });
    expect(body.drawn).toEqual([]);
    expect(body.hidden).toEqual(['surface']);
    // A plain sphere stands in for the hidden surface.
    expect(body.object.children.some((c) => c.visible)).toBe(true);
    body.setVisibleTags([
      'measured',
      'derived',
      'model_dependent',
      'inferred_from_analog',
      'artistic',
    ]);
    expect(body.drawn).toEqual(['surface']);
    expect(body.hidden).toEqual([]);
  });

  it('nebula and nova draw nothing when artistic is hidden (nothing is measured)', async () => {
    const f = fixture('nova');
    const body = await ShaderBody.create(f.card, f.params, { ...ctx, visibleTags: ['measured'] });
    expect(body.drawn).toEqual([]);
    expect(body.hidden).toEqual(['point_cloud']);
    expect(body.object.children.every((c) => !c.visible)).toBe(true);
  });

  it('rebuilds with new field-affecting overrides', async () => {
    const f = fixture('planet_water');
    const seen: number[] = [];
    const body = await ShaderBody.create(f.card, f.params, {
      visibleTags: ALL_TAGS,
      fieldSource: async (p) => {
        seen.push(p.seaLevel);
        return generateField(p, 64, 32);
      },
    });
    await body.setOverrides({ sea_level: 0.55 });
    expect(seen).toEqual([0.58, 0.55]);
    expect(body.drawn).toEqual(['surface']);
  });
});

describe('ShaderBody honesty and redraw (review B2, B3, N7)', () => {
  it('defaults to the D-21 "+ Estimated" start state: artistic layers are hidden', async () => {
    for (const k of KINDS.filter((x) => x !== 'gas_giant')) {
      const f = fixture(k);
      const body = await ShaderBody.create(f.card, f.params, {
        fieldSource: async (p) => generateField(p, 64, 32),
      });
      expect(body.drawn, k).toEqual([]);
      expect(body.hidden, k).toEqual(layersOf(k));
      expect(body.status.state).toBe('hidden');
      body.dispose();
    }
    expect(ESTIMATED_TAGS).not.toContain('artistic');
    expect(ESTIMATED_TAGS).toEqual([
      'measured',
      'derived',
      'model_dependent',
      'inferred_from_analog',
    ]);
  });

  it('requests a render after setVisibleTags and after a rebuild', async () => {
    const f = fixture('gas_giant');
    let calls = 0;
    const body = await ShaderBody.create(f.card, f.params, {
      ...ctx,
      onChange: () => calls++,
    });
    const afterCreate = calls;
    expect(afterCreate).toBeGreaterThan(0);
    body.setVisibleTags(ESTIMATED_TAGS);
    expect(calls).toBe(afterCreate + 1);
    expect(body.drawn).toEqual(['bands', 'flattening', 'colour']);
    body.setVisibleTags(ALL_TAGS);
    expect(calls).toBe(afterCreate + 2);
    await body.setOverrides({ storms: 2 });
    expect(calls).toBe(afterCreate + 3);
  });

  it('never blanks during a slider rebuild: the old surface stays until the new one is ready', async () => {
    const f = fixture('planet_water');
    let release: (() => void) | undefined;
    let hold = false;
    const body = await ShaderBody.create(f.card, f.params, {
      visibleTags: ALL_TAGS,
      fieldSource: async (p) => {
        if (hold) await new Promise<void>((r) => (release = r));
        return generateField(p, 64, 32);
      },
    });
    const first = body.object.children.find((c) => c.visible && c !== undefined)!;
    hold = true;
    const pending = body.setOverrides({ sea_level: 0.5 });
    await Promise.resolve();
    expect(body.drawn).toEqual(['surface']);
    expect(body.object.children.filter((c) => c.visible).length).toBe(1);
    expect(body.object.children).toContain(first);
    release!();
    await pending;
    expect(body.drawn).toEqual(['surface']);
    expect(body.object.children).not.toContain(first);
    expect(body.object.children.filter((c) => c.visible).length).toBe(1);
  });

  it('reports a plain-words status with tags for drawn, hidden and refused (N7)', async () => {
    const f = fixture('planet_water');
    const drawn = await ShaderBody.create(f.card, f.params, ctx);
    expect(drawn.status.state).toBe('drawn');
    expect(drawn.status.tags).toEqual(['artistic']);
    expect(drawn.status.message).toMatch(/artist/i);
    expect(drawn.altText).toContain(f.params.alt_text);
    expect(drawn.altText).toMatch(/artist's impression/);
    drawn.setVisibleTags(ESTIMATED_TAGS);
    expect(drawn.status.state).toBe('hidden');
    // NF-5: nothing from the layer is on screen, so no tag (the contract says empty).
    expect(drawn.status.tags).toEqual([]);
    expect(drawn.status.message).toMatch(/plain grey sphere/);
    const refused = await ShaderBody.create(f.card, { ...f.params, scale_m: null }, ctx);
    expect(refused.status.state).toBe('refused');
    expect(refused.status.tags).toEqual([]);
    expect(refused.status.message).toMatch(/not drawn/i);
    expect(refused.object.children.every((c) => !c.visible)).toBe(true);
  });
});

describe('ShaderBody disposal and hidden copy (review NF-1, NF-8)', () => {
  it('frees the new surface when dispose lands between build and swap (any microtask delay)', async () => {
    for (let hops = 1; hops <= 6; hops++) {
      const f = fixture('planet_water'); // 2 field textures per build
      const disposed = vi.spyOn(DataTexture.prototype, 'dispose');
      const built = vi.spyOn(Texture.prototype, 'needsUpdate', 'set'); // once per floatTexture()
      let armed = false;
      const holder: { body?: ShaderBody } = {};
      const body = await ShaderBody.create(f.card, f.params, {
        visibleTags: ALL_TAGS,
        fieldSource: async (p) => {
          const field = generateField(p, 64, 32);
          if (armed) {
            // dispose() lands `hops` microtasks after the field resolved.
            let n = 0;
            const tick = (): void => {
              if (++n >= hops) holder.body?.dispose();
              else void Promise.resolve().then(tick);
            };
            void Promise.resolve().then(tick);
          }
          return field;
        },
      });
      holder.body = body;
      armed = true;
      await body.setOverrides({ sea_level: 0.5 });
      await new Promise((r) => setTimeout(r, 0));
      body.dispose(); // idempotent when the hook already disposed
      const made = new Set<unknown>(built.mock.contexts);
      const freed = new Set<unknown>(disposed.mock.contexts);
      expect(made.size, `hops=${hops}`).toBeGreaterThanOrEqual(2);
      for (const t of made) expect(freed.has(t), `hops=${hops}: a built texture leaked`).toBe(true);
      disposed.mockRestore();
      built.mockRestore();
    }
  });

  it('dispose clears the frame; setVisibleTags after dispose is a no-op', async () => {
    const g = fixture('gas_giant');
    let calls = 0;
    const body = await ShaderBody.create(g.card, g.params, { ...ctx, onChange: () => calls++ });
    const live = body.worldToBody([0, 1, 0]);
    body.dispose();
    expect(body.worldToBody([0, 1, 0])).not.toEqual(live);
    expect(body.worldToBody([0, 1, 0])).toEqual([0, 1, 0]); // identity: no stale tilt
    const before = calls;
    body.setVisibleTags(ESTIMATED_TAGS);
    expect(calls).toBe(before);
    expect(body.hidden).toEqual([]);
  });

  it('the hidden copy names the object kind (nova is not "This cloud")', async () => {
    const n = fixture('nova');
    const nova = await ShaderBody.create(n.card, n.params, { ...ctx, visibleTags: ['measured'] });
    expect(nova.status.message).not.toMatch(/This cloud/);
    expect(nova.status.message).toMatch(/Nothing is shown/);
    const b = fixture('nebula');
    const neb = await ShaderBody.create(b.card, b.params, { ...ctx, visibleTags: ['measured'] });
    expect(neb.status.message).toMatch(/This cloud/);
    expect(neb.status.tags).toEqual([]);
  });
});

describe('ShaderBody field and point access for the haptic sources (review N1)', () => {
  it('exposes the field sampler for planets and gas giants, none for point clouds', async () => {
    for (const k of KINDS) {
      const f = fixture(k);
      const body = await ShaderBody.create(f.card, f.params, ctx);
      if (k === 'nebula' || k === 'nova') {
        // Q-103: neither volume has haptics, so neither keeps a field or point sets.
        expect(body.field).toBeNull();
        expect(body.pointSets).toBeNull();
      } else {
        expect(body.field).not.toBeNull();
        expect(body.pointSets).toBeNull();
        const s = body.field!.sampleDirection([0, 1, 0]);
        expect(Number.isFinite(s.height)).toBe(true);
      }
    }
  });

  it('worldToBody undoes the gas-giant tilt and the nebula scale', async () => {
    const g = fixture('gas_giant');
    const gas = await ShaderBody.create(g.card, g.params, ctx);
    // The tilt group is rotated 0.35 rad about z, so world +y sits 0.35 rad off the body axis.
    // The surface frame also undoes the flattening (the polar axis is 1 - f of the equatorial), so
    // a point is mapped onto the unit sphere the field is defined on.
    const f = resolveShaderSpec(g.card, g.params, undefined, resolveMotion(g.card, g.params)).gas!
      .flattening;
    const [x, y, z] = gas.worldToBody([0, 1, 0]);
    expect(x).toBeCloseTo(Math.sin(0.35), 6);
    expect(y).toBeCloseTo(Math.cos(0.35) / (1 - f), 6);
    expect(z).toBeCloseTo(0, 9);
    const n = fixture('nebula');
    const neb = await ShaderBody.create(n.card, n.params, ctx);
    const p = neb.worldToBody([1.35, 0, 0]);
    expect(p[0]).toBeCloseTo(1, 6);
    // A planet has no tilt: identity.
    const w = fixture('planet_water');
    const world = await ShaderBody.create(w.card, w.params, ctx);
    expect(world.worldToBody([0.3, 0.4, 0.5])).toEqual([0.3, 0.4, 0.5]);
  });
});

describe('ShaderBody volumes free their GPU texture (review of #51)', () => {
  const handles = (b: ShaderBody) => (b as unknown as { volumes: { dispose(): void }[] }).volumes;

  it('dispose() disposes the volume (and so its Data3DTexture)', async () => {
    const f = fixture('nebula');
    const body = await ShaderBody.create(f.card, f.params, ctx);
    const spies = handles(body).map((v) => vi.spyOn(v, 'dispose'));
    expect(spies.length).toBeGreaterThan(0);
    body.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it('a rebuild (a slider change) disposes the volume it replaces', async () => {
    const f = fixture('nova');
    const body = await ShaderBody.create(f.card, f.params, ctx);
    const old = handles(body).map((v) => vi.spyOn(v, 'dispose'));
    await body.setOverrides({ energy_e51: 2 });
    for (const s of old) expect(s).toHaveBeenCalledTimes(1);
    expect(handles(body)[0]).not.toBe(undefined);
    body.dispose();
  });
});

describe('ShaderBody.start (the plan path builds without waiting)', () => {
  it('has the plain sphere at once and the surface when the field arrives', async () => {
    const f = fixture('planet_water');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const body = ShaderBody.start(f.card, f.params, {
      visibleTags: ALL_TAGS,
      fieldSource: async (p) => {
        await gate;
        return generateField(p, 64, 32);
      },
    });
    // Never blank: a body is on screen before the field exists.
    expect(body.object.children.filter((c) => c.visible).length).toBe(1);
    expect(body.field).toBeNull();
    release();
    await vi.waitFor(() => expect(body.field).not.toBeNull());
    expect(body.drawn).toEqual(['surface']);
    expect(body.object.children.filter((c) => c.visible).length).toBe(1);
    body.dispose();
  });

  it('reports a failed field through onFailed and keeps the plain sphere', async () => {
    const f = fixture('gas_giant');
    const failed: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const body = ShaderBody.start(f.card, f.params, {
      visibleTags: ALL_TAGS,
      fieldSource: () => Promise.reject(new Error('no worker')),
      onFailed: (id) => failed.push(id),
    });
    await vi.waitFor(() => expect(failed).toEqual(GAS));
    expect(body.object.children.some((c) => c.visible)).toBe(true);
    warn.mockRestore();
    body.dispose();
  });
});
