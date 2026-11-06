import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { RecordingSink, sampleUV } from '@/test/hapticRecorder';
import { HEIGHT_STRENGTH_TAU_MULTIPLE, HYDRATED_STRENGTH_SCALE } from '../tuning';
import {
  decodeFloat16,
  halfToFloat,
  HeightGrid,
  HeightMapSource,
  isHydrated,
  loadHeightGrid,
} from './heightMap';
import { PeakDetector, ReliefStats } from './relief';

/** number → IEEE half bits (round to nearest; enough for the test values). */
function toHalf(x: number): number {
  const f = new Float32Array([x]);
  const b = new Uint32Array(f.buffer)[0]!;
  const sign = (b >>> 16) & 0x8000;
  const exp = ((b >>> 23) & 0xff) - 127 + 15;
  const mant = b & 0x7fffff;
  if (x === 0) return sign;
  if (exp <= 0) return sign | Math.round((mant | 0x800000) / 2 ** (14 - exp));
  return sign | (exp << 10) | Math.round(mant / 8192);
}

function encode(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((v, i) => {
    const h = toHalf(v);
    out[2 * i] = h & 0xff;
    out[2 * i + 1] = h >> 8;
  });
  return out;
}

describe('float16 decoding (height.bin is <f2, no Float16Array in ES2023)', () => {
  it('decodes known half values', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBeCloseTo(5.960464477539063e-8, 20);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0xfc00)).toBe(-Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
  });

  it('decodes little-endian bytes', () => {
    const vals = [0, 0.5, -0.25, 0.0123, 1.5, 0.001];
    const out = decodeFloat16(encode(vals));
    expect(out.length).toBe(vals.length);
    vals.forEach((v, i) => expect(out[i]).toBeCloseTo(v, 3));
    // An ArrayBuffer works too.
    expect(decodeFloat16(encode([2]).buffer as ArrayBuffer)[0]).toBe(2);
  });
});

describe('HeightGrid', () => {
  it('infers W×H from the length with the bake 2:1 rule', () => {
    const g = HeightGrid.fromValues(new Float32Array(2 * 8 * 8));
    expect(g?.width).toBe(16);
    expect(g?.height).toBe(8);
    expect(HeightGrid.fromValues(new Float32Array(100))).toBeNull();
    expect(HeightGrid.fromValues(new Float32Array(2))).toBeNull();
  });

  it('samples bilinearly, wrapping u and clamping v', () => {
    // 4×2: row 0 = 0,1,2,3; row 1 = 10,11,12,13.
    const g = new HeightGrid(4, 2, new Float32Array([0, 1, 2, 3, 10, 11, 12, 13]));
    expect(g.sample(0.125, 0.25)).toBeCloseTo(0); // texel (0,0) centre
    expect(g.sample(0.25, 0.25)).toBeCloseTo(0.5); // between col 0 and 1
    expect(g.sample(0.125, 0.5)).toBeCloseTo(5); // between rows
    expect(g.sample(0, 0.25)).toBeCloseTo(1.5); // wraps: halfway between col 3 and col 0
    expect(g.sample(0.125, 0)).toBeCloseTo(0); // clamped at the pole
  });

  it('loads and decodes height.bin through fetch', async () => {
    const bytes = encode(Array.from({ length: 2 * 4 * 4 }, (_, i) => i / 32));
    const grid = await loadHeightGrid(
      '/x/height.bin',
      async () => new Response(bytes.buffer as ArrayBuffer),
    );
    expect(grid.width).toBe(8);
    expect(grid.texel(1, 0)).toBeCloseTo(1 / 32, 4);
    await expect(
      loadHeightGrid('/x', async () => new Response('', { status: 404 })),
    ).rejects.toThrow(/404/);
    await expect(
      loadHeightGrid('/x', async () => new Response(new ArrayBuffer(6))),
    ).rejects.toThrow(/2:1/);
  });
});

