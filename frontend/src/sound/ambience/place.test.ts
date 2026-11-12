// Issue #114 (sound spec §6.2-6.6, §16 test 4): the place around the listener, on a fake WorldEngineLike with
// synthetic grids and a recording windAt stub (wind.ts is ticket T2).
import { describe, expect, it } from 'vitest';
import { gasProfile } from '@/engine/worlds/gas.js';
import { bspline } from '@/engine/worlds/fieldSampler';
import {
  cellOf,
  destination,
  localFrame,
  nearestCyclone,
  reachKm,
  RING_EDGES,
  samplePlace,
  type WindAt,
  type WindCtx,
} from './place';
import type { AirModel, WindResult, WorldEngineLike } from './types';

const TAU = Math.PI * 2;
const W = 720,
  H = 360,
  NX = 180,
  NY = 90,
  RW = 256,
  RH = 128;

interface FakeOpts {
  elev?: (lon: number, lat: number) => number;
  T?: (lon: number, lat: number) => number;
  iceH?: number;
  rain?: number;
  RH?: number;
  hydro?: (lon: number, lat: number) => [number, number, number, number];
  hydroLava?: boolean;
  fly?: Partial<WorldEngineLike['fly']>;
  spinup?: number;
  model?: Record<string, unknown>;
  gas?: boolean;
  gasField?: Float32Array | null;
  cyclones?: { lon: number; lat: number; r: number; s: number }[];
}
const lonOf = (i: number, n: number) => ((i + 0.5) / n - 0.5) * TAU;
const latOf = (j: number, n: number) => ((j + 0.5) / n - 0.5) * Math.PI;

function fakeEngine(o: FakeOpts = {}) {
  const data = new Float32Array(W * H * 2);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      data[(j * W + i) * 2] = o.elev ? o.elev(lonOf(i, W), latOf(j, H)) : 1;
  const T = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) T[j * NX + i] = o.T ? o.T(lonOf(i, NX), latOf(j, NY)) : 280;
  const n = NX * NY;
  const out = new Float32Array(n * 4),
    out2 = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    out[k * 4] = T[k]!;
    out[k * 4 + 3] = o.RH ?? 0.5;
    out2[k * 4] = o.rain ?? 0;
  }
  const iceH = new Float32Array(n).fill(o.iceH ?? 0),
    snow = new Float32Array(n);
  // the engine's EB arrays; a test may swap them for new ones, as the #93 shared simulation source does
  const EB = { out, out2 };
  const img = new Uint8Array(RW * RH * 4);
  if (o.hydro)
    for (let j = 0; j < RH; j++)
      for (let i = 0; i < RW; i++) img.set(o.hydro(lonOf(i, RW), latOf(j, RH)), (j * RW + i) * 4);
  const hydro = { img, RW, RH, lava: !!o.hydroLava, hM: 0 };
  const eng = {
    spinup: o.spinup ?? 0,
    gasCalls: 0,
    fly: { alt: 2, lon: 0.3, lat: 0.2, head: 0.5, pitch: -0.1, auto: false, ...o.fly },
    // o.model is copied on every call, so a test that mutates it is a slider moving
    readouts: () => ({
      model: {
        gas: !!o.gas,
        airless: false,
        Ts: 288,
        F: { Tt: 273.16 },
        U: 100,
        jets: 6,
        ...o.model,
      },
    }),
    state: () => ({ Ps: 1, fluid: 'water' as const, gas: !!o.gas, locked: false }),
    cpuFields: () => ({
      terrain: o.gas ? null : { W, H, data },
      climate: o.gas ? null : { NX, NY, T, land: new Uint8Array(n), stats: {} },
      hydro: o.gas ? null : hydro,
    }),
    EB,
    weatherFields: () =>
      o.gas ? null : { NX, NY, iceH, snow, out: EB.out, out2: EB.out2, cyclones: o.cyclones ?? [] },
    gasField() {
      eng.gasCalls++;
      return o.gasField ?? null;
    },
    groundKm: (lon: number, lat: number) => {
      const [i, j] = cellOf(lon, lat, W, H);
      return data[(j * W + i) * 2]!;
    },
    flyCameraBasis: () => null,
    altRange: (): [number, number] => [0.3, 3000],
  };
  return eng satisfies WorldEngineLike;
}

