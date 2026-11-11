// Area search timers and keys (A18.1, A18.3; Q-406 (4), Q-408):
// - The blink: one visit every BLINK_MS while it is on. It stops when pressed again (the button),
//   when the Area card closes, when the tool changes, when a split pane opens, when the page is
//   hidden, when the area changes and when reduced motion turns on. Ticks are never announced.
// - Escape while drawing: leaves drawing and keeps the square (rank 3 of A21.10, until Q-170's
//   single owner exists). A capture-phase window listener, so it runs before the island's and the
//   object card's bubble-phase listeners, which skip an event that is already handled.
import { useEffect, useState } from 'react';
import { useShellStore } from '@/app/shell/shellStore';
import { isEditableTarget } from '@/app/shell/shortcuts';
import { useAppStore } from '@/state/store';
import { prefersReducedMotion } from '@/viewer/ViewerApp';
import { getSkyDrawHandler } from '@/app/sky/layers';
import { BLINK_MS } from './blink';
import { paneOpen } from './areaTool';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Reduced motion, following changes at run time (red-team H15). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Stops the blink when any of its stop conditions happens; runs its timer while it is on. */
export function useBlink(): void {
  const blink = useAppStore((s) => s.area.blink);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!blink) return;
    if (reduced) {
      useAppStore.getState().areaSetBlink(false);
      return;
    }
    const id = window.setInterval(() => useAppStore.getState().areaStepVisit(false), BLINK_MS);
    const stop = () => useAppStore.getState().areaSetBlink(false);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const offShell = useShellStore.subscribe((s) => {
      if (s.tool !== 'area' || paneOpen(s)) stop();
    });
    const startArea = useAppStore.getState().area.areaId;
    const offArea = useAppStore.subscribe((s) => {
      if (s.area.card === null || s.area.areaId !== startArea) stop();
    });
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      offShell();
      offArea();
    };
  }, [blink, reduced]);
}

/** Escape leaves drawing (rank 3, A21.10): pointer mode `pan`, any drag dropped, square kept. */
export function useDrawEscape(): void {
  const drawing = useShellStore((s) => s.tool === 'area' && s.pointerMode === 'draw');
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditableTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      getSkyDrawHandler()?.cancel();
      useShellStore.getState().setPointerMode('pan');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawing]);
}
