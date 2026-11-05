// Flipbook playback helpers (A1.1). UI pacing only; no physical values.

/** Frames per second offered by the speed control. */
export const FPS_OPTIONS = [1, 2, 4, 8] as const;
export type Fps = (typeof FPS_OPTIONS)[number];
export const DEFAULT_FPS: Fps = 2;

/** Play is enabled once the current frame and this many after it have loaded or failed. */
export const PLAY_LOOKAHEAD = 3;

/** Next frame while playing: wraps to the first frame after the last. */
export function nextIndex(i: number, n: number): number {
  return n <= 0 ? 0 : (i + 1) % n;
}

export function clampIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return Math.min(Math.max(Math.trunc(i), 0), n - 1);
}

/**
 * True when frames `index` … `index + PLAY_LOOKAHEAD` (wrapping, capped at n) have settled, i.e.
 * loaded or failed. A failed frame is shown as "cutout unavailable", so it does not block play.
 */
export function readyToPlay(
  index: number,
  n: number,
  settled: (i: number) => boolean,
  lookahead: number = PLAY_LOOKAHEAD,
): boolean {
  if (n <= 0) return false;
  const count = Math.min(n, lookahead + 1);
  for (let k = 0; k < count; k++) {
    if (!settled((index + k) % n)) return false;
  }
  return true;
}