function air(o: Partial<AirModel> = {}): AirModel {
  return {
    gas: false,
    cls: 'N2',
    fluid: 'water',
    state: 'liquid',
    T0: 288,
    P0: 1e5,
    H_km: 8.5,
    mu: 29,
    gamma: 1.4,
    gv: 9.81,
    gamK: 0,
    c0: 340,
    rho0: 1.2,
    Z0: 408,
    airOK: true,
    liquid: null,
    lavaWorld: false,
    Uscale: 66.8,
    Us: 7,
    phiH: 0.5,
    Om: 7.3e-5,
    locked: false,
    res32: false,
    R_km: 6371,
    zc_km: 2,
    regime: 'Water clouds',
    seed: 101,
    Vmax: null,
    seed3: [101, 101, 101],
    oceanF: 0,
    presetId: 'earth',
    inputs: [],
    refusals: [],
    ...o,
  };
}

function recorder(): { windAt: WindAt; calls: WindCtx[] } {
  const calls: WindCtx[] = [];
  const res: WindResult = { U10: 5, Uz: 6, Iu: 0.1, dirDeg: 45, parts: [], tag: 'model_dependent' };
  return {
    calls,
    windAt: (_a, _lo, _la, ctx) => {
      calls.push(ctx);
      return res;
    },
  };
}

describe('samplePlace: lifecycle', () => {
  it('returns null while the world spins up (hydro and climate still belong to the previous world)', () => {
    const r = recorder();
    expect(samplePlace(fakeEngine({ spinup: 120 }), air(), r.windAt)).toBeNull();
    expect(r.calls).toHaveLength(0);
    const e = fakeEngine({ spinup: 120 });
    e.spinup = 0;
    expect(samplePlace(e, air(), r.windAt)).not.toBeNull();
  });
});

describe('samplePlace: geometry (§6.2, amendments 2 and 3)', () => {
  const e = fakeEngine({ fly: { alt: 10, lon: 0.3, lat: 0.2, head: 0.5 }, elev: () => 1 });
  const p = samplePlace(e, air(), recorder().windAt)!;
  const z = p.features.z_km,
    R = reachKm(z);

  it('37 samples: the centre and 3 rings x 12 bearings from head in 30 degree steps', () => {
    expect(p.samples).toHaveLength(37);
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 12; k++) {
        const s = p.samples[1 + r * 12 + k]!;
        expect(s.bearing).toBeCloseTo(0.5 + (k * TAU) / 12, 12);
        expect(s.s_km).toBeCloseTo([0.25, 0.5, 1][r]! * R, 9);
        expect(s.d_m).toBeCloseTo(1000 * Math.hypot(z, s.s_km), 6);
      }
  });

  it('sector areas tile the disc of radius 1.25 R; the centre slant distance is max(z, D_MIN)', () => {
    const sum = p.samples.reduce((a, s) => a + s.area_m2, 0);
    expect(sum / (Math.PI * (RING_EDGES[4] * R) ** 2 * 1e6)).toBeCloseTo(1, 9);
    expect(p.samples[0]!.d_m).toBe(Math.max(z * 1000, 2));
  });

  it('the listener height is the gap to the drawn ground: alt + 3 (groundKm - hKm)', () => {
    expect(z).toBeCloseTo(10 + 3 * (1 - p.samples[0]!.h_km), 9);
  });

  it('frame: east = normalize(cross(Y, up)); a bearing of pi/2 heads along it (towards smaller atan2 longitude)', () => {
    const f = localFrame(0.3, 0);
    const d = destination(0.3, 0, Math.PI / 2, 50, 6371);
    expect(d.lon).toBeLessThan(0.3);
    const step = d.dir.map((v, k) => v - f.up[k]!);
    expect(step[0]! * f.east[0]! + step[1]! * f.east[1]! + step[2]! * f.east[2]!).toBeGreaterThan(
      0,
    );
  });

  it('ring 1, bearing 0 lies along flyCamera fh = north cos(head) + east sin(head)', () => {
    const f = localFrame(0.3, 0.2);
    const fh = f.north.map((n, k) => n * Math.cos(0.5) + f.east[k]! * Math.sin(0.5));
    const s = p.samples[1]!;
    const up2 = [
      Math.cos(s.lat) * Math.cos(s.lon),
      Math.sin(s.lat),
      Math.cos(s.lat) * Math.sin(s.lon),
    ];
    const v = up2.map((x, k) => x - f.up[k]!);
    const n = Math.hypot(...v);
    expect((v[0]! * fh[0]! + v[1]! * fh[1]! + v[2]! * fh[2]!) / n).toBeCloseTo(1, 4);
  });
});

