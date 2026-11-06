// R7.7, D-12: what the shader and the CPU field must share. Seed bounding (review B1), the storm
// edge (N3), zonal wind and ring gaps (N2), and the GPU fieldUV / bilinear maths against the
// FieldSampler (N11).
import { describe, expect, it } from 'vitest';
import {
  FIELD_HEIGHT,
  FieldSampler,
  RING_GAP_EDGES,
  RING_INNER,
  RING_OUTER,
  STORM_EDGE_FACTOR,
  STORM_RING_CENTRE,
  STORM_RING_WIDTH,
  generateField,
  ringGapAt,
  ringT,
  gasBandAt,
  pixelDirection,
  stormIdAt,
  stormsFor,
  zonalWind,
  type FieldParams,
  type Vec3,
} from './fieldGenerator';
import { SEED_OFFSET_MOD, boundedSeed, mulberry32, shaderSeedOffsets } from './noise';

const f32 = Math.fround;
const gas: FieldParams = {
  kind: 'gas',
  seed: 12,
  freq: 0,
  seaLevel: 0,
  iceExtent: 0,
  heat: 0,
  bands: 12,
  turbulence: 0.5,
  storms: 5,
};
const water: FieldParams = {
  kind: 'terrain',
  seed: 11,
  freq: 2,
  seaLevel: 0.4,
  iceExtent: 0.22,
  heat: 0,
  bands: 0,
  turbulence: 0,
  storms: 0,
};

describe('boundedSeed (review B1)', () => {
  it('stays inside 0..SEED_OFFSET_MOD-1 for any seed, including above 2^31 and 2^53', () => {
    for (const s of [0, 1, 12, 996, 997, 1e6, 2 ** 31 + 5, 2 ** 32 + 1, 2 ** 40 + 3, 2 ** 53 - 1]) {
      const b = boundedSeed(s);
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(SEED_OFFSET_MOD);
    }
    expect(boundedSeed(-1)).toBe(SEED_OFFSET_MOD - 1);
    expect(boundedSeed(NaN)).toBe(0);
  });

  it('keeps float32 noise inputs distinct for a seed above 2^31 (the shader adds seed * 2)', () => {
    // The shader adds `boundedSeed(seed) * 2` to `dir * 7`. Count distinct float32 results over
    // 10,001 directions: a raw 2^31 seed collapses them to 1, the bounded offset keeps them all.
    const dirs: number[] = [];
    for (let i = 0; i <= 10000; i++) dirs.push(-1 + (2 * i) / 10000);
    const distinct = (off: number) => new Set(dirs.map((d) => f32(f32(d * 7) + f32(off * 2)))).size;
    const seed = 2 ** 31 - 1;
    expect(distinct(seed)).toBeLessThan(50); // the bug
    expect(distinct(boundedSeed(seed))).toBeGreaterThan(9000);
    expect(distinct(boundedSeed(2 ** 31 + 12345))).toBeGreaterThan(9000);
    expect(distinct(boundedSeed(12))).toBeGreaterThan(9000);
  });

  it('different large seeds still give different offsets and a different field', () => {
    expect(boundedSeed(2 ** 31 + 1)).not.toBe(boundedSeed(2 ** 31 + 2));
    const a = generateField({ ...gas, seed: 2 ** 31 + 1 }, 32, 16);
    const b = generateField({ ...gas, seed: 2 ** 31 + 2 }, 32, 16);
    expect(a.a.some((v, i) => v !== b.a[i])).toBe(true);
  });
});

