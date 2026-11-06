import { describe, expect, it } from 'vitest';
import type { HonestyState } from '@/viewer/honesty';
import { bindHonesty } from './haptics';

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
});