describe('samplePlace: grid conventions (row 0 = south pole, column 0 = lon -pi)', () => {
  it('a hot south-pole row reads hot near lat -pi/2 and cold near +pi/2', () => {
    const T = (_lo: number, la: number) => (la < -Math.PI / 2 + 0.04 ? 400 : 200);
    const south = samplePlace(
      fakeEngine({ T, fly: { lat: -Math.PI / 2 + 0.001, alt: 0.3 } }),
      air(),
      recorder().windAt,
    )!;
    const north = samplePlace(
      fakeEngine({ T, fly: { lat: Math.PI / 2 - 0.001, alt: 0.3 } }),
      air(),
      recorder().windAt,
    )!;
    expect(south.features.Tloc).toBeGreaterThan(350);
    expect(north.features.Tloc).toBeLessThan(250);
  });

  it('a hot first column reads hot just east of lon -pi', () => {
    const T = (lo: number) => (lo < -Math.PI + 0.04 ? 400 : 200);
    const p = samplePlace(
      fakeEngine({ T, fly: { lon: -Math.PI + 0.017, lat: 0, alt: 0.3 } }),
      air(),
      recorder().windAt,
    )!;
    expect(p.features.Tloc).toBeGreaterThan(300);
  });

  it('the poles and the seam give finite features (no NaN from asin or an index past the edge)', () => {
    for (const fly of [
      { lon: Math.PI, lat: Math.PI / 2 },
      { lon: -Math.PI, lat: -Math.PI / 2 },
    ]) {
      const p = samplePlace(fakeEngine({ fly }), air(), recorder().windAt)!;
      for (const s of p.samples) expect(Number.isFinite(s.h_km + s.lat + s.lon + s.T)).toBe(true);
      expect(Number.isFinite(p.features.slope + p.features.relief + p.features.Tloc)).toBe(true);
    }
    expect(cellOf(Math.PI, Math.PI / 2, 256, 128)).toEqual([0, 127]);
    expect(cellOf(-Math.PI, -Math.PI / 2, 256, 128)).toEqual([0, 0]);
  });
});

