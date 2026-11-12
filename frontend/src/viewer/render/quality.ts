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
  /**
   * Scene resolution as a fraction of the drawing buffer (render-performance roadmap 1.14). Below 1
   * only with TAAU, which upscales to the full drawing buffer; SMAA has no upscaler, so the low
   * level stays at 1. This is the settled (base) scale; dynamic resolution may lower it while the
   * clock runs (`DynamicResolution`). Display choice.
   */
  renderScale: number;
}

/**
 * Scene scale of the TAAU levels (roadmap 1.14: about 56% of the scene pixels). Display choice
 * ('artistic'); the A15 measurement (R12 #43) decides whether it stays. [verify] on the A15.
 */
export const TAAU_RENDER_SCALE = 0.75;

export const TIERS: Readonly<Record<TierName, QualityTier>> = {
  high: {
    name: 'high',
    octaves: OCTAVES.high,
    volumeSteps: 96,
    // Roadmap 1.3 / issue #50: half-resolution bloom on High too. Bloom is a blur, so half
    // resolution changes its look very little and quarters its cost.
    bloomScale: 0.5,
    aa: 'taau',
    targetFps: 60,
    renderScale: TAAU_RENDER_SCALE,
  },
  medium: {
    name: 'medium',
    octaves: OCTAVES.medium,
    volumeSteps: 64,
    bloomScale: 0.5,
    aa: 'taau',
    targetFps: 60,
    renderScale: TAAU_RENDER_SCALE,
  },
  low: {
    name: 'low',
    octaves: OCTAVES.low,
    volumeSteps: 40,
    bloomScale: 0.5,
    aa: 'smaa',
    targetFps: 30,
    renderScale: 1,
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
 * The desktop 60 Hz cap of the render-performance roadmap (0.2). OFF by default: Q-66 and R5.7 say
 * the medium and high levels, and a desktop on low, draw at the display rate, so the cap is a
 * setting until a decision replaces that rule (Q-64 is open). Turned on per page with `?fpscap=60`
 * (any whole number from 30 to 240); `?fpscap=0` or no value keeps the display rate.
 */
export const DESKTOP_FPS_CAP_DEFAULT: number | null = null;

/** The desktop cap asked for in the page URL (`?fpscap=60`), else the default (off). */
export function desktopCapFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('fpscap');
  if (raw === null) return DESKTOP_FPS_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n === 0) return null;
  return n >= 30 && n <= 240 ? n : DESKTOP_FPS_CAP_DEFAULT;
}

/**
 * The frame-rate cap. The phone cap: the low quality level on a coarse pointer (R5.7 names phones
 * and the low level; D-34 names phones). Desktop, including a desktop that starts low on WebGL2,
 * and the medium and high levels draw at the display rate unless the `desktopFps` setting is on
 * (`desktopCapFromSearch`). Null means no cap. The phone cap wins where both apply (it is lower).
 */
export function capIntervalMs(
  level: TierName,
  coarsePointer: boolean,
  desktopFps: number | null = null,
): number | null {
  if (level === 'low' && coarsePointer) return 1000 / PHONE_FPS_CAP;
  return desktopFps !== null && desktopFps > 0 ? 1000 / desktopFps : null;
}

/**
 * Engine host loops (D-37 world, star and rock engines on raw WebGL2): roadmap 0.2. Q-66 covers only
 * the three.js viewer, so the engine hosts cap at 60 Hz by default. At a 60 Hz display it draws every
 * frame (the cap allows a frame up to half a display frame early). The star engine must not be
 * capped below about 53 fps or its own resolution scaler sticks low (render-performance guardrail).
 * `?enginefps=0` turns it off; `?enginefps=N` (30 to 240) sets another rate.
 */
export const ENGINE_FPS_CAP = 60;

/** The engine host cap interval (ms) from the page URL, or null when it is turned off. */
export function engineCapIntervalMs(search: string): number | null {
  const raw = new URLSearchParams(search).get('enginefps');
  if (raw === null) return 1000 / ENGINE_FPS_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n === 0) return null;
  return n >= 30 && n <= 240 ? 1000 / n : 1000 / ENGINE_FPS_CAP;
}

/**
 * A FrameCap for an engine host loop, read from the page URL once. Shared by the world host
 * (`WorldEngineStage`); the rock and star hosts can adopt it the same way:
 * `if (!cap.shouldDraw(now)) { raf = requestAnimationFrame(frame); return; }` before the tick, and
 * measure the step from the last DRAWN frame so simulation time stays real time.
 */
export function engineHostCap(
  search: string = typeof location === 'undefined' ? '' : location.search,
): FrameCap {
  return new FrameCap(engineCapIntervalMs(search));
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
