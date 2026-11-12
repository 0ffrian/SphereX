// @vitest-environment node
// §9.4 priority, §9.5 budgets and cache, §2.6 never blank: the palette with a fake AudioContext and a fake worker.
import { describe, expect, it, vi } from 'vitest';
import { handleBakeRequest, type BakeRequest, type BakeResponse } from './bake.worker';
import { BED_MEMORY_MB } from './dspTuning';
import { Palette, worldKeyOf, type WorkerLike } from './palette';
import { EARTH_AIR, EARTH_PARAMS, TITAN_AIR, spec } from './bakeFixtures.testutil';
import type { AirModel, BedSpec } from './types';

const N = 1 << 12;

class FakeBuffer {
  readonly ch: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  copyToChannel(src: Float32Array, c: number) {
    this.ch[c]!.set(src);
  }
}
const fakeCtx = () =>
  ({
    createBuffer: (c: number, l: number, sr: number) => new FakeBuffer(c, l, sr),
  }) as unknown as BaseAudioContext;

/** A worker whose replies are delivered when the test calls `flush()` (one bed at a time, like the real one). */
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: BakeResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  inbox: BakeRequest[] = [];
  terminated = false;
  postMessage(msg: BakeRequest) {
    this.inbox.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  flush(max = 100) {
    for (let i = 0; i < max && this.inbox.length; i++) {
      const m = this.inbox.shift()!;
      this.onmessage?.({ data: handleBakeRequest(m) });
    }
  }
}

function setup() {
  const w = new FakeWorker();
  const p = new Palette(fakeCtx(), { workerFactory: () => w });
  return { w, p };
}
const order = (w: FakeWorker) => {
  const seen: string[] = [];
  while (w.inbox.length) {
    const m = w.inbox[0]!;
    seen.push(`${m.spec.id}/${m.spec.variant}`);
    w.flush(1);
  }
  return seen;
};

