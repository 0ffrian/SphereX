// §8.5 the weather bus: the one place the sound pipeline (#116, `useAmbience`) hands the weather it computed at 10 Hz to
// the picture (#117, the overlay). ASSUMPTION (#117): this is a SHIM with the API the coordinator gave for #116's
// `weatherBus.ts` (publishWeather, getWeather, subscribeWeather, onStrike, useWeatherSnapshot). When #116 lands, its
// file replaces this one. `publishStrike` (the producer side of onStrike) and `resetWeatherBus` are this shim's names.
// Strikes reach the overlay only through onStrike, once each, at least STRIKE_LOOKAHEAD before their t0 (H5).
import { useSyncExternalStore } from 'react';
import type { Tag } from '@/contract';
import type { Strike, WeatherVisualFrame } from './types';

/** The coordinator's snapshot (H6). Clock: `tS` and `Strike.t0` are performance.now() / 1000. */
export interface WeatherSnapshot {
  frame: WeatherVisualFrame | null;
  /** The direction the wind blows FROM, degrees clockwise from north (Appendix D), or null. */
  windDirDeg: number | null;
  /** m/s at 10 m. */
  U10: number;
  /** fly.head when the snapshot was made (radians, clockwise from north). */
  head: number;
  lightning: { allowed: boolean; tag: Tag | null; reason: string | null };
  tS: number;
}

type Listener = () => void;
type StrikeListener = (s: Strike) => void;

let current: WeatherSnapshot | null = null;
const listeners = new Set<Listener>();
const strikeListeners = new Set<StrikeListener>();

/** Producer side (only `useAmbience`): the latest snapshot, or null when the fly view has no weather. */
export function publishWeather(snap: WeatherSnapshot | null): void {
  current = snap;
  for (const l of [...listeners]) l();
}

export function getWeather(): WeatherSnapshot | null {
  return current;
}

export function subscribeWeather(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Producer side: one call per strike, ahead of its t0. */
export function publishStrike(s: Strike): void {
  for (const l of [...strikeListeners]) l(s);
}

/** Fires once per strike. */
export function onStrike(cb: StrikeListener): () => void {
  strikeListeners.add(cb);
  return () => {
    strikeListeners.delete(cb);
  };
}

export function useWeatherSnapshot(): WeatherSnapshot | null {
  return useSyncExternalStore(subscribeWeather, getWeather, getWeather);
}

/** Tests only. */
export function resetWeatherBus(): void {
  current = null;
  listeners.clear();
  strikeListeners.clear();
}
