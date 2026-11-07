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

  // A real bake, not our own encoder: backend `bake(params_from_card(asteroid_procedural, seed 2),
  // 16, 8)`, written by bake.py `encode` as `height.astype("<f2").tobytes()`. The expected values
  // are numpy's own float16 → float64 decode of the same bytes, so this pins the hand decoder to the
  // baker's format (byte order, layout, 2:1 size rule).
  it('decodes a real baker height.bin exactly, as numpy reads it', () => {
    const hex =
      '40a2baa32ba2dfa4c1a695a6eba4d4a47ca4f2a2019e669dc798631bbc1a94a0' +
      '2222e61b159c6c2352229e9fca994b9d28a4e39caa14ab9bc99f441e7225269e' +
      'b52473159110d623468c31991ca78aa0ada55ea08f274d2334236821041d1b22' +
      'ea9e3c220e22c6241820a72085a1da24609d170db61c7c1aee98cb9d4c9b8c24' +
      '5b1a3c989a20c8a023a64c992e11c02417a4aea792a48f90852131a77aa552a5' +
      '5e27601c5ba13f0ed60836a0a3a535a19a9c5097d9217ea080a0ca22a8a9811a' +
      'a625eb1e269de1233c247815309d6720fb25469d61a07c1af61a27a1d2141520' +
      '1aa026a355a573a024a0f3a3a79ff69c469c281c54980d24d126c625c41e6b9f';
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    const expected = [
      -0.01220703125, -0.0150909423828125, -0.01204681396484375, -0.0190277099609375,
      -0.0263824462890625, -0.0257110595703125, -0.0192108154296875, -0.01885986328125,
      -0.01751708984375, -0.0135650634765625, -0.005863189697265625, -0.00527191162109375,
      -0.0023326873779296875, 0.0036067962646484375, 0.00328826904296875, -0.008941650390625,
      0.0119781494140625, 0.003856658935546875, -0.003986358642578125, 0.014495849609375,
      0.0123443603515625, -0.00743865966796875, -0.002826690673828125, -0.005168914794921875,
      -0.0162353515625, -0.004772186279296875, 0.0011386871337890625, -0.0037441253662109375,
      -0.007602691650390625, 0.0061187744140625, 0.021270751953125, -0.00600433349609375,
      0.0183868408203125, 0.0013303756713867188, 0.0005574226379394531, 0.0153045654296875,
      -0.0002608299255371094, -0.0025348663330078125, -0.02777099609375, -0.0088653564453125,
      -0.0221710205078125, -0.0085296630859375, 0.0295257568359375, 0.01425933837890625,
      0.014068603515625, 0.01055908203125, 0.0048980712890625, 0.01192474365234375,
      -0.00675201416015625, 0.012176513671875, 0.0118255615234375, 0.018646240234375,
      0.00799560546875, 0.00908660888671875, -0.01078033447265625, 0.018951416015625,
      -0.0052490234375, 0.00031065940856933594, 0.00460052490234375, 0.00316619873046875,
      -0.002407073974609375, -0.005657196044921875, -0.00356292724609375, 0.01776123046875,
      0.0031032562255859375, -0.00206756591796875, 0.0089874267578125, -0.00933837890625,
      -0.0239715576171875, -0.00258636474609375, 0.0006322860717773438, 0.0185546875,
      -0.0159759521484375, -0.029998779296875, -0.017852783203125, -0.0005564689636230469,
      0.01078033447265625, -0.0280914306640625, -0.021392822265625, -0.020782470703125,
      0.028778076171875, 0.0042724609375, -0.01045989990234375, 0.00038123130798339844,
      0.0001475811004638672, -0.0082244873046875, -0.0220184326171875, -0.01016998291015625,
      -0.00449371337890625, -0.0017852783203125, 0.01142120361328125, -0.0087738037109375,
      -0.0087890625, 0.0132598876953125, -0.044189453125, 0.0031757354736328125, 0.022064208984375,
      0.006755828857421875, -0.00502777099609375, 0.01538848876953125, 0.01654052734375,
      0.00133514404296875, -0.00506591796875, 0.00859832763671875, 0.0233612060546875,
      -0.00514984130859375, -0.00855255126953125, 0.00316619873046875, 0.003398895263671875,
      -0.01006317138671875, 0.0011768341064453125, 0.00797271728515625, -0.0080108642578125,
      -0.0139617919921875, -0.0208282470703125, -0.00868988037109375, -0.008087158203125,
      -0.01552581787109375, -0.007472991943359375, -0.00484466552734375, -0.00417327880859375,
      0.004058837890625, -0.00211334228515625, 0.0158233642578125, 0.0266265869140625,
      0.022552490234375, 0.0066070556640625, -0.007244110107421875,
    ];
    const out = decodeFloat16(bytes);
    expect([...out]).toEqual(expected);
    const grid = HeightGrid.fromValues(out)!;
    expect([grid.width, grid.height]).toEqual([16, 8]);
    expect(grid.texel(0, 0)).toBe(expected[0]);
    expect(grid.texel(15, 7)).toBe(expected[127]);
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
