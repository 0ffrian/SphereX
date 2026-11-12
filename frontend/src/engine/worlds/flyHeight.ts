// Issue #114 (sound spec §6.1): the fly view's surface height on the CPU, so the sound samples the surface the picture
// draws. This is a line-by-line port of FLY_FS `hKm` as it runs after shaders.js noUnroll() and the #93 patterns()
// edits: the uSeed3 offsets, the two-octave vn3 coastline warp, the Catmull-Rom height read (crs, when HQ) or the bilinear
// read, ridge + slope-damped fBm (efbm) + fBm detail, the hot-world magma sea (uLava, uHM) and the ocean clamp.
//
// Precision: GLSL highp is float32. Every step inside h33 is rounded with Math.fround: the hash is chaotic, so one lost
// bit changes it. The noise lattice arguments are rounded too, so floor() picks the same cell and the hash gets the same
// bits. The hash's dot product is emulated as the GPU's fused multiply-add chain (dot3, measured); nowhere else is FMA
// emulated. Interpolation is continuous, so the GPU's own rounding moves the result by ulps only.
// ASSUMPTION: mix(x, y, a) = x + (y - x) * a (HLSL lerp, ANGLE D3D11).
//
// The GPU textures, emulated here: uHt is RG16F (half float, core.js setTerrain), so the heights are rounded to half once
// per terrain; uEb is RGBA16F (EB.out); uHy is RGBA8 (the hydro raster). For the measured parity, see
// scripts/engine-bench/flyheight.html and flyHeight.test.ts.
// Provenance: the heights are `artistic` (procedural terrain, as the picture).
import { catmullRom } from './fieldSampler';

export type Vec3 = [number, number, number];

/** What makeFlyHeightCtx reads from an engine (WorldEngine and the sound tests' fakes satisfy it). */
export interface FlyHeightSource {
  cpuFields(): { terrain: any; climate: any; hydro: any };
  weatherFields(): { NX: number; NY: number; out: Float32Array } | null;
  readouts(): { model: any };
  state(): { Ps: number; gas: boolean };
}

export interface FlyHeightCtx {
  /** uSeed3. */
  seed3: Vec3;
  /** Terrain heights (km), channel 0 only, rounded to half float as the RG16F texture holds them. Null: no terrain. */
  h16: Float32Array | null;
  W: number;
  H: number;
  /** uOcean: oceanF > 0 and air (core.js draw: OCEANF[id] > 0 && !m.airless). */
  ocean: boolean;
  /** uLava: lavaWorld(m) = !m.gas && m.Ts > 700. */
  lava: boolean;
  /** uHM: W.hydro.lava ? W.hydro.hM : 0. */
  hM: number;
  /** EB.out (channel 0 = T), for the magma-sea test; null before the budget is ready. */
  ebOut: Float32Array | null;
  ebNX: number;
  ebNY: number;
  /** Hydro raster RGBA8; null before the first raster (the GPU then has a 1 x 1 zero texture). */
  hydro: { img: ArrayLike<number>; RW: number; RH: number } | null;
  /** True: Catmull-Rom read (the shaded height, HQ in FLY_FS); false: the bilinear read of the march. */
  hq: boolean;
  /** Gas giant: no surface (hKm returns 0, like core.groundKm). */
  gas: boolean;
}

const F = Math.fround;
const TAU = 6.2831853; // FLY_FS: const float TAU=6.2831853
const PI = 3.14159265; // FLY_FS: const float PI=3.14159265

/** Half-float rounding (round to nearest, ties to even), as a FLOAT upload into an RG16F / RGBA16F texture stores it. */
export const f16round: (x: number) => number =
  typeof (Math as { f16round?: (x: number) => number }).f16round === 'function'
    ? (Math as unknown as { f16round: (x: number) => number }).f16round
    : f16roundFallback;

export function f16roundFallback(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 65520) return x > 0 ? Infinity : -Infinity; // 65504 + half an ulp (16) rounds up to infinity
  const e = Math.max(Math.floor(Math.log2(a)), -14);
  const ulp = 2 ** (e - 10);
  let q = a / ulp;
  const fl = Math.floor(q);
  const d = q - fl;
  q = d > 0.5 || (d === 0.5 && fl % 2 === 1) ? fl + 1 : fl;
  return Math.sign(x) * q * ulp;
}

