// GPU timing and dynamic resolution for the three.js path (render-performance roadmap 0.1 and 2.5).
// Pure: no DOM, no three. ViewerApp feeds it the GPU milliseconds that three r187 resolves from its
// timestamp queries (`new WebGPURenderer({ trackTimestamp: true })`, then
// `renderer.resolveTimestampsAsync('render')`, which needs the adapter's 'timestamp-query' feature;
// checked against node_modules/three r187: Backend.js resolveTimestampsAsync, WebGPUBackend
// requiredFeatures = every supported feature). The numbers here are display choices, not physics.

/**
 * Dev-only switches in the page URL. `?gputime=1` turns on GPU timing (renderStats gains gpuP50Ms
 * and gpuP95Ms); `?inspector=1` also mounts the r187 Inspector (three/addons/inspector), which
 * turns timing on by itself. Both are read only in a development or fixtures build.
 */
export interface GpuTimingFlags {
  timing: boolean;
  inspector: boolean;
}

export function gpuTimingFlags(search: string, devBuild: boolean): GpuTimingFlags {
  if (!devBuild) return { timing: false, inspector: false };
  const q = new URLSearchParams(search);
  const inspector = q.get('inspector') === '1';
  return { timing: inspector || q.get('gputime') === '1', inspector };
}

/** A rolling window of samples with percentiles (GPU ms per frame). */
export class RollingStats {
  private readonly values: number[] = [];
  constructor(private readonly size = 120) {}

  push(v: number): void {
    if (!Number.isFinite(v) || v < 0) return;
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
  }

  get count(): number {
    return this.values.length;
  }

  clear(): void {
    this.values.length = 0;
  }

  /** The q-quantile (0..1) by nearest rank, or null with no samples. */
  percentile(q: number): number | null {
    if (this.values.length === 0) return null;
    const s = [...this.values].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
    return s[i]!;
  }

  mean(): number | null {
    if (this.values.length === 0) return null;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }
}

/**
 * GPU budget of one frame at the 60 fps target of the medium and high levels (R5.7), leaving room
 * for the browser's own compositing. Above it the scene scale steps down; below `DYNRES_RAISE_MS`
 * it steps back up. Display choices; [verify] on the A15 (R12 #43).
 */
export const DYNRES_LOWER_MS = 12;
export const DYNRES_RAISE_MS = 7;
/** Lowest scene scale dynamic resolution goes to (TAAU still upscales it to full size). */
export const DYNRES_MIN_SCALE = 0.5;
/** One step of the scene scale. Coarse steps keep the TAAU input size from changing every frame. */
export const DYNRES_STEP = 0.125;
/** GPU samples averaged before a step. */
export const DYNRES_WINDOW = 20;

/**
 * Dynamic resolution (roadmap 2.5): lowers the scene scale while the mean GPU time of the last
 * `DYNRES_WINDOW` frames is over budget, raises it while well under, never above the quality
 * level's base scale. Fed only while the clock runs; a settled frame always uses the base scale
 * (`reset`), so a still picture stays a function of the content only (determinism, goldens).
 */
export class DynamicResolution {
  private scaleNow: number;
  private readonly window: number[] = [];

  constructor(private base: number) {
    this.scaleNow = base;
  }

  get scale(): number {
    return this.scaleNow;
  }

  get baseScale(): number {
    return this.base;
  }

  /** Back to the base scale (settled frames, a quality-level change). */
  reset(base: number = this.base): void {
    this.base = base;
    this.scaleNow = base;
    this.window.length = 0;
  }

  /** One frame's GPU time (ms). Returns the new scale when it changed, else null. */
  feed(gpuMs: number): number | null {
    if (!Number.isFinite(gpuMs) || gpuMs < 0) return null;
    this.window.push(gpuMs);
    if (this.window.length < DYNRES_WINDOW) return null;
    const mean = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    this.window.length = 0;
    const floor = Math.min(this.base, DYNRES_MIN_SCALE);
    let next = this.scaleNow;
    if (mean > DYNRES_LOWER_MS) next = Math.max(floor, this.scaleNow - DYNRES_STEP);
    else if (mean < DYNRES_RAISE_MS) next = Math.min(this.base, this.scaleNow + DYNRES_STEP);
    if (next === this.scaleNow) return null;
    this.scaleNow = next;
    return next;
  }
}

/**
 * Dynamic resolution is on by default (it only acts on WebGPU with 'timestamp-query', on the TAAU
 * levels, while the clock runs); `?dynres=0` in the page URL turns it off.
 */
export function dynamicResolutionFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('dynres') !== '0';
}
