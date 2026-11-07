// R7.7, D-12: the shared CPU field for the shader-generated kinds. Pure and deterministic per engine, so it
// is unit-testable; fieldWorker.ts is a thin Web Worker wrapper around `generateField`.
//
// The field is the SOURCE OF TRUTH for height, band index, storm id and the ocean, ice and lava
// masks. The shader (renderers/ShaderBody.ts) reads these two textures and adds only visual noise
// below the field's resolution, so the picture and the finger agree (D-12, R1 principle 6).
// Haptic sources read the same Float32Arrays through `FieldSampler`.
//
// Packing (D-12): Texture A (RGBA Float32): R height, G band index, B storm id, A unused.
// Texture B: R ocean mask, G ice mask, B lava-crack mask, A unused.
// Pixel-to-direction mapping: R6.1 (row 0 is the north pole).
import { clamp01, fbm, hash3, smoothstep } from './noise';

export const FIELD_WIDTH = 512;
export const FIELD_HEIGHT = 256;
/** Tag of every channel: nothing about these surfaces is measured (R7.7). */
export const FIELD_TAG = 'artistic' as const;

/** Max storms the field and the shader support (mock-up loop bound). */
export const MAX_STORMS = 8;

export type FieldKind = 'terrain' | 'gas';

/** Everything the field depends on. Same params, same bytes. */
export interface FieldParams {
  kind: FieldKind;
  /** RenderParams.seed. */
  seed: number;
  /** terrain: noise frequency on the unit sphere (mock-up uFreq). */
  freq: number;
  /** terrain: sea level in the height range; <= 0 means no ocean. */
  seaLevel: number;
  /** terrain: polar ice extent 0..1 (mock-up uIce). */
  iceExtent: number;
  /** terrain: lava cracks on/off strength 0..1; 0 gives an all-zero lava mask. */
  heat: number;
  /** gas: band count (mock-up uBands). */
  bands: number;
  /** gas: band warp strength (mock-up uTurb). */
  turbulence: number;
  /** gas: storm count, 0..MAX_STORMS. */
  storms: number;
}

export interface FieldData {
  width: number;
  height: number;
  /** R height, G band index, B storm id, A unused. Length width*height*4. */
  a: Float32Array;
  /** R ocean, G ice, B lava-crack, A unused. Length width*height*4. */
  b: Float32Array;
}

export type Vec3 = readonly [number, number, number];

/** R6.1: row r in [0,H), col c in [0,W). Matches three.js SphereGeometry; row 0 is north. */
export function pixelDirection(c: number, r: number, width: number, height: number): Vec3 {
  const theta = ((r + 0.5) / height) * Math.PI;
  const phi = ((c + 0.5) / width) * 2 * Math.PI;
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
}

/** Inverse of `pixelDirection`, in continuous texel space: column = u*W, row = v*H. */
export function directionToUV(d: Vec3): { u: number; v: number } {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  let phi = Math.atan2(d[2], -d[0]);
  if (phi < 0) phi += 2 * Math.PI;
  const theta = Math.acos(Math.max(-1, Math.min(1, d[1] / len)));
  return { u: phi / (2 * Math.PI), v: theta / Math.PI };
}

// ---- gas giant bands and storms ----------------------------------------------------------------

export interface GasBand {
  /** Band phase; band edges are where phase is a multiple of pi. */
  phase: number;
  /** Band profile 0..1, 0.5 + 0.5 sin(phase): the value the shader colours by. */
  value: number;
  /** Non-negative integer band index, floor(phase / pi) + offset. */
  index: number;
}

/** Index offset that keeps `index` >= 0 for any direction. */
export function gasIndexOffset(bands: number, turbulence: number): number {
  return Math.ceil(bands + (4 * turbulence) / Math.PI) + 1;
}

/** Mock-up GAS_FS band function (warped latitude bands), without the animation term. */
export function gasBandAt(d: Vec3, p: FieldParams): GasBand {
  const warp = fbm(d[0] * 2, d[1] * 5, d[2] * 2, 4, p.seed);
  const phase = d[1] * p.bands * Math.PI + (warp - 0.5) * p.turbulence * 8;
  return {
    phase,
    value: 0.5 + 0.5 * Math.sin(phase),
    index: Math.floor(phase / Math.PI) + gasIndexOffset(p.bands, p.turbulence),
  };
}

export interface Storm {
  /** 1-based id, as written to the field's storm channel. */
  id: number;
  center: Vec3;
  /** Angular radius in radians (mock-up `sz`). */
  size: number;
}

