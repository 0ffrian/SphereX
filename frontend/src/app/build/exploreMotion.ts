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

/** The transform that puts `el`'s centre on the island's and shrinks it to a pill (Q-457). */
function towardIsland(el: HTMLElement): string {
  const island = document.querySelector<HTMLElement>('[data-testid="island"]');
  const r = el.getBoundingClientRect();
  if (!island || r.width === 0) return 'translate(0px, 40px) scale(0.6)';
  const i = island.getBoundingClientRect();
  const dx = i.left + i.width / 2 - (r.left + r.width / 2);
  const dy = i.top + i.height / 2 - (r.top + r.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${Math.max(0.04, i.width / r.width)})`;
}

/**
 * Minimise and restore the build view (Moon, 13 Nov 2026, Q-457), in animate-ui's style on `motion`:
 * the pane shrinks into the island and fades with a light blur, or grows back out of it on a spring.
 * Transform, opacity and filter only. `done` runs once the pane has gone (minimise). Reduced motion:
 * no animation. Returns a stop function.
 */
export function flyIsland(
  els: (HTMLElement | null)[],
  dir: 'in' | 'out',
  done?: () => void,
): () => void {
  const list = els.filter((e): e is HTMLElement => e !== null);
  if (list.length === 0 || reducedMotion()) {
    done?.();
    return () => {};
  }
  const runs = list.map((el) => {
    const away = towardIsland(el);
    const here = 'translate(0px, 0px) scale(1)';
    // Growing out: start hidden at the island in this very frame, so the full pane never flashes.
    if (dir === 'out') {
      el.style.opacity = '0';
      el.style.transform = away;
    }
    const a =
      dir === 'in'
        ? animate(
            el,
            { transform: [here, away], opacity: [1, 0], filter: ['blur(0px)', 'blur(6px)'] },
            { duration: 0.38, ease: [0.4, 0, 0.2, 1] },
          )
        : animate(
            el,
            { transform: [away, here], opacity: [0, 1], filter: ['blur(6px)', 'blur(0px)'] },
            EXPLORE_SPRING,
          );
    return { el, a };
  });
  const settle = () => {
    for (const { el } of runs) {
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
      el.style.removeProperty('filter');
    }
  };
  let stopped = false;
  void Promise.all(runs.map((r) => r.a.finished)).then(
    () => {
      if (stopped) return;
      done?.();
      // Going in: keep the pane at its end values until React has hidden it, so it never flashes back.
      if (dir === 'in') requestAnimationFrame(() => requestAnimationFrame(() => !stopped && settle()));
      else settle();
    },
    () => {},
  );
  return () => {
    stopped = true;
    for (const r of runs) r.a.stop();
    settle();
  };
}
