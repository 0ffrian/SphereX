// Issue #71 stream D (D-36, Q-242): plate tectonics for a rocky world, ported from the approved
// prototype (`buildTerrain`). Plates, boundary classes, half-space ocean-floor cooling, isostasy,
// sea level by area, then stream-power erosion on a coarser grid. It replaces the planet's height
// field and feeds the one height field that also drives normals and haptics (D-01, R1.6).
//
// Honesty: no exoplanet has a measured map. Plate tectonics itself is an assumption for any
// exoplanet (D-36); the plate layout, the continents and every height here come from the seed, so
// the surface is `artistic`. What is physics is the SHAPE of the rules, each with its source:
//  - Ocean floor deepens with age as `d = d0 + 0.35 sqrt(age)` (half-space cooling; Parsons and
//    Sclater 1977, J. Geophys. Res. 82, 803: about 350 m per sqrt(Myr)). The prototype works in
//    km, so the coefficient 0.35 km / sqrt(Myr) is that figure.
//  - Convergent boundaries give trenches and arcs or ranges by which crust meets which (plate
//    tectonics textbook classes: Turcotte and Schubert, Geodynamics, ch. 1 and 2).
//  - Mountains are taller on a lower-gravity world: `gf = clamp(9.81 / g, 0.5, 2.5)` (the scaling
//    `h_max ~ 1 / g` of Weisskopf 1975, Science 187, 605; Mars' Olympus Mons against Everest).
//  - Rivers: implicit stream-power incision `dh/dt = U - K A^m S^n` with `m = 0.5, n = 1` solved
//    downstream to upstream (Braun and Willett 2013, Geomorphology 180-181, 170). `K` is the
//    prototype's 0.012, an artistic tuning.
// Determinism: a function of (seed, ocean fraction, gravity, grid size) only.
import { boundedSeed, mulberry32, vnoise } from '@/viewer/fields/noise';

const TAU = 6.283185307179586;
/** Ocean-floor deepening, km per sqrt(Myr) (Parsons and Sclater 1977). */
export const HALF_SPACE_KM_PER_SQRT_MYR = 0.35;
/** Reference surface gravity for the mountain scaling, m/s^2 (Earth, standard gravity). */
export const GRAVITY_REF = 9.81;
/** Plate count range: 8 to 13 (the prototype; Earth has 7 major and about 8 minor plates). */
export const PLATE_COUNT_MIN = 8;
export const PLATE_COUNT_SPAN = 6;

export interface TerrainGrid {
  /** Width and height in cells; row 0 = south pole, column 0 = longitude -pi. */
  W: number;
  H: number;
  /** Interleaved (height, boundary signal) per cell. Height is relative to sea level, model km. */
  data: Float32Array;
  plates: number;
  /** Height in model km above (positive) or below sea level at longitude `lon`, latitude `lat` (radians), bilinear. */
  heightAt(lon: number, lat: number): number;
  /** Boundary signal -1 (divergent) to +1 (convergent), bilinear. */
  boundaryAt(lon: number, lat: number): number;
}

