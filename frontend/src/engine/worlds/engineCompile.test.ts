// Issue #93 phase 1: background shader compile, per-role programs, the loop-bound change, the shared terrain, the
// fly view's resolution-independent detail, the hidden-globe skip and the gas-solver cap. A stub WebGL 2 context
// records every call; it reports the uniforms each fragment shader declares, so the engine's own code runs unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore } from './core.js';
import { ADV_FS, FLY_FS, GAS_FS, WORLD_FS } from './shaders.js';
import { clearTerrainCache } from './terrainCache.js';
import { stubCanvas, stubGL } from './glStub.testutil';
import { DISPOSE_MAX_WAIT_MS, DISPOSE_POLL_MS, WorldEngine, WORLD_PRESETS } from './WorldEngine';

const preset = (id: string) => WORLD_PRESETS.find((p) => p.id === id)!;

afterEach(() => {
  vi.useRealTimers();
  clearTerrainCache();
});

describe('shader loop bounds (issue #93 1.1)', () => {
  const constLoop = /for\(int [ijk]=-?\d+;[ijk]<=?\d+;/;
  it('every loop in WORLD_FS and FLY_FS has a uniform bound, declared once', () => {
    for (const [fs, n] of [
      [FLY_FS, 13], // 11, plus the two cube-face loops of #93 2.5
      [WORLD_FS, 3],
    ] as const) {
      expect(fs.match(/\+uZ0;/g)?.length).toBe(n);
      expect(fs.match(/for\(/g)?.length).toBe(n);
      expect(fs.match(/uniform int uZ0;/g)?.length).toBe(1);
      expect(fs).not.toMatch(constLoop);
      // the declaration sits before the first use
      expect(fs.indexOf('uniform int uZ0;')).toBeLessThan(fs.indexOf('+uZ0;'));
    }
  });
  it('the early-exit loops keep their break', () => {
    expect(FLY_FS).toContain('for(int i=0;i<8+uZ0;i++){if(i>=n)break;');
    expect(FLY_FS).toContain('for(int i=0;i<360+uZ0;i++){p=ro+rd*t;');
    expect(FLY_FS).toContain('if(g<1e-6+t*6e-5){hit=t;break;}if(t>t1)break;');
    expect(FLY_FS).toContain('for(int k=0;k<36+uZ0;k++){s2+=uLb*st;');
  });
  it('the small programs keep their source', () => {
    expect(ADV_FS).not.toContain('uZ0');
    expect(GAS_FS).not.toContain('uZ0');
  });
  it('the fly view sizes its pixel footprint at full resolution (1.4)', () => {
    expect(FLY_FS.match(/uFov\*uScale\/uR\.y/g)?.length).toBe(3);
    expect(FLY_FS).not.toMatch(/uFov\/uR\.y/);
    expect(FLY_FS).toMatch(/uniform float [^;]*\buScale\b/);
  });
});

describe('background compile (issue #93 1.2, 1.3)', () => {
  it('submits without reading a status and links only once the driver reports completion', () => {
    const { gl, calls } = stubGL({ lateBy: 3 });
    const core = createCore(stubCanvas(gl), { role: 'fly' });
    const statusReads = () =>
      calls.filter((c) => c[0] === 'getProgramParameter' && c[1] !== 'COMPLETION_STATUS_KHR');
    expect(statusReads()).toHaveLength(0);
    expect(core.W.gl.poll()).toBe(false);
    expect(core.W.gl.poll()).toBe(false);
    expect(statusReads()).toHaveLength(0);
    // the third poll of the first program finishes it; the others are polled in turn
    let n = 0;
    while (!core.W.gl.poll() && n < 20) n++;
    const firstLink = calls.findIndex(
      (c) => c[0] === 'getProgramParameter' && c[1] === 'LINK_STATUS',
    );
    let lastCompletion = -1;
    calls.forEach((c, i) => {
      if (c[0] === 'getProgramParameter' && c[1] === 'COMPLETION_STATUS_KHR') lastCompletion = i;
    });
    expect(firstLink).toBeGreaterThan(lastCompletion);
    expect(statusReads().filter((c) => c[1] === 'LINK_STATUS')).toHaveLength(4);
  });

  it('WorldEngine.whenReady resolves after a late completion, without blocking', async () => {
    vi.useFakeTimers();
    const { gl, calls } = stubGL({ lateBy: 5 });
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    let done = false;
    void e.whenReady().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(16);
    expect(done).toBe(false);
    expect(e.pollReady()).toBe(false);
    expect(calls.some((c) => c[1] === 'ACTIVE_UNIFORMS')).toBe(false);
    await vi.advanceTimersByTimeAsync(16 * 40);
    expect(done).toBe(true);
    expect(e.pollReady()).toBe(true);
    expect(calls.some((c) => c[1] === 'ACTIVE_UNIFORMS')).toBe(true);
  });

  it('a link failure rejects with the log (the stage then takes the old path)', async () => {
    vi.useFakeTimers();
    const { gl } = stubGL({ lateBy: 1, failOn: 'uniform int uZ0;' });
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    const p = e.whenReady();
    const caught = p.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(100);
    await expect(caught).resolves.toContain('stub link error');
  });

  it('dispose never blocks on a compile still running: the context goes once the driver is done', async () => {
    vi.useFakeTimers();
    const { gl, calls } = stubGL({ lateBy: 30 });
    const e = new WorldEngine(stubCanvas(gl), { role: 'fly' });
    const rejected = e.whenReady().catch(() => 'rejected');
    e.dispose();
    // loseContext() waits for the driver's compile (35 s on a cold ANGLE D3D11 cache): not called while it runs
    expect(calls.some((c) => c[0] === 'loseContext')).toBe(false);
    await vi.advanceTimersByTimeAsync(DISPOSE_POLL_MS * 3);
    expect(calls.some((c) => c[0] === 'loseContext')).toBe(false);
    await vi.advanceTimersByTimeAsync(DISPOSE_POLL_MS * 200);
    expect(calls.filter((c) => c[0] === 'loseContext')).toHaveLength(1);
    await expect(rejected).resolves.toBe('rejected');
    e.dispose();
    expect(calls.filter((c) => c[0] === 'loseContext')).toHaveLength(1);
  });

  it('dispose gives up after DISPOSE_MAX_WAIT_MS without loseContext (B1: it would block on the compile)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gl, calls } = stubGL({ lateBy: 1e9 });
    const e = new WorldEngine(stubCanvas(gl), { role: 'fly' });
    void e.whenReady().catch(() => {});
    e.dispose();
    await vi.advanceTimersByTimeAsync(DISPOSE_MAX_WAIT_MS + DISPOSE_POLL_MS * 5);
    expect(calls.some((c) => c[0] === 'loseContext')).toBe(false);
    // polling has stopped: no further completion reads after the deadline
    const reads = calls.filter((c) => c[1] === 'COMPLETION_STATUS_KHR').length;
    await vi.advanceTimersByTimeAsync(DISPOSE_POLL_MS * 50);
    expect(calls.filter((c) => c[1] === 'COMPLETION_STATUS_KHR')).toHaveLength(reads);
    expect(calls.some((c) => c[0] === 'loseContext')).toBe(false);
    vi.restoreAllMocks();
  });

  it('dispose of a ready engine releases the context at once', async () => {
    const { gl, calls } = stubGL();
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    await e.whenReady();
    e.dispose();
    expect(calls.filter((c) => c[0] === 'loseContext')).toHaveLength(1);
  });

  it('without KHR_parallel_shader_compile it links at the first poll', () => {
    const { gl } = stubGL({ noExt: true });
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    expect(e.pollReady()).toBe(true);
  });

  it('the globe creates 3 programs (no fly shader); the fly engine and the prototype page 4', () => {
    for (const [role, n] of [
      ['globe', 3],
      ['fly', 4],
      ['both', 4],
    ] as const) {
      const { gl, progs } = stubGL();
      const e = new WorldEngine(stubCanvas(gl), { role });
      expect(progs).toHaveLength(n);
      expect(e.programCount()).toBe(n);
      expect(progs.some((p) => p.fs === FLY_FS)).toBe(role !== 'globe');
    }
  });

  it('a globe-role engine ignores setFly(true) and never creates the fly program (B10)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { gl, progs } = stubGL();
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    e.setFly(true);
    expect(e.flying).toBe(false);
    expect(progs.some((p) => p.fs === FLY_FS)).toBe(false);
    warn.mockRestore();
  });

  it('a step before readiness links first (never reads a uniform of an unlinked program)', () => {
    const { gl, progs, calls } = stubGL({ lateBy: 1000 });
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    e.setPreset(preset('jup'));
    expect(progs.every((p) => p.linked)).toBe(true);
    const firstLink = calls.findIndex((c) => c[1] === 'LINK_STATUS');
    const firstUniform = calls.findIndex((c) => c[1] === 'ACTIVE_UNIFORMS');
    expect(firstLink).toBeGreaterThanOrEqual(0);
    expect(firstUniform).toBeGreaterThan(firstLink);
  });
});