describe('storm edge (review N3)', () => {
  it('the field edge is where the drawn ring has faded to about 10%', () => {
    const ring = (ratio: number) =>
      Math.exp(-(((ratio - STORM_RING_CENTRE) / STORM_RING_WIDTH) ** 2));
    expect(STORM_EDGE_FACTOR).toBeCloseTo(STORM_RING_CENTRE + 1.5 * STORM_RING_WIDTH, 12);
    expect(ring(STORM_EDGE_FACTOR)).toBeLessThan(0.11);
    expect(ring(STORM_RING_CENTRE)).toBe(1);
  });

  it('every visible ring texel (weight > 0.12) of a storm carries a storm id', () => {
    const storms = stormsFor(gas.seed, gas.storms);
    const f = generateField(gas, 256, 128);
    let checked = 0;
    for (let r = 0; r < 128; r++) {
      for (let c = 0; c < 256; c++) {
        const phi = ((c + 0.5) / 256) * 2 * Math.PI;
        const theta = ((r + 0.5) / 128) * Math.PI;
        const d: Vec3 = [
          -Math.cos(phi) * Math.sin(theta),
          Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
        ];
        for (const s of storms) {
          const dot = d[0] * s.center[0] + d[1] * s.center[1] + d[2] * s.center[2];
          const ratio = Math.acos(Math.max(-1, Math.min(1, dot))) / s.size;
          const w = Math.exp(-(((ratio - STORM_RING_CENTRE) / STORM_RING_WIDTH) ** 2));
          if (w > 0.12) {
            checked++;
            expect(f.a[(r * 256 + c) * 4 + 2]).toBeGreaterThan(0);
            expect(stormIdAt(d, storms)).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('shaderSeedOffsets (review NF-3)', () => {
  it('stays small for any seed, so float32 never drowns the direction term', () => {
    for (const seed of [12, 1e6, 2 ** 31 + 5, 2 ** 32 - 1, 2 ** 53 - 1, -7, NaN]) {
      const o = shaderSeedOffsets(seed);
      expect(o.cloud).toBeLessThan(SEED_OFFSET_MOD * 2.3);
      expect(o.gasFine).toBeLessThan(SEED_OFFSET_MOD * 2);
      expect(o.ringGrain).toBeLessThan(53 * 0.7);
      expect(o.cloud).toBeGreaterThanOrEqual(0);
    }
  });
  it('is the bounded seed scaled, and differs for seeds above 2^20', () => {
    const o = shaderSeedOffsets(2 ** 31 + 5);
    expect(o.gasFine).toBe(boundedSeed(2 ** 31 + 5) * 2);
    expect(shaderSeedOffsets(2 ** 31 + 1).gasFine).not.toBe(shaderSeedOffsets(2 ** 31 + 2).gasFine);
  });
});

describe('zonal wind and ring gaps (review N2, NF-4)', () => {
  it('wind is bounded, zero on a band edge, and alternates between neighbouring jets', () => {
    const flat = { ...gas, turbulence: 0 };
    // Without warp the phase is y * bands * pi: peaks at y = (k + 1/2) / bands with alternating sign.
    expect(zonalWind([0, 0, 1], flat)).toBeCloseTo(0, 12);
    expect(zonalWind([0, 0.5 / 12, 1], flat)).toBeCloseTo(1, 9);
    expect(zonalWind([0, 1.5 / 12, 1], flat)).toBeCloseTo(-1, 9);
    for (let i = 0; i <= 500; i++) {
      const y = -1 + i / 250;
      const w = zonalWind([Math.sqrt(1 - y * y), y, 0], gas);
      expect(Math.abs(w)).toBeLessThanOrEqual(1);
    }
  });

  it('the wind sign is constant inside each drawn band at the fixture turbulence', () => {
    // The drawn band is the warped phase (gasBandAt); wind must follow it, not a plain latitude.
    expect(gas.turbulence).toBeGreaterThan(0);
    const signByBand = new Map<number, number>();
    for (let r = 0; r < 128; r++) {
      for (let c = 0; c < 256; c++) {
        const d = pixelDirection(c, r, 256, 128);
        const band = gasBandAt(d, gas);
        const w = zonalWind(d, gas);
        if (Math.abs(w) < 1e-9) continue;
        const sign = Math.sign(w);
        const seen = signByBand.get(band.index);
        if (seen === undefined) signByBand.set(band.index, sign);
        else expect(sign, `band ${band.index}`).toBe(seen);
      }
    }
    // Neighbouring band indexes flow in opposite directions.
    for (const [i, sg] of signByBand) {
      const next = signByBand.get(i + 1);
      if (next !== undefined) expect(next).toBe(-sg);
    }
    expect(signByBand.size).toBeGreaterThan(10);
  });

  it('the ring gap is 1 inside the gap, 0 outside, and maps radius to t', () => {
    expect(ringT(RING_INNER)).toBe(0);
    expect(ringT(RING_OUTER)).toBe(1);
    const [a, b, c, d] = RING_GAP_EDGES;
    expect(ringGapAt(a - 0.01)).toBe(0);
    expect(ringGapAt((b + c) / 2)).toBe(1);
    expect(ringGapAt(d + 0.01)).toBe(0);
    expect(ringGapAt((a + b) / 2)).toBeGreaterThan(0);
    expect(ringGapAt((a + b) / 2)).toBeLessThan(1);
  });
});

// ---- GPU parity (review N11) ---------------------------------------------------------------------
// ShaderBody's `fieldUV` + `bilinear` ported to JS with float32 rounding at every step. If the TSL
// graph is changed, change this port with it: the property under test is that the picture samples
// the same field, at the same place, as the haptic sources do.
function gpuSample(arr: Float32Array, W: number, H: number, dir: Vec3, ch: number): number {
  const dx = f32(dir[0]);
  const dy = f32(dir[1]);
  const dz = f32(dir[2]);
  const frac = (x: number) => f32(x - Math.floor(x)); // WGSL fract
  const u = frac(f32(f32(Math.atan2(dz, f32(-dx))) / f32(2 * Math.PI)));
  const v = f32(f32(Math.acos(Math.max(-1, Math.min(1, dy)))) / f32(Math.PI));
  const px = f32(f32(u * W) - 0.5);
  const py = f32(f32(v * H) - 0.5);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = frac(px);
  const fy = frac(py);
  const tap = (ox: number, oy: number) => {
    const col = f32(x0 + ox + W) - W * Math.floor(f32(x0 + ox + W) / W); // three `mod`
    const row = Math.max(0, Math.min(H - 1, y0 + oy));
    return arr[(row * W + Math.trunc(col)) * 4 + ch]!;
  };
  const mix = (p: number, q: number, t: number) => f32(f32(p * f32(1 - t)) + f32(q * t));
  return mix(mix(tap(0, 0), tap(1, 0), fx), mix(tap(0, 1), tap(1, 1), fx), fy);
}

describe('GPU fieldUV / bilinear parity with FieldSampler (review N11, D-12)', () => {
  const W = 128;
  const H = FIELD_HEIGHT / 4;
  const field = generateField(water, W, H);
  const sampler = new FieldSampler(field);

  const dirs: Vec3[] = [];
  const rnd = mulberry32(2026);
  for (let i = 0; i < 20000; i++) {
    const z = rnd() * 2 - 1;
    const t = rnd() * 2 * Math.PI;
    const s = Math.sqrt(1 - z * z);
    dirs.push([s * Math.cos(t), z, s * Math.sin(t)]);
  }
  // Seam (u = 0 / 1 is -x with z = 0) and poles, plus their immediate neighbourhoods.
  for (const e of [0, 1e-7, -1e-7, 1e-4, -1e-4]) {
    dirs.push(
      [-1, e, 0],
      [-1, 0, e],
      [-1, 0, -e],
      [1, e, 0],
      [0, 1, e],
      [0, -1, e],
      [e, 1, 0],
      [e, -1, 0],
    );
  }
  dirs.push([0, 1, 0], [0, -1, 0]);

  it('terrain height and masks agree within 1e-4 over 20k directions plus seam and pole cases', () => {
    let worst = 0;
    for (const raw of dirs) {
      const len = Math.hypot(...raw);
      const d: Vec3 = [raw[0] / len, raw[1] / len, raw[2] / len];
      const cpu = sampler.sampleDirection(d);
      const pairs: [number, number][] = [
        [gpuSample(field.a, W, H, d, 0), cpu.height],
        [gpuSample(field.b, W, H, d, 0), cpu.ocean],
        [gpuSample(field.b, W, H, d, 1), cpu.ice],
      ];
      for (const [g, c] of pairs) worst = Math.max(worst, Math.abs(g - c));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('gas band profile agrees too (texture A only)', () => {
    const gf = generateField(gas, W, H);
    const gs = new FieldSampler(gf);
    let worst = 0;
    for (const raw of dirs.slice(0, 5000)) {
      const len = Math.hypot(...raw);
      const d: Vec3 = [raw[0] / len, raw[1] / len, raw[2] / len];
      worst = Math.max(worst, Math.abs(gpuSample(gf.a, W, H, d, 0) - gs.sampleDirection(d).height));
    }
    expect(worst).toBeLessThan(1e-4);
  });
});
