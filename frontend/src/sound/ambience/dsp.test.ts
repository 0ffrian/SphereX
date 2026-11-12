// @vitest-environment node
// Spec R13 §16 test 7 (bake engine) plus the #113 acceptance checks: determinism (Q-444), seamless loops, gust slope,
// loudness, the frozen params contract (App. D), refusals, physics wiring, one-shots that never wrap.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@/viewer/fields/noise';
import {
  BakeRefusedError,
  REQUIRED_PARAMS,
  bakeBed,
  bakeBedDetailed,
  fft,
  gustEnvelope,
  gustNoise,
  type BakeOutput,
} from './dsp';
import * as K from './dspTuning';
import {
  ALL_LOOP_BEDS,
  EARTH_AIR,
  EARTH_PARAMS,
  MARS_AIR,
  TITAN_AIR,
  TITAN_MF,
  TITAN_RAIN_PITCH,
  spec,
} from './testFixtures';
import type { BedSpec, SourceId } from './types';

const N_SMALL = 1 << 16;
const N_PHYS = 1 << 18;

async function sha256(...arrs: Float32Array[]): Promise<string> {
  const parts = arrs.map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const d = await globalThis.crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cache = new Map<string, BakeOutput>();
function baked(s: BedSpec, air = EARTH_AIR): BakeOutput {
  const k = JSON.stringify(s) + air.presetId;
  let out = cache.get(k);
  if (!out) {
    out = bakeBedDetailed(s, air);
    cache.set(k, out);
  }
  return out;
}

const ONE_SHOTS: BedSpec[] = [
  spec('thunder', N_SMALL, { variant: 0 }),
  spec('thunder', N_SMALL, {
    variant: 2,
    params: { ...EARTH_PARAMS.thunder, d_m: 5000, dur_s: 35, crack: 0 },
  }),
  spec('S8', N_SMALL, { variant: 1 }),
];

/** Band energy of channel L between f1 and f2 (Hz), from one forward FFT. */
function bandEnergy(x: Float32Array, sr: number, f1: number, f2: number): number {
  const n = 1 << Math.floor(Math.log2(x.length));
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i]!;
  fft(re, im, false);
  let e = 0;
  const k1 = Math.max(1, Math.floor((f1 * n) / sr)),
    k2 = Math.min(n / 2 - 1, Math.ceil((f2 * n) / sr));
  for (let k = k1; k <= k2; k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
  return e;
}
function centroid(x: Float32Array, sr: number, f1: number, f2: number): number {
  const n = 1 << Math.floor(Math.log2(x.length));
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i]!;
  fft(re, im, false);
  let num = 0,
    den = 0;
  const k1 = Math.floor((f1 * n) / sr),
    k2 = Math.ceil((f2 * n) / sr);
  for (let k = Math.max(1, k1); k <= Math.min(n / 2 - 1, k2); k++) {
    const p = re[k]! * re[k]! + im[k]! * im[k]!;
    num += p * ((k * sr) / n);
    den += p;
  }
  return num / den;
}
const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) {
    const v = x[((i % x.length) + x.length) % x.length]!;
    s += v * v;
  }
  return Math.sqrt(s / (b - a));
};
const db = (x: number) => 20 * Math.log10(x);
const allFinite = (x: Float32Array) => x.every((v) => Number.isFinite(v));

describe("mulberry32 parity with Moon's rng32", () => {
  // Moon's prototype, verbatim, as the reference.
  function rng32(a: number) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it('gives the same first 8 values', () => {
    const a = rng32(12345),
      b = mulberry32(12345);
    for (let i = 0; i < 8; i++) expect(b()).toBe(a());
  });
});

