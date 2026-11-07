// Quality levels and the frame-time governor (R5.7, issue #39, Q-66). Pure: no DOM, no three.
// "Quality level" (high/medium/low, R5.7) is a rendering budget, not a provenance tier (D-32).
// Code names keep "tier" (TierName, setQualityTier, renderStats().tier) for the test hooks. The
// numbers are display choices ('artistic', not physical values).

import { OCTAVES } from '../shaders/noise';

export type TierName = 'high' | 'medium' | 'low';
export type AntiAlias = 'taau' | 'smaa';

export interface QualityTier {
  name: TierName;
  /** Noise octaves: the single table lives in shaders/noise.ts (`OCTAVES`). */
  octaves: number;
  /** Ray-march steps for volumes (for the shader library's volume kinds). */
  volumeSteps: number;
  /** Bloom resolution as a fraction of the drawing buffer: 1 is full, 0.5 is half. */
  bloomScale: number;
  aa: AntiAlias;
  targetFps: number;
}

export const TIERS: Readonly<Record<TierName, QualityTier>> = {
  high: {
    name: 'high',
    octaves: OCTAVES.high,
    volumeSteps: 96,
    bloomScale: 1,
    aa: 'taau',
    targetFps: 60,
  },
  medium: {
    name: 'medium',
    octaves: OCTAVES.medium,
    volumeSteps: 64,
    bloomScale: 0.5,
    aa: 'taau',
    targetFps: 60,
  },
  low: {
    name: 'low',
    octaves: OCTAVES.low,
    volumeSteps: 40,
    bloomScale: 0.5,
    aa: 'smaa',
    targetFps: 30,
  },
};

export const TIER_ORDER: readonly TierName[] = ['high', 'medium', 'low'];

export function isTierName(v: unknown): v is TierName {
  return v === 'high' || v === 'medium' || v === 'low';
}

/** The next quality level down, or null on the lowest. */
export function lowerTier(t: TierName): TierName | null {
  const i = TIER_ORDER.indexOf(t);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1]! : null;
}

export interface TierEnv {
  backend: 'webgpu' | 'webgl2';
  /** `(pointer: coarse)` matches: a phone or tablet. */
  coarsePointer: boolean;
}

/**
 * Starting quality level. The WebGL2 backend (no WebGPU: older or weaker devices, and headless CI) and
 * touch devices start Low. Desktop WebGPU starts Medium. r187 exposes no reliable high-end signal
 * (GPUAdapterInfo names vary and are frozen or empty in privacy modes), so High is never picked
 * automatically: it is opt-in through `?quality=high` (`qualityFromSearch`) or `setQualityTier`.
 * The governor only ever lowers.
 */
export function initialTier(env: TierEnv): TierName {
  if (env.backend === 'webgl2' || env.coarsePointer) return 'low';
  return 'medium';
}

/**
 * A frame slower than this counts as over budget (R5.7: 33 ms). A high or medium quality level
 * that only reaches a steady 30 fps (33.3 ms) misses its 60 fps target and drops; the low quality
 * tier is the floor and its 30 fps meets D-05.
 */
export const SLOW_FRAME_MS = 33;
/** Frames must stay over budget this long before the quality level drops (R5.7: two seconds). */
export const SLOW_WINDOW_MS = 2000;
/** A gap between fed frames longer than this means rendering was not continuous: start over. */
export const FEED_GAP_MS = 250;

export interface TierDrop {
  kind: 'drop';
  from: TierName;
  to: TierName;
}

/**
 * Lowers the quality level when every frame for `SLOW_WINDOW_MS` took more than `SLOW_FRAME_MS`. Never
 * raises. Feed it only during continuous rendering (animation, settle bursts), not sparse
 * on-change frames.
 */
export class FrameGovernor {
  private slowSince: number | null = null;
  private lastNow: number | null = null;

  constructor(private current: TierName) {}

  get tier(): TierName {
    return this.current;
  }

  /** Follows a manual quality-level change and forgets the slow streak. */
  setTier(t: TierName): void {
    this.current = t;
    this.reset();
  }

  reset(): void {
    this.slowSince = null;
    this.lastNow = null;
  }

  feed(frameMs: number, nowMs: number): TierDrop | null {
    if (this.lastNow !== null && nowMs - this.lastNow > FEED_GAP_MS) this.slowSince = null;
    this.lastNow = nowMs;
    if (!(frameMs > SLOW_FRAME_MS)) {
      this.slowSince = null;
      return null;
    }
    this.slowSince ??= nowMs;
    if (nowMs - this.slowSince < SLOW_WINDOW_MS) return null;
    this.slowSince = null;
    const to = lowerTier(this.current);
    if (to === null) return null;
    const from = this.current;
    this.current = to;
    return { kind: 'drop', from, to };
  }
}

/**
 * Quality level asked for in the page URL (`?quality=high`, also `medium` and `low`), else null.
 * The only way to reach High outside the fixtures build (Q-66).
 */
export function qualityFromSearch(search: string): TierName | null {
  const v = new URLSearchParams(search).get('quality');
  return isTierName(v) ? v : null;
}

/** R5.7 / D-34: phones draw at most this many frames a second (the battery mechanism). */
export const PHONE_FPS_CAP = 30;

/**
 * The phone frame-rate cap: the low quality level on a coarse pointer (R5.7 names phones and the
 * low level; D-34 names phones). Desktop, including a desktop that starts low on WebGL2, and the
 * medium and high levels draw at the display rate. Null means no cap.
 */
export function capIntervalMs(level: TierName, coarsePointer: boolean): number | null {
  return level === 'low' && coarsePointer ? 1000 / PHONE_FPS_CAP : null;
}

/**
 * Frame-rate cap scheduled against a due time, so the drawn rate averages the cap on any display
 * rate (75, 90, 144 Hz...) instead of snapping to a whole number of refreshes. Call `shouldDraw`
 * on every animation frame. A frame draws when it is no more than half a display frame early;
 * the due time then advances by one interval (not from `now`), and restarts after a stall.
 */
export class FrameCap {
  private due: number | null = null;
  private lastRaf: number | null = null;
  /** Display refresh estimate (ms), from the spacing of animation frames. */
  private displayMs = 1000 / 60;

  constructor(private intervalMs: number | null = null) {}

  setInterval(ms: number | null): void {
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    this.due = null;
  }

  reset(): void {
    this.due = null;
    this.lastRaf = null;
  }

  shouldDraw(now: number): boolean {
    if (this.lastRaf !== null) {
      const d = now - this.lastRaf;
      if (d > 0 && d < FEED_GAP_MS) this.displayMs = d;
    }
    this.lastRaf = now;
    const interval = this.intervalMs;
    if (interval === null) return true;
    if (this.due === null || now - this.due > interval) {
      this.due = now + interval;
      return true;
    }
    if (now < this.due - this.displayMs / 2) return false;
    this.due += interval;
    return true;
  }
}

/** The pixel ratio cap holds on every quality level (D-05); see `viewerPixelRatio`. */
export const TIER_PIXEL_RATIO_CAP = 1.5;