describe('samplePlace: classes (§6.3)', () => {
  const at = (o: FakeOpts, a: Partial<AirModel> = {}) =>
    samplePlace(
      fakeEngine({ fly: { lon: 0.3, lat: 0.2, alt: 1 }, ...o }),
      air(a),
      recorder().windAt,
    )!;
  const water: [number, number, number, number] = [255, 0, 0, 0];

  it('sea, ice, land', () => {
    expect(at({ elev: () => -6 }, { oceanF: 0.7 }).samples[0]!.cls).toBe('sea');
    expect(at({ elev: () => -6, iceH: 0.5 }, { oceanF: 0.7 }).samples[0]!.cls).toBe('ice');
    expect(at({ elev: () => 9 }, { oceanF: 0.7 }).samples[0]!.cls).toBe('land');
    expect(at({ elev: () => -6 }, { oceanF: 0 }).samples[0]!.cls).toBe('land'); // no sea on a dry world
  });

  it('lake (water wider than a line), river (a line), frozen river (land)', () => {
    expect(at({ elev: () => 9, hydro: () => water }).samples[0]!.cls).toBe('lake');
    const [ci] = cellOf(0.3, 0.2, RW, RH);
    const line = (lo: number): [number, number, number, number] =>
      cellOf(lo, 0, RW, RH)[0] === ci ? water : [0, 0, 0, 0];
    const river = at({ elev: () => 9, hydro: line }).samples[0]!;
    expect(river.cls).toBe('river');
    expect(river.riverQ).toBe(1);
    expect(at({ elev: () => 9, hydro: () => [255, 0, 0, 255] }).samples[0]!.cls).toBe('land');
  });

  it('lava, crust and vents on a lava world only', () => {
    const lavaAir = { lavaWorld: true, T0: 1500 };
    const lava = at(
      { elev: () => 1, hydroLava: true, hydro: () => [255, 0, 0, 200], model: { Ts: 1500 } },
      lavaAir,
    );
    expect(lava.samples[0]!.cls).toBe('lava');
    expect(lava.samples[0]!.vent).toBe(true);
    expect(
      at(
        { elev: () => 1, hydroLava: true, hydro: () => [0, 255, 0, 0], model: { Ts: 1500 } },
        lavaAir,
      ).samples[0]!.cls,
    ).toBe('crust');
    // the same raster on a cool world is a salt flat (G), i.e. land
    expect(at({ elev: () => 9, hydro: () => [0, 255, 0, 0] }).samples[0]!.cls).toBe('land');
  });

  it('coast zone and the breeze inputs on a straight shoreline', () => {
    const r = recorder();
    const p = samplePlace(
      fakeEngine({
        elev: (lo) => (lo < 0.3 ? -6 : 9),
        T: (lo) => (lo < 0.3 ? 290 : 300),
        fly: { lon: 0.3, lat: 0, alt: 40 },
      }),
      air({ oceanF: 0.7 }),
      r.windAt,
    )!;
    const cls = new Set(p.samples.map((s) => s.cls));
    expect(cls.has('sea') && cls.has('land')).toBe(true);
    expect(p.samples.some((s) => s.coast && s.cls === 'sea')).toBe(true);
    expect(p.samples.some((s) => s.coast && s.cls === 'land')).toBe(true);
    const c = r.calls[0]!;
    expect(c.sCoast_km).not.toBeNull();
    expect(c.landT!).toBeGreaterThan(c.seaT!);
    expect(c.jetU).toBeNull();
    expect(p.features.wind.U10).toBe(5);
  });
});

