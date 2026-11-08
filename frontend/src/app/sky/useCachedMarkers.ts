// Loads `GET /v1/sky/cached` (positions whose frames load at once) for the sky markers. Like the
// target markers it waits until the page has settled and no search is in flight, so it never
// holds up the user's first search. It loads again when a frame list has just become complete
// (a progressive load finished, or a new spot loaded in one go), so that spot gets its marker.
// A failed or refused list shows no cached markers; nothing else depends on it.
import { useEffect, useRef, useState } from 'react';
import type { SkyCachedObject } from '@/app/api/types';
import { getSkyApi, useAppStore, type SkyState } from '@/state/store';
import { MARKER_RESOLVE_DELAY_MS, whenIdle } from './useTargetMarkers';

/** Wait after a frame list completes before asking again (the backend stores it first). */
export const CACHED_REFRESH_DELAY_MS = 500;

/** True when this state change finished a frame list that the cached list does not hold yet. */
export function framesJustCompleted(
  s: SkyState,
  prev: SkyState,
  known: ReadonlySet<string>,
): boolean {
  const complete = (x: SkyState) => x.status === 'ready' && x.progress === null;
  if (!complete(s) || (complete(prev) && prev.resolved === s.resolved)) return false;
  if (!s.resolved || known.has(s.resolved.id)) return false;
  return (s.frames?.frames.length ?? 0) > 0;
}

export function useCachedMarkers(enabled: boolean): SkyCachedObject[] {
  const [objects, setObjects] = useState<SkyCachedObject[]>([]);
  const known = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    let cancelIdle: (() => void) | null = null;
    let refreshTimer: number | null = null;

    const load = async () => {
      controller?.abort();
      const c = new AbortController();
      controller = c;
      try {
        const res = await getSkyApi().skyCached(c.signal);
        if (c.signal.aborted) return;
        if (res.fixture) useAppStore.getState().skyMarkFixtureSeen();
        known.current = new Set(res.data.objects.map((o) => o.id));
        setObjects(res.data.objects);
      } catch {
        // No list (an older backend, offline, a bad reply): no cached markers.
      }
    };

    const busy = () => {
      const st = useAppStore.getState().sky.status;
      return st === 'resolving' || st === 'loading_frames';
    };
    const start = () => {
      cancelIdle?.();
      cancelIdle = whenIdle(() => void load());
    };
    // The first load waits for a search in flight to settle.
    let waitingForSearch = false;
    const startTimer = window.setTimeout(() => {
      if (busy()) waitingForSearch = true;
      else start();
    }, MARKER_RESOLVE_DELAY_MS);

    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (waitingForSearch && !busy()) {
        waitingForSearch = false;
        start();
        return;
      }
      if (!framesJustCompleted(s.sky, prev.sky, known.current)) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        start();
      }, CACHED_REFRESH_DELAY_MS);
    });

    return () => {
      controller?.abort();
      window.clearTimeout(startTimer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      cancelIdle?.();
      unsubscribe();
    };
  }, [enabled]);

  return objects;
}