describe('determinism (§16.7, Q-444)', () => {
  const all: BedSpec[] = [...ALL_LOOP_BEDS.map((id) => spec(id, N_SMALL)), ...ONE_SHOTS];
  it.each(all.map((s) => [`${s.id}/${s.variant}`, s] as const))(
    '%s: same inputs give the same SHA-256',
    async (_n, s) => {
      const a = bakeBed(s, EARTH_AIR),
        b = bakeBed(s, EARTH_AIR);
      expect(await sha256(a.L, a.R)).toBe(await sha256(b.L, b.R));
      for (const ch of [a.L, a.R])
        for (const v of ch) if (!Number.isFinite(v)) throw new Error('non-finite sample');
    },
  );
  it('full size (2^20) S1_land is deterministic too', async () => {
    const s = spec('S1_land', 1 << 20);
    const a = bakeBed(s, EARTH_AIR),
      b = bakeBed(s, EARTH_AIR);
    expect(await sha256(a.L, a.R)).toBe(await sha256(b.L, b.R));
  }, 30_000);
  it('a different seed gives different output', async () => {
    const a = bakeBed(spec('S2', N_SMALL), EARTH_AIR),
      b = bakeBed(spec('S2', N_SMALL, { seed: 99 }), EARTH_AIR);
    expect(await sha256(a.L)).not.toBe(await sha256(b.L));
  });
  it('left and right are independent noise (mono-safe, §11.7)', () => {
    const r = bakeBed(spec('S2', N_SMALL), EARTH_AIR);
    let lr = 0,
      ll = 0,
      rr = 0;
    for (let i = 0; i < r.L.length; i++) {
      lr += r.L[i]! * r.R[i]!;
      ll += r.L[i]! ** 2;
      rr += r.R[i]! ** 2;
    }
    expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.05);
  });
});

describe('seamless loops (§16.7)', () => {
  it.each(ALL_LOOP_BEDS)('%s: the wrap step is no larger than the largest interior step', (id) => {
    const { L, R } = baked(spec(id, N_PHYS)).result;
    for (const x of [L, R]) {
      let maxStep = 0;
      for (let i = 0; i + 1 < x.length; i++)
        maxStep = Math.max(maxStep, Math.abs(x[i + 1]! - x[i]!));
      expect(Math.abs(x[0]! - x[x.length - 1]!)).toBeLessThanOrEqual(maxStep);
    }
  });
  it.each(ALL_LOOP_BEDS)('%s: the 256-sample window across the wrap is a typical window', (id) => {
    const { L } = baked(spec(id, N_PHYS)).result;
    const n = L.length,
      w = 256;
    const all: number[] = [];
    for (let a = 0; a + w <= n; a += w) all.push(rms(L, a, a + w));
    all.sort((x, y) => x - y);
    const p1 = all[Math.floor(0.01 * all.length)]!,
      p99 = all[Math.floor(0.99 * all.length)]!;
    const wrap = rms(L, n - w / 2, n + w / 2);
    expect(wrap).toBeGreaterThanOrEqual(p1);
    expect(wrap).toBeLessThanOrEqual(p99);
  });
  it.each(['S1_land', 'S1_sea', 'S2', 'S9', 'S12'] as const)(
    '%s with Iu 0 (no gusts, no events): the wrap window is within ±1 dB of its neighbours',
    (id) => {
      const params = id === 'S12' ? { Iu: 0 } : { ...EARTH_PARAMS[id], Iu: 0 };
      const { L, R } = baked(spec(id, N_PHYS, { params })).result;
      const n = L.length,
        w = 16384;
      for (const x of [L, R]) {
        const wrap = rms(x, n - w / 2, n + w / 2);
        const side = (rms(x, n - w / 2 - 2 * w, n - w / 2) + rms(x, w / 2, w / 2 + 2 * w)) / 2;
        expect(Math.abs(db(wrap / side))).toBeLessThan(1);
      }
    },
  );
  it('S2 (noise only): the wrap window is within ±1 dB of the windows either side', () => {
    const { L } = baked(spec('S2', N_PHYS)).result;
    const n = L.length,
      w = 256;
    const wrap = rms(L, n - w / 2, n + w / 2);
    const side = (rms(L, n - w / 2 - w, n - w / 2) + rms(L, w / 2, w / 2 + w)) / 2;
    expect(Math.abs(db(wrap / side))).toBeLessThan(1);
  });
});

