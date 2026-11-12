// Explore's transitions (Moon, 12 Nov 2026, Q-450): springs in the style of animate-ui
// (https://animate-ui.com), which is built on `motion` (pinned in package.json). Only transform and
// opacity are animated, so motion hands them to the compositor (WAAPI): they keep running while the
// close-up's engine starts on the main thread, and no canvas is resized on every frame.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animate } from 'motion';

/** animate-ui's default spring feel: quick, a little soft, no visible overshoot. UI pacing, not physics. */
export const EXPLORE_SPRING = { type: 'spring', stiffness: 170, damping: 26, mass: 1 } as const;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * FLIP for the build pane: when its width changes (full view <-> right half), the new width is set at
 * once and the pane springs from where its centre was. The body inside stays where it was on the
 * first frame and glides to its new place.
 */
export function useSpringResize(ref: RefObject<HTMLElement | null>, key: string): void {
  const prev = useRef<{ key: string; centre: number } | null>(null);
  /** Where an interrupted spring had got to (px): the next one starts from there, not with a jump. */
  const inFlight = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The layout box, not the screen box: a spring stopped half-way must not shift the next start.
    const centre = el.offsetLeft + el.offsetWidth / 2;
    const was = prev.current;
    prev.current = { key, centre };
    if (!was || was.key === key || reducedMotion()) return;
    const dx = was.centre + inFlight.current - centre;
    inFlight.current = 0;
    if (Math.abs(dx) < 1) return;
    const a = animate(el, { transform: [`translateX(${dx}px)`, 'translateX(0px)'] }, EXPLORE_SPRING);
    const settle = () => el.style.removeProperty('transform');
    void a.finished.then(settle, () => {});
    return () => {
      inFlight.current = translateXOf(el);
      a.stop();
      settle();
    };
  }, [ref, key]);
}

/** Mounts heavy content (a WebGL engine) a couple of frames after `on`, once the spring is running. */
export function deferFrames(cb: () => void, frames = 2): () => void {
  let id = 0;
  let left = frames;
  const step = () => {
    if (--left <= 0) cb();
    else id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}

/** The element's current horizontal translation in px (0 when there is none or it cannot be read). */
function translateXOf(el: HTMLElement): number {
  try {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none' || typeof DOMMatrixReadOnly === 'undefined') return 0;
    return new DOMMatrixReadOnly(t).m41 || 0;
  } catch {
    return 0;
  }
}