describe('R8.4 peak rule', () => {
  it('ticks once after a rise > τ turns into a fall, strength = clamp(rise / 3τ)', () => {
    const p = new PeakDetector();
    const tau = 0.1;
    const heights = [0, 0.05, 0.1, 0.2, 0.15, 0.1, 0.12, 0.11];
    const out = heights.map((h) => p.step(h, tau));
    // Rise 0 → 0.2 (> τ) then a fall: tick at the 0.15 sample. The 0.1 → 0.12 rise is below τ.
    expect(out.filter((s) => s >= 0)).toEqual([
      Math.min(1, 0.2 / (HEIGHT_STRENGTH_TAU_MULTIPLE * tau)),
    ]);
    expect(out[4]).toBeGreaterThanOrEqual(0);
  });

  it('a small bump does not tick; reset forgets the rise', () => {
    const p = new PeakDetector();
    expect([0, 0.05, 0.0].map((h) => p.step(h, 0.1)).every((s) => s < 0)).toBe(true);
    p.step(0, 0.1);
    p.step(1, 0.1);
    p.reset();
    expect(p.step(0, 0.1)).toBe(-1);
  });

  it('local relief std is per tile, with the global std as fallback', () => {
    // Left half flat, right half alternating ±1.
    const stats = new ReliefStats(32, 16, (c, r) => (c < 16 ? 0 : (c + r) % 2 ? 1 : -1), 16);
    expect(stats.at(0.1, 0.5)).toBeCloseTo(0);
    expect(stats.at(0.9, 0.5)).toBeCloseTo(1);
    const sparse = new ReliefStats(32, 16, (c) => (c === 0 ? 1 : NaN), 16);
    expect(sparse.at(0.1, 0.5)).toBe(sparse.globalStd);
  });
});

/** A 64×32 grid: flat 0 with one ridge (height 1) along column 16. */
function ridgeGrid(): HeightGrid {
  const W = 64;
  const H = 32;
  const data = new Float32Array(W * H);
  for (let r = 0; r < H; r++) data[r * W + 16] = 1;
  return new HeightGrid(W, H, data);
}

function dragAcross(src: HeightMapSource): void {
  for (let i = 0; i <= 64; i++) src.move(sampleUV(0.2 + (0.12 * i) / 64, 0.5));
}

describe('HeightMapSource', () => {
  it('ticks crossing the ridge, tagged with texture_tag, voice click', () => {
    const sink = new RecordingSink();
    dragAcross(new HeightMapSource(sink, ridgeGrid(), 'artistic', { tauFraction: 0.15 }));
    const ticks = sink.ticks();
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ tag: 'artistic', voice: 'click' });
    expect(ticks[0]!.strength).toBeGreaterThan(0);
  });

  it('hydrated bodies tick ×0.6 softer', () => {
    const a = new RecordingSink();
    const b = new RecordingSink();
    dragAcross(new HeightMapSource(a, ridgeGrid(), 'artistic'));
    dragAcross(new HeightMapSource(b, ridgeGrid(), 'artistic', { hydrated: true }));
    expect(b.ticks()[0]!.strength).toBeCloseTo(a.ticks()[0]!.strength * HYDRATED_STRENGTH_SCALE);
  });

  it('a flat map never ticks; leaving the body resets', () => {
    const sink = new RecordingSink();
    const src = new HeightMapSource(sink, new HeightGrid(8, 4, new Float32Array(32)), 'artistic');
    dragAcross(src);
    const off = sampleUV(0.5, 0.5);
    off.bodyId = null;
    src.move(off);
    src.release();
    expect(sink.events).toEqual([]);
  });

  it('hydrated = band_depth_3um > 0.05, as the baker (params.py)', () => {
    const card = (v: number | null) =>
      ({ band_depth_3um: { value: v, tag: 'measured', source: 't' } }) as unknown as ObjectCard;
    expect(isHydrated(card(0.06))).toBe(true);
    expect(isHydrated(card(0.05))).toBe(false);
    expect(isHydrated(card(null))).toBe(false);
    expect(isHydrated({} as ObjectCard)).toBe(false);
  });
});
