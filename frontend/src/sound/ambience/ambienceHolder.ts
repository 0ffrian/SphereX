// §13 (R13.10): the palette and the mixer outlive one WorldFlyStage mount, so closing and reopening the close-up, a
// StrictMode double mount or a quick mute reuse the baked beds. They are released after KEEP_ALIVE_MS of idle.
// The palette bakes before the unlock click (red M16): its AudioBuffers come from an OfflineAudioContext until a live
// context exists (an AudioBuffer is not tied to the context that made it).
import { getAudioContext } from '../audioContext';
import { getBus } from '../audioGraph';
import type { PaletteLike } from './ambienceLoop';
import { AmbienceMixer } from './mixer';
import { Palette } from './palette';
import { KEEP_ALIVE_MS } from './tuning';

let palette: PaletteLike | null = null;
let disposePalette: (() => void) | null = null;
let mixer: { ctx: BaseAudioContext; m: AmbienceMixer } | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
const active = new Set<object>();
let factory: (() => { palette: PaletteLike; dispose(): void } | null) | null = null;

/** Tests: replace how the palette is made (null restores the default). Releases the current one. */
export function setPaletteFactory(f: typeof factory): void {
  releaseAmbience();
  factory = f;
}

function offlineCtx(): BaseAudioContext | null {
  try {
    return typeof OfflineAudioContext === 'undefined' ? null : new OfflineAudioContext(2, 1, 44100);
  } catch {
    return null;
  }
}

/** The shared palette, made on first use (null when no context of any kind can be made here). */
export function sharedPalette(): PaletteLike | null {
  if (palette) return palette;
  if (factory) {
    const made = factory();
    if (!made) return null;
    palette = made.palette;
    disposePalette = made.dispose;
    return palette;
  }
  const ctx = getAudioContext() ?? offlineCtx();
  if (!ctx) return null;
  const p = new Palette(ctx);
  palette = p;
  disposePalette = () => p.dispose();
  return palette;
}

/** The mixer of the shared AudioContext (made on first use; a new context replaces it), or null before the unlock. */
export function sharedMixer(): AmbienceMixer | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (mixer && mixer.ctx === ctx) return mixer.m;
  mixer?.m.dispose();
  mixer = { ctx, m: new AmbienceMixer(ctx, getBus(ctx, 'ambience')) };
  return mixer.m;
}

/**
 * A loop reports idle (true) or active (false). While any loop is active nothing is released; once all are idle the
 * palette and mixer are released after KEEP_ALIVE_MS. Each loop must report its own changes (balanced per loop).
 */
export function reportIdle(loopId: object, on: boolean): void {
  if (on) active.delete(loopId);
  else active.add(loopId);
  if (active.size > 0) {
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = null;
    return;
  }
  if (releaseTimer === null && (palette || mixer))
    releaseTimer = setTimeout(releaseAmbience, KEEP_ALIVE_MS);
}

/** Release the palette (worker, buffers) and the mixer now. */
export function releaseAmbience(): void {
  if (releaseTimer !== null) clearTimeout(releaseTimer);
  releaseTimer = null;
  disposePalette?.();
  palette = null;
  disposePalette = null;
  mixer?.m.dispose();
  mixer = null;
}

/** Tests: what is held. */
export function heldAmbience(): { palette: boolean; mixer: boolean; releasePending: boolean } {
  return { palette: !!palette, mixer: !!mixer, releasePending: releaseTimer !== null };
}