export interface TerrainOptions {
  seed: number;
  /** Share of the area under water, 0..1; 0 gives a dry world and 1 a water world. */
  oceanFraction: number;
  /** Surface gravity, m/s^2. */
  gravity: number;
  W?: number;
  H?: number;
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function fbm3(x: number, y: number, z: number, n: number, seed: number): number {
  let a = 0.5;
  let s = 0;
  let t = 0;
  for (let i = 0; i < n; i++) {
    s += a * vnoise(x, y, z, seed);
    t += a;
    x = x * 2.03 + 7.1;
    y = y * 2.03 + 3.3;
    z = z * 2.03 + 1.7;
    a *= 0.5;
  }
  return s / t;
}

interface Plate {
  d: [number, number, number];
  w: number;
  om: [number, number, number];
}

export function buildTerrain(opt: TerrainOptions): TerrainGrid {
  const W = opt.W ?? 720;
  const H = opt.H ?? 360;
  const N = W * H;
  const oceanFrac = clamp(opt.oceanFraction, 0, 1);
  const seedI = boundedSeed(opt.seed);
  const r = mulberry32(Math.imul(opt.seed | 0, 97) + 13);
  const s = seedI * 1.37;
  const dx = new Float32Array(N);
  const dy = new Float32Array(N);
  const dz = new Float32Array(N);
  const plate = new Uint8Array(N);
  const C = new Float32Array(N);
  const cl = new Float32Array(H);
  const K = PLATE_COUNT_MIN + Math.floor(r() * PLATE_COUNT_SPAN);
  const pl: Plate[] = [];
  for (let k = 0; k < K; k++) {
    const z = r() * 2 - 1;
    const an = r() * TAU;
    const c2 = Math.sqrt(1 - z * z);
    const oz = r() * 2 - 1;
    const oa = r() * TAU;
    const oc = Math.sqrt(1 - oz * oz);
    const sp = 0.3 + 0.9 * r();
    pl.push({
      d: [c2 * Math.cos(an), z, c2 * Math.sin(an)],
      w: 0.85 + 0.4 * r(),
      om: [oc * Math.cos(oa) * sp, oz * sp, oc * Math.sin(oa) * sp],
    });
  }
  for (let j = 0; j < H; j++) {
    const la = ((j + 0.5) / H - 0.5) * Math.PI;
    const c = Math.cos(la);
    const sl = Math.sin(la);
    cl[j] = Math.max(c, 0.02);
    for (let i = 0; i < W; i++) {
      const lo = ((i + 0.5) / W - 0.5) * TAU;
      const x = c * Math.cos(lo);
      const y = sl;
      const zz = c * Math.sin(lo);
      const ix = j * W + i;
      dx[ix] = x;
      dy[ix] = y;
      dz[ix] = zz;
      // Warped Voronoi: nearest plate centre in a noise-displaced direction, so edges wander.
      const wx = x + 0.3 * (vnoise(x * 3 + s, y * 3, zz * 3, seedI) - 0.5);
      const wy = y + 0.3 * (vnoise(x * 3 + 31, y * 3 + s, zz * 3, seedI + 1) - 0.5);
      const wz = zz + 0.3 * (vnoise(x * 3 + 57, y * 3, zz * 3 + s, seedI + 2) - 0.5);
      let best = -9;
      let bk = 0;
      for (let k = 0; k < K; k++) {
        const p = pl[k]!;
        const v = (wx * p.d[0] + wy * p.d[1] + wz * p.d[2]) * p.w;
        if (v > best) {
          best = v;
          bk = k;
        }
      }
      plate[ix] = bk;
      C[ix] = fbm3(x * 1.7 + s, y * 1.7, zz * 1.7, 4, seedI + 3);
    }
  }
  // Continental crust takes the highest part of the slowly varying field, up to the land share.
  const sorted = Float32Array.from(C).sort();
  const th = sorted[Math.floor(clamp(1 - (1 - oceanFrac + 0.06), 0.02, 0.98) * N)]!;
  const isC = new Uint8Array(N);
  for (let i = 0; i < N; i++) isC[i] = C[i]! > th ? 1 : 0;

  // Boundaries: the relative plate velocity along the boundary normal separates convergent from divergent.
  const dist = new Float32Array(N).fill(9);
  const src = new Int32Array(N).fill(-1);
  const bC = new Float32Array(N);
  const bP = new Uint8Array(N);
  const dLat = Math.PI / H;
  const dLon = TAU / W;
  const mark = (a: number, b: number): void => {
    if (plate[a] === plate[b]) return;
    const A = pl[plate[a]!]!.om;
    const B = pl[plate[b]!]!.om;
    const x = dx[a]!;
    const y = dy[a]!;
    const z = dz[a]!;
    const rx = (A[1] - B[1]) * z - (A[2] - B[2]) * y;
    const ry = (A[2] - B[2]) * x - (A[0] - B[0]) * z;
    const rz = (A[0] - B[0]) * y - (A[1] - B[1]) * x;
    const nx = dx[b]! - x;
    const ny = dy[b]! - y;
    const nz = dz[b]! - z;
    const l = Math.hypot(nx, ny, nz) || 1;
    const conv = (rx * nx + ry * ny + rz * nz) / l;
    dist[a] = 0;
    dist[b] = 0;
    src[a] = a;
    src[b] = b;
    bC[a] = conv;
    bC[b] = conv;
    const pa = isC[a]! | (isC[b]! << 1);
    bP[a] = pa;
    bP[b] = pa;
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const ix = j * W + i;
      mark(ix, j * W + ((i + 1) % W));
      if (j < H - 1) mark(ix, ix + W);
    }
  }
  const relax = (a: number, b: number, d: number): void => {
    if (src[b]! >= 0 && dist[b]! + d < dist[a]!) {
      dist[a] = dist[b]! + d;
      src[a] = src[b]!;
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < H; j++) {
      const dl = dLon * cl[j]!;
      const dg = Math.hypot(dl, dLat);
      for (let i = 0; i < W; i++) {
        const ix = j * W + i;
        relax(ix, j * W + ((i + W - 1) % W), dl);
        if (j > 0) {
          relax(ix, ix - W, dLat);
          relax(ix, (j - 1) * W + ((i + W - 1) % W), dg);
          relax(ix, (j - 1) * W + ((i + 1) % W), dg);
        }
      }
    }
    for (let j = H - 1; j >= 0; j--) {
      const dl2 = dLon * cl[j]!;
      const dg2 = Math.hypot(dl2, dLat);
      for (let i = W - 1; i >= 0; i--) {
        const ix = j * W + i;
        relax(ix, j * W + ((i + 1) % W), dl2);
        if (j < H - 1) {
          relax(ix, ix + W, dLat);
          relax(ix, (j + 1) * W + ((i + 1) % W), dg2);
          relax(ix, (j + 1) * W + ((i + W - 1) % W), dg2);
        }
      }
    }
  }

