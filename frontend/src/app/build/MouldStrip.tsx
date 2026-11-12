// Issue #60: the numbered step strip under the build stage (mock-up `.bp-steps`, `fillBuildUI`,
// `loop`). The steps come from the plan (viewer/mould/mouldSteps.ts). Progress is written straight
// to the DOM every frame (no React render per frame): a step is "active" while it runs (green ring
// and glow), "done" when it ends (the number turns into a tick), and its bar fills with progress.
// Once the last step is done the chips leave one after another (Q-421): a staggered spring with a
// blur fade, animate-ui's exit (https://animate-ui.com, built on `motion`, pinned in package.json).
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { animate, stagger } from 'motion';
import { EXPLORE_SPRING } from './exploreMotion';
import type { MouldScript } from '@/viewer/mould/mouldSteps';
import type { MouldPhase } from './useMould';

export interface StripHandle {
  update(progress: readonly number[]): void;
}

export function MouldStrip({
  script,
  phase,
  ref,
}: {
  script: MouldScript | null;
  phase: MouldPhase;
  ref?: Ref<StripHandle>;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastPhase = useRef<MouldPhase>(phase);
  useEffect(() => {
    const ol = listRef.current;
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (!ol) return;
    const items = [...ol.children] as HTMLElement[];
    if (phase !== 'done') {
      // A new build (Replay, New seed): the chips are back.
      for (const li of items) {
        li.style.opacity = '';
        li.style.transform = '';
        li.style.filter = '';
      }
      return;
    }
    // Only a build that played out leaves; a body shown built at once never had a strip on screen.
    if (was === 'done' || was === 'idle') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const a = animate(
      items,
      { opacity: [1, 0], transform: ['translateY(0px) scale(1)', 'translateY(14px) scale(0.96)'], filter: ['blur(0px)', 'blur(6px)'] },
      { ...EXPLORE_SPRING, delay: stagger(0.06, { startDelay: 0.25 }) },
    );
    return () => a.stop();
  }, [phase]);
  useImperativeHandle(
    ref,
    () => ({
      update(progress) {
        const items = listRef.current?.children;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          const li = items[i] as HTMLElement;
          const p = progress[i] ?? 0;
          const done = p >= 1;
          const active = p > 0 && p < 1;
          li.classList.toggle('done', done);
          li.classList.toggle('active', active);
          li.dataset.state = done ? 'done' : active ? 'active' : 'todo';
          if (active) li.setAttribute('aria-current', 'step');
          else li.removeAttribute('aria-current');
          const bar = li.querySelector<HTMLElement>('.bar');
          if (bar) bar.style.transform = `scaleX(${p})`;
          const sr = li.querySelector<HTMLElement>('.sr-only');
          if (sr) sr.textContent = done ? ', done' : active ? ', in progress' : '';
        }
      },
    }),
    [],
  );
  if (!script) return null;
  return (
    <ol
      ref={listRef}
      className="sx-bp-steps"
      aria-label="Build steps"
      data-testid="build-steps"
      data-phase={phase}
    >
      {script.steps.map((s, i) => (
        <li
          key={s.label}
          title={s.hint}
          // A finished build (or one shown built at once) is all ticks; while building, `update`
          // writes the classes itself.
          className={phase === 'done' ? 'done' : undefined}
          data-state={phase === 'done' ? 'done' : 'todo'}
          data-testid="build-step"
        >
          <span className="dot" aria-hidden="true">
            <b>{i + 1}</b>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span className="lb">
            {s.label}
            <span className="sr-only">{phase === 'done' ? ', done' : ''}</span>
          </span>
          <span
            className="bar"
            aria-hidden="true"
            style={phase === 'done' ? { transform: 'scaleX(1)' } : undefined}
          />
        </li>
      ))}
    </ol>
  );
}