describe('samplePlace: features (§6.4)', () => {
  const bump = (sign: number) => (lo: number, la: number) => {
    const d = Math.hypot((lo - 0.3) * Math.cos(0.2), la - 0.2) * 6371;
    return sign * 15 * Math.exp(-((d / 40) ** 2));
  };
  it('exposure: a peak under the listener is exposed (> 0), a pit is sheltered (< 0)', () => {
    const peak = samplePlace(
      fakeEngine({ elev: bump(1), fly: { alt: 60 } }),
      air(),
      recorder().windAt,
    )!;
    const pit = samplePlace(
      fakeEngine({ elev: bump(-1), fly: { alt: 60 } }),
      air(),
      recorder().windAt,
    )!;
    expect(peak.features.exposure).toBeGreaterThan(0);
    expect(pit.features.exposure).toBeLessThan(0);
    expect(peak.features.relief).toBeGreaterThan(1);
    expect(peak.features.slope).toBeGreaterThan(0);
  });

  it('weather at the listener: rain, RH, phase by the freezing point, convection', () => {
    const wet = samplePlace(
      fakeEngine({ rain: 1.5, RH: 1, T: () => 310, elev: () => 0.5 }),
      air({ gamK: 0 }),
      recorder().windAt,
    )!;
    expect(wet.features.rainRate).toBeCloseTo(1.5, 6);
    expect(wet.features.RH).toBeCloseTo(1, 6);
    expect(wet.features.precipPhase).toBe('rain');
    expect(wet.features.cnv).toBeCloseTo(1, 6); // Tt + 28 < 310 K and RH 1
    expect(wet.features.cnvRing).toBeCloseTo(1, 6);
    const cold = samplePlace(fakeEngine({ rain: 1, T: () => 260 }), air(), recorder().windAt)!;
    expect(cold.features.precipPhase).toBe('snow');
    const dry = samplePlace(fakeEngine({ rain: 0 }), air(), recorder().windAt)!;
    expect(dry.features.precipPhase).toBe('none');
    const icy = samplePlace(fakeEngine({ iceH: 0.3 }), air(), recorder().windAt)!;
    expect(icy.features.iceCover).toBeCloseTo(1 - Math.exp(-0.3 / 0.15), 4);
  });

  it('Tloc applies the lapse to ground above sea level only (shader: max(h, 0))', () => {
    const hi = samplePlace(
      fakeEngine({ elev: () => 8, T: () => 300 }),
      air({ gamK: 6.5 }),
      recorder().windAt,
    )!;
    expect(hi.features.Tloc).toBeCloseTo(300 - 6.5 * hi.samples[0]!.h_km, 6);
    const lo = samplePlace(
      fakeEngine({ elev: () => -8, T: () => 300 }),
      air({ gamK: 6.5 }),
      recorder().windAt,
    )!;
    expect(lo.features.Tloc).toBeCloseTo(300, 6);
  });

  it('cyclone: nearest storm, Rm = 0.15 r, a calm eye inside 0.4 Rm', () => {
    const c = nearestCyclone(
      [
        { lon: 0.3, lat: 0.2, r: 0.1, s: 1 },
        { lon: 2, lat: 0.2, r: 0.1, s: 1 },
      ],
      0.3 + 0.004,
      0.2,
    )!;
    expect(c.Rm).toBeCloseTo(0.015, 12);
    expect(c.inEye).toBe(true);
    expect(c.delta).toBeCloseTo(0.004 * Math.cos(0.2), 4);
    expect(nearestCyclone([{ lon: 0.3, lat: 0.2, r: 0.1, s: 1 }], 0.32, 0.2)!.inEye).toBe(false);
    expect(nearestCyclone([], 0, 0)).toBeNull();
    const p = samplePlace(
      fakeEngine({ cyclones: [{ lon: 0.3, lat: 0.25, r: 0.08, s: 1 }] }),
      air(),
      recorder().windAt,
    )!;
    expect(p.features.cyclone!.r).toBe(0.08);
  });

  it.todo(
    'wind.ts (T2): the Rankine profile is calm in the eye and peaks at Rm; U(z) follows the log law upwards',
  );
});