  // Heights: isostasy (continents ride high, ocean floor low), boundary relief, gravity scaling.
  const gf = clamp(GRAVITY_REF / opt.gravity, 0.5, 2.5);
  const e = new Float32Array(N);
  const orog = new Float32Array(N);
  const sig = new Float32Array(N);
  const g2 = (v: number, c0: number, w: number): number => {
    const t = (v - c0) / w;
    return Math.exp(-t * t);
  };
  for (let i = 0; i < N; i++) {
    const d = dist[i]!;
    const sc = src[i]! < 0 ? i : src[i]!;
    const conv = bC[sc]!;
    const cc = Math.min(1, Math.abs(conv) * 1.4);
    const pair = bP[sc]!;
    const me = isC[i]!;
    let up = 0;
    // Half-space cooling: young floor at a ridge (divergent), older away from it.
    const age = conv < -0.05 ? Math.min(d * 900, 180) : 110 + d * 200;
    let h = me
      ? 0.15 + 3.2 * Math.max(0, C[i]! - th)
      : -(2.5 + HALF_SPACE_KM_PER_SQRT_MYR * Math.sqrt(age));
    if (conv > 0.05) {
      if (pair === 3)
        up = 5.5 * cc * g2(d, 0, 0.085); // continents collide: thick crust, high range
      else if (pair === 0) {
        up = 3.6 * cc * g2(d, 0.04, 0.02); // ocean under ocean: island arc
        h -= 4 * cc * g2(d, 0, 0.025); // and its trench
      } else if (me)
        up = 3.8 * cc * g2(d, 0.055, 0.045); // ocean sinks under continent: volcanic range
      else h -= 3.5 * cc * g2(d, 0, 0.03); // the trench on the ocean side
    } else if (conv < -0.05 && me) h -= 1.2 * cc * g2(d, 0, 0.04); // continental rift
    if (up > 0.01) {
      const rg = 1 - Math.abs(2 * vnoise(dx[i]! * 14 + s, dy[i]! * 14, dz[i]! * 14, seedI + 4) - 1);
      up *= 0.55 + 0.75 * rg;
    }
    orog[i] = up * gf;
    e[i] = h + up * gf;
    sig[i] = clamp(Math.sign(conv) * cc * g2(d, 0, 0.012), -1, 1);
  }
  // Sea level: the height that puts the wanted share of the AREA under water (rows weighted by cos lat).
  const step2: { v: number; w: number }[] = [];
  let st = 0;
  for (let j = 0; j < H; j += 2) {
    for (let i = 0; i < W; i += 2) {
      step2.push({ v: e[j * W + i]!, w: cl[j]! });
      st += cl[j]!;
    }
  }
  step2.sort((a, b) => a.v - b.v);
  let acc = 0;
  let sea = step2[step2.length - 1]!.v + 0.5;
  if (oceanFrac < 1) {
    sea = step2[0]!.v - 0.1;
    for (let i = 0; i < step2.length && oceanFrac > 0; i++) {
      acc += step2[i]!.w;
      if (acc >= oceanFrac * st) {
        sea = step2[i]!.v;
        break;
      }
    }
  }
  for (let i = 0; i < N; i++) e[i] = e[i]! - sea;

