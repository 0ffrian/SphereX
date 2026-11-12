import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Strike } from './types';
import { getWeather, onStrike, publishWeather, resetWeatherBus, subscribeWeather, type WeatherSnapshot } from './weatherBus';

const strike = (t0: number): Strike => ({ t0, d_m: 3000, bearing: 1, seed: 7, variant: 2, flash: true });
const snap = (strikes: Strike[] = [], tS = 1): WeatherSnapshot => ({
  frame: { rain: null, strikes, aboveClouds: false, zc_km: 1.5 },
  windDirDeg: 270,
  U10: 8,
  head: 0.5,
  lightning: { allowed: true, tag: 'measured', reason: null },
  tS,
});

afterEach(() => resetWeatherBus());

describe('weatherBus (#117 contract, C8)', () => {
  it('publishes snapshots and null to subscribers; getWeather returns the latest', () => {
    const seen: (WeatherSnapshot | null)[] = [];
    const off = subscribeWeather((s) => seen.push(s));
    const a = snap();
    publishWeather(a);
    publishWeather(null);
    expect(seen).toEqual([a, null]);
    expect(getWeather()).toBeNull();
    off();
    publishWeather(snap());
    expect(seen).toHaveLength(2);
  });

  it('onStrike fires once per strike of each publish', () => {
    const cb = vi.fn();
    const off = onStrike(cb);
    publishWeather(snap([strike(2.3)]));
    publishWeather(snap([], 2.1));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].t0).toBe(2.3);
    off();
    publishWeather(snap([strike(5)]));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('the same snapshot object twice is one publish', () => {
    const cb = vi.fn();
    subscribeWeather(cb);
    const a = snap();
    publishWeather(a);
    publishWeather(a);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