describe('samplePlace: gas giants (§6.6)', () => {
  const field = new Float32Array(256 * 128 * 4);
  const [gi, gj] = cellOf(0.3, 0.2, 256, 128);
  field[(gj * 256 + gi) * 4 + 2] = -0.4;
  field[(gj * 256 + gi) * 4 + 3] = 0.8;
  const gasAir = air({ gas: true, presetId: 'jup', seed: 7, locked: false, oceanF: 0 });

  it('storm and vorticity at the listener cell, stormNear weighted by distance, jet from the zonal profile', () => {
    const r = recorder();
    const e = fakeEngine({ gas: true, gasField: field, fly: { lon: 0.3, lat: 0.2, alt: 100 } });
    const p = samplePlace(e, gasAir, r.windAt, { now: () => 0 })!;
    expect(p.samples).toEqual([]);
    expect(p.features.vort).toBeCloseTo(-0.4, 6);
    expect(p.features.stormNear).toBeCloseTo(0.8, 6);
    expect(p.features.cnv).toBeCloseTo(0.8, 6);
    const prof = gasProfile(
      { gas: true, U: 100, jets: 6 },
      { id: 'jup', seed: 7, locked: false },
    ) as {
      u: (l: number) => number;
    };
    expect(r.calls[0]!.jetU).toBeCloseTo(100 * prof.u(0.2), 9);
  });

  it('reads the gas field at most every 500 ms, and again when the air model is rebuilt', () => {
    const e = fakeEngine({ gas: true, gasField: field });
    let t = 0;
    const now = () => t;
    samplePlace(e, gasAir, recorder().windAt, { now });
    t = 400;
    samplePlace(e, gasAir, recorder().windAt, { now });
    expect(e.gasCalls).toBe(1);
    t = 500;
    samplePlace(e, gasAir, recorder().windAt, { now });
    expect(e.gasCalls).toBe(2);
    samplePlace(e, { ...gasAir }, recorder().windAt, { now });
    expect(e.gasCalls).toBe(3);
  });

  it('no gas field yet: neutral storms, still a wind', () => {
    const p = samplePlace(fakeEngine({ gas: true, gasField: null }), gasAir, recorder().windAt, {
      now: () => 0,
    })!;
    expect(p.features.stormNear).toBe(0);
    expect(p.features.wind.U10).toBe(5);
  });
});

describe('samplePlace: the height context follows the sliders (ruling 3)', () => {
  it('rebuilds when the lava state flips without a new terrain', () => {
    const model: Record<string, unknown> = { Ts: 600 };
    const e = fakeEngine({
      elev: () => 2,
      hydroLava: true,
      hydro: () => [0, 0, 0, 0],
      T: () => 1600,
      model,
    });
    const cool = samplePlace(e, air({ T0: 600 }), recorder().windAt)!;
    model.Ts = 1600;
    const warm = samplePlace(e, air({ T0: 1600, lavaWorld: true }), recorder().windAt)!;
    // the magma sea (hM = 0, T 1600 K, no crust) replaces the relief once the world is hot
    expect(Math.abs(cool.samples[0]!.h_km)).toBeGreaterThan(0.1);
    expect(warm.samples[0]!.h_km).toBe(0);
  });
});

describe('samplePlace: the engine may swap its EB arrays between ticks (#93 shared simulation source)', () => {
  it('a new EB.out2 (rain) is read on the next call, even while the heights are reused', () => {
    const e = fakeEngine({ rain: 0.5, fly: { alt: 5 } });
    const a = air();
    expect(samplePlace(e, a, recorder().windAt)!.features.rainRate).toBeCloseTo(0.5, 6);
    const out2 = new Float32Array(e.EB.out2.length);
    for (let k = 0; k < out2.length; k += 4) out2[k] = 2;
    e.EB.out2 = out2;
    expect(samplePlace(e, a, recorder().windAt)!.features.rainRate).toBeCloseTo(2, 6);
  });

  it('a new EB.out (T) reaches the magma-sea height on the next resample', () => {
    const e = fakeEngine({
      elev: () => 2,
      hydroLava: true,
      hydro: () => [0, 0, 0, 0],
      T: () => 1000,
      model: { Ts: 1600 },
    });
    const a = air({ T0: 1600, lavaWorld: true });
    const cool = samplePlace(e, a, recorder().windAt, { reuseFraction: 0 })!;
    expect(Math.abs(cool.samples[0]!.h_km)).toBeGreaterThan(0.1); // T 1000 K: below the 1400-1500 K magma ramp
    const out = new Float32Array(e.EB.out.length);
    for (let k = 0; k < out.length; k += 4) out[k] = 1600;
    e.EB.out = out;
    const hot = samplePlace(e, a, recorder().windAt, { reuseFraction: 0 })!;
    expect(hot.samples[0]!.h_km).toBe(0); // hM = 0: the magma sea
  });
});

