// Issue #173: the scanning rings' model. Rings trickle in one at a time, each dies on its own time,
// the crowd drifts between 5 and 10 or 20, and nothing is left past a ring's life.
import { describe, expect, it } from 'vitest';
import {
  BUSY,
  CALM,
  CROWD_STEP_MS,
  RING_LIFE_MS,
  RING_RADIUS_PX,
  newSim,
  quadPoint,
  ringLook,
  seeded,
  stepSim,
} from './scanRingsSim';

const run = (seed: number, ms: number, dt = 16) => {
  const sim = newSim(0, seeded(seed));
  const counts: number[] = [];
  const targets = new Set<number>();
  let maxBorn = 0;
  for (let t = 0; t <= ms; t += dt) {
    const before = sim.rings.length;
    stepSim(sim, t);
    // At most one new ring a step: they trickle in, never as a set.
    expect(sim.rings.length - before).toBeLessThanOrEqual(1);
    counts.push(sim.rings.length);
    targets.add(sim.target);
    maxBorn = Math.max(maxBorn, sim.rings.filter((r) => r.born === t).length);
  }
  return { sim, counts, targets, maxBorn };
};

describe('scanning rings', () => {
  it('drifts between a calm 5 and a busy 10 or 20', () => {
    const { targets, counts } = run(7, CROWD_STEP_MS * 12);
    expect(targets.has(CALM)).toBe(true);
    expect([...targets].some((t) => (BUSY as readonly number[]).includes(t))).toBe(true);
    expect(Math.max(...counts)).toBeLessThanOrEqual(BUSY[1]);
    expect(Math.max(...counts)).toBeGreaterThan(CALM);
  });

  it('rings die one by one, not as a set', () => {
    const sim = newSim(0, seeded(3));
    for (let t = 0; t <= 3000; t += 16) stepSim(sim, t);
    const ends = sim.rings.map((r) => Math.round(r.born + r.life));
    expect(new Set(ends).size).toBe(ends.length);
  });

  it('each ring lives 0.7 to 2 s and grows to 6 to 14 px', () => {
    const { sim } = run(11, 5000);
    for (const r of sim.rings) {
      expect(r.life).toBeGreaterThanOrEqual(RING_LIFE_MS[0]);
      expect(r.life).toBeLessThanOrEqual(RING_LIFE_MS[1]);
      expect(r.rMax).toBeGreaterThanOrEqual(RING_RADIUS_PX[0]);
      expect(r.rMax).toBeLessThanOrEqual(RING_RADIUS_PX[1]);
      expect(r.u).toBeGreaterThan(0);
      expect(r.u).toBeLessThan(1);
    }
  });

  it('a ring fades in, widens, and is gone at the end of its life', () => {
    const r = { u: 0.5, v: 0.5, born: 0, life: 1000, rMax: 10 };
    expect(ringLook(r, 0).opacity).toBe(0);
    expect(ringLook(r, 500).opacity).toBeGreaterThan(0.5);
    expect(ringLook(r, 1000).opacity).toBe(0);
    expect(ringLook(r, 900).radius).toBeGreaterThan(ringLook(r, 100).radius);
    expect(ringLook(r, 1000).radius).toBeCloseTo(10);
  });

  it('is the same for the same seed', () => {
    const a = run(5, 4000).sim.rings;
    const b = run(5, 4000).sim.rings;
    expect(a).toEqual(b);
  });

  it('places a ring inside the square by its own coordinates', () => {
    const q = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    expect(quadPoint(q, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(quadPoint(q, 1, 1)).toEqual({ x: 100, y: 50 });
    expect(quadPoint(q, 0.5, 0.5)).toEqual({ x: 50, y: 25 });
  });
});
