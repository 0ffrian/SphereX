import { describe, expect, it } from 'vitest';
import type { HonestyState } from '@/viewer/honesty';
import { bindHonesty } from './engine';
import { ListenSweep } from './listenSweep';

describe('bindHonesty (M5 wiring of the D-21 toggle)', () => {
  it('applies the toggle now and on every change, until unsubscribed', () => {
    let state: HonestyState = 'measured';
    const listeners = new Set<() => void>();
    const seen: HonestyState[] = [];
    const engine = { setHonesty: (s: HonestyState) => void seen.push(s) };
    const unbind = bindHonesty(
      engine,
      () => state,
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    );
    expect(seen).toEqual(['measured']);
    state = 'artistic';
    for (const l of listeners) l();
    expect(seen).toEqual(['measured', 'artistic']);
    unbind();
    expect(listeners.size).toBe(0);
  });

  it('drives a Listen sweep too', () => {
    let state: HonestyState = 'derived';
    const sweep = new ListenSweep({ context: () => null });
    let fire = () => {};
    bindHonesty(
      sweep,
      () => state,
      (l) => {
        fire = l;
        return () => {};
      },
    );
    expect(sweep.honestyState).toBe('derived');
    state = 'measured';
    fire();
    expect(sweep.honestyState).toBe('measured');
  });
});
