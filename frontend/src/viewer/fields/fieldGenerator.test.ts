// R7.7, D-12, R6.1: the shared CPU field. Determinism, pixel->direction mapping, gas band edges,
// masks and the typed sampler.
import { describe, expect, it } from 'vitest';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FieldSampler,
  directionToUV,
  fieldHash,
  gasBandAt,
  gasIndexOffset,
  generateField,
  pixelDirection,
  stormIdAt,
  stormsFor,
  type FieldParams,
} from './fieldGenerator';

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
const rocky: FieldParams = { ...water, seed: 10, freq: 1.6, seaLevel: 0, iceExtent: 0, heat: 0.55 };

// Small grid keeps the structural tests fast; the determinism test also runs the real 512x256.
const bytesEqual = (a: Float32Array, b: Float32Array): boolean => {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};
const W = 128;
const H = 64;

describe('pixelDirection (R6.1)', () => {
  it('matches the spec formula and gives unit vectors', () => {
    const [x, y, z] = pixelDirection(10, 5, 64, 32);
    const theta = (5.5 / 32) * Math.PI;
    const phi = (10.5 / 64) * 2 * Math.PI;
    expect(x).toBeCloseTo(-Math.cos(phi) * Math.sin(theta), 12);
    expect(y).toBeCloseTo(Math.cos(theta), 12);
    expect(z).toBeCloseTo(Math.sin(phi) * Math.sin(theta), 12);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });

  it('row 0 is the north pole, the last row the south pole', () => {
    expect(pixelDirection(0, 0, 512, 256)[1]).toBeGreaterThan(0.999);
    expect(pixelDirection(0, 255, 512, 256)[1]).toBeLessThan(-0.999);
  });

  it('matches three.js SphereGeometry: u = 0.25 faces +z, u = 0.5 faces +x', () => {
    // SphereGeometry vertex x = -cos(phi) sin(theta), z = sin(phi) sin(theta), u = phi / 2pi.
    const q = pixelDirection(127, 31, 512, 64); // u just under 0.25 -> phi ~ pi/2
    expect(q[2]).toBeGreaterThan(0.99);
    const h = pixelDirection(255, 31, 512, 64); // u just under 0.5 -> phi ~ pi
    expect(h[0]).toBeGreaterThan(0.99);
  });

  it('directionToUV inverts pixelDirection at texel centres', () => {
    for (const [c, r] of [
      [0, 0],
      [511, 255],
      [100, 77],
      [300, 200],
    ] as const) {
      const { u, v } = directionToUV(pixelDirection(c, r, FIELD_WIDTH, FIELD_HEIGHT));
      expect(u * FIELD_WIDTH - 0.5).toBeCloseTo(c, 6);
      expect(v * FIELD_HEIGHT - 0.5).toBeCloseTo(r, 6);
    }
  });
});

describe('generateField determinism (R1, D-12)', () => {
  it('same params give byte-identical 512x256 Float32Arrays', () => {
    const a = generateField(water);
    const b = generateField({ ...water });
    expect(a.width).toBe(512);
    expect(a.height).toBe(256);
    expect(a.a.length).toBe(512 * 256 * 4);
    expect(bytesEqual(a.a, b.a)).toBe(true);
    expect(bytesEqual(a.b, b.b)).toBe(true);
    expect(fieldHash(a)).toBe(fieldHash(b));
  });

  it('a different seed gives a different field', () => {
    expect(fieldHash(generateField(water, W, H))).not.toBe(
      fieldHash(generateField({ ...water, seed: 99 }, W, H)),
    );
    expect(fieldHash(generateField(gas, W, H))).not.toBe(
      fieldHash(generateField({ ...gas, seed: 13 }, W, H)),
    );
  });

  it('leaves the unused A channels at zero and has no NaN', () => {
    for (const p of [water, rocky, gas]) {
      const f = generateField(p, W, H);
      for (const arr of [f.a, f.b]) {
        for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]!)).toBe(true);
      }
      for (let i = 3; i < f.a.length; i += 4) {
        expect(f.a[i]).toBe(0);
        expect(f.b[i]).toBe(0);
      }
    }
  });
});

describe('gas giant bands (done-when: field band edges match the drawn bands)', () => {
  const f = generateField(gas, W, H);
  const off = gasIndexOffset(gas.bands, gas.turbulence);

  it('band index is a non-negative integer equal to the drawn band function', () => {
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        const band = gasBandAt(pixelDirection(c, r, W, H), gas);
        expect(f.a[i + 1]).toBe(band.index);
        expect(Number.isInteger(f.a[i + 1])).toBe(true);
        expect(f.a[i + 1]).toBeGreaterThanOrEqual(0);
        expect(Math.abs(f.a[i]! - band.value)).toBeLessThan(1e-6);
      }
    }
    expect(off).toBeGreaterThan(0);
  });

  it('the band index changes exactly where the drawn profile crosses 0.5 (the colour edge)', () => {
    // The shader colours by R (0.5 = a band edge, kept at 0.5 by its remap), so every place the
    // index steps between neighbours must be a place where R crosses 0.5, and vice versa.
    let steps = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        for (const j of [r * W + ((c + 1) % W), (r + 1) * W + c]) {
          if (j >= W * H) continue;
          const k = j * 4;
          const indexStep = f.a[i + 1] !== f.a[k + 1];
          const vA = f.a[i]!;
          const vB = f.a[k]!;
          const cross = vA - 0.5 === 0 || vB - 0.5 === 0 || vA - 0.5 > 0 !== vB - 0.5 > 0;
          expect(indexStep).toBe(cross);
          if (indexStep) steps++;
        }
      }
    }
    expect(steps).toBeGreaterThan(gas.bands); // there are bands
  });

  it('the number of band edges along the central meridian is near the band count', () => {
    const c = 0;
    const seen = new Set<number>();
    for (let r = 0; r < H; r++) seen.add(f.a[(r * W + c) * 4 + 1]!);
    expect(seen.size).toBeGreaterThanOrEqual(gas.bands);
  });

  it('storm ids come from stormsFor and match stormIdAt', () => {
    const storms = stormsFor(gas.seed, gas.storms);
    expect(storms).toHaveLength(5);
    const ids = new Set<number>();
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const id = f.a[(r * W + c) * 4 + 2]!;
        expect(id).toBe(stormIdAt(pixelDirection(c, r, W, H), storms));
        ids.add(id);
      }
    }
    expect(ids.has(0)).toBe(true);
    expect([...ids].some((i) => i > 0)).toBe(true);
    expect(stormsFor(gas.seed, 99)).toHaveLength(8);
  });

  it('texture B is all zero for gas giants', () => {
    expect(f.b.every((x) => x === 0)).toBe(true);
  });
});