  // Rivers: stream-power erosion on a grid of half the size, solved downstream to upstream.
  const LW = W >> 1;
  const LH = H >> 1;
  const LN = LW * LH;
  const hl = new Float32Array(LN);
  const h0 = new Float32Array(LN);
  const ul = new Float32Array(LN);
  const cl2 = new Float32Array(LH);
  for (let j = 0; j < LH; j++) {
    cl2[j] = Math.max(Math.cos(((j + 0.5) / LH - 0.5) * Math.PI), 0.02);
    for (let i = 0; i < LW; i++) {
      const a0 = j * 2 * W + i * 2;
      hl[j * LW + i] = (e[a0]! + e[a0 + 1]! + e[a0 + W]! + e[a0 + W + 1]!) / 4;
      ul[j * LW + i] = orog[a0]!;
    }
  }
  h0.set(hl);
  const hIdx = new Int32Array(LN + 8);
  const hVal = new Float32Array(LN + 8);
  const order = new Int32Array(LN);
  const rec = new Int32Array(LN);
  const seen = new Uint8Array(LN);
  const fill = new Float32Array(LN);
  const area = new Float32Array(LN);
  let hn = 0;
  const push = (ix2: number, v: number): void => {
    let c = hn++;
    while (c > 0) {
      const par = (c - 1) >> 1;
      if (hVal[par]! <= v) break;
      hVal[c] = hVal[par]!;
      hIdx[c] = hIdx[par]!;
      c = par;
    }
    hVal[c] = v;
    hIdx[c] = ix2;
  };
  const pop = (): number => {
    const top = hIdx[0]!;
    const lv = hVal[--hn]!;
    const li2 = hIdx[hn]!;
    let c = 0;
    for (;;) {
      let ch = 2 * c + 1;
      if (ch >= hn) break;
      if (ch + 1 < hn && hVal[ch + 1]! < hVal[ch]!) ch++;
      if (hVal[ch]! >= lv) break;
      hVal[c] = hVal[ch]!;
      hIdx[c] = hIdx[ch]!;
      c = ch;
    }
    hVal[c] = lv;
    hIdx[c] = li2;
    return top;
  };
  if (oceanFrac < 1) {
    for (let it = 0; it < 9; it++) {
      seen.fill(0);
      hn = 0;
      let cnt = 0;
      let low = 0;
      // Priority-flood from the sea: every cell drains to a lower neighbour (depressions are filled).
      for (let i = 0; i < LN; i++) {
        rec[i] = i;
        if (hl[i]! < hl[low]!) low = i;
        if (hl[i]! <= 0) {
          seen[i] = 1;
          fill[i] = hl[i]!;
          push(i, hl[i]!);
        }
      }
      if (hn === 0) {
        seen[low] = 1;
        fill[low] = hl[low]!;
        push(low, hl[low]!);
      }
      while (hn > 0) {
        const cur = pop();
        order[cnt++] = cur;
        const cy = Math.floor(cur / LW);
        const cx = cur - cy * LW;
        for (let nj = Math.max(0, cy - 1); nj <= Math.min(LH - 1, cy + 1); nj++) {
          for (let di = -1; di <= 1; di++) {
            const nb = nj * LW + ((cx + di + LW) % LW);
            if (seen[nb]) continue;
            seen[nb] = 1;
            rec[nb] = cur;
            fill[nb] = Math.max(hl[nb]!, fill[cur]! + 1e-4);
            push(nb, fill[nb]!);
          }
        }
      }
      for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) area[j * LW + i] = cl2[j]!;
      for (let i = cnt - 1; i >= 0; i--) {
        const c0 = order[i]!;
        if (rec[c0] !== c0) area[rec[c0]!] = area[rec[c0]!]! + area[c0]!;
      }
      for (let i = 0; i < cnt; i++) {
        const c1 = order[i]!;
        const r0 = rec[c1]!;
        if (r0 === c1) continue;
        if (fill[c1]! > hl[c1]!) hl[c1] = fill[c1]!;
        const Fk = 0.012 * Math.sqrt(area[c1]!); // K A^m dt with m = 0.5
        if (hl[c1]! > hl[r0]!) hl[c1] = (hl[c1]! + Fk * hl[r0]!) / (1 + Fk);
      }
      // Uplift holds mountains up: relax rising ground back toward its tectonic height.
      for (let i = 0; i < LN; i++) if (ul[i]! > 0.02) hl[i] = hl[i]! + (h0[i]! - hl[i]!) * 0.1;
    }
  }
  const out = new Float32Array(N * 2);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const fx = i / 2;
      const fy = j / 2;
      const ai = Math.floor(fx);
      const aj = Math.min(Math.floor(fy), LH - 2);
      const tx = fx - ai;
      const ty = fy - aj;
      const ii = ai % LW;
      const i2 = (ai + 1) % LW;
      const dd = (a: number, b: number): number => hl[a * LW + b]! - h0[a * LW + b]!;
      const delta = lerp(
        lerp(dd(aj, ii), dd(aj, i2), tx),
        lerp(dd(aj + 1, ii), dd(aj + 1, i2), tx),
        ty,
      );
      out[(j * W + i) * 2] = e[j * W + i]! + delta;
      out[(j * W + i) * 2 + 1] = sig[j * W + i]!;
    }
  }

  return terrainFromData(W, H, out, K);
}