describe('drawing (issue #93 1.4, 1.6, 1.7)', () => {
  it('the fly engine draws only the fly view; W.view is still set', async () => {
    for (const [role, draws] of [
      ['fly', 1],
      ['both', 2],
    ] as const) {
      const { gl, calls } = stubGL();
      const e = new WorldEngine(stubCanvas(gl, 1000, 400), { role });
      await e.whenReady();
      e.setPreset(preset('jup'));
      e.draw();
      e.setFly(true);
      const before = calls.filter((c) => c[0] === 'drawArrays').length;
      e.draw();
      expect(calls.filter((c) => c[0] === 'drawArrays').length - before).toBe(draws);
      const v = e.view()!;
      expect(v.gx).toBe(600);
      expect(v.gw).toBe(400);
      // uScale (the scaler's factor) is passed to FLY_FS
      expect(calls.some((c) => c[0] === 'uniform1f' && c[1] === 'uScale' && c[2] === 1)).toBe(true);
    }
  });

  it('caps the pixel ratio at 1.0 for the fly engine and 1.25 for the globe', async () => {
    const g = globalThis as unknown as { devicePixelRatio: number };
    const dpr = g.devicePixelRatio;
    g.devicePixelRatio = 2;
    try {
      for (const [role, k] of [
        ['fly', 1],
        ['globe', 1.25],
        ['both', 1.5],
      ] as const) {
        const { gl } = stubGL();
        const c = stubCanvas(gl, 400, 200);
        const e = new WorldEngine(c, { role });
        await e.whenReady();
        e.setPreset(preset('jup'));
        e.draw();
        expect(c.width).toBe(Math.round(400 * k));
      }
    } finally {
      g.devicePixelRatio = dpr;
    }
  });

  it('nothing is drawn while a rocky world spins up under the Forming overlay', async () => {
    const { gl } = stubGL();
    const e = new WorldEngine(stubCanvas(gl), { role: 'globe' });
    await e.whenReady();
    e.setPreset(preset('t1e'));
    expect(e.spinup).toBeGreaterThan(0);
    e.tick(0.016);
    expect(e.spinup).toBeGreaterThan(0);
    // a screen draw sets W.view (the prototype drew every spin-up frame of a rocky world)
    expect(e.view()).toBeNull();
    // the last spin-up step: the settled world is drawn in the same tick
    (e as unknown as { core: { W: { spinup: number } } }).core.W.spinup = 1;
    e.tick(0.016);
    expect(e.spinup).toBe(0);
    expect(e.view()).not.toBeNull();
  }, 30000);
});

