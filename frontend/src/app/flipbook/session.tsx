// The flipbook's playback session, shared by the frame viewer (in the object panel) and the
// transport bar (bottom left): cutout preloading, the playback timer and "can play". It lives
// above both, so closing the panel does not stop playback or restart the preload, and the two
// never keep separate copies of the playback logic.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Frame } from '@/app/api/types';
import { useAppStore } from '@/state/store';
import { readyToPlay } from './playback';
import { useCutoutPreload, type CutoutStatus } from './useCutoutPreload';

export interface FlipbookSession {
  /** Frames of the current object once they have loaded, else an empty list. */
  frames: readonly Frame[];
  status: readonly CutoutStatus[];
  /** Natural size of the first cutout that loaded. */
  size: { w: number; h: number } | null;
  /** The Play button is enabled: playing, or the current frame and the next 3 have settled. */
  canPlay: boolean;
  loadedCount: number;
  failedCount: number;
  settled(i: number): boolean;
  /**
   * The frame the viewer is showing (useFrameSwap.ts), which can trail `sky.index` until the next
   * picture has decoded; null while the viewer is not on screen. The transport bar's frame number
   * and wavelength follow it, so they change with the picture.
   */
  shownIndex: number | null;
  setShownIndex(i: number | null): void;
}

const NO_FRAMES: readonly Frame[] = [];

const SessionContext = createContext<FlipbookSession | null>(null);

export function FlipbookSessionProvider({ children }: { children: ReactNode }) {
  const frames = useAppStore((s) =>
    s.sky.status === 'ready' && s.sky.frames ? s.sky.frames.frames : NO_FRAMES,
  );
  const index = useAppStore((s) => s.sky.index);
  const playing = useAppStore((s) => s.sky.playing);
  const fps = useAppStore((s) => s.sky.fps);

  const preload = useCutoutPreload(frames);
  const [shownIndex, setShownIndex] = useState<number | null>(null);
  const status = preload.status;
  const statusRef = useRef<readonly CutoutStatus[]>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Playback timer. Each tick reads the latest preload state through the ref.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = statusRef.current;
      useAppStore.getState().skyAdvance((i) => s[i] === 'loaded' || s[i] === 'failed');
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [playing, fps]);

  const n = frames.length;
  const settled = (i: number) => status[i] === 'loaded' || status[i] === 'failed';
  const current = Math.min(index, Math.max(0, n - 1));
  const value: FlipbookSession = {
    frames,
    status,
    size: preload.size,
    canPlay: n >= 2 && (playing || readyToPlay(current, n, settled)),
    loadedCount: status.filter((s) => s === 'loaded').length,
    failedCount: status.filter((s) => s === 'failed').length,
    settled,
    shownIndex,
    setShownIndex,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useFlipbookSession(): FlipbookSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useFlipbookSession needs a FlipbookSessionProvider above it');
  return s;
}