// ---- noise (NOISE in shaders.js, float32) ----
const K1 = F(0.1031),
  K2 = F(0.103),
  K3 = F(0.0973),
  K33 = F(33.33);

/**
 * dot(p, q) as the GPU computes it: a fused multiply-add chain, fma(z, qz, fma(y, qy, x * qx)), one rounding per step.
 * Measured on ANGLE D3D11 (NVIDIA RTX 4060 Ti, flyheight.html): with this order the CPU hKm matches the GPU to about
 * 1e-5 km. With separately rounded products and sums, a hash bit flipped in 1 to 3 of 64 directions (errors up to 0.1 km).
 * A float32 product is exact in a double, so F(a * b + c) is one fused float32 rounding (except for a rare double rounding).
 * ASSUMPTION: the fused multiply-add emulation is assumed for ANGLE D3D11 (measured on one NVIDIA card only). Re-check
 * it on the A15 event laptop with the dev parity page (scripts/engine-bench/flyheight.html) before relying on it.
 */
function dot3(a: number, b: number, c: number, d: number, e: number, f: number): number {
  return F(e * f + F(c * d + F(a * b)));
}

const fr = (x: number): number => F(x - Math.floor(x)); // fract; exact in float32
let hx = 0,
  hy = 0,
  hz = 0;

/** h33(p) into (hx, hy, hz). p must already be float32 values. */
function h33(px: number, py: number, pz: number): void {
  const x = fr(F(px * K1)),
    y = fr(F(py * K2)),
    z = fr(F(pz * K3));
  // p += dot(p, p.yxz + 33.33)
  const d = dot3(x, F(y + K33), y, F(x + K33), z, F(z + K33));
  const X = F(x + d),
    Y = F(y + d),
    Z = F(z + d);
  // fract((p.xxy + p.yxx) * p.zyx)
  hx = fr(F(F(X + Y) * Z));
  hy = fr(F(F(X + X) * Y));
  hz = fr(F(F(Y + X) * X));
}

/** h33(p).x only (what vn and vnd read): the same steps, without the y and z outputs. */
export function h33x(px: number, py: number, pz: number): number {
  const x = fr(F(px * K1)),
    y = fr(F(py * K2)),
    z = fr(F(pz * K3));
  const d = dot3(x, F(y + K33), y, F(x + K33), z, F(z + K33));
  return fr(F(F(F(x + d) + F(y + d)) * F(z + d)));
}

/** h33 as a vector (tests). */
export function h33v(px: number, py: number, pz: number): Vec3 {
  h33(F(px), F(py), F(pz));
  return [hx, hy, hz];
}

const mix = (a: number, b: number, t: number): number => F(a + F(F(b - a) * t));
const smooth = (f: number): number => F(F(f * f) * F(3 - F(2 * f)));

/** vn(x): value noise. Arguments float32. */
function vn(x: number, y: number, z: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const ux = smooth(fr(x)),
    uy = smooth(fr(y)),
    uz = smooth(fr(z));
  const a = h33x(ix, iy, iz),
    b = h33x(ix + 1, iy, iz),
    c = h33x(ix, iy + 1, iz),
    d = h33x(ix + 1, iy + 1, iz),
    e = h33x(ix, iy, iz + 1),
    f = h33x(ix + 1, iy, iz + 1),
    g = h33x(ix, iy + 1, iz + 1),
    h = h33x(ix + 1, iy + 1, iz + 1);
  return mix(mix(mix(a, b, ux), mix(c, d, ux), uy), mix(mix(e, f, ux), mix(g, h, ux), uy), uz);
}

const C3 = new Float64Array(24);
let v3x = 0,
  v3y = 0,
  v3z = 0;

/** vn3(x) (the #93 warp: vn with all three hash channels) into (v3x, v3y, v3z). */
function vn3(x: number, y: number, z: number): void {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const ux = smooth(fr(x)),
    uy = smooth(fr(y)),
    uz = smooth(fr(z));
  for (let k = 0; k < 8; k++) {
    h33(ix + (k & 1), iy + ((k >> 1) & 1), iz + ((k >> 2) & 1));
    C3[k * 3] = hx;
    C3[k * 3 + 1] = hy;
    C3[k * 3 + 2] = hz;
  }
  v3x = trilerp(0, ux, uy, uz);
  v3y = trilerp(1, ux, uy, uz);
  v3z = trilerp(2, ux, uy, uz);
}

