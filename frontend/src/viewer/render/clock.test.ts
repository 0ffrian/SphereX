import { describe, expect, it } from 'vitest';
import { MAX_TICK_S, SimClock } from './clock';

function make() {
  let t = 0;
  const clock = new SimClock(() => t);
  return { clock, advance: (ms: number) => void (t += ms) };
}

describe('SimClock', () => {
  it('sim time is real time times the speed-up, per process', () => {
    const { clock, advance } = make();
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 1000 });
    clock.setProcess({ id: 'wind', label: 'Winds', speedup: 10 });
    clock.tick();
    advance(50);
    clock.tick();
    advance(50);
    clock.tick();
    expect(clock.simTime('spin')).toBeCloseTo(100, 6);
    expect(clock.simTime('wind')).toBeCloseTo(1, 6);
  });

  it('is not running without a process, or with any pause reason', () => {
    const { clock } = make();
    expect(clock.running).toBe(false);
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 1 });
    expect(clock.running).toBe(true);
    clock.pause('hidden');
    clock.pause('user');
    clock.resume('hidden');
    expect(clock.running).toBe(false);
    expect(clock.pauseReasons()).toEqual(['user']);
    clock.resume('user');
    expect(clock.running).toBe(true);
  });

  it('time does not pass while paused and a resume does not jump', () => {
    const { clock, advance } = make();
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 1 });
    clock.tick();
    advance(50);
    clock.tick();
    clock.pause('offscreen');
    advance(5000);
    expect(clock.tick()).toBe(0);
    clock.resume('offscreen');
    clock.tick();
    advance(50);
    clock.tick();
    expect(clock.simTime('spin')).toBeCloseTo(0.1, 6);
  });

  it('clamps one step so a stalled tab does not jump', () => {
    const { clock, advance } = make();
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 1 });
    clock.tick();
    advance(60_000);
    expect(clock.tick()).toBe(MAX_TICK_S);
  });

  it('setProcess keeps sim time; setAllSimTimes sets every process', () => {
    const { clock } = make();
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 1 });
    clock.setAllSimTimes(12);
    clock.setProcess({ id: 'spin', label: 'Spin', speedup: 2 });
    expect(clock.simTime('spin')).toBe(12);
    expect(clock.processes()).toEqual([{ id: 'spin', label: 'Spin', speedup: 2 }]);
    clock.removeProcess('spin');
    expect(clock.processes()).toEqual([]);
  });
});
