// Issue #114 (sound spec §6.2-6.4, §6.6): the place around the listener. It takes 37 samples on the drawn surface
// (flyHeight.hKm, the fly view's own height) and gives each a class (land, sea, ice, river, lake, lava, crust) and a coast
// flag. It works out the features the beds and the weather read, and the wind at the listener through an injected
// `windAt` (wind.ts, ticket T2).
// Grid conventions (engine): row 0 = south pole, column 0 = lon -pi; lon = atan2(z, x), lat = asin(y).
// Local frame (contract amendment 3): up = (cos lat cos lon, sin lat, cos lat sin lon), east = normalize(cross(Y, up)),
// north = cross(up, east); bearings run clockwise from north towards that east, as fly.head does.
// Provenance: heights and classes come from `artistic` engine fields; weather features are `model_dependent` engine
// state. Nothing here invents a physical value: a missing field gives a neutral feature (0, 'none' or null). Nothing
// here gates on air either (ruling R6: acoustic air is AirModel.airOK, which the beds and levels apply).
import { bspline } from '@/engine/worlds/fieldSampler';
import { hKm, makeFlyHeightCtx, type FlyHeightCtx, type Vec3 } from '@/engine/worlds/flyHeight';
import { gasProfile } from '@/engine/worlds/gas.js';
import type {
  AirModel,
  Place,
  PlaceFeatures,
  PlaceSample,
  SampleClass,
  WindResult,
  WorldEngineLike,
} from './types';

/** The ctx `windAt` receives (Appendix B, wind.ts row, amendment 1). */
export interface WindCtx {
  exposure: number;
  relief: number;
  z_km: number;
  cyclone: PlaceFeatures['cyclone'];
  /** Area-weighted mean climate T (K) of the land (land, river) and sea (sea, lake) samples; null when there are none. */
  landT: number | null;
  seaT: number | null;
  /** Ground distance to the nearest coast-zone sample, km; null when no sample is in the coast zone. */
  sCoast_km: number | null;
  overSea: boolean;
  /** Gas giants: m.U * gasProfile(m, preset).u(lat), m/s (signed, as the profile); null on rocky worlds. */
  jetU: number | null;
}

export type WindAt = (air: AirModel, lon: number, lat: number, ctx: WindCtx) => WindResult;

// ASSUMPTION: these live here until T6 moves them into tuning.ts (T2 owns that file).
/** §6.2 ring radii as fractions of the reach R. */
export const RING_FRACTIONS = [0.25, 0.5, 1] as const;
/** §6.2 sector edges (fractions of R): centre disc to 0.125, rings 0.125-0.375, 0.375-0.75, 0.75-1.25. */
export const RING_EDGES = [0, 0.125, 0.375, 0.75, 1.25] as const;
export const BEARINGS = 12;
/** §6.2 D_MIN: the centre sample's smallest slant distance. ASSUMPTION: §17 gives no value; 2 m, ear height. CREATIVE. */
export const D_MIN_M = 2;
/** §17 GAS_FIELD_MS: the gas field is read at most this often. */
export const GAS_FIELD_MS = 500;
/** §6.5 item 7, §17 RANKINE_RM: the radius of maximum wind as a fraction of the storm radius. */
export const RANKINE_RM = 0.15;
/** §6.4 slope: central differences at +-0.5 km. */
export const SLOPE_STEP_KM = 0.5;
/** core.js flyCamera: the rocky fly view draws relief x3 (gas x2). */
export const FLY_EX_ROCKY = 3;
/** Gas field grid (gas.js GasSim: NX 256, NY 128). */
const GNX = 256,
  GNY = 128;

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The engine frame at (lon, lat): up, east (= normalize(cross(Y, up))) and north (= cross(up, east)). */
export function localFrame(lon: number, lat: number): { up: Vec3; east: Vec3; north: Vec3 } {
  const cl = Math.cos(lat);
  const up: Vec3 = [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
  // cross([0,1,0], up) = (up.z, 0, -up.x)
  const l = Math.hypot(up[2], up[0]) || 1;
  const east: Vec3 = [up[2] / l, 0, -up[0] / l];
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return { up, east, north };
}

/** The point at ground distance s_km, bearing b (radians clockwise from north) from (lon, lat): a great-circle step. */
export function destination(
  lon: number,
  lat: number,
  bearing: number,
  s_km: number,
  R_km: number,
): { dir: Vec3; lon: number; lat: number } {
  const { up, east, north } = localFrame(lon, lat);
  const sig = s_km / R_km,
    cs = Math.cos(sig),
    sn = Math.sin(sig),
    cb = Math.cos(bearing),
    sb = Math.sin(bearing);
  const d: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) d[k] = up[k]! * cs + (north[k]! * cb + east[k]! * sb) * sn;
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= n;
  d[1] /= n;
  d[2] /= n;
  return { dir: d, lon: Math.atan2(d[2], d[0]), lat: Math.asin(clamp(d[1], -1, 1)) };
}