/** Storm centres and sizes from the seed (mock-up GAS_FS loop, with an integer hash). */
export function stormsFor(seed: number, count: number): Storm[] {
  const out: Storm[] = [];
  const n = Math.max(0, Math.min(MAX_STORMS, Math.floor(count)));
  for (let i = 0; i < n; i++) {
    const h1 = hash3(i, 1, 0, seed);
    const h2 = hash3(i, 2, 0, seed);
    const h3 = hash3(i, 3, 0, seed);
    const la = (h2 - 0.5) * 1.5;
    const lo = h1 * 2 * Math.PI;
    out.push({
      id: i + 1,
      center: [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)],
      size: 0.07 + 0.11 * h3,
    });
  }
  return out;
}

/**
 * The drawn storm is a spot (Gaussian of width 1 size) plus a ring: a Gaussian in the angular
 * distance centred at `STORM_RING_CENTRE` sizes with width `STORM_RING_WIDTH` sizes. The shader
 * (ShaderBody.ts) and the field both read these, so the felt edge is the drawn edge (D-12).
 */
export const STORM_RING_CENTRE = 1.3;
export const STORM_RING_WIDTH = 0.4;
/**
 * Storm influence: the field marks a pixel as inside a storm within this many sizes. It is the
 * radius where the drawn ring has faded to exp(-2.25), about 10%, of its peak (review N3).
 */
export const STORM_EDGE_FACTOR = STORM_RING_CENTRE + 1.5 * STORM_RING_WIDTH; // 1.9 (was 1.5, signed off by Atish)

/** Id of the storm covering `d` (nearest in units of its size), or 0. */
export function stormIdAt(d: Vec3, storms: readonly Storm[]): number {
  let best = 0;
  let bestRatio = STORM_EDGE_FACTOR;
  for (const s of storms) {
    const dot = d[0] * s.center[0] + d[1] * s.center[1] + d[2] * s.center[2];
    const ratio = Math.acos(Math.max(-1, Math.min(1, dot))) / s.size;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = s.id;
    }
  }
  return best;
}

// ---- gas giant flow and rings (D-12 flow source, R8.4) ------------------------------------------

/**
 * Zonal wind in the direction `d`, in units of the strongest jet (-1..1, `artistic`: the mock-up's
 * differential rotation without its time scale). It is `sin` of the same warped band phase the
 * shader draws (`gasBandAt`), so adjacent bands flow in opposite directions and the felt jets
 * follow the drawn bands exactly, warp included (R8.4, review NF-4). The still picture has no
 * motion (D-05), so this is the one flow input the shader does not use.
 */
export function zonalWind(d: Vec3, p: FieldParams): number {
  return Math.sin(gasBandAt(d, p).phase);
}

/** Ring plane geometry in body radii (ShaderBody draws the ring from these). */
export const RING_INNER = 1.45;
export const RING_OUTER = 2.55;
/** Gap edges as a fraction of the ring width, t = (r - RING_INNER) / (RING_OUTER - RING_INNER). */
export const RING_GAP_EDGES = [0.58, 0.6, 0.64, 0.66] as const;

/** Radial ring parameter t in 0..1 across the ring; outside the ring it is outside 0..1. */
export function ringT(r: number): number {
  return (r - RING_INNER) / (RING_OUTER - RING_INNER);
}

/** 1 inside the ring gap (the shader thins the ring there), 0 elsewhere. Shared with the shader. */
export function ringGapAt(t: number): number {
  const [a, b, c, d] = RING_GAP_EDGES;
  return smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
}

// ---- terrain -----------------------------------------------------------------------------------

export interface TerrainSample {
  height: number;
  ocean: number;
  ice: number;
  lava: number;
}

/** Mock-up TERRA_FS terrain, sea, ice and crack functions, evaluated on the CPU. */
export function terrainAt(d: Vec3, p: FieldParams): TerrainSample {
  const sx = d[0] * p.freq;
  const sy = d[1] * p.freq;
  const sz = d[2] * p.freq;
  const e = clamp01(fbm(sx, sy, sz, 6, p.seed));
  const hasSea = p.seaLevel > 0;
  const seaL = Math.max(p.seaLevel, 0);
  const ocean = hasSea ? 1 - smoothstep(p.seaLevel - 0.006, p.seaLevel + 0.006, e) : 0;
  const hh = clamp01((e - seaL) / (1 - seaL));

  let ice = 0;
  if (p.iceExtent > 0.001) {
    const edge = 1.08 + (0.45 - 1.08) * p.iceExtent;
    const lat = Math.abs(d[1]);
    const wob = (fbm(sx * 2, sy * 2, sz * 2, 4, p.seed + 101) - 0.5) * 0.35;
    ice = smoothstep(edge - 0.06, edge + 0.06, lat + wob);
    ice = Math.max(ice, p.iceExtent * p.iceExtent * smoothstep(0.5, 0.75, hh) * (1 - ocean) * 0.9);
  }

  let lava = 0;
  if (p.heat > 0) {
    const f = fbm(sx * 2.5 + 11, sy * 2.5 + 11, sz * 2.5 + 11, 5, p.seed + 202);
    lava = Math.pow(1 - Math.abs(f * 2 - 1), 8) * (1 - ocean) * (1 - ice);
  }

  // ASSUMPTION: `height` is the raw terrain value (sea floor included), so the shader can shade
  // ocean depth from it. Consumers flatten the ocean themselves with the ocean mask: the shader
  // for normals, the haptic terrain source for the near-silent open ocean (D-12).
  return { height: e, ocean, ice, lava };
}

