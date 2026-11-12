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

/**
 * The ambience loop only: 10 Hz whenever the fly view is live at "+ Artistic", with sound off, muted or still locked
 * (the visuals never wait for audio). `frame.strikes` lists this tick's new strikes; they are also sent through
 * publishStrike.
 */
export function publishWeather(snap: WeatherSnapshot | null): void {
  if (snap === current) return;
  current = snap;
  for (const l of [...listeners]) l(snap);
}

/** The ambience loop only: one new strike, announced at least 150 ms before its t0 (scheduler lookahead). */
export function publishStrike(strike: Strike): void {
  for (const l of [...strikeListeners]) l(strike);
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

/** One weather row for "What is drawn" (#117) and "What you hear" (#116), with its §8.5 tag. */
export interface WeatherRow {
  tag: Tag;
  text: string;
}

/**
 * §8.5 the weather rows: what is shown now and the tag of each part. Placement and colour are artistic; whether it
 * rains, the rate, the fall speed and the slant are the model's; lightning carries the §8.2 rule's tag (R11: only the
 * fact that lightning is observed on such a world is measured; each strike's time and place is artistic).
 */
export function weatherRows(s: WeatherSnapshot | null): WeatherRow[] {
  if (!s) return [];
  const rows: WeatherRow[] = [];
  const r = s.frame.rain;
  if (r && !r.snow) {
    rows.push({
      tag: 'model_dependent',
      text: `Rain: whether it falls, how hard, its fall speed (${r.vt.toFixed(1)} m/s) and its slant in the wind`,
    });
    rows.push({ tag: 'artistic', text: 'Where each raindrop is drawn, and its colour (the liquid’s colour mixed towards grey)' });
  } else if (r) {
    rows.push({ tag: 'model_dependent', text: 'Snow: whether it falls and how hard' });
    rows.push({ tag: 'artistic', text: 'Where each snowflake is drawn, and how it drifts' });
  }
  if (s.lightning.allowed) {
    if (s.lightning.tag) rows.push({ tag: s.lightning.tag, text: 'Lightning happens on this kind of world' });
    rows.push({ tag: 'artistic', text: 'When and where each strike falls, and the colour of the bolt (not from data)' });
  } else if (s.lightning.reason) {
    rows.push({ tag: 'model_dependent', text: s.lightning.reason });
  }
  return rows;
}

/** Tests. */
export function resetWeatherBus(): void {
  current = null;
  listeners.clear();
  strikeListeners.clear();
}
