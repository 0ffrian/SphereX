// Issue #93 F4 (PR #101 render-performance finding 4): the climate step loop in WorldGL.tick stops before it overruns
// its budget. Driven headless with a fake clock: each performance.now() call advances the clock by `d` ms, so the time
// between two checks of the loop (one ebStep) is `d`.
import { afterEach, describe, expect, it } from 'vitest';
import { headlessCore, preset } from './coreHarness.testutil';

const real = performance.now.bind(performance);
afterEach(() => {
  performance.now = real;
});

/** Steps one tick takes with a fake clock of `d` ms a call, and the fake time the last step ended at. */
function stepsOfOneTick(d: number, playing: boolean) {
  const core = headlessCore();
  core.setPreset(preset('t1f'));
  const W = core.W;
  if (playing) W.spinup = 0;
  const before = W.spinup;
  let t = 0,
    calls = 0;
  performance.now = () => {
    calls++;
    return (t += d);
  };
  const step0 = W.step;
  const season0 = W.season;
  W.gl.tick(W.m, playing, 1 / 60);
  performance.now = real;
  // During the spin-up W.spinup counts the steps; while playing each step advances the season by dt / 500.
  const k = playing
    ? Math.round(((((W.season - season0) % 1) + 1) % 1) / (0.7 / 500))
    : before - W.spinup;
  // t0 is call 1 and the check before step i is call i + 2, so step k - 1 ends at the check after it: (k + 1) d.
  return { k, end: (k + 1) * d, calls, cloud: W.step - step0 };
}

describe('#93 F4 climate loop budget', () => {
  it('the parity virtual clock (1 ms a call) takes the prototype rule: 13 spin-up steps a tick', () => {
    expect(stepsOfOneTick(1, false).k).toBe(13);
  });

  it('a spin-up tick never runs a step that ends past the 14 ms budget (one step always runs)', () => {
    for (const d of [0.5, 1.7, 3.3, 4.6, 5.5, 6, 7.5, 9, 15]) {
      const { k, end } = stepsOfOneTick(d, false);
      expect(k, `d = ${d}`).toBeGreaterThanOrEqual(1);
      if (k > 1) expect(end, `d = ${d}`).toBeLessThanOrEqual(14);
      // The old rule (check elapsed < budget before a step) took one more step whenever it fitted under 14.
      expect(k, `d = ${d}`).toBe(Math.max(1, Math.min(40, Math.floor(14 / d) - 1)));
    }
  });

  it('a playing tick keeps its 7 ms and 4-step limits', () => {
    for (const d of [0.5, 1, 2, 3.5, 5]) {
      const { k, end } = stepsOfOneTick(d, true);
      expect(k, `d = ${d}`).toBe(Math.max(1, Math.min(4, Math.floor(7 / d) - 1)));
      if (k > 1) expect(end).toBeLessThanOrEqual(7);
    }
  });

  // The prototype's last spin-up tick keeps stepping after W.spinup reaches 0 (st is read once a tick), so the step
  // total depends on how the 900 steps were chunked, as it always did (Q-306). These step costs split 900 evenly
  // (10, then 1 step a tick), so both runs take exactly 900 steps and must end in the same bytes.
  it('the spin-up ends in the same state at any step cost, only over more ticks', () => {
    const run = (d: number) => {
      const core = headlessCore();
      core.setPreset(preset('t1f'));
      const W = core.W;
      let t = 0,
        ticks = 0;
      performance.now = () => (t += d);
      while (W.spinup > 0 && ticks < 5000) {
        W.gl.tick(W.m, false, 1 / 60);
        ticks++;
      }
      performance.now = real;
      const EB = core.EB;
      return {
        ticks,
        T: EB.T.slice(),
        out: EB.out.slice(),
        out2: EB.out2.slice(),
        h: EB.h.slice(),
      };
    };
    const a = run(1.25);
    const b = run(5.5);
    expect(a.ticks).toBe(90);
    expect(b.ticks).toBe(900);
    expect(b.ticks).toBeGreaterThan(a.ticks);
    for (const k of ['T', 'out', 'out2', 'h'] as const)
      expect(Buffer.from(b[k].buffer).equals(Buffer.from(a[k].buffer)), k).toBe(true);
  }, 60_000);
});
