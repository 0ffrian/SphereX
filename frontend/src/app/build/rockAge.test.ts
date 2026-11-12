// Issue #93 wave 1 (1.8): a Surface age drag rebuilds the rock's height map once, after the slider stops.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROCK_AGE_DEBOUNCE_MS, trailingDebounce } from './RockStage';

afterEach(() => vi.useRealTimers());

describe('trailingDebounce (Surface age)', () => {
  it('a drag of 20 steps 16 ms apart applies once, with the last value', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const d = trailingDebounce(apply, ROCK_AGE_DEBOUNCE_MS);
    for (let i = 0; i < 20; i++) {
      d.push(30 + i);
      vi.advanceTimersByTime(16);
    }
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ROCK_AGE_DEBOUNCE_MS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(49);
  });

  it('cancel drops a value still waiting (the stage unmounted)', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const d = trailingDebounce(apply, ROCK_AGE_DEBOUNCE_MS);
    d.push(10);
    d.cancel();
    vi.advanceTimersByTime(ROCK_AGE_DEBOUNCE_MS * 2);
    expect(apply).not.toHaveBeenCalled();
  });

  it('the wait is short enough to feel immediate', () => {
    expect(ROCK_AGE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(ROCK_AGE_DEBOUNCE_MS).toBeLessThanOrEqual(250);
  });
});
