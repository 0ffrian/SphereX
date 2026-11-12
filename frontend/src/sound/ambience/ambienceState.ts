// §13 lifecycle (R13.10) as a pure reducer. The loop calls `step` on every tick AND on every gate event (visibility,
// the paused prop, settings, honesty, unlock, unmount), so a fade never waits for a tick (coordinator ruling C1).
// Timers (fade end, 2-minute keep-alive) belong to the loop; the reducer only says what to do.
//
//   idle ──(gate on, place not ready)──► waiting ──(place ready)──► baking ──(first bed ready)──► playing
//   baking/playing ──(gate off)──► fading ──(timer)──► idle        fading ──(gate on)──► baking/playing (fadeIn)
//   any ──(engine failed)──► noSurface        any ──(exception)──► error
// A world or physics change is a worldKey change inside baking/playing: the mixer crossfades its groups (C5), so it
// needs no state of its own (blue 11, 12). Nothing in "waiting" is a refusal (R12).

export type AmbienceStatus = 'idle' | 'waiting' | 'baking' | 'playing' | 'fading' | 'noSurface' | 'error';

export interface GateInputs {
  /** The fly view was entered (WorldFlyStage). */
  entered: boolean;
  /** The close-up is closed (flyPaused). */
  paused: boolean;
  /** document.hidden. */
  hidden: boolean;
  /** Honesty is "+ Artistic". */
  artistic: boolean;
  /** The engine failed or WebGL 2 is missing. */
  failed: boolean;
  soundOn: boolean;
  ambienceOn: boolean;
  /** The shared AudioContext exists and runs (unlocked by a click, not suspended). */
  audioRunning: boolean;
}

export interface StepInput {
  gate: GateInputs;
  /** The place was sampled and the world is not waiting (R12). */
  placeReady: boolean;
  /** Beds selected and beds ready (from palette.get). */
  selected: number;
  ready: number;
}

export type Effect = 'fadeOut' | 'fadeIn';

/** The fly view is live at "+ Artistic" (the place loop and the weather run, with or without sound). */
export function flyLive(g: GateInputs): boolean {
  return g.entered && !g.paused && !g.hidden && g.artistic && !g.failed;
}

/** Sound may play now. */
export function soundGate(g: GateInputs): boolean {
  return flyLive(g) && g.soundOn && g.ambienceOn && g.audioRunning;
}

const audible = (s: AmbienceStatus) => s === 'baking' || s === 'playing';

export function step(prev: AmbienceStatus, i: StepInput): { status: AmbienceStatus; effects: Effect[] } {
  if (prev === 'error') return { status: 'error', effects: [] };
  const fade: Effect[] = audible(prev) ? ['fadeOut'] : [];
  if (i.gate.failed) return { status: 'noSurface', effects: fade };
  if (!soundGate(i.gate)) {
    if (audible(prev)) return { status: 'fading', effects: fade };
    return { status: prev === 'fading' ? 'fading' : 'idle', effects: [] };
  }
  if (!i.placeReady) return { status: 'waiting', effects: fade };
  const status: AmbienceStatus = i.selected > 0 && i.ready === 0 ? 'baking' : 'playing';
  return { status, effects: prev === 'fading' ? ['fadeIn'] : [] };
}

/** The fade timer fired. */
export function fadeDone(prev: AmbienceStatus): AmbienceStatus {
  return prev === 'fading' ? 'idle' : prev;
}