/** One sample position of the §6.2 pattern (geometry only). */
export interface RingPoint {
  /** 0 = centre, 1..3. */
  ring: number;
  /** Bearing index 0..11 (0 for the centre). */
  k: number;
  s_km: number;
  bearing: number;
  area_m2: number;
  dir: Vec3;
  lon: number;
  lat: number;
}

/** §6.2 reach R (km) for a listener z km above the ground. */
export const reachKm = (z_km: number): number => clamp(4 * z_km + 2, 2, 400);

/** §6.2: the centre and 3 rings x 12 bearings from `head`, with their sector areas. Pure. */
export function ringGeometry(
  lon: number,
  lat: number,
  head: number,
  R: number,
  R_km: number,
): RingPoint[] {
  const pts: RingPoint[] = [];
  const centreArea = Math.PI * (RING_EDGES[1] * R) ** 2 * 1e6;
  const { up } = localFrame(lon, lat);
  pts.push({ ring: 0, k: 0, s_km: 0, bearing: head, area_m2: centreArea, dir: up, lon, lat });
  for (let r = 1; r <= 3; r++) {
    const s = RING_FRACTIONS[r - 1]! * R;
    const area =
      (Math.PI * ((RING_EDGES[r + 1]! * R) ** 2 - (RING_EDGES[r]! * R) ** 2) * 1e6) / BEARINGS;
    for (let k = 0; k < BEARINGS; k++) {
      const b = head + (k * TAU) / BEARINGS;
      const p = destination(lon, lat, b, s, R_km);
      pts.push({
        ring: r,
        k,
        s_km: s,
        bearing: b,
        area_m2: area,
        dir: p.dir,
        lon: p.lon,
        lat: p.lat,
      });
    }
  }
  return pts;
}

/** Index of (ring, k) in the ringGeometry array. */
const idx = (ring: number, k: number): number =>
  ring === 0 ? 0 : 1 + (ring - 1) * BEARINGS + (((k % BEARINGS) + BEARINGS) % BEARINGS);

/** Nearest cell (i, j) of a lon/lat grid, longitude wrapped, latitude clamped (row 0 south, column 0 lon -pi). */
export function cellOf(lon: number, lat: number, W: number, H: number): [number, number] {
  const i = Math.floor((lon / TAU + 0.5) * W);
  const j = Math.floor((lat / Math.PI + 0.5) * H);
  return [((i % W) + W) % W, clamp(j, 0, H - 1)];
}

interface Hydro {
  img: ArrayLike<number>;
  RW: number;
  RH: number;
  lava?: boolean;
}

/** RGBA of the hydro raster at the nearest texel (offset di, dj texels). */
function hydroAt(
  h: Hydro,
  lon: number,
  lat: number,
  di = 0,
  dj = 0,
): [number, number, number, number] {
  const [i0, j0] = cellOf(lon, lat, h.RW, h.RH);
  const i = (((i0 + di) % h.RW) + h.RW) % h.RW,
    j = clamp(j0 + dj, 0, h.RH - 1);
  const o = (j * h.RW + i) * 4;
  return [h.img[o]!, h.img[o + 1]!, h.img[o + 2]!, h.img[o + 3]!];
}

