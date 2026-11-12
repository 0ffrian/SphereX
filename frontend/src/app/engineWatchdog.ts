// Issue #93 regression fix: a world engine stage must never hang on "Forming the planet…". These helpers bound the two
// waits (the shader compile, then the spin-up) so the stage takes the three.js path (onFail) instead of waiting
// forever, and turn the spin-up count into the progress the overlay shows. The limits are UI pacing, not physics.

export type EngineRole = 'globe' | 'fly';

/**
 * Longest wait for the shaders before the stage gives up and the three.js path draws (ms). Measured cold on an RTX 4060
 * Ti desktop (R5.9, Q-337): the globe's programs 2.3 to 4.6 s; the fly shader 22 to 43 s alone, and 40 to 55 s in the
 * app, where it compiles while the globe draws and forms. Chrome keeps these programs on disk only with
 * ANGLEPerContextBlobCache (Q-368), so a cold launch pays this again. The A15 is not measured: [verify] there.
 */
export const ENGINE_READY_TIMEOUT_MS: Record<EngineRole, number> = { globe: 60_000, fly: 180_000 };

/** Longest the world may take to form once its shaders are ready, counted only while it is on screen (ms). */
export const ENGINE_FORM_TIMEOUT_MS = 90_000;

/** A frame longer than this counts as this much towards the form time (a tab in the background, a breakpoint). */
const MAX_FRAME_MS = 250;

/**
 * Calls `onReady` when `ready` resolves, or `onFail` when it rejects or has not settled after `ms`. Exactly one of
 * them is called, once; the returned function cancels both (an unmount).
 */
export function readyOrTimeout(
  ready: Promise<void>,
  ms: number,
  onReady: () => void,
  onFail: (err: unknown) => void,
): () => void {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onFail(new Error(`the shaders were not ready after ${Math.round(ms / 1000)} s`));
  }, ms);
  ready.then(
    () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onReady();
    },
    (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onFail(err);
    },
  );
  return () => {
    settled = true;
    clearTimeout(timer);
  };
}

/** Counts the time a world spends forming while it is shown; `over` turns true past the limit. */
export class FormClock {
  private ms = 0;
  constructor(private readonly limit = ENGINE_FORM_TIMEOUT_MS) {}
  /** Adds one frame of `dtMs`; returns true once the world has formed on screen for longer than the limit. */
  add(dtMs: number, shown: boolean, forming: boolean): boolean {
    if (shown && forming && dtMs > 0) this.ms += Math.min(dtMs, MAX_FRAME_MS);
    return this.over;
  }
  get over(): boolean {
    return this.ms > this.limit;
  }
}

/** Share of the spin-up done, 0..1, from the steps left and the steps it started with; null before it starts. */
export function formProgress(spinup: number | null, start: number | null): number | null {
  if (spinup === null || start === null || !(start > 0)) return null;
  return Math.max(0, Math.min(1, 1 - spinup / start));
}
