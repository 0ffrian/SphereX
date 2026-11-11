// Issue #71 stream D, round 2 (Q-244): rivers and lakes on the final terrain, ported from the
// approved prototype (`routeTerrain`, `hydroRaster`). Pure and deterministic: a function of the
// terrain grid, the climate grid and the world model. No `Math.random`, no `Date`.
//
//  1. Land roughness: a seeded fractal added to land height so the flow does not run on a plane.
//     This is `artistic` (it is texture, not a measurement).
//  2. Priority-flood fills every closed basin to its spill level, so every land cell drains
//     (Barnes, Lehman and Mulla 2014, Computers and Geosciences 62, 117).
//  3. Each cell sends water to its steepest lower neighbour on the filled surface (D8; O'Callaghan
//     and Mark 1984, Computer Vision, Graphics and Image Processing 28, 323).
//  4. Runoff = rain x (1 - evaporation share) with the Budyko curve (Budyko 1974, Climate and
//     Life), dryness = potential evaporation / rain. Frozen ground stores water instead of running off.
//  5. Discharge accumulates downstream. A channel starts above `CHANNEL_Q_M3S`.
//  6. Width follows hydraulic geometry w = 4 Q^0.5 (Leopold and Maddock 1953, USGS Prof. Paper 252),
//     drawn no thinner than 0.9 + log10(Q / Qc) texels so a small river stays visible.
//  7. A closed basin (depth >= 0.03 model km, >= 3 cells) holds a lake only as far as inflow can
//     balance open-water evaporation; otherwise it is a salt flat. Big rivers leave a sediment
//     plume at the sea.
// Tags: the routing, discharge, lakes and salt flats are `model_dependent` (rain is the model's own,
// in relative units, and the "1 m a year" scale P0 is an assumption); the roughness is `artistic`.
// [verify] The five citations above were entered from memory.
import { boundedSeed, vnoise } from '@/viewer/fields/noise';
import type { Fluid } from './fluids';

/** Discharge above which a river is drawn, m^3/s (the prototype's value). */
export const CHANNEL_Q_M3S = 50;
/** Smallest lake depth, model km, and smallest basin, cells. */
export const LAKE_MIN_DEPTH = 0.03;
export const LAKE_MIN_CELLS = 3;
/** Rain scale: a relative rain of 1 is about 1 m a year of liquid water (water); 0.4 for other fluids. ASSUMPTION. */
export const RAIN_SCALE_WATER = 1;
export const RAIN_SCALE_OTHER = 0.4;
const SECONDS_PER_YEAR = 3.156e7;
/** Sediment plume starts at this discharge, m^3/s. */
const PLUME_Q = 3000;

export const HYDROLOGY_TAGS = {
  routing: 'model_dependent',
  discharge: 'model_dependent',
  lakes: 'model_dependent',
  saltFlats: 'model_dependent',
  roughness: 'artistic',
} as const;

export interface Routing {
  /** Land height with the fractal roughness added (model km). */
  h: Float32Array;
  /** Height after priority-flood: every closed basin raised to its spill level. */
  fill: Float32Array;
  /** Receiver of each cell (itself for sea cells and outlets). */
  rec: Int32Array;
  /** Cells from the sea outward (flood order); accumulate in reverse. */
  order: Int32Array;
  cnt: number;
}

export interface HydroInput {
  W: number;
  H: number;
  /** Interleaved (height, boundary) per cell, row 0 = south. */
  data: Float32Array;
  seed: number;
}

