// WP2 (issue #39): shared TSL noise building blocks (three r187, `three/tsl`). Pure functions of
// (position, seed, t): no Math.random, no Date, no per-frame state. For shader-generated kinds and
// later renderers only; baked kinds never compute noise per frame (R5.5). Every output here is a
// visual-only texture, so any layer built from it is `artistic` (R7.7).
//
// r187 APIs used (node_modules/three/src/nodes/materialx/MaterialXNodes.js):
//   mx_noise_float(texcoord, amplitude = 1, pivot = 0)  Perlin, roughly [-1, 1], vec2|vec3 input
//   mx_worley_noise_float(texcoord, jitter = 1, style = 0)  Worley F1 distance, vec2|vec3 input
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { abs, float, mx_noise_float, mx_worley_noise_float, vec3 } from 'three/tsl';

/** Quality-tier octave counts (R5.7): the tier supplies one of these as a plain number. */
export const OCTAVES = { high: 6, medium: 5, low: 4 } as const;
export type Octaves = (typeof OCTAVES)[keyof typeof OCTAVES] | number;

/** Per-octave lattice shift so octaves do not share lattice points. */
const OCTAVE_SHIFT = 17.31;
const LACUNARITY = 2;
const GAIN = 0.5;
/** Offset range of the seed hash. Integers below 2^8 stay exact in float32. */
const SEED_RANGE = 256;
/** Drift speed of animatedCells along its time axis (artistic). */
const CELL_DRIFT = 0.25;

/** murmur3 fmix32 finaliser. */
function fmix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deterministic CPU hash of an integer seed to a vec3 offset in [0, 256)^3 (integer valued).
 * All bits of the seed count: the low and high 32 bits are mixed separately, then combined.
 * Non-finite input is treated as 0; fractions are floored.
 */
export function seedOffset(seed: number): [number, number, number] {
  const s = Math.floor(Number.isFinite(seed) ? seed : 0);
  const lo = s >>> 0; // low 32 bits (two's complement for negatives)
  const hi = Math.floor(s / 4294967296) >>> 0;
  const h0 = fmix((lo ^ 0x9e3779b9) >>> 0);
  const h = fmix((h0 ^ Math.imul(hi, 0x85ebca6b) ^ hi) >>> 0);
  const a = fmix((h + 0x1b873593) >>> 0);
  const b = fmix((a + 0x1b873593) >>> 0);
  const c = fmix((b + 0x1b873593) >>> 0);
  return [a % SEED_RANGE, b % SEED_RANGE, c % SEED_RANGE];
}

/** The seed offset as a constant vec3 node. */
export function seedNode(seed: number): any {
  const [x, y, z] = seedOffset(seed);
  return vec3(x, y, z);
}

/** Fractal Brownian motion in about [-1, 1]. `octaves` is a plain number (loop unrolled at build). */
export function fbm(p: any, octaves: Octaves, seed: any = vec3(0)): any {
  const q = p.add(seed);
  let sum: any = float(0);
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum = sum.add(mx_noise_float(q.mul(freq).add(i * OCTAVE_SHIFT)).mul(amp));
    norm += amp;
    amp *= GAIN;
    freq *= LACUNARITY;
  }
  return sum.div(norm);
}

/** Ridged multifractal in about [0, 1]: sharp crests where the base noise crosses zero. */
export function ridged(p: any, octaves: Octaves, seed: any = vec3(0)): any {
  const q = p.add(seed);
  let sum: any = float(0);
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const r = float(1).sub(abs(mx_noise_float(q.mul(freq).add(i * OCTAVE_SHIFT))));
    sum = sum.add(r.mul(r).mul(amp));
    norm += amp;
    amp *= GAIN;
    freq *= LACUNARITY;
  }
  return sum.div(norm);
}

/** Domain warp: returns the displaced position (vec3); feed it to fbm / ridged / cells. */
export function domainWarp(p: any, amount: any, octaves: Octaves, seed: any = vec3(0)): any {
  const dx = fbm(p, octaves, seed.add(vec3(5.2, 1.3, 7.7)));
  const dy = fbm(p, octaves, seed.add(vec3(9.1, 3.7, 2.4)));
  const dz = fbm(p, octaves, seed.add(vec3(1.9, 8.3, 4.6)));
  return p.add(vec3(dx, dy, dz).mul(amount));
}

/** Worley cells (F1 distance) drifting with time `t` along z. A pure function of (p, t, seed). */
export function animatedCells(p: any, t: any, seed: any = vec3(0)): any {
  const q = p.add(seed);
  return mx_worley_noise_float(vec3(q.x, q.y, q.z.add(float(t).mul(CELL_DRIFT))));
}
