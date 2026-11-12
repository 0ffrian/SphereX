// Issue #93 wave 1 (1.8): the height-map build is a pure function of its request, so the worker's copy of the engine
// gives the same bytes as the main thread's (determinism: same card and seed, same picture).
import { describe, expect, it } from 'vitest';
import * as E from './source';
import { buildField, handleBuild, type BuildRequest } from './rockBuild';
import type { RockPreset } from './cardToRock';

const RP = (E as unknown as { RP: RockPreset[] }).RP;
/** A card body (#93 2.8 seed fields): its own crater stream and per-crater variation. */
const card: RockPreset = {
  ...RP[1]!,
  id: 'card',
  seed: 7,
  seed3: [12, 200, 77],
  seedHash: 0x9e3779b9 | 0,
};

const copy = (req: BuildRequest) => {
  const r = buildField(req);
  return { ...r, built: { ...r.built, data: r.built.data.slice() } };
};

describe('buildField (#93 1.8)', () => {
  it('the same request gives byte-identical height maps, and another age a different one', () => {
    const req: BuildRequest = { preset: card, mode: 'rocky', age: 40, mesh: null };
    const a = copy(req);
    const b = copy(req);
    expect(a.built.w * a.built.h * 2).toBe(a.built.data.length);
    expect(Buffer.from(a.built.data.buffer).equals(Buffer.from(b.built.data.buffer))).toBe(true);
    expect(a.RM).toEqual(b.RM);
    expect(a.built.craters).toBe(b.built.craters);
    const c = copy({ ...req, age: 90 });
    expect(c.built.craters).toBeGreaterThan(a.built.craters);
  });

  it("the worker's handler returns the same bytes as the main thread", () => {
    const req: BuildRequest = { preset: RP[4]!, mode: 'rocky', age: 70, mesh: null };
    const main = copy(req);
    const res = handleBuild({ id: 9, req });
    if (!('built' in res)) throw new Error(res.error);
    expect(res.id).toBe(9);
    expect(Buffer.from(res.built.data.buffer).equals(Buffer.from(main.built.data.buffer))).toBe(
      true,
    );
    expect(res.built.ext).toBe(main.built.ext);
  });

  it('a shape model replaces the generated field: radius over the engine radius, round axes, no fresh craters', () => {
    const mesh = new Float32Array(1024 * 512).fill(0.1);
    mesh[5] = 0.3;
    const r = copy({ preset: RP[2]!, mode: 'rocky', age: 70, mesh });
    expect(r.RM.ax).toEqual([1, 1, 1]);
    // ab is forced to 1, so the engine's own radius is 1 and h = r - 1.
    expect(r.built.data[0]).toBeCloseTo(0.1, 6);
    expect(r.built.data[5 * 2]).toBeCloseTo(0.3, 6);
    expect(r.built.data[1]).toBe(0);
    expect(r.built.ext).toBeCloseTo(1.3, 6);
  });

  it('a failing build is reported, not thrown (the client then builds on its own thread)', () => {
    const res = handleBuild({
      id: 1,
      req: { preset: null as unknown as RockPreset, mode: 'rocky', age: 1, mesh: null },
    });
    expect('error' in res).toBe(true);
  });
});
