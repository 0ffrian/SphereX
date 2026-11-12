// §8.5 (R13.6): the one WeatherVisualFrame the sound and the weather overlay (#117) share. The ambience loop publishes
// at 10 Hz whenever the fly view is entered at "+ Artistic", with or without sound; null means "draw nothing" (no fly
// view, paused, honesty dropped, waiting, or the kill switch). Strikes are announced through onStrike at least
// STRIKE_LOOKAHEAD_S − one tick (≥ 150 ms) before their t0, so the overlay can flash at t0 while the mixer plays the
// thunder at t0 + d/c. Strike.t0 and tS use one clock: performance.now() / 1000 (s). Coordinator ruling C8, #116.
import { useSyncExternalStore } from 'react';
import type { Tag } from '@/contract';
import type { Strike, WeatherVisualFrame } from './types';

export interface WeatherSnapshot {
  frame: WeatherVisualFrame;
  /** The direction the wind blows from, degrees clockwise from north (WindResult.dirDeg). */
  windDirDeg: number;
  /** Wind at 10 m, m/s. */
  U10: number;
  /** Listener heading, rad clockwise from north (fly.head). */
  head: number;
  /** §8.2 lightning rule for this world. */
  lightning: { allowed: boolean; tag: Tag | null; reason: string | null };
  /** Publish time, s, performance.now() / 1000. */
  tS: number;
}

let current: WeatherSnapshot | null = null;
const listeners = new Set<(s: WeatherSnapshot | null) => void>();
const strikeListeners = new Set<(s: Strike) => void>();

/** The ambience loop only. Each strike in `snap.frame.strikes` is new in this publish and goes to onStrike once. */
export function publishWeather(snap: WeatherSnapshot | null): void {
  if (snap === current) return;
  current = snap;
  for (const l of [...listeners]) l(snap);
  if (snap) for (const s of snap.frame.strikes) for (const l of [...strikeListeners]) l(s);
}

export function getWeather(): WeatherSnapshot | null {
  return current;
}

/** Called on every publish (10 Hz) and on null. Returns the unsubscribe function. */
export function subscribeWeather(cb: (s: WeatherSnapshot | null) => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Called once per new strike, ahead of its t0 (lookahead). Returns the unsubscribe function. */
export function onStrike(cb: (s: Strike) => void): () => void {
  strikeListeners.add(cb);
  return () => void strikeListeners.delete(cb);
}

/** React: the latest snapshot. Re-renders at 10 Hz; a canvas overlay should subscribeWeather from its own loop. */
export function useWeatherSnapshot(): WeatherSnapshot | null {
  return useSyncExternalStore(
    (cb) => subscribeWeather(() => cb()),
    getWeather,
    getWeather,
  );
}

/** Tests. */
export function resetWeatherBus(): void {
  current = null;
  listeners.clear();
  strikeListeners.clear();
}