/** Per-world inputs the sampler reads, rebuilt when its key changes (coordinator ruling 3). */
interface WorldCache {
  key: string;
  terr: unknown;
  hyd: unknown;
  ctx: FlyHeightCtx;
  Tt: number;
}
/** The last rocky Place's height work, reused while the camera stays within REUSE_FRACTION of R (blue 15, ruling 5). */
interface Heights {
  world: WorldCache;
  lon: number;
  lat: number;
  head: number;
  z: number;
  R: number;
  geo: RingPoint[];
  hs: number[];
  slope: number;
}
interface EngineCache {
  world: WorldCache | null;
  heights: Heights | null;
  gasF: { air: AirModel; t: number; f: Float32Array | null } | null;
  prof: { key: string; air: AirModel; U: number; u: (lat: number) => number } | null;
}
const caches = new WeakMap<object, EngineCache>();

/**
 * The engine surface samplePlace reads: the contract's WorldEngineLike plus the spin-up counter (WorldEngine.spinup).
 * Kept local (ruling 6); the contract change waits for #116.
 */
export type WorldEngineWithSpinup = WorldEngineLike & { readonly spinup: number };

/** Ruling 5: reuse the last rings' heights while the camera moved less than this fraction of R and turned < 1 degree. */
export const REUSE_FRACTION = 0.01;
const REUSE_HEAD_RAD = Math.PI / 180;

function worldFor(e: WorldEngineWithSpinup, air: AirModel, c: EngineCache): WorldCache {
  const st = e.state();
  const f = e.cpuFields();
  const hyd = f.hydro as Hydro | null;
  const terr = f.terrain?.data ?? null;
  // The shader's own flags: uOcean uses the engine's airless (core.js worldModel: !gas && Ps < 0.02), uLava m.Ts > 700.
  const airless = !st.gas && st.Ps < 0.02;
  const key = [
    st.Ps,
    st.fluid,
    st.gas,
    airless,
    // uLava is m.Ts > 700; AirModel.T0 is m.Ts on rocky worlds (#112 airModel), rebuilt on the §9.6 triggers
    !st.gas && air.T0 > 700,
    !!hyd?.lava,
    air.oceanF,
    air.seed3.join(','),
  ].join('|');
  const w = c.world;
  if (w && w.key === key && w.terr === terr && w.hyd === hyd) return w;
  const ctx = makeFlyHeightCtx(e, air.seed3, { oceanF: air.oceanF });
  const m = e.readouts().model ?? {};
  const Tt = Number(m.F?.Tt ?? NaN);
  c.world = { key, terr, hyd, ctx, Tt };
  return c.world;
}

/**
 * §6.2-6.6: the place around the fly listener. Returns null while the world spins up (coordinator ruling 2), because the
 * hydro raster and the climate still belong to the previous world then.
 */