/** Steps 1 to 3. Land heights get the roughness; sea cells are the flood's starting points. */
export function routeTerrain(t: HydroInput): Routing {
  const Wd = t.W;
  const Hd = t.H;
  const N = Wd * Hd;
  const seed = boundedSeed(t.seed);
  const h = new Float32Array(N);
  const fb = (x: number, y: number, z: number, n: number): number => {
    let a = 0.5;
    let s = 0;
    let tt = 0;
    for (let i = 0; i < n; i++) {
      s += a * vnoise(x, y, z, seed + 7);
      tt += a;
      x = x * 2.03 + 7.1;
      y = y * 2.03 + 3.3;
      z = z * 2.03 + 1.7;
      a *= 0.5;
    }
    return s / tt;
  };
  for (let i = 0; i < N; i++) {
    const yq = Math.floor(i / Wd);
    const xq = i - yq * Wd;
    const la = ((yq + 0.5) / Hd - 0.5) * Math.PI;
    const lo = ((xq + 0.5) / Wd - 0.5) * 2 * Math.PI;
    const c = Math.cos(la);
    const px = c * Math.cos(lo) * 24;
    const py = Math.sin(la) * 24;
    const pz = c * Math.sin(lo) * 24;
    h[i] = t.data[i * 2]!;
    if (h[i]! > 0)
      h[i] =
        h[i]! +
        0.12 * (fb(px, py, pz, 4) - 0.5) +
        0.05 * (fb(px * 3.1, py * 3.1, pz * 3.1, 3) - 0.5);
  }
  const fill = new Float32Array(N);
  const rec = new Int32Array(N);
  const order = new Int32Array(N);
  const seen = new Uint8Array(N);
  const hIdx = new Int32Array(N + 8);
  const hVal = new Float32Array(N + 8);
  let hn = 0;
  let cnt = 0;
  let low = 0;
  const push = (ix: number, v: number): void => {
    let c = hn++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hVal[p]! <= v) break;
      hVal[c] = hVal[p]!;
      hIdx[c] = hIdx[p]!;
      c = p;
    }
    hVal[c] = v;
    hIdx[c] = ix;
  };
  const pop = (): number => {
    const top = hIdx[0]!;
    const lv = hVal[--hn]!;
    const li = hIdx[hn]!;
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
    hIdx[c] = li;
    return top;
  };
  for (let i = 0; i < N; i++) {
    rec[i] = i;
    if (h[i]! < h[low]!) low = i;
    if (h[i]! <= 0) {
      seen[i] = 1;
      fill[i] = h[i]!;
      push(i, h[i]!);
    }
  }
  if (hn === 0) {
    // No sea at all: the lowest cell is the outlet (a world with no ocean still drains somewhere).
    seen[low] = 1;
    fill[low] = h[low]!;
    push(low, h[low]!);
  }
  while (hn > 0) {
    const cur = pop();
    order[cnt++] = cur;
    const cy = Math.floor(cur / Wd);
    const cx = cur - cy * Wd;
    for (let nj = Math.max(0, cy - 1); nj <= Math.min(Hd - 1, cy + 1); nj++) {
      for (let di = -1; di <= 1; di++) {
        const nb = nj * Wd + ((cx + di + Wd) % Wd);
        if (seen[nb]) continue;
        seen[nb] = 1;
        fill[nb] = Math.max(h[nb]!, fill[cur]! + 1e-5);
        push(nb, fill[nb]!);
      }
    }
  }
  const dLat = Math.PI / Hd;
  for (let i = 0; i < N; i++) {
    if (h[i]! <= 0) continue;
    const y = Math.floor(i / Wd);
    const x = i - y * Wd;
    const cl = Math.max(Math.cos(((y + 0.5) / Hd - 0.5) * Math.PI), 0.02);
    let best = i;
    let bs = 0;
    for (let yj = Math.max(0, y - 1); yj <= Math.min(Hd - 1, y + 1); yj++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && yj === y) continue;
        const nb = yj * Wd + ((x + dx + Wd) % Wd);
        const dist = Math.hypot(dx * cl, yj - y) * dLat;
        const sl = (fill[i]! - fill[nb]!) / dist;
        if (sl > bs) {
          bs = sl;
          best = nb;
        }
      }
    }
    rec[i] = best;
  }
  return { h, fill, rec, order, cnt };
}

export interface HydroClimate {
  nx: number;
  ny: number;
  /** Temperature K per cell, row 0 = south. */
  T: Float32Array;
  /** Rain 0..1 relative to the wettest 60% (the budget's `rain` output). */
  rain: Float32Array;
}

export interface HydroStats {
  rivers: number;
  /** Largest discharge, m^3/s. */
  bigQ: number;
  mouths: number;
  lakes: number;
  salt: number;
}

export interface HydroRaster {
  /** RGBA8: R river or lake water, G salt flat, B sediment plume, A frozen. Row 0 = south. */
  img: Uint8Array;
  RW: number;
  RH: number;
  stats: HydroStats;
}

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

export interface HydroWorld {
  radiusM: number;
  fluid: Fluid;
  /** Dry lapse rate, K per km. */
  lapseKPerKm: number;
  /** Water is the only fluid with the Earth rain scale. */
  isWater: boolean;
}

