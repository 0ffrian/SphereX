// Dev-only parity hook (parity/CONTRACT.md C). Installed by main.tsx when the URL has ?parity=1 in a dev build.
// window.__sxEngine.parity(case) loads the object through the real path (resolve -> card -> cardToWorld -> engine),
// finishes the spin-up the way the artifact's test page does, applies the fly altitude and draws once.
// window.__sxEngine.capture(size) returns a square centre-crop PNG of the engine canvas.
import type { ObjectCard } from '@/contract';
import { cardToWorld } from '../worlds/cardToWorld';
import { WorldEngine, WORLD_PRESETS } from '../worlds/WorldEngine';

interface ParityCase {
  kind: string;
  id: string;
  search?: string | null;
  fly?: number;
}

// The artifact's render scale drops when frames are slow; parity pins it (the declared @rename in core.js).
(window as unknown as Record<string, unknown>).__sxPin = true;

let engine: WorldEngine | null = null;
let canvas: HTMLCanvasElement | null = null;

async function load(c: ParityCase): Promise<void> {
  if (c.kind !== 'world') throw new Error('this host only runs world cases, not ' + c.kind);
  let preset;
  if (c.search) {
    const r = (await (await fetch('/v1/resolve?q=' + encodeURIComponent(c.search))).json()) as {
      id?: string;
    };
    if (!r.id) throw new Error('resolve found nothing for ' + c.search);
    const card = (await (
      await fetch('/v1/objects/' + encodeURIComponent(r.id) + '/card')
    ).json()) as ObjectCard;
    const out = cardToWorld(card);
    if (!out.ok) throw new Error('cardToWorld refused ' + r.id + ': ' + out.missing.join(', '));
    if (out.artifact !== c.id)
      throw new Error('card ' + r.id + ' mapped to ' + String(out.artifact) + ', expected ' + c.id);
    preset = out.preset;
  } else {
    preset = WORLD_PRESETS.find((p) => p.id === c.id);
    if (!preset) throw new Error('no preset ' + c.id);
  }
  engine?.dispose();
  canvas?.remove();
  // Exactly the artifact's stage size in the parity run (1200x900 viewport, DPR 1): 704x439 for the
  // globe, 1150x547 with the fly view. A different size resamples differently and shows up as noise.
  canvas = document.createElement('canvas');
  const w = c.fly ? 1150 : 704;
  canvas.style.cssText =
    'position:fixed;left:0;top:0;z-index:-1;width:' +
    w +
    'px;height:' +
    (c.fly ? 547 : 439) +
    'px;';
  document.body.appendChild(canvas);
  engine = new WorldEngine(canvas, { preserveDrawingBuffer: true });
  // Issue #93: let the shaders compile in the background instead of waiting inside setPreset.
  await engine.whenReady();
  engine.playing = false;
  engine.setPreset(preset);
  engine.spinUp(1 / 60, true);
  if (c.fly) {
    // The fly camera aims from the globe's last drawn view (W.view); a user always sees the globe first.
    engine.draw();
    engine.setFly(true);
    engine.fly.alt = c.fly;
  }
  engine.draw();
}

function capture(size: number): string {
  if (!engine || !canvas) throw new Error('nothing loaded');
  engine.draw();
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const g = out.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  // Fly cases compare the orbit view only: the left region [0, gx] of the split canvas (the artifact's world.region()).
  const v = engine.flying ? engine.view() : null;
  const x0 = 0;
  const w = v ? v.gx : canvas.width;
  const h = canvas.height;
  const s = Math.min(w, h);
  g.drawImage(canvas, x0 + (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return out.toDataURL('image/png');
}

(window as unknown as Record<string, unknown>).__sxEngine = {
  kind: 'world',
  parity: load,
  capture,
  get state() {
    return engine ? (engine as unknown as { core: { W: unknown; EB: unknown } }).core : null;
  },
  get canvas() {
    return canvas;
  },
  draw: () => engine?.draw(),
};
