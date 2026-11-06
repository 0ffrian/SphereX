// R7.7, D-12: integer-hash value noise for the shared CPU field. Ported from the mock-up's
// NOISE block (hash13/vnoise/fbm, mockup/spherex-ui.html) with an integer hash, so the same seed
// gives the same numbers on every machine (R1 determinism). Only +, -, *, floor and Math.imul are
// used here, all exactly specified by IEEE 754 and ECMAScript, so no transcendental rounding.

/** murmur3 fmix32 finaliser. */
function fmix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash of an integer lattice point and a seed, in [0, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x1b873593;
  h = fmix(h ^ Math.imul(x | 0, 0x27d4eb2d));
  h = fmix(h ^ Math.imul(y | 0, 0x165667b1));
  h = fmix(h ^ Math.imul(z | 0, 0x85ebca77));
  return h / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Trilinear value noise in [0, 1]. */
export function vnoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const h = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c, seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}

/** Mock-up fbm: lacunarity 2.03, per-octave offset (1.7, 9.2, 3.1), normalised by 0.97. */
export function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x, y, z, seed);
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    z = z * 2.03 + 3.1;
    amp *= 0.5;
  }
  return sum / 0.97;
}

/** Seeded PRNG (mulberry32). Deterministic stream for point clouds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  return smooth(clamp01((x - e0) / (e1 - e0)));
}