/** The vn mix nest (x, then y, then z) over channel c of the 8 corner hashes in C3 (no closure per call). */
function trilerp(c: number, ux: number, uy: number, uz: number): number {
  return mix(
    mix(mix(C3[c]!, C3[3 + c]!, ux), mix(C3[6 + c]!, C3[9 + c]!, ux), uy),
    mix(mix(C3[12 + c]!, C3[15 + c]!, ux), mix(C3[18 + c]!, C3[21 + c]!, ux), uy),
    uz,
  );
}

const FB = [F(7.1), F(3.3), F(1.7)] as const,
  RB = [F(3.1), F(9.3), F(4.7)] as const,
  F203 = F(2.03),
  F21 = F(2.1);

function fbm(px: number, py: number, pz: number, n: number): number {
  let a = 0.5,
    s = 0,
    t = 0;
  for (let i = 0; i < n; i++) {
    s = F(s + F(a * vn(px, py, pz)));
    t = F(t + a);
    px = F(F(px * F203) + FB[0]);
    py = F(F(py * F203) + FB[1]);
    pz = F(F(pz * F203) + FB[2]);
    a = F(a * 0.5);
  }
  return F(s / t);
}

function ridge(px: number, py: number, pz: number, n: number): number {
  let a = 0.5,
    s = 0,
    t = 0;
  for (let i = 0; i < n; i++) {
    s = F(s + F(a * F(1 - Math.abs(F(F(2 * vn(px, py, pz)) - 1)))));
    t = F(t + a);
    px = F(F(px * F21) + RB[0]);
    py = F(F(py * F21) + RB[1]);
    pz = F(F(pz * F21) + RB[2]);
    a = F(a * 0.5);
  }
  return F(s / t);
}

let ndv = 0,
  ndx = 0,
  ndy = 0,
  ndz = 0;

/** vnd(x): value noise and its analytic gradient into (ndv, ndx, ndy, ndz). */
function vnd(x: number, y: number, z: number): void {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = fr(x),
    fy = fr(y),
    fz = fr(z);
  const ux = smooth(fx),
    uy = smooth(fy),
    uz = smooth(fz);
  const dux = F(F(6 * fx) * F(1 - fx)),
    duy = F(F(6 * fy) * F(1 - fy)),
    duz = F(F(6 * fz) * F(1 - fz));
  const a = h33x(ix, iy, iz),
    b = h33x(ix + 1, iy, iz),
    c = h33x(ix, iy + 1, iz),
    d = h33x(ix + 1, iy + 1, iz),
    e = h33x(ix, iy, iz + 1),
    f1 = h33x(ix + 1, iy, iz + 1),
    g = h33x(ix, iy + 1, iz + 1),
    h = h33x(ix + 1, iy + 1, iz + 1);
  const k1 = F(b - a),
    k2 = F(c - a),
    k3 = F(e - a),
    k4 = F(F(F(a - b) - c) + d),
    k5 = F(F(F(a - c) - e) + g),
    k6 = F(F(F(a - b) - e) + f1),
    k7 = F(F(F(F(F(F(F(-a + b) + c) - d) + e) - f1) - g) + h);
  const uxy = F(ux * uy),
    uyz = F(uy * uz),
    uzx = F(uz * ux);
  ndv = F(
    F(
      F(F(F(F(F(a + F(k1 * ux)) + F(k2 * uy)) + F(k3 * uz)) + F(k4 * uxy)) + F(k5 * uyz)) +
        F(k6 * uzx),
    ) + F(k7 * F(uxy * uz)),
  );
  ndx = F(dux * F(F(F(k1 + F(k4 * uy)) + F(k6 * uz)) + F(k7 * uyz)));
  ndy = F(duy * F(F(F(k2 + F(k5 * uz)) + F(k4 * ux)) + F(k7 * uzx)));
  ndz = F(duz * F(F(F(k3 + F(k6 * ux)) + F(k5 * uy)) + F(k7 * uxy)));
}

// const mat3 RM=mat3(.00,.80,.60,-.80,.36,-.48,-.60,-.48,.64): GLSL matrices are column-major, so RM*p is
// col0 * p.x + col1 * p.y + col2 * p.z with col0 = (0, .8, .6), col1 = (-.8, .36, -.48), col2 = (-.6, -.48, .64).
const R0 = [F(0), F(0.8), F(0.6)],
  R1 = [F(-0.8), F(0.36), F(-0.48)],
  R2 = [F(-0.6), F(-0.48), F(0.64)];

