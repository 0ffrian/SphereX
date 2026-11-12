// @vitest-environment node
// Issue #93 1.9 (PR #101 render-performance roadmap): one planet simulation feeding the globe and the fly view. Two
// WorldEngines on stub WebGL contexts follow one source; the lifecycle (either view disposed first, a view that stops
// drawing, a rebuild) and the worker source's failure path are checked. The clock is the parity virtual clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldEngine } from './WorldEngine';
import { stubCanvas, stubGL } from './glStub.testutil';
import { preset } from './coreHarness.testutil';
import { LocalSimSource, SIM_LIVE_MS, simSourceFor } from './simSource';

// Node, not jsdom: the climate steps run about 8 times faster. The draw reads these two browser globals.
const g0 = globalThis as unknown as { window?: unknown; devicePixelRatio?: number };
g0.window ??= globalThis;
g0.devicePixelRatio ??= 1;

const real = performance.now.bind(performance);
let t = 0;
afterEach(() => {
  performance.now = real;
});
function clock() {
  t = 0;
  performance.now = () => (t += 1);
}

function engine(role: 'globe' | 'fly') {
  const { gl, calls } = stubGL();
  const e = new WorldEngine(stubCanvas(gl), { role });
  e.pollReady();
  e.setPreset(preset('t1f'));
  e.playing = false;
  return { e, calls };
}

/** Frames until formed (or a cap), each view ticking once a frame as the stage does. */
function frames(views: WorldEngine[], n: number, until?: () => boolean) {
  for (let i = 0; i < n && !(until && until()); i++) for (const v of views) v.tick(1 / 60);
}

const coreOf = (e: WorldEngine) =>
  (e as unknown as { core: { W: Record<string, unknown>; EB: Record<string, unknown> } }).core;
const hostSteps = (src: LocalSimSource) => src.host.core.W.step as number;
/** A short spin-up (60 steps, not 900): these tests are about who steps and when, not about the climate. */
const short = (src: LocalSimSource) => {
  src.host.core.W.spinup = 60;
};

describe('#93 1.9 one simulation for the globe and the fly view (main thread)', () => {
  it('a fly view that opens on a formed globe is formed at its first frame, and runs no climate steps', () => {
    clock();
    const g = engine('globe').e;
    const src = new LocalSimSource(preset('t1f'), {});
    g.followSim(src);
    frames([g], 2000, () => g.spinup === 0);
    expect(g.spinup).toBe(0);
    expect(src.host.spinup).toBe(0);

    const { e: f } = engine('fly');
    const ebStep = vi.fn();
    // The fly engine's own climate step must never run: replace its core's tick with a spy.
    coreOf(f).W.gl = Object.assign(coreOf(f).W.gl as object, { tick: ebStep });
    expect(f.spinup).toBe(900);
    f.followSim(src);
    frames([f], 1);
    expect(f.spinup).toBe(0);
    expect(ebStep).not.toHaveBeenCalled();
    // It reads the simulation's grids (haptics, readouts), not its own.
    expect(f.cpuFields().climate!.T).toBe(src.host.core.EB.T);
    expect(f.readouts().stats).toBe(g.readouts().stats);
    g.dispose();
    f.dispose();
  }, 60_000);

  it('either view can be disposed first; the simulation goes on with the other and ends with the last', () => {
    for (const first of ['globe', 'fly'] as const) {
      clock();
      const g = engine('globe').e;
      const f = engine('fly').e;
      const src = new LocalSimSource(preset('t1f'), {});
      short(src);
      g.followSim(src);
      f.followSim(src);
      frames([g, f], 2000, () => g.spinup === 0);
      expect(f.spinup).toBe(0);
      g.playing = true;
      f.playing = true;
      const [gone, kept] = first === 'globe' ? [g, f] : [f, g];
      gone.dispose();
      expect(src.viewCount).toBe(1);
      const s0 = hostSteps(src);
      frames([kept], 5);
      expect(hostSteps(src)).toBeGreaterThan(s0);
      kept.dispose();
      expect(src.viewCount).toBe(0);
      // A released source takes no new view.
      expect(() => src.attach(kept)).toThrow();
    }
  }, 60_000);

  it('the simulation steps once a frame for two views, and a view that stops drawing catches up later', () => {
    clock();
    const g = engine('globe').e;
    const f = engine('fly').e;
    const src = new LocalSimSource(preset('t1f'), {});
    short(src);
    g.followSim(src);
    f.followSim(src);
    frames([g, f], 2000, () => g.spinup === 0);
    g.playing = f.playing = true;
    const s0 = hostSteps(src);
    frames([g, f], 4);
    // One cloud step per frame (one tick), not two.
    expect(hostSteps(src) - s0).toBe(4);
    expect(coreOf(f).W.step).toBe(hostSteps(src));
    // The fly view stops drawing (closed close-up): the globe drives on alone.
    t += SIM_LIVE_MS * 2;
    frames([g], 6);
    expect(coreOf(f).W.step).toBeLessThan(hostSteps(src));
    const resync = vi.spyOn(f, 'simResync');
    frames([f], 1);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(coreOf(f).W.step).toBe(hostSteps(src));
    g.dispose();
    f.dispose();
  }, 60_000);

  it('a rebuild (a fluid or crust change) restarts the forming on both views from the one simulation', () => {
    clock();
    const g = engine('globe').e;
    const f = engine('fly').e;
    const src = new LocalSimSource(preset('t1f'), {});
    short(src);
    g.followSim(src);
    f.followSim(src);
    frames([g, f], 2000, () => g.spinup === 0);
    const T = src.host.core.EB.T as Float32Array;
    const before = T.slice();
    // What worldStore.apply does: the views first, then the source once.
    for (const v of [g, f]) v.setOverrides({ tect: 'lid' });
    src.setOverrides({ tect: 'lid' });
    expect(src.key).toBe(g.simKey());
    frames([g, f], 1);
    expect(g.spinup).toBeGreaterThan(0);
    expect(f.spinup).toBe(g.spinup);
    // The views' local rebuild ran on their own arrays, never on the simulation's.
    expect(T).toBe(src.host.core.EB.T);
    expect(Buffer.from(T.buffer).equals(Buffer.from(before.buffer))).toBe(false);
    g.dispose();
    f.dispose();
  }, 60_000);

  it('a view of another world does not join the source', () => {
    clock();
    const g = engine('globe').e;
    const src = simSourceFor('shared', preset('t1f'), {}, g, null)!;
    g.followSim(src);
    const { gl } = stubGL();
    const other = new WorldEngine(stubCanvas(gl), { role: 'fly' });
    other.pollReady();
    other.setPreset(preset('earth'));
    const src2 = simSourceFor('shared', preset('earth'), {}, other, src);
    expect(src2).not.toBe(src);
    expect(() => other.followSim(src)).toThrow(/another world/);
    expect(simSourceFor('own', preset('t1f'), {}, g, src)).toBeNull();
    g.dispose();
    other.dispose();
    src2!.detach(other);
  }, 60_000);
});