export function samplePlace(
  e: WorldEngineWithSpinup,
  air: AirModel,
  windAt: WindAt,
  opts: { now?: () => number; reuseFraction?: number } = {},
): Place | null {
  if (e.spinup > 0) return null;
  let c = caches.get(e);
  if (!c) caches.set(e, (c = { world: null, heights: null, gasF: null, prof: null }));
  if (air.gas) return gasPlace(e, air, windAt, c, opts.now ?? (() => performance.now()));

  const fly = e.fly;
  const lon = fly.lon,
    lat = fly.lat,
    head = fly.head;
  const w = worldFor(e, air, c);
  const ctx = w.ctx;
  // The engine may swap its EB arrays (T, rain, out, out2) for a shared source's between ticks (#93 simulation merge),
  // so no EB array reference is kept across calls: the weather is re-read here, and the cached height ctx gets the
  // current EB.out (the magma-sea T) for every height computed from now on. Heights reused from an earlier call (below)
  // keep the magma level of that call until the next resample; the magma T changes slowly, so this is accepted.
  const wf = e.weatherFields();
  ctx.ebOut = wf ? wf.out : null;
  ctx.ebNX = wf ? wf.NX : 0;
  ctx.ebNY = wf ? wf.NY : 0;
  const H = heightsFor(e, air, c, w, lon, lat, head, opts.reuseFraction ?? REUSE_FRACTION);
  const { geo, hs, z } = H;
  const f = e.cpuFields();
  const clim = f.climate as { NX: number; NY: number; T: Float32Array } | null;
  const hyd = f.hydro as Hydro | null;
  const lavaW = air.lavaWorld && !!hyd?.lava;

  const samples: PlaceSample[] = [];
  const cnvs: number[] = [];
  for (let n = 0; n < geo.length; n++) {
    const g = geo[n]!;
    const h = hs[n]!;
    const seaCand = ctx.ocean && h <= 0.001;
    let cls: SampleClass = 'land';
    let riverQ = 0;
    const px = hyd && hyd.RW > 0 ? hydroAt(hyd, g.lon, g.lat) : null;
    if (lavaW && px && px[0] >= 128) cls = 'lava';
    else if (lavaW && px && px[1] >= 128) cls = 'crust';
    else if (seaCand && wf && bspline(wf.iceH, 1, wf.NX, wf.NY, g.lon, g.lat) > 0.02) cls = 'ice';
    else if (seaCand) cls = 'sea';
    else if (!hyd?.lava && px && px[0] >= 128 && px[3] < 128) {
      cls = isBasin(hyd!, g.lon, g.lat) ? 'lake' : 'river';
      riverQ = px[0] / 255; // ASSUMPTION: the raster's water strength as a 0..1 flow proxy (artistic)
    }
    const vent = !!(lavaW && px && px[3] >= 128);
    // one set of B-spline weights for the climate T and the weather grids (the same NX x NY cells)
    climateAt(clim, wf, g.lon, g.lat);
    // the fly shader's lapse: Tl = T - uGam * max(h, 0)
    const T = clim ? BS.T - air.gamK * Math.max(h, 0) : air.T0;
    const rain = wf ? clamp(BS.rain, 0, 3) : 0;
    const RH = wf ? BS.RH : 0;
    cnvs.push(
      wf && Number.isFinite(w.Tt)
        ? smoothstep(w.Tt + 12, w.Tt + 28, T) * smoothstep(0.6, 1, RH)
        : 0,
    );
    const d_m = n === 0 ? Math.max(z * 1000, D_MIN_M) : 1000 * Math.hypot(z, g.s_km);
    samples.push({
      lon: g.lon,
      lat: g.lat,
      s_km: g.s_km,
      bearing: g.bearing,
      d_m,
      area_m2: g.area_m2,
      h_km: h,
      cls,
      coast: false,
      rain,
      T,
      riverQ,
      vent,
    });
  }
  markCoast(samples);
  const features = rockyFeatures(samples, cnvs, air, w, H.slope, z, lon, lat, wf, windAt);
  return { lon, lat, head, samples, features };
}

/**
 * The 37 sample positions and heights, and the slope (4 more hKm calls). They are reused from the previous call while
 * the camera stays within `frac` of R and turns less than 1 degree, so a hovering or slowly moving listener costs no hKm
 * calls; the classes and the weather are still read on every call. ASSUMPTION (blue 20): the centre height uses the
 * Catmull-Rom (shaded) read, while the GPU march hits the bilinear surface. They agree on texels and differ by a fraction
 * of a texel's relief, which is negligible for z. Do not switch it to bilinear.
 */
function heightsFor(
  e: WorldEngineWithSpinup,
  air: AirModel,
  c: EngineCache,
  w: WorldCache,
  lon: number,
  lat: number,
  head: number,
  frac: number,
): Heights {
  // ASSUMPTION (red 9): flyCamera puts the eye at ex * groundKm (the nearest raw cell) + alt above the radius, and the
  // drawn surface is at ex * hKm, so the eye's gap above the drawn ground is alt + ex * (groundKm - hKm).
  const zOf = (hc: number): number =>
    Math.max(e.fly.alt + FLY_EX_ROCKY * (e.groundKm(lon, lat) - hc), D_MIN_M / 1000);
  const p = c.heights;
  if (p && p.world === w && frac > 0) {
    // z (so R and the rings) follows fly.alt on every call (PR #122 review 1): reuse only while R and the foot point
    // both stay within frac of R and the heading within 1 degree.
    const z = zOf(p.hs[0]!);
    const R = reachKm(z);
    const moved = angDist(lon, lat, p.lon, p.lat) * air.R_km;
    const turn = Math.abs(((((head - p.head + Math.PI) % TAU) + TAU) % TAU) - Math.PI);
    if (Math.abs(R - p.R) < frac * p.R && moved < frac * p.R && turn < REUSE_HEAD_RAD)
      return { ...p, z };
  }
  const ctx = w.ctx;
  const { up } = localFrame(lon, lat);
  const hc = hKm(up, ctx);
  const z = zOf(hc);
  const R = reachKm(z);
  const geo = ringGeometry(lon, lat, head, R, air.R_km);
  const hs = geo.map((g, n) => (n === 0 ? hc : hKm(g.dir, ctx)));
  // slope: central differences at +-0.5 km along the engine's north and east (rise / run, both km)
  const at = (b: number): number => hKm(destination(lon, lat, b, SLOPE_STEP_KM, air.R_km).dir, ctx);
  const gN = (at(0) - at(Math.PI)) / (2 * SLOPE_STEP_KM),
    gE = (at(Math.PI / 2) - at(-Math.PI / 2)) / (2 * SLOPE_STEP_KM);
  c.heights = { world: w, lon, lat, head, z, R, geo, hs, slope: Math.hypot(gN, gE) };
  return c.heights;
}