describe('gas solver cap (issue #93 1.8)', () => {
  it('runs at most 3 steps a frame and drops the backlog', () => {
    const { gl } = stubGL();
    const core = createCore(stubCanvas(gl), { role: 'globe' });
    core.setPreset(preset('hd'));
    core.W.spinup = 0;
    core.W.timeSec = 1e9;
    const GS = core.getGS();
    let n = 0;
    const step = GS.step.bind(GS);
    GS.step = () => {
      n++;
      step();
    };
    core.W.gl.tick(core.W.m, true, 0.06);
    expect(n).toBe(3);
    expect(core.W.simAcc).toBeLessThan(GS.dt);
  });
});

describe('shared terrain (issue #93 1.5)', () => {
  it(
    'a second engine on the same world reuses the first one terrain and routing',
    { timeout: 30000 },
    () => {
      const a = createCore(stubCanvas(stubGL().gl), { role: 'globe' });
      const b = createCore(stubCanvas(stubGL().gl), { role: 'fly' });
      a.setPreset(preset('t1e'));
      const terr = a.W.terr;
      const data = terr.data.slice();
      const t0 = performance.now();
      b.setPreset(preset('t1e'));
      const second = performance.now() - t0;
      expect(b.W.terr).toBe(terr);
      expect(b.W.route).toBe(a.W.route);
      // neither engine wrote to the shared arrays while loading and stepping
      a.W.gl.tick(a.W.m, false, 1 / 60);
      b.W.gl.tick(b.W.m, false, 1 / 60);
      expect(terr.data).toEqual(data);
      expect(second).toBeGreaterThanOrEqual(0);
    },
  );
});