describe('samplePlace: reuse and cost (ruling 5)', () => {
  const terrain = (lo: number, la: number) => 4 * Math.sin(lo * 9) * Math.cos(la * 7);

  it('the fused climate read equals fieldSampler.bspline for T, rain and RH', () => {
    const T = (lo: number, la: number) => 250 + 40 * Math.sin(lo * 3) * Math.cos(la * 2);
    const e = fakeEngine({
      elev: terrain,
      T,
      rain: 1,
      RH: 0.7,
      fly: { lon: 0.31, lat: 0.27, alt: 5 },
    });
    const p = samplePlace(e, air(), recorder().windAt)!;
    const c = e.cpuFields().climate!;
    for (const s of p.samples) {
      expect(s.T).toBeCloseTo(bspline(c.T, 1, c.NX, c.NY, s.lon, s.lat), 9);
      expect(s.rain).toBeCloseTo(1, 9);
    }
    expect(p.features.RH).toBeCloseTo(Math.fround(0.7), 9);
  });

  it('reuses the heights while the camera moves < 1 % of R and turns < 1 degree; recomputes otherwise', () => {
    const e = fakeEngine({ elev: terrain, fly: { lon: 0.3, lat: 0.2, alt: 5, head: 0.4 } });
    const a = air();
    const p0 = samplePlace(e, a, recorder().windAt)!;
    const R = reachKm(p0.features.z_km);
    e.fly.lon += (0.004 * R) / a.R_km; // 0.4 % of R
    const p1 = samplePlace(e, a, recorder().windAt)!;
    expect(p1.samples.map((s) => s.h_km)).toEqual(p0.samples.map((s) => s.h_km));
    expect(p1.samples[5]!.lon).toBe(p0.samples[5]!.lon);
    e.fly.lon += (0.02 * R) / a.R_km; // now 2.4 % of R from the cached place
    const p2 = samplePlace(e, a, recorder().windAt)!;
    expect(p2.samples[5]!.lon).not.toBe(p0.samples[5]!.lon);
    e.fly.head += 0.05; // about 3 degrees
    const p3 = samplePlace(e, a, recorder().windAt)!;
    expect(p3.samples[1]!.bearing).toBeCloseTo(e.fly.head, 12);
    const fresh = samplePlace(e, a, recorder().windAt, { reuseFraction: 0 })!;
    expect(fresh.samples[1]!.bearing).toBeCloseTo(e.fly.head, 12);
  });

  it('cost: full sampling, hovering and auto-flight at 10 Hz (logged; asserted loosely)', () => {
    const a = air({ oceanF: 0.7 });
    const r = recorder();
    const time = (e: ReturnType<typeof fakeEngine>, step: () => void, opts = {}) => {
      for (let i = 0; i < 20; i++) samplePlace(e, a, r.windAt, opts);
      const N = 300;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        step();
        samplePlace(e, a, r.windAt, opts);
      }
      return (performance.now() - t0) / N;
    };
    const full = fakeEngine({ elev: terrain, rain: 1, fly: { alt: 2 } });
    const msFull = time(full, () => (full.fly.lon += 1e-3), { reuseFraction: 0 });
    // hovering at 2 km (a paused demo, or the user looking around slowly): the drift stays inside 1 % of R
    const hover = fakeEngine({ elev: terrain, rain: 1, fly: { alt: 2 } });
    const msHover = time(hover, () => (hover.fly.lon += 1e-9));
    // auto-flight (tickNow: max(0.4 alt, 4) km/s), sampled at 10 Hz: 0.4 km a tick at 2 km, so every tick resamples
    const fly = fakeEngine({ elev: terrain, rain: 1, fly: { alt: 2 } });
    const msFly = time(fly, () => (fly.fly.lon += 0.4 / 6371));
    console.info(
      `[place] ms per samplePlace: full ${msFull.toFixed(3)}, hovering ${msHover.toFixed(3)}, auto-flight ${msFly.toFixed(3)}`,
    );
    expect(msFull).toBeLessThanOrEqual(2);
    expect(msHover).toBeLessThanOrEqual(msFull);
  });
});
