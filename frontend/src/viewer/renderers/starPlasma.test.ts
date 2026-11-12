// Issue #71 stream G: flares and plasma through the plan and the star body.
import { describe, expect, it } from 'vitest';
import { defaultContext } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { STAR_CONFIG, planStar } from './Star';
import { StarBody } from './StarBody';
import { uploadUsed } from './StarPlasma';
import { BufferAttribute } from 'three/webgpu';
import { STREAK_BUDGET } from '@/physics/flares';

const config = {
  ...STAR_CONFIG,
  massMsun: () => ({ value: 0.7, tag: 'measured' as const, source: 't' }),
};
const plan = (ctx = {}) => {
  const { card, params } = fixture('star');
  return planStar({ card, params, ctx: defaultContext({ honesty: 'artistic', ...ctx }) }, config);
};
const body = (p: ReturnType<typeof plan>, tier: 'high' | 'low' = 'high') =>
  new StarBody(p.star!, {
    tint: p.bodies[0]!.tint,
    emissive: 1,
    limbU: 0.6,
    octaves: 3,
    axes: [1, 1, 1],
    segments: [16, 8],
    tier,
  });

describe('plasma on the star', () => {
  it('is a layer of the plan with the model_dependent tag, and replaces the old loops', () => {
    const p = plan();
    expect(p.star?.plasma).toBe(true);
    expect(p.drawn.find((d) => d.id === 'plasma')?.tier).toBeDefined();
    expect(p.drawn.find((d) => d.id === 'plasma')?.tag).toBe('model_dependent');
    const b = body(p);
    expect(b.plasma).not.toBeNull();
  });

  it('draws the same streaks twice and stays inside the budget', () => {
    const p = plan();
    expect(p.star?.plasma).toBe(true);
    const a = body(p);
    const b = body(p);
    for (const t of [0, 5e4, 3e6, 9e6]) {
      a.setTime(() => t);
      b.setTime(() => t);
      expect(a.plasma!.streakCount).toBe(b.plasma!.streakCount);
      expect(a.plasma!.streakCount).toBeLessThanOrEqual(STREAK_BUDGET.high);
    }
    const low = body(p, 'low');
    low.setTime(() => 3e6);
    expect(low.plasma!.streakCount).toBeLessThanOrEqual(STREAK_BUDGET.low);
  });

  it('is hidden in true colour and the close-up, and the field-lines toggle hides it', () => {
    const t = plan({ starColour: 'true' });
    expect(t.star?.plasma).toBe(true);
    expect(body(t).plasma!.group.visible).toBe(false);
    const p = plan({ starColour: 'enhanced' });
    const b = body(p);
    expect(b.plasma!.group.visible).toBe(true);
    b.plasma!.setLines(false);
    expect(b.plasma!.group.visible).toBe(false);
  });
});

describe('streak upload (issue #93 W1, render notes 0.6)', () => {
  it('uploads only the floats in use, and nothing when nothing is drawn', () => {
    const a = new BufferAttribute(new Float32Array(600), 3);
    const v0 = a.version;
    uploadUsed(a, 42);
    expect(a.updateRanges).toEqual([{ start: 0, count: 42 }]);
    expect(a.version).toBe(v0 + 1);
    uploadUsed(a, 6);
    expect(a.updateRanges).toEqual([{ start: 0, count: 6 }]);
    uploadUsed(a, 0);
    expect(a.updateRanges).toEqual([]);
    expect(a.version).toBe(v0 + 2);
    uploadUsed(a, 9999);
    expect(a.updateRanges).toEqual([{ start: 0, count: 600 }]);
  });

  it('a star frame asks for the streaks it drew, not the whole budget', () => {
    const b = body(plan({ starColour: 'enhanced' }));
    b.setTime(() => 3e6);
    const pl = b.plasma!;
    const n = pl.streakCount;
    expect(n).toBeGreaterThan(0);
    const mesh = pl.group.children[0] as unknown as {
      geometry: { attributes: Record<string, BufferAttribute> };
    };
    const { position, color } = mesh.geometry.attributes;
    expect(position!.updateRanges).toEqual([{ start: 0, count: n * 6 }]);
    expect(color!.updateRanges).toEqual([{ start: 0, count: n * 6 }]);
    expect(n * 6).toBeLessThan(position!.array.length);
  });
});