// ---- field -------------------------------------------------------------------------------------

/**
 * Generates the 512x256 field once per body. Deterministic per engine: the same params give byte-identical
 * Float32Arrays on one engine (see noise.ts on cross-engine trig differences). Gas giants: R holds the band profile 0..1 (a gas giant has no relief; this is the
 * value the shader colours by), G the band index, B the storm id; texture B stays zero.
 */
export function generateField(
  p: FieldParams,
  width = FIELD_WIDTH,
  height = FIELD_HEIGHT,
): FieldData {
  const a = new Float32Array(width * height * 4);
  const b = new Float32Array(width * height * 4);
  const storms = p.kind === 'gas' ? stormsFor(p.seed, p.storms) : [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const d = pixelDirection(c, r, width, height);
      const i = (r * width + c) * 4;
      if (p.kind === 'terrain') {
        const t = terrainAt(d, p);
        a[i] = t.height;
        b[i] = t.ocean;
        b[i + 1] = t.ice;
        b[i + 2] = t.lava;
      } else {
        const band = gasBandAt(d, p);
        a[i] = band.value;
        a[i + 1] = band.index;
        a[i + 2] = stormIdAt(d, storms);
      }
    }
  }
  return { width, height, a, b };
}

/** FNV-1a over the field bytes; a compact determinism check. */
export function fieldHash(f: FieldData): string {
  let h = 0x811c9dc5;
  for (const arr of [f.a, f.b]) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface FieldSample {
  height: number;
  /** Nearest texel, an integer. */
  band: number;
  /** Nearest texel, an integer; 0 = no storm. */
  storm: number;
  ocean: number;
  ice: number;
  lava: number;
}

/**
 * Typed sampler over the field arrays, for haptic sources (D-12). Height and masks are bilinear
 * (wrapping in u, clamped in v); band and storm ids are nearest, because ids must not blend.
 */
export class FieldSampler {
  /** Moving storms (issue #42, D-34): when set, the storm id is computed from them, not read from the t = 0 field. */
  private storms: readonly Storm[] | null = null;

  constructor(private readonly field: FieldData) {}

  /**
   * Sets the storms at the current simulation time, from `flowModel.stormsAt`. The same list is
   * given to the shader, so what the finger feels is what is drawn (touch matches sight, D-34).
   * `null` goes back to the storm channel of the field (a still body).
   */
  setStorms(storms: readonly Storm[] | null): void {
    this.storms = storms;
  }

  sampleUV(u: number, v: number): FieldSample {
    const { width: W, height: H, a, b } = this.field;
    const px = u * W - 0.5;
    const py = v * H - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const col = (x: number) => ((x % W) + W) % W;
    const row = (y: number) => Math.max(0, Math.min(H - 1, y));
    const at = (arr: Float32Array, x: number, y: number, ch: number) =>
      arr[(row(y) * W + col(x)) * 4 + ch]!;
    const bil = (arr: Float32Array, ch: number) => {
      const top = at(arr, x0, y0, ch) * (1 - fx) + at(arr, x0 + 1, y0, ch) * fx;
      const bot = at(arr, x0, y0 + 1, ch) * (1 - fx) + at(arr, x0 + 1, y0 + 1, ch) * fx;
      return top * (1 - fy) + bot * fy;
    };
    const nx = x0 + (fx >= 0.5 ? 1 : 0);
    const ny = y0 + (fy >= 0.5 ? 1 : 0);
    // Moving storms: the id comes from the storm list at the texel centre the static channel would
    // have used, so a still list gives exactly the field's own id.
    const storm = this.storms
      ? stormIdAt(pixelDirection(col(nx), row(ny), W, H), this.storms)
      : at(a, nx, ny, 2);
    return {
      height: bil(a, 0),
      band: at(a, nx, ny, 1),
      storm,
      ocean: bil(b, 0),
      ice: bil(b, 1),
      lava: bil(b, 2),
    };
  }

  sampleDirection(d: Vec3): FieldSample {
    const { u, v } = directionToUV(d);
    return this.sampleUV(u, v);
  }
}
