// Sky markers for the quick-pick targets: the same names as the search's "Try" chips, resolved
// through `GET /v1/resolve` (D-19) so their positions are the backend's, never hard-coded here.
// A name that does not resolve gets no marker and is listed as not placed.
//
// The lookups wait until the page has settled (MARKER_RESOLVE_DELAY_MS, then an idle moment) and
// until no search is in flight, so they never hold up the user's first search.
import { useEffect, useState } from 'react';
import { TEST_TARGETS } from '@/app/search/testTargets';
import { getSkyApi, useAppStore } from '@/state/store';

export interface TargetMarker {
  /** The backend's object id (from /v1/resolve), so cached markers can skip this target. */
  id: string;
  name: string;
  ra: number;
  dec: number;
}

export interface TargetMarkers {
  markers: TargetMarker[];
  /** Names that could not be resolved. */
  unplaced: string[];
  done: boolean;
}

/** Delay before the marker lookups start. UI pacing, not a physical value. */
export const MARKER_RESOLVE_DELAY_MS = 2000;

export function whenIdle(cb: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(cb, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 0);
  return () => window.clearTimeout(id);
}

export function useTargetMarkers(enabled: boolean): TargetMarkers {
  const [state, setState] = useState<TargetMarkers>({ markers: [], unplaced: [], done: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelIdle: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;

    const run = async () => {
      const api = getSkyApi();
      const results = await Promise.all(
        TEST_TARGETS.map(async (name) => {
          try {
            const r = await api.resolve(name, controller.signal);
            if (r.fixture) useAppStore.getState().skyMarkFixtureSeen();
            return { id: r.data.id, name, ra: r.data.ra, dec: r.data.dec };
          } catch {
            return name;
          }
        }),
      );
      if (controller.signal.aborted) return;
      setState({
        markers: results.filter((r): r is TargetMarker => typeof r !== 'string'),
        unplaced: results.filter((r): r is string => typeof r === 'string'),
        done: true,
      });
    };

    const busy = () => {
      const s = useAppStore.getState().sky.status;
      return s === 'resolving' || s === 'loading_frames';
    };
    const startWhenFree = () => {
      if (!busy()) {
        cancelIdle = whenIdle(() => void run());
        return;
      }
      unsubscribe = useAppStore.subscribe((s) => {
        if (s.sky.status === 'resolving' || s.sky.status === 'loading_frames') return;
        unsubscribe?.();
        unsubscribe = null;
        cancelIdle = whenIdle(() => void run());
      });
    };
    const timer = window.setTimeout(startWhenFree, MARKER_RESOLVE_DELAY_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      cancelIdle?.();
      unsubscribe?.();
    };
  }, [enabled]);

  return state;
}
