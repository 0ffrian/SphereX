// Issue #71, parity/CONTRACT.md C: one `window.__sxEngine` for the three engines (worlds, stars and flares, rocks),
// routed by the case's `kind`. Dev only, on ?parity=1; never part of a production build.
import { installRockParity } from '@/engine/rocks/parity';

export async function installParity(): Promise<void> {
  const w = window as any;
  await import('@/engine/parity/hook'); // sets __sxEngine for kind 'world'
  const world = w.__sxEngine;
  (await import('@/engine/stars/parityHook')).installParityHook(); // replaces it with kind 'star' / 'flare'
  const star = w.__sxEngine;
  let cur: any = world;
  w.__sxEngine = {
    get kind() {
      return cur?.kind;
    },
    get state() {
      return cur?.state;
    },
    get canvas() {
      return cur?.canvas;
    },
    parity(c: { kind: string }) {
      cur = c.kind === 'world' ? world : star;
      return cur.parity(c);
    },
    capture: (S: number) => cur.capture(S),
    draw: () => cur.draw?.(),
    step: (n: number) => cur.step?.(n),
    ready: () => cur.ready?.(),
  };
  installRockParity(); // composes over the router: kind 'rock' goes to the rock engine, the rest falls through
}