/** Rebuilds the samplers of a grid from its raw data (the worker sends the data only). */
export function terrainFromData(
  W: number,
  H: number,
  out: Float32Array,
  plates: number,
): TerrainGrid {
  const sampleCh =
    (ch: number) =>
    (lon: number, lat: number): number => {
      const fx = ((((lon / TAU + 0.5) % 1) + 1) % 1) * W - 0.5;
      const fy = clamp((lat / Math.PI + 0.5) * H - 0.5, 0, H - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.min(Math.floor(fy), H - 2);
      const tx = fx - x0;
      const ty = fy - y0;
      const at = (x: number, y: number): number => out[(y * W + ((x + W) % W)) * 2 + ch]!;
      return lerp(
        lerp(at(x0, y0), at(x0 + 1, y0), tx),
        lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx),
        ty,
      );
    };
  return { W, H, data: out, plates, heightAt: sampleCh(0), boundaryAt: sampleCh(1) };
}

/** FNV-1a over the height data: the determinism check. */
export function terrainHash(t: TerrainGrid): string {
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength);
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Share of the area (cos-latitude weighted) below sea level (height < 0). */
export function oceanAreaShare(t: TerrainGrid): number {
  let a = 0;
  let w = 0;
  for (let j = 0; j < t.H; j++) {
    const c = Math.max(Math.cos(((j + 0.5) / t.H - 0.5) * Math.PI), 0.02);
    for (let i = 0; i < t.W; i++) {
      w += c;
      if (t.data[(j * t.W + i) * 2]! < 0) a += c;
    }
  }
  return a / w;
}
