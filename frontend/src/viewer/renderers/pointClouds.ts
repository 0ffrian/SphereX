// R7.7, A6: nebula (`gas-cloud`) and nova (`shell-remnant`) point sets, ported from the mock-up
// (mkNoise, pointsOf and the nebula / nova blocks of the Build view). Pure and seeded: the same
// seed gives byte-identical arrays. Every colour and position is `artistic` (D-12: slider-only
// showcase bodies). The mock-up animates a "build" slider; this port produces the finished state.
import { clamp01, fbm, mulberry32 } from '../fields/noise';

export interface PointSet {
  count: number;
  /** xyz per point, unit-scale (the renderer scales the group). */
  positions: Float32Array;
  /** rgb per point, 0..1. */
  colors: Float32Array;
}

export interface NebulaPoints {
  glow: PointSet;
  dust: PointSet;
  stars: PointSet;
}
export interface NovaPoints {
  shell: PointSet;
  hot: PointSet;
  core: PointSet;
}

// Mock-up sizes. 14000 + 3500 + 500 = 18000 and 16000 + 4500 + 1 = 20501 stay under the 60k
// points budget (D-05). Mobile may want fewer; that is a later tuning step.
export const NEBULA_COUNTS = { glow: 14000, dust: 3500, stars: 500 } as const;
export const NOVA_COUNTS = { shell: 16000, hot: 4500 } as const;
// Mock-up slider defaults at full build (artistic).
const FILAMENTS = 0.6;
const CLUMPINESS = 0.5;

const noise3 = (seed: number) => (x: number, y: number, z: number, oct: number) =>
  fbm(x, y, z, oct, seed);

function ballPoint(rr: () => number): [number, number, number] {
  for (;;) {
    const x = rr() * 2 - 1;
    const y = rr() * 2 - 1;
    const z = rr() * 2 - 1;
    if (x * x + y * y + z * z <= 1) return [x, y, z];
  }
}

function filamentSet(
  n: number,
  seed: number,
  rr: () => number,
  power: number,
): { pos: Float32Array; sp: Float32Array; dn: Float32Array; count: number } {
  const f3 = noise3(seed);
  const pos = new Float32Array(n * 3);
  const sp = new Float32Array(n);
  const dn = new Float32Array(n);
  let i = 0;
  for (let tries = 0; i < n && tries < n * 60; tries++) {
    const x = rr() * 2 - 1;
    const y = rr() * 2 - 1;
    const z = rr() * 2 - 1;
    const r = Math.hypot(x, y, z);
    if (r > 1) continue;
    const q = f3(x * 1.3 + 4, y * 1.3 + 4, z * 1.3 + 4, 4);
    const rid = 1 - Math.abs(2 * q - 1);
    let w = q + (rid * rid * 1.4 - q) * FILAMENTS;
    const cl = f3(x * 3.1, y * 3.1, z * 3.1, 3);
    w *= (1 + (clamp01((cl - 0.3) * 3) - 1) * CLUMPINESS) * Math.pow(1 - r, 0.7);
    if (rr() > Math.pow(w, power)) continue;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y * 0.8;
    pos[i * 3 + 2] = z;
    sp[i] = f3(x * 1.7 + 20, y * 1.7, z * 1.7, 3);
    dn[i] = w;
    i++;
  }
  return { pos, sp, dn, count: i };
}

export function generateNebula(seed: number): NebulaPoints {
  const rr = mulberry32(seed + 5);
  const g = filamentSet(NEBULA_COUNTS.glow, seed + 5, rr, 1.4);
  const d = filamentSet(NEBULA_COUNTS.dust, seed + 77, rr, 1.1);

  // Hydrogen red / oxygen teal mix (mock-up colour block at full "glow").
  const gc = new Float32Array(g.count * 3);
  for (let i = 0; i < g.count; i++) {
    const s1 = clamp01((g.sp[i]! - 0.35) * 3);
    const k2 = 0.35 + 0.9 * g.dn[i]!;
    const ha = 0.8;
    const o3 = 0.45 * 1.4;
    gc[i * 3] = k2 * ((1 - s1) * ha + s1 * o3 * 0.15 + 0.03);
    gc[i * 3 + 1] = k2 * ((1 - s1) * ha * 0.22 + s1 * o3 * 0.85 + 0.03);
    gc[i * 3 + 2] = k2 * ((1 - s1) * ha * 0.3 + s1 * o3 * 0.75 + 0.03);
  }
  const dc = new Float32Array(d.count * 3);
  for (let i = 0; i < d.count; i++) {
    dc[i * 3] = 0.06;
    dc[i * 3 + 1] = 0.035;
    dc[i * 3 + 2] = 0.03;
  }
  const sN = NEBULA_COUNTS.stars;
  const sp = new Float32Array(sN * 3);
  const sc = new Float32Array(sN * 3);
  for (let i = 0; i < sN; i++) {
    const [x, y, z] = ballPoint(rr);
    sp[i * 3] = x;
    sp[i * 3 + 1] = y * 0.8;
    sp[i * 3 + 2] = z;
    const t = rr();
    sc[i * 3] = 1;
    sc[i * 3 + 1] = 0.85 + 0.15 * t;
    sc[i * 3 + 2] = 0.7 + 0.3 * t;
  }
  return {
    glow: { count: g.count, positions: g.pos.subarray(0, g.count * 3), colors: gc },
    dust: { count: d.count, positions: d.pos.subarray(0, d.count * 3), colors: dc },
    stars: { count: sN, positions: sp, colors: sc },
  };
}