function efbm(px: number, py: number, pz: number): number {
  let a = 0.5,
    s = 0,
    gx = 0,
    gy = 0,
    gz = 0;
  for (let i = 0; i < 6; i++) {
    vnd(px, py, pz);
    const nx = F(F(ndv * 2) - 1);
    gx = F(gx + F(ndx * 2));
    gy = F(gy + F(ndy * 2));
    gz = F(gz + F(ndz * 2));
    s = F(s + F(F(a * nx) / F(1 + F(F(F(gx * gx) + F(gy * gy)) + F(gz * gz)))));
    a = F(a * 0.5);
    const qx = F(F(F(R0[0]! * px) + F(R1[0]! * py)) + F(R2[0]! * pz)),
      qy = F(F(F(R0[1]! * px) + F(R1[1]! * py)) + F(R2[1]! * pz)),
      qz = F(F(F(R0[2]! * px) + F(R1[2]! * py)) + F(R2[2]! * pz));
    px = F(qx * 2);
    py = F(qy * 2);
    pz = F(qz * 2);
  }
  return s;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// ---- texture reads ----

/** FLY_FS uvOf: u = atan(z, x)/TAU + .5, v = asin(clamp(y))/PI + .5. */
function uvOf(x: number, y: number, z: number): [number, number] {
  return [Math.atan2(z, x) / TAU + 0.5, Math.asin(Math.min(Math.max(y, -1), 1)) / PI + 0.5];
}

/** texture() with LINEAR filtering on channel 0 of a W x H array: S wraps (REPEAT), T clamps to the edge. */
function bilinear(
  data: ArrayLike<number>,
  stride: number,
  W: number,
  H: number,
  u: number,
  v: number,
): number {
  const px = u * W - 0.5,
    py = v * H - 0.5;
  const x0f = Math.floor(px),
    y0f = Math.floor(py);
  const fx = px - x0f,
    fy = py - y0f;
  const x0 = ((x0f % W) + W) % W,
    x1 = (x0 + 1) % W;
  const y0 = Math.min(Math.max(y0f, 0), H - 1),
    y1 = Math.min(Math.max(y0f + 1, 0), H - 1);
  const a = data[(y0 * W + x0) * stride]!,
    b = data[(y0 * W + x1) * stride]!,
    c = data[(y1 * W + x0) * stride]!,
    d = data[(y1 * W + x1) * stride]!;
  const r0 = a + (b - a) * fx,
    r1 = c + (d - c) * fx;
  return r0 + (r1 - r0) * fy;
}

/** FLY_FS tex4(uEb, uv).r: texelFetch bilinear (exact filtering), x wraps, y clamps, on half-float EB.out. */
function tex4T(out: Float32Array, NX: number, NY: number, u: number, v: number): number {
  const px = u * NX - 0.5,
    py = v * NY - 0.5;
  const ix = Math.floor(px),
    iy = Math.floor(py);
  const fx = px - ix,
    fy = py - iy;
  const x0 = ((ix % NX) + NX) % NX,
    x1 = (x0 + 1) % NX;
  const y0 = Math.min(Math.max(iy, 0), NY - 1),
    y1 = Math.min(Math.max(iy + 1, 0), NY - 1);
  const t = (x: number, y: number): number => f16round(out[(y * NX + x) * 4]!);
  const r0 = t(x0, y0) + (t(x1, y0) - t(x0, y0)) * fx,
    r1 = t(x0, y1) + (t(x1, y1) - t(x0, y1)) * fx;
  return r0 + (r1 - r0) * fy;
}

/** texture(uHy, uv).g of the RGBA8 hydro raster, 0..1, bilinear (S repeat, T clamp). */
function hydroG(
  hy: { img: ArrayLike<number>; RW: number; RH: number },
  u: number,
  v: number,
): number {
  const img = hy.img;
  const px = u * hy.RW - 0.5,
    py = v * hy.RH - 0.5;
  const x0f = Math.floor(px),
    y0f = Math.floor(py);
  const fx = px - x0f,
    fy = py - y0f;
  const x0 = ((x0f % hy.RW) + hy.RW) % hy.RW,
    x1 = (x0 + 1) % hy.RW;
  const y0 = Math.min(Math.max(y0f, 0), hy.RH - 1),
    y1 = Math.min(Math.max(y0f + 1, 0), hy.RH - 1);
  const t = (x: number, y: number): number => img[(y * hy.RW + x) * 4 + 1]! / 255;
  const r0 = t(x0, y0) + (t(x1, y0) - t(x0, y0)) * fx,
    r1 = t(x0, y1) + (t(x1, y1) - t(x0, y1)) * fx;
  return r0 + (r1 - r0) * fy;
}

// ---- context ----

const h16Cache = new WeakMap<object, Float32Array>();

/** Channel 0 of the interleaved terrain grid, rounded to half float (the RG16F texture), built once per grid. */
export function terrainHalf(data: Float32Array, W: number, H: number, stride = 2): Float32Array {
  let h = h16Cache.get(data);
  if (!h) {
    h = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) h[i] = f16round(data[i * stride]!);
    h16Cache.set(data, h);
  }
  return h;
}