describe('gust envelope (§7 S1, §16.7)', () => {
  function slope(x: Float64Array): number {
    const M = x.length,
      re = new Float64Array(M),
      im = new Float64Array(M);
    for (let i = 0; i < M; i++) re[i] = x[i]!;
    fft(re, im, false);
    const xs: number[] = [],
      ys: number[] = [];
    for (let k = 1; k <= K.GUST_SINES; k++) {
      xs.push(Math.log(k));
      ys.push(Math.log(re[k]! ** 2 + im[k]! ** 2));
    }
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length,
      my = ys.reduce((a, v) => a + v, 0) / ys.length;
    let num = 0,
      den = 0;
    xs.forEach((v, i) => {
      num += (v - mx) * (ys[i]! - my);
      den += (v - mx) ** 2;
    });
    return num / den;
  }
  const n = gustNoise(8192, mulberry32(7));
  it('n(t) has unit variance and power slope −5/3 ± 0.2', () => {
    const v = n.reduce((a, x) => a + x * x, 0) / n.length;
    expect(v).toBeCloseTo(1, 2);
    expect(Math.abs(slope(n) + 5 / 3)).toBeLessThan(0.2);
  });
  it('the clipped envelope g = max(0, 1 + 0.24·n) keeps the slope and stays ≥ 0', () => {
    const g = gustEnvelope(n, 0.24, 1);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(0);
    const mean = g.reduce((a, x) => a + x, 0) / g.length;
    const fluct = g.map((x) => x - mean);
    expect(Math.abs(slope(fluct) + 5 / 3)).toBeLessThan(0.2);
  });
});

describe('loudness (§11.4, §11.7, ruling 3)', () => {
  it.each(ALL_LOOP_BEDS)('%s: −24 LUFS, or the peak-limited level at −1 dBFS peak', (id) => {
    const out = baked(spec(id, N_PHYS));
    expect(out.peakDbfs).toBeLessThanOrEqual(K.BED_PEAK_MAX_DBFS + 1e-6);
    const limited = out.notes.some((t) => t.startsWith('peak-limited'));
    if (!limited) expect(Math.abs(out.result.lufs - K.BED_LUFS)).toBeLessThan(0.5);
    else expect(out.result.lufs).toBeLessThan(K.BED_LUFS);
  });
  it.each(ONE_SHOTS.map((s) => [`${s.id}/${s.variant}`, s] as const))(
    '%s: one-shot peak at ONE_SHOT_PEAK_DBFS',
    (_n, s) => {
      expect(baked(s).peakDbfs).toBeCloseTo(K.ONE_SHOT_PEAK_DBFS, 3);
    },
  );
});

describe('one-shots are linear (ruling 2)', () => {
  it.each(ONE_SHOTS.map((s) => [`${s.id}/${s.variant}`, s] as const))(
    '%s: silent before the onset and at the end',
    (_n, s) => {
      const { L, R, sampleRate } = baked(s).result;
      let pk = 0;
      for (const x of [L, R]) for (const v of x) pk = Math.max(pk, Math.abs(v));
      const pre = Math.floor(0.8 * K.ONE_SHOT_PAD_S * sampleRate);
      const end = Math.floor(0.05 * sampleRate);
      for (const x of [L, R]) {
        expect(db(rms(x, 0, pre) / pk)).toBeLessThan(-60);
        expect(db(rms(x, x.length - end, x.length) / pk)).toBeLessThan(-60);
      }
    },
  );
  it('length follows the duration, not spec.N', () => {
    const near = baked(ONE_SHOTS[0]!).result,
      far = baked(ONE_SHOTS[1]!).result;
    expect(near.L.length).toBe(
      Math.ceil((K.ONE_SHOT_PAD_S + 10.2 + K.ONE_SHOT_TAIL_S) * near.sampleRate),
    );
    expect(far.L.length).toBe(
      Math.ceil((K.ONE_SHOT_PAD_S + 35 + K.ONE_SHOT_TAIL_S) * far.sampleRate),
    );
  });
  it('the thunder peak follows f_m (Few 1969 scaling is an input)', () => {
    const lo = baked(
      spec('thunder', N_SMALL, {
        variant: 2,
        params: { ...EARTH_PARAMS.thunder, crack: 0, fm_Hz: 150 },
      }),
    );
    const hi = baked(
      spec('thunder', N_SMALL, {
        variant: 2,
        params: { ...EARTH_PARAMS.thunder, crack: 0, fm_Hz: 1200 },
      }),
    );
    const sr = lo.result.sampleRate;
    expect(centroid(hi.result.L, sr, 80, 6000)).toBeGreaterThan(
      2 * centroid(lo.result.L, sr, 80, 6000),
    );
  });
});

