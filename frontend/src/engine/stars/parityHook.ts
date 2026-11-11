// Issue #71 (parity/CONTRACT.md, check C): in dev with `?parity=1`, `window.__sxEngine` lets the
// orchestrator's harness load a star through the real app path (search, Enter, the rail's "3D viewer"),
// drive the engine to the artifact's state and read the picture back. Never installed in a build.
import type { StarEngine } from './StarEngine';
import { PROTOTYPE_PRESETS } from './cardToStar';

type Win = Window & {
  __sxStar_globe?: StarEngine | null;
  __sxStar_closeup?: StarEngine | null;
  __sxEngine?: unknown;
};
const W = window as unknown as Win;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let loaded: string | null = null;

async function until<T>(f: () => T | null | undefined | false, ms = 500000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('parity: timed out waiting for the app');
    await sleep(150);
  }
}

async function loadStar(search: string): Promise<void> {
  if (loaded === search && W.__sxStar_globe) return;
  const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
  if (!input) throw new Error('parity: no search box');
  W.__sxStar_globe = null;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  input.focus();
  set.call(input, search);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1800);
  // Enter in the box submits its form (the browser's implicit submission).
  input.form?.requestSubmit();
  await sleep(2500);
  const rail = document.querySelector('nav[aria-label="Tools"]');
  const btn = [...(rail?.querySelectorAll('button') ?? [])].find(
    (b) => b.getAttribute('aria-label') === '3D viewer',
  );
  if (!btn) throw new Error('parity: no 3D viewer button');
  if (btn.getAttribute('aria-pressed') !== 'true') (btn as HTMLButtonElement).click();
  await until(() => W.__sxStar_globe && W.__sxStar_globe.ready && W.__sxStar_globe);
  loaded = search;
}

function sized<T>(e: StarEngine, w: number, h: number, f: () => T): T {
  const host = e.layers[0]!.parentElement!;
  const old = host.style.cssText;
  host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:99999;background:#000`;
  try {
    return f();
  } finally {
    host.style.cssText = old;
  }
}

export function installParityHook(): void {
  // Adaptive quality is pinned in parity runs, as in the artifact's test page (production is unchanged).
  (window as unknown as { __sxPin?: boolean }).__sxPin = true;
  let current: StarEngine | null = null;
  let kind: 'star' | 'flare' = 'star';
  const api = {
    get kind() {
      return kind;
    },
    get state() {
      return current?.state ?? {};
    },
    get canvas() {
      return current?.layers[0] ?? null;
    },
    // `preset` (or `?preset=` in the page URL) loads one of the artifact's type rows by id ('f', 'k', 'm', ...)
    // into the engine after the Sun's page is up: named stars draw from their own cards, not from these rows.
    async parity(c: {
      search?: string | null;
      preset?: string | null;
      kind: string;
      view?: 'big' | 'true' | 'close';
      filter?: number;
      fire?: boolean;
      steps?: number;
      flare?: [never, never, number];
    }) {
      const pid = c.preset ?? new URLSearchParams(location.search).get('preset');
      const row = pid ? PROTOTYPE_PRESETS[pid] : undefined;
      if (pid && !row) throw new Error(`parity: no prototype preset "${pid}"`);
      await loadStar(row ? 'Sun' : c.search || 'Sun');
      kind = c.kind === 'flare' ? 'flare' : 'star';
      const g = W.__sxStar_globe!;
      g.setPaused(true);
      if (row) {
        g.setStar(row);
        W.__sxStar_closeup?.setStar(row);
      }
      if (kind === 'star') {
        current = g;
        g.parity(c);
      } else {
        const f = await until(() => W.__sxStar_closeup);
        current = f;
        f.setPaused(true);
        f.parity(c);
      }
    },
    draw() {
      current?.draw();
    },
    step(n: number) {
      current?.parity({ steps: n, filter: current.light });
    },
    ready: () => until(() => W.__sxStar_globe),
    /** Square PNG of the engine's layers, composited as the harness does (overlays with 'screen'). */
    capture(S: number): string {
      const e = current!;
      return sized(e, 704.0625, 439.28125, () => {
        // the artifact stage size exactly (1200x900 viewport, DPR 1)
        e.draw(); // draw and read back in the same task: the GL canvases do not keep their buffer
        const out = document.createElement('canvas');
        out.width = out.height = S;
        const g = out.getContext('2d')!;
        g.fillStyle = '#000';
        g.fillRect(0, 0, S, S);
        const [base, ...over] = e.layers as [HTMLCanvasElement, ...HTMLCanvasElement[]];
        const w = base.width,
          h = base.height,
          s = Math.min(w, h),
          x = (w - s) / 2,
          y = (h - s) / 2;
        for (const el of [base, ...over]) {
          if (!el.width) continue;
          g.globalCompositeOperation = el === base ? 'source-over' : 'screen';
          g.drawImage(
            el,
            (x * el.width) / w,
            (y * el.height) / h,
            (s * el.width) / w,
            (s * el.height) / h,
            0,
            0,
            S,
            S,
          );
        }
        return out.toDataURL('image/png');
      });
    },
  };
  W.__sxEngine = api;
}