/** Largest seed3 component the float32 noise keeps precise (seedVec gives < 256; presets use their small seed). */
export const SEED3_MAX = 65536;

/**
 * The uniforms and textures FLY_FS `hKm` reads, from the engine's CPU state. `seed3` is the world's uSeed3
 * (AirModel.seed3: preset.seed3 for card worlds, else [seed, seed, seed]); `oceanF` is the preset's ocean share
 * (core OCEANF[id], AirModel.oceanF).
 */
export function makeFlyHeightCtx(
  e: FlyHeightSource,
  seed3: readonly [number, number, number],
  opt: { oceanF: number; hq?: boolean },
): FlyHeightCtx {
  for (const s of seed3)
    if (!Number.isFinite(s) || Math.abs(s) >= SEED3_MAX)
      throw new Error(
        'flyHeight: seed3 must be three small numbers (seedVec), got ' + seed3.join(','),
      );
  const f = e.cpuFields();
  const m = e.readouts().model ?? {};
  const st = e.state();
  const gas = !!(m.gas ?? st.gas);
  const t = f.terrain as { W: number; H: number; data: Float32Array } | null;
  const hyd = f.hydro as {
    img: ArrayLike<number>;
    RW: number;
    RH: number;
    lava?: boolean;
    hM?: number;
  } | null;
  const wf = e.weatherFields();
  return {
    seed3: [F(seed3[0]), F(seed3[1]), F(seed3[2])],
    h16: t ? terrainHalf(t.data, t.W, t.H) : null,
    W: t ? t.W : 0,
    H: t ? t.H : 0,
    ocean: opt.oceanF > 0 && !m.airless,
    lava: !gas && m.Ts > 700,
    hM: hyd && hyd.lava ? F(hyd.hM ?? 0) : 0,
    ebOut: wf ? wf.out : null,
    ebNX: wf ? wf.NX : 0,
    ebNY: wf ? wf.NY : 0,
    hydro: hyd && hyd.img && hyd.RW > 0 ? { img: hyd.img, RW: hyd.RW, RH: hyd.RH } : null,
    hq: opt.hq ?? true,
    gas,
  };
}

/**
 * The filtered raw grid height at texture coordinate (u, v), km: FLY_FS `HQ?crs(uHt,uv).r:texture(uHt,uv).r`. The GPU
 * merges Catmull-Rom into 9 bilinear taps with its own filtering precision; this sums the 16 texels with
 * fieldSampler.catmullRom (exact weights). The difference is the filter half of the parity error.
 */
export function heightAtUv(ctx: FlyHeightCtx, u: number, v: number): number {
  if (!ctx.h16) return 0;
  return ctx.hq
    ? // back to the lon/lat catmullRom takes, with its own 2 pi, so its texel coordinate is exactly u * W - 0.5
      catmullRom(ctx.h16, 1, ctx.W, ctx.H, (u - 0.5) * 2 * Math.PI, (v - 0.5) * Math.PI)
    : bilinear(ctx.h16, 1, ctx.W, ctx.H, u, v);
}

/**
 * The magma-sea inputs at the unwarped direction: tex4(uEb, uvOf(d)).r (EB.out T, half float) and texture(uHy, uh).g
 * (0 before the first raster: the GPU's 1 x 1 zero texture). Exported for the parity test.
 */
