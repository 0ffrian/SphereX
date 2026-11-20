import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Strike } from './types';
import {
  getWeather,
  onStrike,
  publishStrike,
  publishWeather,
  resetWeatherBus,
  subscribeWeather,
  useWeatherSnapshot,
  weatherBusStats,
  weatherRows,
  type WeatherSnapshot,
} from './weatherBus';

const strike = (t0: number): Strike => ({
  t0,
  d_m: 3000,
  bearing: 1,
  seed: 7,
  variant: 2,
  flash: true,
});
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

  it('onStrike receives each publishStrike once; publishWeather does not emit strikes', () => {
    const cb = vi.fn();
    const off = onStrike(cb);
    publishWeather(snap([strike(2.3)]));
    expect(cb).not.toHaveBeenCalled();
    publishStrike(strike(2.3));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].t0).toBe(2.3);
    off();
    publishStrike(strike(5));
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

  it('weather rows tag the rain, the artistic placement and the lightning rule', () => {
    expect(weatherRows(null)).toEqual([]);
    const s = snap();
    s.frame.rain = { density: 0.5, vt: 9.2, slantRad: 0.3, tint: [0.5, 0.5, 0.5], snow: false };
    const rows = weatherRows(s);
    expect(rows.map((r) => r.tag)).toEqual(['model_dependent', 'artistic', 'measured', 'artistic']);
    expect(rows[0]!.text).toContain('9.2 m/s');
    const no = snap();
    no.lightning = {
      allowed: false,
      tag: null,
      reason: 'No lightning has ever been detected on Titan, so there is no thunder here.',
    };
    expect(weatherRows(no).at(-1)!.text).toMatch(/Titan/);
  });

  it('useWeatherSnapshot subscribes once per mount, not on every render (m6)', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: (WeatherSnapshot | null)[] = [];
    function Probe() {
      seen.push(useWeatherSnapshot());
      return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => root.render(createElement(Probe)));
    expect(weatherBusStats()).toEqual({ listeners: 1, subscribes: 1 });
    for (let i = 0; i < 5; i++) await act(async () => publishWeather(snap([], i)));
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(seen.at(-1)!.tS).toBe(4);
    expect(weatherBusStats()).toEqual({ listeners: 1, subscribes: 1 }); // never resubscribed by a re-render
    await act(async () => root.unmount());
    expect(weatherBusStats().listeners).toBe(0);
  });
});
