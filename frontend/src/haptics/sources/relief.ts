// R8.4 height rule, shared by the height-map source (asteroid_procedural) and the land part of the
// terrain source (planet_rocky, planet_water; D-12 "height-map ticks as for asteroid_procedural"):
//   track dh between consecutive samples; when dh turns from positive to negative after a rise
//   greater than τ = tauFraction × local relief std, emit a tick with strength = clamp(rise / 3τ).
// `ReliefStats` holds the local std per tile, computed once per body (not per pointermove).
import {
  HEIGHT_STRENGTH_TAU_MULTIPLE,
  RELIEF_STD_MIN_TEXELS,
  RELIEF_STD_TILE_TEXELS,
} from '../tuning';
import { clamp } from './types';

/** Local relief std of an equirectangular height grid, by tile. */
export class ReliefStats {
  private readonly std: Float64Array;
  private readonly tilesX: number;
  private readonly tilesY: number;
  readonly globalStd: number;

  /**
   * @param heightAt height of texel (col, row), or NaN to leave it out (open ocean)
   * @param tile tile size in texels (RELIEF_STD_TILE_TEXELS for a 512-wide map)
   */
  constructor(
    readonly width: number,
    readonly height: number,
    heightAt: (col: number, row: number) => number,
    tile = Math.max(2, Math.round((RELIEF_STD_TILE_TEXELS * width) / 512)),
  ) {
    this.tilesX = Math.max(1, Math.ceil(width / tile));
    this.tilesY = Math.max(1, Math.ceil(height / tile));
    const n = this.tilesX * this.tilesY;
    const sum = new Float64Array(n);
    const sum2 = new Float64Array(n);
    const count = new Float64Array(n);
    let gs = 0;
    let gs2 = 0;
    let gn = 0;
    for (let r = 0; r < height; r++) {
      const ty = Math.floor(r / tile);
      for (let c = 0; c < width; c++) {
        const h = heightAt(c, r);
        if (!Number.isFinite(h)) continue;
        const i = ty * this.tilesX + Math.floor(c / tile);
        sum[i] = sum[i]! + h;
        sum2[i] = sum2[i]! + h * h;
        count[i] = count[i]! + 1;
        gs += h;
        gs2 += h * h;
        gn++;
      }
    }
    this.globalStd = gn > 1 ? Math.sqrt(Math.max(0, gs2 / gn - (gs / gn) ** 2)) : 0;
    this.std = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = count[i]!;
      this.std[i] =
        k >= RELIEF_STD_MIN_TEXELS
          ? Math.sqrt(Math.max(0, sum2[i]! / k - (sum[i]! / k) ** 2))
          : this.globalStd;
    }
  }

  /** Local std at texture coordinates (u wraps, v clamps). */
  at(u: number, v: number): number {
    const tx = ((Math.floor(u * this.tilesX) % this.tilesX) + this.tilesX) % this.tilesX;
    const ty = clamp(Math.floor(v * this.tilesY), 0, this.tilesY - 1);
    return this.std[ty * this.tilesX + tx]!;
  }
}

/** The R8.4 rise-then-fall detector. One per source; `reset` when the finger leaves the body. */
export class PeakDetector {
  private prev = NaN;
  private base = NaN;
  private rising = false;

  reset(): void {
    this.prev = NaN;
    this.base = NaN;
    this.rising = false;
  }

  /**
   * Feed one height. Returns the tick strength (0–1) when a peak higher than `tau` has just been
   * passed, otherwise -1. A flat step (dh = 0) keeps the current direction.
   */
  step(h: number, tau: number): number {
    const prev = this.prev;
    this.prev = h;
    if (!Number.isFinite(prev) || !Number.isFinite(h)) {
      this.rising = false;
      return -1;
    }
    const dh = h - prev;
    if (dh > 0) {
      if (!this.rising) {
        this.base = prev;
        this.rising = true;
      }
      return -1;
    }
    if (dh < 0 && this.rising) {
      this.rising = false;
      const rise = prev - this.base;
      if (tau > 0 && rise > tau) return clamp(rise / (HEIGHT_STRENGTH_TAU_MULTIPLE * tau), 0, 1);
    }
    return -1;
  }
}