/** Cubic B-spline weights (fieldSampler's, Sigg and Hadwiger 2005) for fraction f, into a reused 4-array. */
function bw4(f: number, o: Float64Array): void {
  const f2 = f * f,
    f3 = f2 * f;
  o[0] = (1 - 3 * f + 3 * f2 - f3) / 6;
  o[1] = (4 - 6 * f2 + 3 * f3) / 6;
  o[2] = (1 + 3 * f + 3 * f2 - 3 * f3) / 6;
  o[3] = f3 / 6;
}
const WX = new Float64Array(4),
  WY = new Float64Array(4);
const BS = { T: 0, rain: 0, RH: 0 };

/**
 * Climate T, rain (out2 channel 0) and RH (out channel 3) at (lon, lat) into BS. Each value is the B-spline that
 * fieldSampler.bspline gives (wrap in longitude, clamp at the poles), computed with one set of weights because the three
 * grids share the NX x NY cells.
 */
function climateAt(
  clim: { NX: number; NY: number; T: Float32Array } | null,
  wf: { NX: number; NY: number; out: Float32Array; out2: Float32Array } | null,
  lon: number,
  lat: number,
): void {
  BS.T = BS.rain = BS.RH = 0;
  const NX = wf?.NX ?? clim?.NX,
    NY = wf?.NY ?? clim?.NY;
  if (!NX || !NY) return;
  if (clim && wf && (clim.NX !== NX || clim.NY !== NY)) {
    BS.T = bspline(clim.T, 1, clim.NX, clim.NY, lon, lat);
    BS.rain = bspline(wf.out2, 4, NX, NY, lon, lat);
    BS.RH = bspline(wf.out.subarray(3), 4, NX, NY, lon, lat);
    return;
  }
  const px = (lon / TAU + 0.5) * NX - 0.5,
    py = (lat / Math.PI + 0.5) * NY - 0.5;
  const x0 = Math.floor(px),
    y0 = Math.floor(py);
  bw4(px - x0, WX);
  bw4(py - y0, WY);
  let T = 0,
    rain = 0,
    RH = 0;
  for (let b = 0; b < 4; b++) {
    const y = clamp(y0 - 1 + b, 0, NY - 1);
    let rT = 0,
      rR = 0,
      rH = 0;
    for (let a = 0; a < 4; a++) {
      const k = y * NX + ((((x0 - 1 + a) % NX) + NX) % NX);
      const wa = WX[a]!;
      if (clim) rT += wa * clim.T[k]!;
      if (wf) {
        rR += wa * wf.out2[k * 4]!;
        rH += wa * wf.out[k * 4 + 3]!;
      }
    }
    T += WY[b]! * rT;
    rain += WY[b]! * rR;
    RH += WY[b]! * rH;
  }
  BS.T = T;
  BS.rain = rain;
  BS.RH = RH;
}

/**
 * ASSUMPTION (§6.3 leaves "basin cell" undefined): a lake is water wider than a river line, i.e. hydro R >= 128
 * (A < 128) also one texel away in all four directions. Rivers are drawn 1-2 texels wide, and basins as discs about a
 * terrain cell wide.
 */
function isBasin(h: Hydro, lon: number, lat: number): boolean {
  for (const [di, dj] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const p = hydroAt(h, lon, lat, di, dj);
    if (!(p[0] >= 128 && p[3] < 128)) return false;
  }
  return true;
}