describe('params contract (App. D, frozen keys)', () => {
  const ids = Object.keys(REQUIRED_PARAMS) as SourceId[];
  it.each(ids)(
    '%s: the minimal valid params bake; each missing required key is refused by name',
    (id) => {
      const base = spec(id, 1 << 12);
      expect(() => bakeBed(base, EARTH_AIR)).not.toThrow();
      for (const key of REQUIRED_PARAMS[id]) {
        const params = { ...base.params };
        delete params[key];
        try {
          bakeBed({ ...base, params }, EARTH_AIR);
          throw new Error(`no refusal for ${key}`);
        } catch (e) {
          expect(e).toBeInstanceOf(BakeRefusedError);
          expect((e as BakeRefusedError).missing).toContain(key);
        }
      }
    },
  );
  it('refuses S3 with every tone gated, a bad N, a bad rate, a NaN and a bad variant', () => {
    const bad: BedSpec[] = [
      spec('S3', 1 << 12, { params: { Iu: 0.24 } }),
      spec('S1_land', 3000),
      spec('S1_land', 1 << 12, { sampleRate: 4000 }),
      spec('S2', 1 << 12, { params: { Iu: 0.24, fHiss_Hz: Number.NaN } }),
      spec('S2', 1 << 12, { variant: 1 }),
    ];
    for (const s of bad) expect(() => bakeBed(s, EARTH_AIR)).toThrow(BakeRefusedError);
  });
  it('refuses a bed whose every tone is above the guard', () => {
    expect(() =>
      bakeBed(spec('S3', 1 << 12, { params: { Iu: 0.24, fWhistle1_Hz: 20000 } }), EARTH_AIR),
    ).toThrow(BakeRefusedError);
  });
  it('refuses a silent bed instead of returning zeros (code review L7)', () => {
    // A 0.5 Hz tone falls between the first FFT bins at 2^14 (bin 1.95 Hz), so the bed has no energy at all and is
    // refused by the loudness gate as 'silent', never returned as zeros labelled ready.
    try {
      bakeBed(spec('S3', 1 << 14, { params: { Iu: 0.24, fWhistle1_Hz: 0.5 } }), EARTH_AIR);
      throw new Error('no refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(BakeRefusedError);
      expect((e as BakeRefusedError).missing).toEqual(['silent']);
    }
  });
});

describe('thin air (ruling R6: Mars-like and lava worlds are not silent)', () => {
  const marsParams: Record<string, Record<string, number>> = {
    S1_land: { Iu: 0.24 },
    S10: { Iu: 0.24 },
    S3: { Iu: 0.24, fWhistle1_Hz: (0.15 * 20) / 0.006 },
    S9: { Iu: 0.24 },
    S8: {},
  };
  it.each(Object.keys(marsParams))('%s bakes finite at P0 600 Pa', (id) => {
    const r = bakeBedDetailed(spec(id as SourceId, N_SMALL, { params: marsParams[id]! }), MARS_AIR);
    expect(allFinite(r.result.L) && allFinite(r.result.R)).toBe(true);
    expect(Math.abs(r.result.lufs - K.BED_LUFS)).toBeLessThan(0.5);
  });
  it('lava vent burst and thunder bake finite in thin air (500 Pa)', () => {
    const air = { ...MARS_AIR, P0: 500, lavaWorld: true, presetId: 'lava-thin' };
    for (const s of [
      spec('S8', N_SMALL, { variant: 1 }),
      spec('thunder', N_SMALL, {
        variant: 2,
        params: {
          ...EARTH_PARAMS.thunder,
          fm_Hz: 9,
          d_m: 5000,
          dur_s: 35,
          crack: 0,
          absK2: 1.7e-7,
        },
      }),
    ]) {
      const r = bakeBed(s, air);
      expect(allFinite(r.L)).toBe(true);
    }
  });
  it('S4 echo blur stays finite with strong CO2 absorption (absK2 1.7e-7)', () => {
    const r = bakeBed(
      spec('S4', N_SMALL, { params: { ...EARTH_PARAMS.S4, absK2: 1.7e-7 } }),
      MARS_AIR,
    );
    expect(allFinite(r.L)).toBe(true);
  });
});

describe('physics wiring (§7)', () => {
  it('S2 hiss sits around fHiss', () => {
    const lo = baked(spec('S2', N_PHYS, { params: { Iu: 0.24, fHiss_Hz: 300 } })).result;
    const hi = baked(spec('S2', N_PHYS, { params: { Iu: 0.24, fHiss_Hz: 1200 } })).result;
    const cLo = centroid(lo.L, lo.sampleRate, 20, 15000),
      cHi = centroid(hi.L, hi.sampleRate, 20, 15000);
    expect(cHi / cLo).toBeGreaterThan(3);
    expect(cHi / cLo).toBeLessThan(5);
  });
  it('S3 has energy at the present tone and none at the gated ones (R4)', () => {
    const r = baked(spec('S3', N_PHYS, { params: { Iu: 0.24, fWhistle1_Hz: 400 } })).result;
    const at = (f: number) => bandEnergy(r.L, r.sampleRate, f * 0.97, f * 1.03);
    const near = (f: number) => bandEnergy(r.L, r.sampleRate, f * 1.2, f * 1.26);
    expect(10 * Math.log10(at(400) / near(400))).toBeGreaterThan(10);
    expect(10 * Math.log10(at(400) / at(686))).toBeGreaterThan(30);
  });
  it('S6 rain band falls with rainPitch (Titan p 0.50–0.68 below Earth 1.0, R3)', () => {
    const e = baked(spec('S6', N_PHYS)).result;
    const t1 = baked(
      spec('S6', N_PHYS, { params: { rainPitch: 0.68, mf: TITAN_MF } }),
      TITAN_AIR,
    ).result;
    const t2 = baked(
      spec('S6', N_PHYS, { params: { rainPitch: TITAN_RAIN_PITCH, mf: TITAN_MF } }),
      TITAN_AIR,
    ).result;
    const c = (x: Float32Array) => centroid(x, e.sampleRate, 100, 12000);
    expect(c(t1.L)).toBeLessThan(c(e.L));
    expect(c(t2.L)).toBeLessThan(c(t1.L));
  });
  it('S5 with no whitecaps has no caps or pings (swell only)', () => {
    const calm = baked(
      spec('S5', N_PHYS, { params: { ...EARTH_PARAMS.S5, whitecapRate_per_s: 0 } }),
    );
    const rough = baked(spec('S5', N_PHYS)).result;
    const ratio = (x: Float32Array) =>
      bandEnergy(x, calm.result.sampleRate, 1000, 14000) /
      bandEnergy(x, calm.result.sampleRate, 20, 200);
    expect(10 * Math.log10(ratio(rough.L) / ratio(calm.result.L))).toBeGreaterThan(10);
    expect(calm.ffts).toBe(1);
  });
  it('S6 notes the Titan bubble ring as dropped above the guard (G8)', () => {
    const t = baked(
      spec('S6', N_PHYS, { params: { rainPitch: TITAN_RAIN_PITCH, mf: TITAN_MF } }),
      TITAN_AIR,
    );
    expect(t.notes.join(' ')).toMatch(/ring .* dropped/);
    expect(baked(spec('S6', N_PHYS)).notes.join(' ')).not.toMatch(/ring/);
  });
  it('S6 patter is capped at RAIN_PATTER_MAX (code review F3)', () => {
    const big = bakeBedDetailed(
      spec('S6', N_SMALL, { params: { rainPitch: 2, mf: 1 } }),
      EARTH_AIR,
    );
    const loop = N_SMALL / 31000;
    const raw = Math.round(K.RAIN_PATTER_PER_S * loop * 8);
    if (raw > K.RAIN_PATTER_MAX) expect(big.notes.join(' ')).toMatch(/patter capped/);
    else expect(big.notes.join(' ')).not.toMatch(/patter capped/);
  });
  it('far thunder swells in; near thunder knocks', () => {
    const near = baked(spec('thunder', N_SMALL, { variant: 0 })).result;
    const far = baked(
      spec('thunder', N_SMALL, {
        variant: 2,
        params: { ...EARTH_PARAMS.thunder, d_m: 5000, dur_s: 35, crack: 0 },
      }),
    ).result;
    const sr = near.sampleRate,
      a = Math.floor(K.ONE_SHOT_PAD_S * sr),
      b = a + Math.floor(0.03 * sr);
    const early = (x: Float32Array) => rms(x, a, b) / rms(x, a, a + Math.floor(2 * sr));
    expect(early(far.L)).toBeLessThan(early(near.L));
  });
  it('S4 uses at most 4 FFTs, the others at most 2', () => {
    for (const id of ALL_LOOP_BEDS)
      expect(baked(spec(id, N_PHYS)).ffts).toBeLessThanOrEqual(id === 'S4' ? 4 : 2);
  });
});
