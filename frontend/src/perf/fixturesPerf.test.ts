import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPerfHooks } from './fixturesPerf';
import type { PerfHooks } from './fixturesPerf';

type Cb = (t: number) => void;
const g = globalThis as unknown as {
  window: Record<string, unknown>;
  requestAnimationFrame: (cb: Cb) => number;
  cancelAnimationFrame: (h: number) => void;
};

let now = 0;
let pending: Map<number, Cb>;
let nextHandle = 1;
let cancelled: number[];
let intervalAt: (i: number) => number;
let ticks = 0;

/** Runs frames until nothing is scheduled (the recorder stops itself). */
function pump(max = 100000): void {
  for (let i = 0; i < max && pending.size > 0; i++) {
    const [h, cb] = pending.entries().next().value as [number, Cb];
    pending.delete(h);
    now += intervalAt(ticks++);
    cb(now);
  }
}

function fakeViewer(over: { tier?: string; backend?: string; drops?: number } = {}) {
  let frames = 0;
  return {
    renderStats: () => ({
      tier: over.tier ?? 'medium',
      backend: over.backend ?? 'webgpu',
      frames: (frames = frames + 0),
      drops: over.drops ?? 0,
      p50Ms: 0,
      p95Ms: 0,
    }),
    advance: (n: number) => {
      frames += n;
    },
  };
}

beforeEach(() => {
  now = 0;
  ticks = 0;
  nextHandle = 1;
  pending = new Map();
  cancelled = [];
  intervalAt = () => 1000 / 144;
  g.window = {};
  g.requestAnimationFrame = (cb) => {
    const h = nextHandle++;
    pending.set(h, cb);
    return h;
  };
  g.cancelAnimationFrame = (h) => {
    cancelled.push(h);
    pending.delete(h);
  };
});
afterEach(() => {
  vi.restoreAllMocks();
});

const hooks = (): PerfHooks => (g.window as { __sxPerf: PerfHooks }).__sxPerf;

/** A viewer whose frame counter advances with every rAF tick, like a viewer drawing every frame. */
function drawingViewer(): ReturnType<typeof fakeViewer> {
  const v = fakeViewer();
  const base = g.requestAnimationFrame;
  g.requestAnimationFrame = (cb) => base((t) => (v.advance(1), cb(t)));
  return v;
}

describe('__sxPerf.record', () => {
  it('collects every interval of a 144 Hz second and computes viewerFrames', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    const p = hooks().record(1);
    pump();
    const r = await p;
    expect(r.samples).toBeGreaterThan(130);
    expect(r.summary.p50Ms).toBeCloseTo(1000 / 144, 5);
    expect(r.viewerFrames).toBeGreaterThanOrEqual(r.samples);
    expect(r.tierStart).toBe('medium');
    expect(r.verdict.meetsTarget).toBe(true);
  });

  it('collects more than 240 intervals over a longer run (past the renderStats window)', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    const p = hooks().record(2);
    pump();
    expect((await p).samples).toBeGreaterThan(240);
  });

  it('counts a 300 ms tick as a gap and fails the verdict', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    intervalAt = (i) => (i === 50 ? 300 : 1000 / 144);
    const p = hooks().record(1);
    pump();
    const r = await p;
    expect(r.summary.longGaps).toBe(1);
    expect(r.summary.maxGapMs).toBeCloseTo(300, 5);
    expect(r.verdict.meetsFloor30).toBe(false);
    expect(r.verdict.reasons.join('|')).toContain('stall');
  });

  it('fails when the viewer did not draw each sampled frame', async () => {
    installPerfHooks();
    g.window.__sxViewer = fakeViewer();
    const p = hooks().record(1);
    pump();
    const r = await p;
    expect(r.viewerFrames).toBe(0);
    expect(r.verdict.meetsFloor30).toBe(false);
  });

  it('a drop before the recording (start.drops 1, delta 0) fails everything', async () => {
    installPerfHooks();
    const v = drawingViewer();
    const base = v.renderStats;
    v.renderStats = () => ({ ...base(), tier: 'low', drops: 1 });
    g.window.__sxViewer = v;
    const p = hooks().record(1);
    pump();
    const r = await p;
    expect(r.verdict.meetsFloor30).toBe(false);
    expect(r.verdict.meetsTarget).toBe(false);
    expect(r.verdict.eventGate).toBe(false);
    expect(r.verdict.reasons.join('|')).toContain('quality dropped');
  });

  it('rejects a non-positive or NaN duration', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    await expect(hooks().record(0.0)).rejects.toThrow(/positive/);
    await expect(hooks().record(Number.NaN)).rejects.toThrow(/positive/);
    await expect(hooks().record(-1)).rejects.toThrow(/positive/);
  });

  it('a 0.05 s run is accepted but never passes the gate', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    const p = hooks().record(0.05);
    pump();
    const r = await p;
    expect(r.verdict.eventGate).toBe(false);
  });

  it('rejects without a viewer', async () => {
    installPerfHooks();
    await expect(hooks().record(1)).rejects.toThrow(/no viewer/);
  });

  it('rejects a second concurrent record, and clears the flag after resolve', async () => {
    installPerfHooks();
    g.window.__sxViewer = drawingViewer();
    const first = hooks().record(1);
    await expect(hooks().record(1)).rejects.toThrow(/already running/);
    pump();
    await first;
    expect(pending.size).toBe(0);
    const again = hooks().record(1);
    pump();
    await expect(again).resolves.toBeDefined();
  });

  it('cancels rAF and clears the flag after a throw', async () => {
    installPerfHooks();
    const v = drawingViewer();
    g.window.__sxViewer = v;
    const p = hooks().record(1);
    // The viewer breaks mid-run: the final renderStats call throws.
    v.renderStats = () => {
      throw new Error('viewer gone');
    };
    pump();
    await expect(p).rejects.toThrow(/viewer gone/);
    expect(pending.size).toBe(0);
    g.window.__sxViewer = drawingViewer();
    const again = hooks().record(1);
    pump();
    await expect(again).resolves.toBeDefined();
  });

  it('reads __sxViewer lazily, after install', async () => {
    installPerfHooks();
    g.window.__sxViewer = fakeViewer({ tier: 'low' });
    g.window.__sxViewer = drawingViewer(); // swapped, as StrictMode re-creation does
    const p = hooks().record(1);
    pump();
    expect((await p).tierStart).toBe('medium');
  });
});