/** Steps 4 to 7: discharge, channels, lakes and salt flats, deltas, drawn into an RGBA8 raster. */
export function hydroRaster(
  t: HydroInput,
  w: HydroWorld,
  c: HydroClimate,
  rt: Routing,
  RW: number,
  RH: number,
): HydroRaster {
  const Wd = t.W;
  const Hd = t.H;
  const N = Wd * Hd;
  const img = new Uint8Array(RW * RH * 4);
  const F = w.fluid;
  const Rm = w.radiusM;
  const cellA = ((2 * Math.PI * Rm) / Wd) * ((Math.PI * Rm) / Hd);
  const Q = new Float64Array(N);
  const T = new Float32Array(N);
  const ex = c.nx / Wd;
  const ey = c.ny / Hd;
  const P0 = w.isWater ? RAIN_SCALE_WATER : RAIN_SCALE_OTHER;
  const cosLat = (y: number): number => Math.cos(((y + 0.5) / Hd - 0.5) * Math.PI);
  for (let i = 0; i < N; i++) {
    const y = Math.floor(i / Wd);
    const x = i - y * Wd;
    const e = Math.min(c.nx * c.ny - 1, Math.floor(y * ey) * c.nx + Math.floor(x * ex));
    const tc = c.T[e]! - w.lapseKPerKm * Math.max(rt.h[i]!, 0);
    T[i] = tc;
    const P = clamp(c.rain[e]!, 0, 3) * P0;
    const pet = clamp((tc - F.Tt) / 40, 0, 3) * P0 * 1.1;
    const phi = P > 1e-6 ? pet / P : 9;
    const ep = P > 1e-6 ? Math.sqrt(phi * Math.tanh(1 / phi) * (1 - Math.exp(-phi))) : 1;
    const run = tc > F.Tt - 10 ? P * Math.max(0, 1 - ep) : 0;
    Q[i] = rt.h[i]! > 0 ? (run * cellA * cosLat(y)) / SECONDS_PER_YEAR : 0;
  }
  for (let k = rt.cnt - 1; k >= 0; k--) {
    const i = rt.order[k]!;
    const r = rt.rec[i]!;
    if (r !== i && rt.h[i]! > 0) Q[r] = Q[r]! + Q[i]!;
  }
  const plotDisc = (cx: number, cy: number, rad: number, ch: number, val: number): void => {
    const x0 = Math.floor(cx - rad - 1);
    const x1 = Math.ceil(cx + rad + 1);
    const y0 = Math.max(0, Math.floor(cy - rad - 1));
    const y1 = Math.min(RH - 1, Math.ceil(cy + rad + 1));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d = Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy);
        const a = clamp(rad + 0.5 - d, 0, 1) * val;
        if (a <= 0) continue;
        const ix = (yy * RW + (((xx % RW) + RW) % RW)) * 4 + ch;
        img[ix] = Math.max(img[ix]!, Math.round(a * 255));
      }
    }
  };
  const seg = (
    ax: number,
    ay: number,
    bx0: number,
    by: number,
    rad: number,
    ch: number,
    val: number,
  ): void => {
    let bx = bx0;
    if (bx - ax > RW / 2) bx -= RW;
    else if (ax - bx > RW / 2) bx += RW;
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(L / Math.max(rad * 0.7, 0.5)));
    for (let s = 0; s <= n; s++)
      plotDisc(ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n, rad, ch, val);
  };
  const sx = RW / Wd;
  const sy = RH / Hd;
  const jit = (c0: number): [number, number] => {
    const hsh = Math.imul(c0, 2654435761) >>> 0;
    return [((hsh & 1023) / 1023 - 0.5) * 0.6, (((hsh >>> 10) & 1023) / 1023 - 0.5) * 0.6];
  };
  const cen = (c0: number): [number, number] => {
    const y = Math.floor(c0 / Wd);
    const x = c0 - y * Wd;
    const j = jit(c0);
    return [(x + 0.5 + j[0]) * sx, (y + 0.5 + j[1]) * sy];
  };
  const plain = (c0: number): [number, number] => {
    const y = Math.floor(c0 / Wd);
    const x = c0 - y * Wd;
    return [(x + 0.5) * sx, (y + 0.5) * sy];
  };
  const texKm = (2 * Math.PI * Rm) / RW / 1000;
  let nRiv = 0;
  let bigQ = 0;
  const mouths: [number, number, number][] = [];

  // Closed basins: label each set of flooded cells; lake or salt flat from the water balance.
  const basin = new Int32Array(N).fill(-1);
  let nb = 0;
  const stack: number[] = [];
  const basins: { n: number; frac: number }[] = [];
  const flooded = (i: number): boolean => rt.h[i]! > 0 && rt.fill[i]! - rt.h[i]! >= LAKE_MIN_DEPTH;
  for (let i = 0; i < N; i++) {
    if (basin[i]! >= 0 || !flooded(i)) continue;
    const cells: number[] = [];
    let inflow = 0;
    let petA = 0;
    basin[i] = nb;
    stack.push(i);
    while (stack.length) {
      const cc = stack.pop()!;
      cells.push(cc);
      const cy2 = Math.floor(cc / Wd);
      const cx2 = cc - cy2 * Wd;
      inflow = Math.max(inflow, Q[cc]!);
      petA +=
        (clamp((T[cc]! - F.Tt) / 40, 0, 3) * P0 * 1.1 * cellA * cosLat(cy2)) / SECONDS_PER_YEAR;
      for (let yj = Math.max(0, cy2 - 1); yj <= Math.min(Hd - 1, cy2 + 1); yj++) {
        for (let dx2 = -1; dx2 <= 1; dx2++) {
          const n2 = yj * Wd + ((cx2 + dx2 + Wd) % Wd);
          if (basin[n2]! < 0 && flooded(n2)) {
            basin[n2] = nb;
            stack.push(n2);
          }
        }
      }
    }
    if (cells.length < LAKE_MIN_CELLS) {
      nb++;
      continue;
    }
    const frac = petA > 0 ? clamp(inflow / petA, 0, 1) : 1;
    let frozen = 0;
    for (const c3 of cells) if (T[c3]! < F.Tt) frozen++;
    cells.sort((a, b) => rt.fill[b]! - rt.h[b]! - (rt.fill[a]! - rt.h[a]!));
    const nWet = Math.round(cells.length * frac);
    cells.forEach((c3, idx) => {
      const p2 = cen(c3);
      const wet = idx < nWet;
      plotDisc(p2[0], p2[1], 1.05 * sx, wet ? (frozen > cells.length / 2 ? 3 : 0) : 1, 1);
    });
    basins.push({ n: cells.length, frac });
    nb++;
  }
  // Channels.
  for (let i = 0; i < N; i++) {
    if (rt.h[i]! <= 0 || Q[i]! < CHANNEL_Q_M3S) continue;
    const r2 = rt.rec[i]!;
    if (r2 === i) continue;
    const wReal = (4 * Math.sqrt(Q[i]!)) / 1000;
    const wDraw = Math.max(wReal / texKm, 0.9 + Math.log10(Q[i]! / CHANNEL_Q_M3S));
    const a = cen(i);
    const b2 = rt.h[r2]! > 0 ? cen(r2) : plain(r2);
    seg(
      a[0],
      a[1],
      b2[0],
      b2[1],
      wDraw / 2,
      T[i]! < F.Tt - 4 ? 3 : 0,
      clamp(0.5 + 0.2 * Math.log10(Q[i]! / CHANNEL_Q_M3S), 0.5, 1),
    );
    nRiv++;
    if (Q[i]! > bigQ) bigQ = Q[i]!;
    if (rt.h[r2]! <= 0 && Q[i]! > PLUME_Q) mouths.push([i, r2, Q[i]!]);
  }
  // Deltas and sediment plumes at big river mouths.
  for (const mo of mouths) {
    const a = cen(mo[0]);
    const b3 = plain(mo[1]);
    const dx3 = b3[0] - a[0];
    const dy3 = b3[1] - a[1];
    const L = Math.hypot(dx3, dy3) || 1;
    const ux = dx3 / L;
    const uy = dy3 / L;
    const sz = 1.6 + 1.4 * Math.log10(mo[2] / PLUME_Q);
    for (let f = -2; f <= 2; f++) {
      const ang = f * 0.38;
      const vx = ux * Math.cos(ang) - uy * Math.sin(ang);
      const vy = ux * Math.sin(ang) + uy * Math.cos(ang);
      seg(a[0], a[1], a[0] + vx * sz * 2.2, a[1] + vy * sz * 2.2, 0.45, 0, 0.8);
    }
    plotDisc(a[0] + ux * sz * 3, a[1] + uy * sz * 3, sz * 3.2, 2, 0.75);
  }
  return {
    img,
    RW,
    RH,
    stats: {
      rivers: nRiv,
      bigQ,
      mouths: mouths.length,
      lakes: basins.filter((b) => b.frac > 0.05).length,
      salt: basins.filter((b) => b.frac <= 0.05).length,
    },
  };
}

/** Land cells that do not drain to the sea or to a basin outlet (must be 0: the flood guarantees it). */
export function undrainedLandCells(rt: Routing, hasSea = true): number {
  const N = rt.h.length;
  let bad = 0;
  for (let i = 0; i < N; i++) {
    if (rt.h[i]! <= 0) continue;
    let c = i;
    let steps = 0;
    while (rt.rec[c] !== c && steps++ <= N) c = rt.rec[c]!;
    // An outlet is a sea cell. With no sea at all the flood starts at the lowest cell, the one allowed land outlet.
    if (steps > N || (rt.h[c]! > 0 && hasSea)) bad++;
  }
  return bad;
}
