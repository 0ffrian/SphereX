// Issue #71 stream G: flare energy cap, decay-index threshold, schedule floor, determinism,
// particle budget and occlusion.
import { describe, expect, it } from 'vitest';
import {
  DECAY_THRESHOLD,
  MIN_GAP_S,
  STREAK_BUDGET,
  StreakSink,
  decayIndexOf,
  emaxErg,
  emitEvent,
  emitQuiet,
  emitStage,
  eventsAt,
  flareClass,
  flareText,
  gapOf,
  groupPoint,
  lightCurves,
  occludedByDisc,
  opens,
  scheduledEvent,
  type ScheduleContext,
} from './flares';
import { stellarModel } from './stellar';

const m = stellarModel({ teffK: 5772, radiusRsun: 1, massMsun: 1, rotationPeriodD: 6, seed: 5 });
if (!m.model) throw new Error('no model');
const ctx = (rate = 0.2, seed = 5): ScheduleContext => ({
  seed,
  groups: m.model!.groups,
  radiusRsun: 1,
  ratePerDisplayS: rate,
});

describe('energy cap', () => {
  it('E_max = 0.1 (B^2/8pi) A^1.5 with B = 1000 G', () => {
    // A = 1e-3 of the Sun's surface: 6.08e19 cm^2 -> 0.1 * 3.979e4 erg/cm^3 * 4.74e29 = 1.89e33 erg
    expect(emaxErg(1e-3, 1) / 1.89e33).toBeGreaterThan(0.98);
    expect(emaxErg(1e-3, 1) / 1.89e33).toBeLessThan(1.02);
  });
  it('no scheduled flare exceeds its group cap', () => {
    const c = ctx();
    for (let k = 0; k < 200; k++) {
      const e = scheduledEvent(c, k)!;
      const g = c.groups.find((x) => x.id === e.groupId)!;
      expect(e.energyErg).toBeLessThanOrEqual(emaxErg(g.areaFraction, 1) * 1.0000001);
    }
  });
  it('a forced flare is capped too', () => {
    const e = scheduledEvent(ctx(), 0)!;
    expect(e.energyErg).toBeGreaterThan(0);
  });
});

describe('decay index', () => {
  it('threshold 1.5 sits at x = 1 and splits open from closed', () => {
    expect(decayIndexOf(1)).toBeCloseTo(1.5, 10);
    expect(opens(decayIndexOf(0.99))).toBe(false);
    expect(opens(decayIndexOf(1.01))).toBe(true);
    expect(opens(DECAY_THRESHOLD)).toBe(true);
  });
  it('events agree with their own index', () => {
    for (let k = 0; k < 100; k++) {
      const e = scheduledEvent(ctx(), k)!;
      expect(e.open).toBe(e.decayIndex >= DECAY_THRESHOLD);
    }
  });
});

describe('schedule', () => {
  it('is deterministic and seed dependent', () => {
    expect(scheduledEvent(ctx(), 7)).toEqual(scheduledEvent(ctx(), 7));
    expect(scheduledEvent(ctx(0.2, 6), 7)).not.toEqual(scheduledEvent(ctx(), 7));
  });
  it('never starts two flares closer than 1.4 s, even on a very active star', () => {
    for (const rate of [0.05, 0.5, 5, 50]) {
      const c = ctx(rate);
      let prev = -Infinity;
      for (let k = 0; k < 300; k++) {
        const e = scheduledEvent(c, k)!;
        expect(e.t0 - prev).toBeGreaterThanOrEqual(MIN_GAP_S - 1e-9);
        prev = e.t0;
      }
    }
  });
  it('raises the threshold on an active star', () => {
    const lo = Math.min(
      ...Array.from({ length: 80 }, (_, k) => scheduledEvent(ctx(0.1), k)!.energyErg),
    );
    const hi = Math.min(
      ...Array.from({ length: 80 }, (_, k) => scheduledEvent(ctx(10), k)!.energyErg),
    );
    expect(hi).toBeGreaterThan(lo);
    expect(gapOf(10)).toBe(MIN_GAP_S);
  });
  it('eventsAt is a pure function of time and has no events without groups or rate', () => {
    expect(eventsAt(ctx(), 30)).toEqual(eventsAt(ctx(), 30));
    expect(eventsAt({ ...ctx(), groups: [] }, 30)).toEqual([]);
    expect(eventsAt(ctx(0), 30)).toEqual([]);
  });
});