export function generateNova(seed: number): NovaPoints {
  const rr = mulberry32(seed + 31);
  const f3 = noise3(seed + 31);
  const NSH = NOVA_COUNTS.shell;
  const pos = new Float32Array(NSH * 3);
  const col = new Float32Array(NSH * 3);
  let i = 0;
  for (let tries = 0; i < NSH && tries < NSH * 40; tries++) {
    const gx = rr() + rr() + rr() - 1.5;
    const gy = rr() + rr() + rr() - 1.5;
    const gz = rr() + rr() + rr() - 1.5;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-4) continue;
    const dx = gx / l;
    const dy = gy / l;
    const dz = gz / l;
    const q = f3(dx * 3 + 6, dy * 3 + 6, dz * 3 + 6, 4);
    const rid = 1 - Math.abs(2 * q - 1);
    const w = 1 + (rid * rid * 2.2 - 1) * 0.7;
    if (rr() > w) continue;
    const gauss = (rr() + rr() + rr() - 1.5) * 2;
    const r = 1 + 0.18 * gauss * 0.5;
    const dsx = f3(dx * 5, dy * 5, dz * 5, 3) - 0.5;
    const dsy = f3(dx * 5 + 9, dy * 5, dz * 5, 3) - 0.5;
    const dsz = f3(dx * 5, dy * 5 + 9, dz * 5, 3) - 0.5;
    pos[i * 3] = dx * r + dsx * 0.16 * 0.7;
    pos[i * 3 + 1] = dy * r + dsy * 0.16 * 0.7;
    pos[i * 3 + 2] = dz * r + dsz * 0.16 * 0.7;
    const sp = f3(dx * 2 + 30, dy * 2, dz * 2, 3);
    const rd = clamp01((gauss + 1.5) / 3);
    const s1 = clamp01((sp - 0.3) * 2.4 + (rd - 0.5) * 0.8);
    const ha = 0.7;
    const o3 = 0.6;
    const k2 = 0.9;
    col[i * 3] = k2 * ((1 - s1) * ha + s1 * o3 * 0.15 + 0.03);
    col[i * 3 + 1] = k2 * ((1 - s1) * ha * 0.2 + s1 * o3 * 0.85 + 0.03);
    col[i * 3 + 2] = k2 * ((1 - s1) * ha * 0.25 + s1 * o3 * 0.75 + 0.03);
    i++;
  }
  const NHOT = NOVA_COUNTS.hot;
  const hp = new Float32Array(NHOT * 3);
  const hc = new Float32Array(NHOT * 3);
  for (let q = 0; q < NHOT; q++) {
    const ax = rr() + rr() + rr() - 1.5;
    const ay = rr() + rr() + rr() - 1.5;
    const az = rr() + rr() + rr() - 1.5;
    const al = Math.hypot(ax, ay, az) || 1;
    const r2 = Math.pow(rr(), 0.6) * 0.85;
    hp[q * 3] = (ax / al) * r2;
    hp[q * 3 + 1] = (ay / al) * r2;
    hp[q * 3 + 2] = (az / al) * r2;
    hc[q * 3] = 0.25;
    hc[q * 3 + 1] = 0.42;
    hc[q * 3 + 2] = 0.7;
  }
  return {
    shell: { count: i, positions: pos.subarray(0, i * 3), colors: col.subarray(0, i * 3) },
    hot: { count: NHOT, positions: hp, colors: hc },
    core: {
      count: 1,
      positions: new Float32Array([0, 0, 0]),
      colors: new Float32Array([0.8, 0.9, 1]),
    },
  };
}
