// Preloads the cutout PNGs of a frame list (UML 08: "loop each frame: GET cutout"). A cutout that
// fails is marked 'failed' and shown as "cutout unavailable"; nothing is drawn in its place.
import { useEffect, useState } from 'react';
import type { Frame } from '@/app/api/types';

export type CutoutStatus = 'pending' | 'loaded' | 'failed';

/** At most this many cutout requests at once, so a long frame list does not flood the server. */
export const PRELOAD_CONCURRENCY = 6;

export interface CutoutPreload {
  status: readonly CutoutStatus[];
  /** Natural size of the first cutout that loaded, or null while none has. */
  size: { w: number; h: number } | null;
}

interface PreloadState {
  frames: readonly Frame[] | null;
  status: CutoutStatus[];
  size: { w: number; h: number } | null;
}

const allPending = (frames: readonly Frame[]): CutoutStatus[] => frames.map(() => 'pending');

export function useCutoutPreload(frames: readonly Frame[]): CutoutPreload {
  const [state, setState] = useState<PreloadState>({ frames: null, status: [], size: null });

  useEffect(() => {
    let cancelled = false;
    const active = new Set<HTMLImageElement>();
    let next = 0;

    const mark = (i: number, s: CutoutStatus, size: { w: number; h: number } | null) => {
      setState((prev) => {
        const same = prev.frames === frames;
        const status = (same ? prev.status : allPending(frames)).slice();
        status[i] = s;
        return { frames, status, size: (same ? prev.size : null) ?? size };
      });
    };

    const startNext = () => {
      if (cancelled || next >= frames.length) return;
      const i = next++;
      const frame = frames[i];
      if (!frame) return;
      const img = new Image();
      active.add(img);
      const done = (s: CutoutStatus) => {
        active.delete(img);
        img.onload = null;
        img.onerror = null;
        if (cancelled) return;
        const size =
          s === 'loaded' && img.naturalWidth > 0
            ? { w: img.naturalWidth, h: img.naturalHeight }
            : null;
        mark(i, s, size);
        startNext();
      };
      img.onload = () => done('loaded');
      img.onerror = () => done('failed');
      img.src = frame.cutout_url;
    };

    for (let k = 0; k < PRELOAD_CONCURRENCY; k++) startNext();

    return () => {
      // A new search: drop the pending requests of the old frame list.
      cancelled = true;
      for (const img of active) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
      }
      active.clear();
    };
  }, [frames]);

  return state.frames === frames
    ? { status: state.status, size: state.size }
    : { status: allPending(frames), size: null };
}
