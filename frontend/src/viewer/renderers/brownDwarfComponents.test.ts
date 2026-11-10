// Issue #68 Part 8d (Q-154): the binary's two bodies take their own colour and brightness from the
// backend's `components`, and the "share one look" note goes away when they are drawn.
import { describe, expect, it } from 'vitest';
import type { RenderParams } from '@/contract';
import { defaultContext, planRender } from '../renderPlan';
import type { HonestyState } from '../honesty';
import { fixture } from './fixtures.testutil';

const SHARE_BOTH = /Both bodies share the system colour and brightness/;

/** The binary fixture with the band map taken out, so the tint is the flat colour of each body. */
function flatBinary(edit?: (p: RenderParams) => void) {
  const { card, params } = fixture('brown_dwarf_binary');
  const p = structuredClone(params);
  p.layers = p.layers.filter((l) => l.id !== 'bands');
  p.components = [
    { ...p.components![0]!, tint: [0.5, 0.24, 0.14] },
    { ...p.components![1]!, tint: [0.3, 0.26, 0.36] },
  ];
  edit?.(p);
  return { card, params: p };
}

const plan = (
  { card, params }: ReturnType<typeof flatBinary>,
  mode: 'visible' | 'spherex_ir' = 'visible',
  honesty: HonestyState = 'artistic',
) => planRender(card, params, defaultContext({ honesty, mode }));

describe('brown dwarf binary components', () => {
  it('the fixture carries two components in class order', () => {
    const { params } = fixture('brown_dwarf_binary');
    expect(params.components?.map((c) => c.class)).toEqual(['T1', 'T6']);
    expect(params.components?.[0]?.emissive_scale).toBe(1);
  });

  it('each body takes its own tint and brightness, and no sharing note is shown', () => {
    const f = flatBinary();
    const p = plan(f);
    const [a, b] = p.bodies;
    expect(a!.tint).toEqual([0.5, 0.24, 0.14]);
    expect(b!.tint).toEqual([0.3, 0.26, 0.36]);
    expect(a!.emissive).toBeGreaterThan(b!.emissive ?? 0);
    expect(b!.emissive! / a!.emissive!).toBeCloseTo(f.params.components![1]!.emissive_scale!, 6);
    expect(p.notes.join(' ')).not.toMatch(/share the system/);
    const drawn = p.drawn.map((d) => d.id);
    expect(drawn).toEqual(expect.arrayContaining(['components', 'component_brightness']));
  });

  it('the infrared view keeps the whole-body SPHEREx colour but still scales the brightness', () => {
    const p = plan(flatBinary(), 'spherex_ir');
    const [a, b] = p.bodies;
    expect(a!.tint).toEqual(p.tint.rgb);
    expect(b!.tint).toEqual(p.tint.rgb);
    expect(b!.emissive).toBeLessThan(a!.emissive!);
    expect(p.notes.join(' ')).toMatch(/share the system colour\./);
  });

  it('a drawn band map is the colour, so the per-class tint is not applied on top of it', () => {
    const { card, params } = fixture('brown_dwarf_binary');
    const p = planRender(card, params, defaultContext({ honesty: 'artistic', mode: 'visible' }));
    expect(p.bodies[0]!.tint).toEqual([1, 1, 1]);
    expect(p.drawn.map((d) => d.id)).not.toContain('components');
  });

  it('without `components` the old note stays and both bodies share the system look', () => {
    const f = flatBinary((p) => delete p.components);
    const p = plan(f);
    expect(p.notes.join(' ')).toMatch(SHARE_BOTH);
    expect(p.bodies[0]!.emissive).toBe(p.bodies[1]!.emissive);
    expect(p.bodies[0]!.tint).toEqual(p.bodies[1]!.tint);
  });

  it('with no component brightness the colour is per body and the brightness is shared', () => {
    const f = flatBinary((p) => {
      const [a, b] = p.components!;
      p.components = [
        { ...a!, emissive_scale: null },
        { ...b!, emissive_scale: null },
      ];
      p.layers = p.layers.filter((l) => l.id !== 'component_brightness');
      p.missing = [...p.missing, 'component_brightness'];
    });
    const p = plan(f);
    expect(p.bodies[0]!.emissive).toBe(p.bodies[1]!.emissive);
    expect(p.bodies[0]!.tint).not.toEqual(p.bodies[1]!.tint);
    expect(p.notes.join(' ')).toMatch(/share the system brightness\./);
  });

  it('at a lower honesty state the inferred-from-analog colour layer is refused, not faked', () => {
    const p = plan(flatBinary(), 'visible', 'derived');
    // The orbit is artistic, so only one body is drawn at this state; the layers stay out of it.
    expect(p.bodies).toHaveLength(1);
    expect(p.drawn.map((d) => d.id)).not.toContain('components');
  });
});