const SEA = new Set<SampleClass>(['sea']);
const SHORE = new Set<SampleClass>(['land', 'ice']);

/**
 * §6.3 coast zone: a sea sample next to land or ice, or the reverse. The neighbours are the same ring (±1 bearing) and
 * the same bearing on the next ring; the centre's neighbours are all of ring 1.
 */
export function markCoast(s: PlaceSample[]): void {
  const neigh = (ring: number, k: number): number[] => {
    if (ring === 0) return Array.from({ length: BEARINGS }, (_, b) => idx(1, b));
    const out = [idx(ring, k - 1), idx(ring, k + 1), ring === 1 ? 0 : idx(ring - 1, k)];
    if (ring < 3) out.push(idx(ring + 1, k));
    return out;
  };
  for (let n = 0; n < s.length; n++) {
    const ring = n === 0 ? 0 : 1 + Math.floor((n - 1) / BEARINGS);
    const k = n === 0 ? 0 : (n - 1) % BEARINGS;
    const me = s[n]!.cls;
    if (!SEA.has(me) && !SHORE.has(me)) continue;
    const other = SEA.has(me) ? SHORE : SEA;
    s[n]!.coast = neigh(ring, k).some((m) => other.has(s[m]!.cls));
  }
}

function angDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const c =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2);
  return Math.acos(clamp(c, -1, 1));
}

/** §6.4 cyclone: the nearest EB.cyc entry, its radius of maximum wind Rm = 0.15 r and the calm eye (delta < 0.4 Rm). */
export function nearestCyclone(
  cyc: { lon: number; lat: number; r: number; s: number }[],
  lon: number,
  lat: number,
): PlaceFeatures['cyclone'] {
  let best: PlaceFeatures['cyclone'] = null;
  for (const c of cyc) {
    const delta = angDist(lon, lat, c.lon, c.lat);
    if (!best || delta < best.delta) {
      const Rm = RANKINE_RM * c.r;
      best = { delta, r: c.r, Rm, inEye: delta < 0.4 * Rm };
    }
  }
  return best;
}

function rockyFeatures(
  s: PlaceSample[],
  cnvs: number[],
  air: AirModel,
  w: WorldCache,
  slope: number,
  z: number,
  lon: number,
  lat: number,
  wf: ReturnType<WorldEngineLike['weatherFields']>,
  windAt: WindAt,
): PlaceFeatures {
  const hs = s.map((p) => p.h_km);
  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  const relief = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
  const ring1 = s.slice(1, 1 + BEARINGS);
  const m1 = ring1.reduce((a, p) => a + p.h_km, 0) / ring1.length;
  const exposure = clamp((s[0]!.h_km - m1) / Math.max(relief, 0.05), -1, 1);

  let snowCover = 0,
    iceCover = 0,
    rainRate = 0,
    RH = 0;
  if (wf) {
    snowCover = 1 - Math.exp(-Math.max(bspline(wf.snow, 1, wf.NX, wf.NY, lon, lat), 0) / 0.05);
    iceCover = 1 - Math.exp(-Math.max(bspline(wf.iceH, 1, wf.NX, wf.NY, lon, lat), 0) / 0.15);
    climateAt(null, wf, lon, lat);
    rainRate = clamp(BS.rain, 0, 3);
    RH = BS.RH;
  }
  const Tloc = s[0]!.T;
  const cnv = cnvs[0] ?? 0;
  let aw = 0,
    ac = 0;
  for (let n = 0; n < s.length; n++) {
    aw += s[n]!.area_m2;
    ac += s[n]!.area_m2 * (cnvs[n] ?? 0);
  }
  const cnvRing = aw > 0 ? ac / aw : 0; // §8.3 cnv_ring: the area-weighted mean
  // ebStep: Tf = Tt - 1.9 for water, else Tt. ASSUMPTION: no rain (or no weather yet) gives 'none'.
  const Tf = w.Tt - (air.fluid === 'water' ? 1.9 : 0);
  const precipPhase: PlaceFeatures['precipPhase'] =
    !wf || rainRate <= 1e-3 || !Number.isFinite(Tf) ? 'none' : Tloc < Tf ? 'snow' : 'rain';
  const cyclone = wf ? nearestCyclone(wf.cyclones, lon, lat) : null;

  const meanT = (pred: (p: PlaceSample) => boolean): number | null => {
    let a = 0,
      t = 0;
    for (const p of s)
      if (pred(p)) {
        a += p.area_m2;
        t += p.area_m2 * p.T;
      }
    return a > 0 ? t / a : null;
  };
  let sCoast: number | null = null;
  for (const p of s) if (p.coast && (sCoast === null || p.s_km < sCoast)) sCoast = p.s_km;
  const ctxW: WindCtx = {
    exposure,
    relief,
    z_km: z,
    cyclone,
    landT: meanT((p) => p.cls === 'land' || p.cls === 'river'),
    seaT: meanT((p) => p.cls === 'sea' || p.cls === 'lake'),
    sCoast_km: sCoast,
    overSea: s[0]!.cls === 'sea' || s[0]!.cls === 'lake',
    jetU: null,
  };
  return {
    z_km: z,
    relief,
    exposure,
    slope,
    snowCover,
    iceCover,
    rainRate,
    RH,
    Tloc,
    cnv,
    cnvRing,
    precipPhase,
    cyclone,
    stormNear: 0,
    vort: 0,
    wind: windAt(air, lon, lat, ctxW),
  };
}

