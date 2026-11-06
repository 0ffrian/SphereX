// R8.4 height-map source (asteroid_procedural). The baked `height.bin` is float16 little-endian,
// row-major W×H, row 0 the north pole (backend/app/core/render/bake.py `encode`, R6.1). It is
// decoded by hand (lib ES2023 has no Float16Array), sampled bilinearly at the probe's UV, and fed to
// the R8.4 peak rule (relief.ts). Hydrated bodies tick ×0.6 softer.
//
// Refused, not invented: the R8.4 crater-rim double tick and silent crater floor need a crater mask
// channel, and the bake ships none (height.bin holds height only). `CRATER_RIMS_MISSING` goes in
// `missing` (Q-78).
import type { ObjectCard, Tag } from '@/contract';
import { HEIGHT_TAU_FRACTION, HYDRATED_BAND_DEPTH_3UM, HYDRATED_STRENGTH_SCALE } from '../tuning';
import { PeakDetector, ReliefStats } from './relief';
import { clamp, OneShot, type HapticSink, type HapticSource, type TouchSample } from './types';

/** `missing` id for the refused crater-rim double tick and silent floor (no crater mask, Q-78). */
export const CRATER_RIMS_MISSING = 'crater_rims';

/** IEEE 754 half → number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/** Little-endian float16 bytes → Float32Array. An odd trailing byte is ignored. */
export function decodeFloat16(bytes: ArrayBuffer | Uint8Array): Float32Array {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = u8.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = halfToFloat(u8[2 * i]! | (u8[2 * i + 1]! << 8));
  return out;
}

/** An equirectangular height grid (R6.1 layout), sampled like `FieldSampler`. */
export class HeightGrid {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly data: Float32Array,
  ) {
    if (data.length !== width * height) throw new RangeError('height grid size mismatch');
  }

  /**
   * From a decoded height.bin. The file has no header, so W×H is inferred from its length with
   * the bake's 2:1 rule (W = 2H). Returns null when the length is not 2H² for an integer H.
   */
  static fromValues(values: Float32Array): HeightGrid | null {
    const h = Math.round(Math.sqrt(values.length / 2));
    if (h < 2 || 2 * h * h !== values.length) return null;
    return new HeightGrid(2 * h, h, values);
  }

  texel(col: number, row: number): number {
    const W = this.width;
    const c = ((col % W) + W) % W;
    const r = clamp(row, 0, this.height - 1);
    return this.data[r * W + c]!;
  }

  /** Bilinear, wrapping in u and clamped in v, with texel centres at (i + 0.5) / W as R6.1. */
  sample(u: number, v: number): number {
    const px = u * this.width - 0.5;
    const py = v * this.height - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const top = this.texel(x0, y0) * (1 - fx) + this.texel(x0 + 1, y0) * fx;
    const bot = this.texel(x0, y0 + 1) * (1 - fx) + this.texel(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  }
}

/** Fetch and decode `params.textures.height_bin`. Rejects on a network error or a bad size. */
export async function loadHeightGrid(
  url: string,
  fetchImpl: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<HeightGrid> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`height.bin: HTTP ${res.status}`);
  const grid = HeightGrid.fromValues(decodeFloat16(await res.arrayBuffer()));
  if (!grid) throw new Error('height.bin: length is not a 2:1 float16 map');
  return grid;
}

/**
 * Hydrated, as the baker decides it: `band_depth_3um > 0.05`
 * (backend/app/core/render/params.py, `hydration=` in `_asteroid`). A missing depth is not hydrated.
 */
export function isHydrated(card: ObjectCard): boolean {
  const d = card.band_depth_3um?.value;
  return typeof d === 'number' && Number.isFinite(d) && d > HYDRATED_BAND_DEPTH_3UM;
}

export interface HeightMapOptions {
  /** τ as a fraction of the local relief std: `profile.params.tau`, else HEIGHT_TAU_FRACTION. */
  tauFraction?: number;
  hydrated?: boolean;
}

/** R8.4 height-map ticks. Texture channel; tag = `texture_tag` (artistic for procedural relief). */
export class HeightMapSource implements HapticSource {
  readonly id = 'height';
  readonly channel = 'texture' as const;
  readonly trigger = 'move' as const;
  private readonly stats: ReliefStats;
  private readonly peaks = new PeakDetector();
  private readonly out: OneShot;
  private readonly tauFraction: number;
  private readonly scale: number;

  constructor(
    engine: HapticSink,
    private readonly grid: HeightGrid,
    readonly tag: Tag,
    options: HeightMapOptions = {},
  ) {
    this.out = new OneShot(engine, tag);
    this.stats = new ReliefStats(grid.width, grid.height, (c, r) => grid.texel(c, r));
    const t = options.tauFraction;
    this.tauFraction = typeof t === 'number' && t > 0 ? t : HEIGHT_TAU_FRACTION;
    this.scale = options.hydrated ? HYDRATED_STRENGTH_SCALE : 1;
  }

  move(s: TouchSample): void {
    if (s.bodyId === null) {
      this.peaks.reset();
      return;
    }
    const h = this.grid.sample(s.u, s.v);
    const strength = this.peaks.step(h, this.tauFraction * this.stats.at(s.u, s.v));
    if (strength >= 0) this.out.play('tick', strength * this.scale, s.pan, 'click');
  }

  release(): void {
    this.peaks.reset();
  }
}