export function lavaInputs(
  dir: readonly [number, number, number],
  ctx: FlyHeightCtx,
): { T: number; g: number } {
  const [uh, vh] = uvOf(F(dir[0]), F(dir[1]), F(dir[2]));
  return {
    T: ctx.ebOut ? tex4T(ctx.ebOut, ctx.ebNX, ctx.ebNY, uh, vh) : 0,
    g: ctx.hydro ? hydroG(ctx.hydro, uh, vh) : 0,
  };
}

/** One hKm evaluation with its parts (the parity page and tests read e, u, v). */
export interface HKmParts {
  /** The filtered raw grid height, km (before the noise detail). */
  e: number;
  /** Texture coordinate of the warped direction. */
  u: number;
  v: number;
  /** hKm, km. */
  h: number;
}

/**
 * hKm(d) of FLY_FS, in km above the sea-level reference of the drawn surface. It is not exaggerated: the fly view
 * multiplies it by ex = 3. `dir` is a unit vector in the engine's body frame (lon = atan2(z, x), lat = asin(y)).
 */
export function hKm(dir: readonly [number, number, number], ctx: FlyHeightCtx): number {
  return hKmParts(dir, ctx).h;
}

/**
 * hKm with its parts. `eGiven` replaces the filtered grid height and `gGiven` the hydro G read (the parity test feeds
 * the GPU's own values).
 */
export function hKmParts(
  dir: readonly [number, number, number],
  ctx: FlyHeightCtx,
  eGiven?: number,
  gGiven?: number,
): HKmParts {
  if (ctx.gas || !ctx.h16) return { e: 0, u: 0, v: 0, h: 0 };
  const dx = F(dir[0]),
    dy = F(dir[1]),
    dz = F(dir[2]);
  const [s0, s1, s2] = ctx.seed3;
  // vec3 wq=d*300.+uSeed3; uv=uvOf(normalize(d+(vn3(wq)-.5)*.008+(vn3(wq*4.)-.5)*.0025))
  const wx = F(F(dx * 300) + s0),
    wy = F(F(dy * 300) + s1),
    wz = F(F(dz * 300) + s2);
  vn3(wx, wy, wz);
  let qx = dx + (v3x - 0.5) * 0.008,
    qy = dy + (v3y - 0.5) * 0.008,
    qz = dz + (v3z - 0.5) * 0.008;
  vn3(F(wx * 4), F(wy * 4), F(wz * 4));
  qx += (v3x - 0.5) * 0.0025;
  qy += (v3y - 0.5) * 0.0025;
  qz += (v3z - 0.5) * 0.0025;
  const ql = Math.hypot(qx, qy, qz);
  const [u, v] = uvOf(qx / ql, qy / ql, qz / ql);
  // float e=HQ?crs(uHt,uv).r:texture(uHt,uv).r, m=smoothstep(.1,2.5,e)
  const e = eGiven ?? heightAtUv(ctx, u, v);
  const m = smoothstep(0.1, 2.5, e);
  // vec3 p=d*420.+uSeed3; h=e+((ridge(p,4)-.55)*.6+efbm(p*.8)*1.1)*(.3+2.6*m)+(fbm(p*3.7,3)-.5)*.14
  const px = F(F(dx * 420) + s0),
    py = F(F(dy * 420) + s1),
    pz = F(F(dz * 420) + s2);
  const r = ridge(px, py, pz, 4);
  const ef = efbm(F(px * F(0.8)), F(py * F(0.8)), F(pz * F(0.8)));
  const fb = fbm(F(px * F(3.7)), F(py * F(3.7)), F(pz * F(3.7)), 3);
  let h = e + ((r - 0.55) * 0.6 + ef * 1.1) * (0.3 + 2.6 * m) + (fb - 0.5) * 0.14;
  // if(uLava>.5){vec2 uh=uvOf(d);h=mix(h,uHM,smoothstep(1400.,1500.,tex4(uEb,uh).r)*(1.-texture(uHy,uh).g));}
  if (ctx.lava) {
    const L = lavaInputs(dir, ctx);
    const g = gGiven ?? L.g;
    h = h + (ctx.hM - h) * (smoothstep(1400, 1500, L.T) * (1 - g));
  }
  // return uOcean>.5?max(h,0.):h
  if (ctx.ocean) h = Math.max(h, 0);
  return { e, u, v, h };
}