describe('terrain masks', () => {
  const f = generateField(water, W, H);
  const at = (arr: Float32Array, r: number, c: number, ch: number) => arr[(r * W + c) * 4 + ch]!;

  it('heights are in [0, 1] and masks in [0, 1]', () => {
    for (let i = 0; i < W * H; i++) {
      expect(f.a[i * 4]).toBeGreaterThanOrEqual(0);
      expect(f.a[i * 4]).toBeLessThanOrEqual(1);
      for (let ch = 0; ch < 3; ch++) {
        expect(f.b[i * 4 + ch]).toBeGreaterThanOrEqual(0);
        expect(f.b[i * 4 + ch]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ocean is exactly the low ground below the sea level', () => {
    let oceanPx = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const h = at(f.a, r, c, 0);
        const o = at(f.b, r, c, 0);
        if (h < water.seaLevel - 0.007) expect(o).toBe(1);
        if (h > water.seaLevel + 0.007) expect(o).toBe(0);
        if (o > 0.5) oceanPx++;
      }
    }
    const frac = oceanPx / (W * H);
    expect(frac).toBeGreaterThan(0.05);
    expect(frac).toBeLessThan(0.95);
  });

  it('polar ice is denser at the poles than at the equator', () => {
    const mean = (rows: number[]) => {
      let s = 0;
      for (const r of rows) for (let c = 0; c < W; c++) s += at(f.b, r, c, 1);
      return s / (rows.length * W);
    };
    const polar = mean([0, 1, 2, 3, H - 4, H - 3, H - 2, H - 1]);
    const equator = mean([H / 2 - 2, H / 2 - 1, H / 2, H / 2 + 1]);
    expect(polar).toBeGreaterThan(equator + 0.2);
  });

  it('no ocean without a sea level, no lava without heat, lava cracks with heat', () => {
    const r = generateField(rocky, W, H);
    expect(Array.from({ length: W * H }, (_, i) => r.b[i * 4]!).every((x) => x === 0)).toBe(true);
    expect(Array.from({ length: W * H }, (_, i) => f.b[i * 4 + 2]!).every((x) => x === 0)).toBe(
      true,
    );
    let maxLava = 0;
    for (let i = 0; i < W * H; i++) maxLava = Math.max(maxLava, r.b[i * 4 + 2]!);
    expect(maxLava).toBeGreaterThan(0.5);
  });
});

describe('FieldSampler (haptic sources read the same arrays)', () => {
  const f = generateField(water, W, H);
  const s = new FieldSampler(f);

  it('returns the stored texel at a texel centre', () => {
    for (const [c, r] of [
      [3, 4],
      [100, 30],
      [127, 63],
    ] as const) {
      const out = s.sampleUV((c + 0.5) / W, (r + 0.5) / H);
      const i = (r * W + c) * 4;
      expect(out.height).toBeCloseTo(f.a[i]!, 6);
      expect(out.ocean).toBeCloseTo(f.b[i]!, 6);
      expect(out.ice).toBeCloseTo(f.b[i + 1]!, 6);
      expect(out.lava).toBeCloseTo(f.b[i + 2]!, 6);
    }
  });

  it('interpolates halfway between two texels and wraps across the u seam', () => {
    const r = 20;
    const between = s.sampleUV(0, (r + 0.5) / H).height; // between col W-1 (wrapped) and col 0
    const left = f.a[(r * W + (W - 1)) * 4]!;
    const right = f.a[r * W * 4]!;
    expect(between).toBeCloseTo((left + right) / 2, 6);
  });

  it('sampleDirection agrees with sampleUV and band ids stay integers', () => {
    const g = new FieldSampler(generateField(gas, W, H));
    const d = pixelDirection(40, 20, W, H);
    const out = g.sampleDirection(d);
    expect(out.band).toBe(gasBandAt(d, gas).index);
    expect(Number.isInteger(out.band)).toBe(true);
    expect(Number.isInteger(out.storm)).toBe(true);
  });
});

describe('field worker wrapper', () => {
  it('handleFieldRequest returns the same field as generateField', async () => {
    const { handleFieldRequest } = await import('./fieldWorker');
    const res = handleFieldRequest({ id: 7, params: gas });
    expect(res.id).toBe(7);
    expect('field' in res && fieldHash(res.field)).toBe(fieldHash(generateField(gas)));
  });
});
