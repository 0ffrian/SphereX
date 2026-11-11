// Issue #71, parity/CONTRACT.md C: one `window.__sxEngine` for the three engines (worlds, stars and flares, rocks),
// routed by the case's `kind`. Dev only, on ?parity=1; never part of a production build.
import '@/engine/parity/hook'; // sets __sxEngine for kind 'world'
import { installParityHook as installStarParity } from '@/engine/stars/parityHook';
import { installRockParity } from '@/engine/rocks/parity';

// The harness polls for `window.__sxEngine.parity` and takes the first thing it finds. The world hook
// sets it when its module runs, so every hook is imported statically (the whole graph runs in one task,
// with no await between the world hook and the router) instead of one dynamic import after another,
// which left a gap where the harness got the world-only hook and rock cases failed with "this host only
// runs world cases".

export function installParity(): void {
  const w = window as any;
  const world = w.__sxEngine;
  installStarParity(); // replaces it with kind 'star' / 'flare'
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