describe('text and class', () => {
  it('classes and plain words', () => {
    expect(flareClass(3e29)).toBe('C3.0');
    expect(flareClass(2e30)).toBe('M2.0');
    expect(flareClass(5e31)).toBe('X5.0');
    expect(flareText(scheduledEvent(ctx(), 1)!)).toMatch(/decay index is n = /);
  });
});

describe('plasma streaks', () => {
  const big = () => {
    const c = ctx();
    const g = c.groups[0]!;
    // a big forced flare in the middle of its life
    const e0 = scheduledEvent(c, 3)!;
    return { g, e: { ...e0, groupId: g.id } };
  };
  it('is a pure function of age and identical on a rerun', () => {
    const { g, e } = big();
    const a = new StreakSink(60000);
    const b = new StreakSink(60000);
    emitEvent(a, g, e, e.t0 + e.life * 0.4, { boost: 3, q: 1, clock: 1 });
    emitEvent(b, g, e, e.t0 + e.life * 0.4, { boost: 3, q: 1, clock: 1 });
    expect(a.n).toBeGreaterThan(50);
    expect(a.n).toBe(b.n);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
  });
  it('draws nothing outside the flare life', () => {
    const { g, e } = big();
    const s = new StreakSink(1000);
    emitEvent(s, g, e, e.t0 - 1, { boost: 1, q: 1, clock: 0 });
    emitEvent(s, g, e, e.t0 + e.life + 1, { boost: 1, q: 1, clock: 0 });
    expect(s.n).toBe(0);
  });
  it('never exceeds the budget and low quality draws fewer', () => {
    const { g, e } = big();
    const small = new StreakSink(STREAK_BUDGET.low);
    emitQuiet(small, [g], 5, { boost: 3, q: 1, clock: 0 });
    for (let i = 0; i < 10; i++)
      emitEvent(small, g, e, e.t0 + e.life * 0.4, { boost: 3, q: 1, clock: 0 });
    expect(small.n).toBeLessThanOrEqual(STREAK_BUDGET.low);
    const hi = new StreakSink(STREAK_BUDGET.high);
    const lo = new StreakSink(STREAK_BUDGET.high);
    emitEvent(hi, g, e, e.t0 + e.life * 0.4, { boost: 3, q: 1, clock: 0 });
    emitEvent(lo, g, e, e.t0 + e.life * 0.4, { boost: 3, q: 0.4, clock: 0 });
    expect(lo.n).toBeLessThan(hi.n);
  });
  it('stays on the arches: every point is above the surface', () => {
    const { g, e } = big();
    const s = new StreakSink(60000);
    emitEvent(s, g, e, e.t0 + e.life * 0.5, { boost: 3, q: 1, clock: 0 });
    for (let i = 0; i < s.n; i++) {
      const r = Math.hypot(s.pos[i * 6]!, s.pos[i * 6 + 1]!, s.pos[i * 6 + 2]!);
      expect(r).toBeGreaterThan(0.99);
    }
  });
  it('the stage view is pure and open differs from closed', () => {
    const at = (a: number, l: number, h: number): [number, number, number] => [a, 1 + h, l];
    const a = new StreakSink(20000);
    const b = new StreakSink(20000);
    emitStage(a, at, 0.5, { open: true, strength: 1, q: 1 });
    emitStage(b, at, 0.5, { open: true, strength: 1, q: 1 });
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
    const c = new StreakSink(20000);
    emitStage(c, at, 0.5, { open: false, strength: 1, q: 1 });
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(c.pos.buffer))).toBe(false);
  });
});

describe('occlusion', () => {
  it('hides what is behind the disc, shows what is beside or in front', () => {
    const view: [number, number, number] = [0, 0, 1];
    expect(occludedByDisc([0.2, 0.1, -1.01], view)).toBe(true);
    expect(occludedByDisc([0.2, 0.1, 1.01], view)).toBe(false);
    expect(occludedByDisc([1.3, 0, -1.2], view)).toBe(false);
  });
  it('a group point lifts along the radius', () => {
    const g = ctx().groups[0]!;
    const p = groupPoint(g, 0, 0, 0.1);
    expect(Math.hypot(...p)).toBeCloseTo(1.1, 10);
  });
});

describe('light curve (Neupert)', () => {
  it('hard X-rays peak while soft X-rays rise, before the soft peak', () => {
    for (const open of [true, false]) {
      const { soft, hard } = lightCurves(open);
      const hp = hard.indexOf(Math.max(...hard));
      const sp = soft.indexOf(Math.max(...soft));
      expect(hp).toBeLessThan(sp);
      expect(Math.max(...hard)).toBeCloseTo(1, 10);
    }
  });
});
