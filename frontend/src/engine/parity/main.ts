// Dev-only: renders the D-37 world engine for a prototype preset id or for a card from /v1/objects/{id}/card.
// Exposes window.__engine and window.__done for the Playwright parity script (frontend/scripts/engine-parity.cjs).
import type { ObjectCard } from '@/contract';
import { cardToWorld } from '../worlds/cardToWorld';
import { WorldEngine } from '../worlds/WorldEngine';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const msg = document.getElementById('msg') as HTMLDivElement;
const w = Number(q.get('w') ?? 760);
const h = Number(q.get('h') ?? 475);
canvas.style.width = w + 'px';
canvas.style.height = h + 'px';
const w2 = window as unknown as Record<string, unknown>;
w2.__sxPin = true;
// Draw and read the drawing buffer in the same task (a WebGL canvas is blank after the task ends), for exact comparison.
w2.__png = (): string => {
  (w2.__engine as WorldEngine).draw();
  return canvas.toDataURL('image/png');
};

const tv = (value: number) => ({
  value,
  tag: 'measured' as const,
  source:
    'test fixture: published value, typed in as a user-supplied exoplanet (not from the backend)',
});
/** A user's own exoplanet (HD 209458 b, published values) to show the engine draws a world it has no preset for. */
const CUSTOM: Record<string, ObjectCard> = {
  'custom-hd209458b': {
    id: 'custom-hd209458b',
    name: 'HD 209458 b (user input)',
    type: 'gas_giant',
    radius_rjup: tv(1.359),
    mass_mearth: tv(227),
    orbit_au: tv(0.04707),
    orbital_period_d: tv(3.52475),
    host_teff_K: tv(6065),
    host_radius_rsun: tv(1.155),
    host_mass_msun: tv(1.119),
    host_age_gyr: tv(4),
  } as ObjectCard,
};

async function main(): Promise<void> {
  // Same settling as the prototype's test page (mklocal.py): a large spin-up budget so the world settles in one tick,
  // and no frame-time resolution scaler, so the output depends on the code and not on how fast the machine is.
  const engine = new WorldEngine(canvas, { preserveDrawingBuffer: true });
  w2.__engine = engine;
  engine.playing = false;
  // ?pre=<preset>: load and settle another world first, as the prototype's page always starts on 'rivers'.
  const pre = q.get('pre');
  if (pre) {
    engine.setPreset(pre);
    engine.spinUp(1 / 60, true);
  }
  const presetId = q.get('preset');
  const cardId = q.get('card');
  if (presetId) {
    engine.setPreset(presetId);
    msg.textContent = 'preset ' + presetId;
  } else if (cardId) {
    const card =
      CUSTOM[cardId] ??
      ((await (
        await fetch('/v1/objects/' + encodeURIComponent(cardId) + '/card')
      ).json()) as ObjectCard);
    const out = cardToWorld(card);
    w2.__cardResult = out;
    if (!out.ok) {
      msg.textContent = 'refused: missing ' + out.missing.join(', ');
      w2.__done = 'refused';
      return;
    }
    engine.setPreset(out.preset);
    msg.textContent =
      'card ' + cardId + ' -> ' + out.preset.id + ' (' + out.assumptions.length + ' assumptions)';
  } else {
    msg.textContent = 'pass ?preset= or ?card=';
    w2.__done = 'idle';
    return;
  }
  engine.spinUp(1 / 60, true);
  // The prototype's settle also runs the next hydro refresh tick only while playing; paused it does not (parity).
  if (q.get('fly') === '1') {
    engine.setFly(true);
    const alt = q.get('alt');
    if (alt) engine.fly.alt = Number(alt);
  }
  engine.draw();
  w2.__done = 'ok';
}

main().catch((e) => {
  msg.textContent = 'error: ' + (e as Error).message;
  w2.__done = 'error: ' + (e as Error).message;
});
