// Issue #71, D-37 (stream V3): the parity harness hook (sculptor-reference/parity/CONTRACT.md C).
// Dev only, and only with `?parity=1`: exposes `window.__sxEngine` so the harness can drive the app to
// the same state as the artifact (`window.__sxProto.rock`): search the body by name through the real
// app path, set the surface mode and age, draw, and read the picture back. Other engines compose by
// routing on `c.kind`; this one answers `kind: 'rock'`.
import * as E from './source';
import { useRockStore } from '@/app/rockStore';
import type { RockView } from './RockView';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(f: () => T | null | false, what: string, ms = 400000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(100);
  }
}

/** Types `name` in the search box and presses Enter, then opens the 3D viewer from the rail. */
async function openByName(name: string): Promise<void> {
  const input = await until(
    () => document.querySelector<HTMLInputElement>('input[placeholder^="Search a name"]'),
    'the search box',
  );
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, name);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  // Pick the first suggestion, as a click would (a synthetic Enter is not taken by the box).
  const option = await until(
    () => document.querySelector<HTMLElement>('[role="option"]'),
    'a search suggestion',
  );
  option.click();
  const btn = await until(
    () =>
      [...document.querySelectorAll('button')].find((b) =>
        /3D viewer/.test(`${b.getAttribute('aria-label') ?? ''} ${b.title} ${b.textContent ?? ''}`),
      ) ?? null,
    'the 3D viewer button',
  );
  await wait(4000);
  btn.click();
}

export function installRockParity(): void {
  if (
    !import.meta.env.DEV ||
    typeof location === 'undefined' ||
    !/[?&]parity=1/.test(location.search)
  )
    return;
  const w = window as any;
  const prev = w.__sxEngine;
  let active = false;
  const view = (): RockView | null => useRockStore.getState().view;
  w.__sxEngine = {
    kind: 'rock',
    get state() {
      return active ? { R: E.R } : prev?.state;
    },
    get canvas() {
      return active ? document.querySelector('[data-testid=rock-stage] canvas') : prev?.canvas;
    },
    async parity(c: { kind: string; search: string; mode?: 'rocky' | 'smooth'; age?: number }) {
      active = c.kind === 'rock';
      if (!active) return prev?.parity?.(c);
      const want = c.search.toLowerCase().replace(/^'/, '');
      // A different body than the one on screen: search it.
      if (!(view()?.label ?? '').toLowerCase().includes(want)) {
        const old = view();
        await openByName(c.search);
        await until(() => {
          const v = view();
          return v && v.built && v !== old && (v.label ?? '').toLowerCase().includes(want)
            ? v
            : null;
        }, `the rock engine for ${c.search}`).catch(async () => {
          // Same view object kept across bodies: the label alone decides.
          return until(() => {
            const v = view();
            return v && v.built && (v.label ?? '').toLowerCase().includes(want) ? v : null;
          }, `the rock engine for ${c.search}`);
        });
      }
      const v = view()!;
      v.setPlaying(false);
      v.setMode(c.mode ?? 'rocky');
      v.setAge(c.age ?? 70);
      v.pose(0.6, 0.25, 0);
    },
    capture(size: number) {
      if (!active) return prev?.capture?.(size);
      return view()!.capture(size);
    },
    draw() {
      view()?.draw();
    },
    step(n: number) {
      view()?.step(n);
    },
    ready: () => until(() => view()?.built || null, 'the engine'),
  };
}
