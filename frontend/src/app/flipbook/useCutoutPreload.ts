// Preloads the cutout PNGs of a frame list (UML 08: "loop each frame: GET cutout"). A cutout that
// fails is marked 'failed' and shown as "cutout unavailable"; nothing is drawn in its place.
//
// The state is kept per cutout URL, so a frame list that grows (progressive loading,
// progressive.ts) keeps every cutout already loaded and only queues the new ones. A different
// object's list shares no URL, so its old loads are cancelled and its entries dropped.
import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@/app/api/types';

export type CutoutStatus = 'pending' | 'loaded' | 'failed';

/** At most this many cutout requests at once, so a long frame list does not flood the server. */
export const PRELOAD_CONCURRENCY = 6;

export interface CutoutPreload {
  status: readonly CutoutStatus[];
  /** Natural size of the first cutout that loaded, or null while none has. */
  size: { w: number; h: number } | null;
}

type Done = Exclude<CutoutStatus, 'pending'>;

interface Settled {
  byUrl: ReadonlyMap<string, Done>;
  size: { w: number; h: number } | null;
}

const EMPTY: Settled = { byUrl: new Map(), size: null };

function cancel(img: HTMLImageElement): void {
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
}

export function useCutoutPreload(frames: readonly Frame[]): CutoutPreload {
  const [settled, setSettled] = useState<Settled>(EMPTY);
  // The same value as `settled`, for the load callbacks (state updates there are plain values).
  const settledRef = useRef<Settled>(EMPTY);
  const wantedRef = useRef<ReadonlySet<string>>(new Set());
  const active = useRef(new Map<string, HTMLImageElement>());
  const queue = useRef<string[]>([]);

  useEffect(() => {
    const wanted = new Set(frames.map((f) => f.cutout_url));
    wantedRef.current = wanted;
    for (const [url, img] of active.current) {
      if (!wanted.has(url)) {
        cancel(img);
        active.current.delete(url);
      }
    }
    // In list order, skipping what has settled or is loading. Kept in a ref, so a load that
    // finishes after a newer list arrives takes from the newest queue.
    const seen = new Set<string>();
    queue.current = frames
      .map((f) => f.cutout_url)
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return !settledRef.current.byUrl.has(url) && !active.current.has(url);
      });

    const pump = () => {
      while (active.current.size < PRELOAD_CONCURRENCY && queue.current.length > 0) {
        const url = queue.current.shift();
        if (url === undefined || active.current.has(url)) continue;
        const img = new Image();
        active.current.set(url, img);
        const done = (s: Done) => {
          if (active.current.get(url) !== img) return;
          active.current.delete(url);
          img.onload = null;
          img.onerror = null;
          const prev = settledRef.current;
          const keep = wantedRef.current;
          // Entries of another object's list are dropped here, as are their sizes.
          const byUrl = new Map([...prev.byUrl].filter(([u]) => keep.has(u)));
          const sizeBefore = byUrl.size > 0 ? prev.size : null;
          byUrl.set(url, s);
          const size =
            s === 'loaded' && img.naturalWidth > 0
              ? { w: img.naturalWidth, h: img.naturalHeight }
              : null;
          const next: Settled = { byUrl, size: sizeBefore ?? size };
          settledRef.current = next;
          setSettled(next);
          pump();
        };
        img.onload = () => done('loaded');
        img.onerror = () => done('failed');
        img.src = url;
      }
    };
    pump();
  }, [frames]);

  // Unmount: drop every pending request.
  useEffect(() => {
    const loads = active.current;
    return () => {
      for (const img of loads.values()) cancel(img);
      loads.clear();
      queue.current = [];
    };
  }, []);

  const status = frames.map((f) => settled.byUrl.get(f.cutout_url) ?? 'pending');
  return {
    status,
    // Only a size measured on this list's cutouts.
    size: status.some((s) => s === 'loaded') ? settled.size : null,
  };
}