describe('Palette', () => {
  it('bakes in §9.4 priority order, one bed at a time', () => {
    const { w, p } = setup();
    p.request(
      [spec('S2', N), spec('thunder', N), spec('S1_land', N), spec('S6', N), spec('S4', N)],
      EARTH_AIR,
    );
    expect(w.inbox.length).toBe(1);
    expect(order(w)).toEqual(['S1_land/0', 'S4/0', 'S6/0', 'S2/0', 'thunder/0']);
    expect(p.get('S4', 0)).not.toBeNull();
  });

  it('keeps loop beds under the 96 MB cap and thunder in its own one-shot budget', () => {
    const { w, p } = setup();
    const big = (id: BedSpec['id']) => spec(id, 1 << 20);
    const beds = [
      big('S1_land'),
      big('S1_sea'),
      big('S2'),
      big('S3'),
      big('S4'),
      big('S5'),
      big('S6'),
      big('S7'),
      big('S9'),
      big('S10'),
      big('S12'),
      big('S8'),
      spec('thunder', 1 << 20, { variant: 0 }),
      spec('thunder', 1 << 20, {
        variant: 2,
        params: { ...EARTH_PARAMS.thunder, d_m: 5000, dur_s: 35, crack: 0 },
      }),
    ];
    p.request(beds, EARTH_AIR);
    const skipped = p.unavailable().map((r) => r.source);
    const loopCount = 12 - skipped.length;
    expect(loopCount * (1 << 20) * 8).toBeLessThanOrEqual(BED_MEMORY_MB * 1e6);
    expect(skipped).toContain('S9'); // the lowest-priority loop beds go first
    expect(skipped).not.toContain('thunder');
    expect(w.inbox[0]!.spec.id).toBe('S1_land');
  });

  it('a cached bed is not baked again; a changed spec is', () => {
    const { w, p } = setup();
    p.request([spec('S2', N)], EARTH_AIR);
    w.flush();
    p.request([spec('S2', N)], EARTH_AIR);
    expect(w.inbox.length).toBe(0);
    p.request([spec('S2', N, { Uref: 9 })], EARTH_AIR);
    expect(w.inbox.length).toBe(1);
  });

  it('onReady fires once per bed with the world key; unsubscribe works', () => {
    const { w, p } = setup();
    const cb = vi.fn();
    const off = p.onReady(cb);
    p.request([spec('S1_land', N), spec('S2', N)], EARTH_AIR);
    w.flush(1);
    expect(cb).toHaveBeenCalledWith({ id: 'S1_land', variant: 0, worldKey: worldKeyOf(EARTH_AIR) });
    off();
    w.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a refused bed drops only itself and is listed', () => {
    const { w, p } = setup();
    p.request(
      [spec('S1_land', N), spec('S2', N, { params: { Iu: 0.2 } }), spec('S6', N)],
      EARTH_AIR,
    );
    w.flush();
    expect(p.get('S1_land', 0)).not.toBeNull();
    expect(p.get('S6', 0)).not.toBeNull();
    expect(p.get('S2', 0)).toBeNull();
    expect(p.unavailable()).toEqual([
      { source: 'S2', reason: expect.stringMatching(/^The sound of grit hissing in the wind is unavailable: .*fHiss_Hz/) },
    ]);
  });

  it("keeps two worlds (LRU) and never serves another world's bed (ruling 1)", () => {
    const { w, p } = setup();
    const mars: AirModel = { ...TITAN_AIR, presetId: 'mars-like' };
    p.request([spec('S1_land', N)], EARTH_AIR);
    w.flush();
    const earthBuf = p.get('S1_land', 0);
    expect(earthBuf).not.toBeNull();
    p.request([spec('S1_land', N)], TITAN_AIR);
    expect(p.get('S1_land', 0)).toBeNull(); // Titan's is not baked yet: never Earth's wind
    w.flush();
    expect(p.get('S1_land', 0)).not.toBeNull();
    expect(p.get('S1_land', 0)).not.toBe(earthBuf);
    p.request([spec('S1_land', N)], mars);
    w.flush();
    expect(p.stats().beds).toBe(2); // Earth evicted
    p.request([spec('S1_land', N)], EARTH_AIR);
    expect(w.inbox.length).toBe(1); // re-baked: it was evicted
  });

  it('a reply in flight lands under its own world, and a new request re-prioritises', () => {
    const { w, p } = setup();
    p.request([spec('S2', N), spec('S7', N)], EARTH_AIR);
    p.request([spec('S1_land', N)], TITAN_AIR);
    w.flush(1); // Earth's S2 was in flight; Titan's queue follows (S7 was dropped)
    expect(w.inbox.map((m) => m.spec.id)).toEqual(['S1_land']);
    w.flush();
    expect(p.get('S7', 0)).toBeNull();
    expect(p.get('S2', 0)).toBeNull(); // Titan never asked for S2
    expect(p.unavailable()).toEqual([]);
  });

  it('a §9.6 re-bake reuses beds whose sound is unchanged (same spec, c0, gv)', () => {
    const { w, p } = setup();
    const cb = vi.fn();
    p.onReady(cb);
    p.request([spec('S1_land', N), spec('S4', N)], EARTH_AIR);
    w.flush();
    const s1 = p.get('S1_land', 0);
    // Ps slider: a new air hash, same preset, same c0 and gv; S4's spec changes (new wave height).
    const moved: AirModel = { ...EARTH_AIR, P0: 90000, rho0: 1.09 };
    p.request(
      [spec('S1_land', N), spec('S4', N, { params: { ...EARTH_PARAMS.S4, Hs_m: 1.3 } })],
      moved,
    );
    expect(p.get('S1_land', 0)).toBe(s1);
    expect(p.get('S4', 0)).toBeNull();
    expect(w.inbox.map((m) => m.spec.id)).toEqual(['S4']);
    expect(cb).toHaveBeenLastCalledWith({ id: 'S1_land', variant: 0, worldKey: worldKeyOf(moved) });
  });

  it('a re-bake that changes c0 still reuses beds that do not read it, and counts shared buffers once', () => {
    const { w, p } = setup();
    p.request([spec('S1_land', N), spec('S4', N)], EARTH_AIR);
    w.flush();
    const s1 = p.get('S1_land', 0);
    const bytesBefore = p.stats().bytes;
    const warmer: AirModel = { ...EARTH_AIR, T0: 300, c0: 347.3 };
    p.request([spec('S1_land', N), spec('S4', N)], warmer);
    expect(p.get('S1_land', 0)).toBe(s1); // S1 does not read c0
    expect(w.inbox.map((m) => m.spec.id)).toEqual(['S4']); // S4's echo delays do
    w.flush();
    // Two worlds hold S1, but it is one AudioBuffer: only the new S4 adds bytes.
    expect(p.stats().bytes).toBe(bytesBefore + N * 8);
  });

  it('beds a later request drops are evicted and no longer served (code review M2)', () => {
    const { w, p } = setup();
    p.request([spec('S1_land', N), spec('S6', N), spec('S7', N)], EARTH_AIR);
    w.flush();
    p.request([spec('S1_sea', N), spec('S4', N)], EARTH_AIR);
    w.flush();
    expect(p.get('S6', 0)).toBeNull();
    expect(p.get('S1_land', 0)).toBeNull();
    expect(p.stats().beds).toBe(2);
  });

  it('does not bake the bed in flight twice', () => {
    const { w, p } = setup();
    p.request([spec('S1_land', N), spec('S2', N)], EARTH_AIR);
    p.request([spec('S1_land', N), spec('S2', N)], EARTH_AIR);
    expect(order(w)).toEqual(['S1_land/0', 'S2/0']);
    expect(p.get('S1_land', 0)).not.toBeNull();
  });

  it('fits 4 thunder variants plus the vent burst on a slow-sound world (36 MB one-shot budget)', () => {
    const { p } = setup();
    const th = (variant: number, d_m: number, dur_s: number, crack: number) =>
      spec('thunder', 1 << 20, { variant, params: { ...EARTH_PARAMS.thunder, d_m, dur_s, crack } });
    p.request(
      [
        th(0, 400, 17.7, 1),
        th(1, 800, 34.9, 1),
        th(2, 5000, 35, 0),
        th(3, 12000, 35, 0),
        spec('S8', N, { variant: 1 }),
      ],
      TITAN_AIR,
    );
    expect(p.unavailable()).toEqual([]);
  });

  it('refuses an invalid spec before charging the budget (code review L5)', () => {
    const { w, p } = setup();
    const bad = spec('thunder', N, { params: { ...EARTH_PARAMS.thunder, dur_s: Number.NaN } });
    p.request([bad, spec('thunder', N, { variant: 1 })], EARTH_AIR);
    expect(p.unavailable().map((r) => r.reason)).toEqual([expect.stringMatching(/dur_s/)]);
    expect(w.inbox.map((m) => `${m.spec.id}/${m.spec.variant}`)).toEqual(['thunder/1']);
  });

  it('falls back to the main thread for the first bed only, once per world', () => {
    const jobs: (() => void)[] = [];
    const p = new Palette(fakeCtx(), {
      workerFactory: () => null,
      schedule: (fn) => void jobs.push(fn),
    });
    p.request([spec('S2', N), spec('S1_land', N), spec('S6', N)], EARTH_AIR);
    expect(jobs.length).toBe(1);
    jobs.shift()!();
    expect(p.get('S1_land', 0)).not.toBeNull();
    expect(p.unavailable().map((r) => r.source)).toEqual(['S6', 'S2']);
    // m5 (#116): the text the panel shows names the sound, never the raw id
    expect(p.unavailable().map((r) => r.reason)).toEqual([
      'The sound of the rain is unavailable: the background sound maker did not start',
      'The sound of grit hissing in the wind is unavailable: the background sound maker did not start',
    ]);
    for (const r of p.unavailable()) expect(r.reason).not.toMatch(/\bS\d+\b/);
    p.request([spec('S2', N), spec('S1_land', N), spec('S6', N)], EARTH_AIR);
    expect(jobs.length).toBe(0); // no second main-thread bake for this world (code review L4)
  });

  it('a worker error re-queues the bed on the main thread', () => {
    const w = new FakeWorker();
    const jobs: (() => void)[] = [];
    const p = new Palette(fakeCtx(), {
      workerFactory: () => w,
      schedule: (fn) => void jobs.push(fn),
    });
    p.request([spec('S1_land', N)], EARTH_AIR);
    w.onerror?.(new Error('boom'));
    expect(w.terminated).toBe(true);
    jobs.shift()!();
    expect(p.get('S1_land', 0)).not.toBeNull();
  });

  it('dispose terminates the worker and ignores late replies', () => {
    const { w, p } = setup();
    p.request([spec('S1_land', N)], EARTH_AIR);
    p.dispose();
    expect(w.terminated).toBe(true);
    w.flush();
    expect(p.get('S1_land', 0)).toBeNull();
  });
});