/** §6.6: a gas giant has no surface classes; its storms come from the gas field and its jet from the zonal profile. */
function gasPlace(
  e: WorldEngineWithSpinup,
  air: AirModel,
  windAt: WindAt,
  c: EngineCache,
  now: () => number,
): Place {
  const fly = e.fly;
  const lon = fly.lon,
    lat = fly.lat,
    head = fly.head;
  const t = now();
  // The field is live (GasSim's own buffer): re-read at most every 500 ms, and when the air model is rebuilt.
  if (!c.gasF || c.gasF.air !== air || t - c.gasF.t >= GAS_FIELD_MS)
    c.gasF = { air, t, f: e.gasField() };
  const field = c.gasF.f;
  const z = fly.alt;
  const R = reachKm(z);
  let vort = 0,
    stormNear = 0;
  if (field) {
    const read = (lo: number, la: number, ch: number): number => {
      const [i, j] = cellOf(lo, la, GNX, GNY);
      return field[(j * GNX + i) * 4 + ch] ?? 0;
    };
    vort = read(lon, lat, 2);
    for (const g of ringGeometry(lon, lat, head, R, air.R_km))
      stormNear = Math.max(stormNear, read(g.lon, g.lat, 3) * Math.exp(-((g.s_km / R) ** 2)));
  }
  // Jet at the listener's latitude: m.U * gasProfile(m, {id, seed, locked}).u(lat), with the profile cached per world.
  const pkey = air.presetId + '|' + air.seed + '|' + air.locked;
  if (!c.prof || c.prof.key !== pkey || c.prof.air !== air) {
    const m = e.readouts().model ?? {};
    const prof = gasProfile(m, { id: air.presetId, seed: air.seed, locked: air.locked }) as {
      u: (lat: number) => number;
    };
    // refuse rather than invent: no model wind scale gives jetU null (windAt then reports no wind), never 0
    c.prof = { key: pkey, air, U: Number.isFinite(m.U) ? Number(m.U) : NaN, u: prof.u };
  }
  const jetU = Number.isFinite(c.prof.U) ? c.prof.U * c.prof.u(lat) : null;
  const cnvG = clamp(stormNear, 0, 1);
  const ctxW: WindCtx = {
    exposure: 0,
    relief: 0,
    z_km: z,
    cyclone: null,
    landT: null,
    seaT: null,
    sCoast_km: null,
    overSea: false,
    jetU,
  };
  return {
    lon,
    lat,
    head,
    samples: [],
    features: {
      z_km: z,
      relief: 0,
      exposure: 0,
      slope: 0,
      snowCover: 0,
      iceCover: 0,
      rainRate: 0,
      RH: 0,
      Tloc: air.T0,
      cnv: cnvG,
      cnvRing: cnvG,
      precipPhase: 'none',
      cyclone: null,
      stormNear: cnvG,
      vort,
      wind: windAt(air, lon, lat, ctxW),
    },
  };
}
