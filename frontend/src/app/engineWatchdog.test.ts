// Issue #93 regression fix: a world engine stage never hangs on "Forming…".
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_FORM_TIMEOUT_MS,
  ENGINE_READY_TIMEOUT_MS,
  FormClock,
  formProgress,
  readyOrTimeout,
} from './engineWatchdog';

afterEach(() => vi.useRealTimers());

describe('readyOrTimeout', () => {
  it('fails (the three.js path draws) when the shaders never become ready', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const onFail = vi.fn();
    readyOrTimeout(new Promise<void>(() => {}), ENGINE_READY_TIMEOUT_MS.fly, onReady, onFail);
    await vi.advanceTimersByTimeAsync(ENGINE_READY_TIMEOUT_MS.fly - 1);
    expect(onFail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onFail).toHaveBeenCalledOnce();
    expect(String(onFail.mock.calls[0]![0])).toContain(
      `not ready after ${ENGINE_READY_TIMEOUT_MS.fly / 1000} s`,
    );
    expect(onReady).not.toHaveBeenCalled();
  });

  it('starts once when ready in time, and a late timeout does nothing', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const onFail = vi.fn();
    readyOrTimeout(Promise.resolve(), 1000, onReady, onFail);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('a compile error fails at once; a readiness after the timeout does not start', async () => {
    vi.useFakeTimers();
    const onFail = vi.fn();
    readyOrTimeout(Promise.reject(new Error('link log')), 1000, vi.fn(), onFail);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFail).toHaveBeenCalledWith(new Error('link log'));
    let resolve!: () => void;
    const late = new Promise<void>((r) => (resolve = r));
    const onReady = vi.fn();
    const onFail2 = vi.fn();
    readyOrTimeout(late, 1000, onReady, onFail2);
    await vi.advanceTimersByTimeAsync(1001);
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(onFail2).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('cancelling (an unmount) calls neither', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn();
    const onFail = vi.fn();
    const cancel = readyOrTimeout(new Promise<void>(() => {}), 1000, onReady, onFail);
    cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe('FormClock', () => {
  it('counts only frames shown while forming, a long frame as at most 250 ms', () => {
    const c = new FormClock(1000);
    expect(c.add(60_000, false, true)).toBe(false); // hidden: not counted
    expect(c.add(60_000, true, false)).toBe(false); // formed: not counted
    expect(c.add(60_000, true, true)).toBe(false); // one long frame counts 250 ms
    for (let i = 0; i < 46; i++) c.add(16, true, true);
    expect(c.over).toBe(false);
    for (let i = 0; i < 2; i++) c.add(16, true, true);
    expect(c.over).toBe(true);
    expect(new FormClock().add(ENGINE_FORM_TIMEOUT_MS, true, true)).toBe(false);
  });
});

describe('formProgress', () => {
  it('is the share of the spin-up done, null before it starts', () => {
    expect(formProgress(null, 900)).toBeNull();
    expect(formProgress(900, null)).toBeNull();
    expect(formProgress(900, 900)).toBe(0);
    expect(formProgress(450, 900)).toBe(0.5);
    expect(formProgress(0, 900)).toBe(1);
    expect(formProgress(0, 0)).toBeNull();
  });
});
