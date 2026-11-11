// Issue #93 3 (2.1): one seed helper for the D-37 engines (worlds, stars, rocks).
//
// A card object gets a 32-bit avalanche hash (murmur3's fmix32 finaliser, the same mixing as viewer/fields/noise.ts
// hash3) and, from it, three integers in [0, 256) that the shaders add to their noise coordinates as a vec3. The
// prototype added one small seed along (1, 1, 1), so nearby seeds gave shifted copies of one pattern (about 97 rock
// patterns, world seeds 1..997). A vec3 of three independent bytes gives 2^24 offsets, and integer offsets keep every
// noise lattice aligned, so no seed is a fraction of a cell away from another.
//
// The prototype's own presets do not use this: they keep their integer seed along (1, 1, 1), so they render as before.
// Provenance: a seed is `artistic` (it picks one of many equally valid patterns; it measures nothing).

/** murmur3 fmix32 finaliser: every input bit flips each output bit with probability about 1/2. */
export function fmix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 32-bit hash of a string (FNV-1a, then fmix32 so short ids that differ in one character spread over all bits). */
export function hashString32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** 32-bit hash of an integer seed (the card's RenderParams.seed). Non-finite input hashes as 0. */
export function hashInt32(n: number): number {
  const v = Number.isFinite(n) ? Math.floor(Math.abs(n)) : 0;
  // Fold values above 2^32 in, so no bit of a large seed is lost.
  return fmix32((v >>> 0) ^ Math.imul(Math.floor(v / 4294967296) | 0, 0x9e3779b1));
}

/** Upper end (exclusive) of each component of seedVec. Small, so a float32 noise coordinate keeps its precision. */
export const SEED_VEC_RANGE = 256;

/**
 * Three integers in [0, 256) from a 32-bit hash, for `uniform vec3` noise offsets. Each component re-mixes the hash
 * with its own constant (golden-ratio steps), so the three are independent and a one-bit change of the hash changes
 * all three.
 */
export function seedVec(hash: number): [number, number, number] {
  const h = hash >>> 0;
  return [
    fmix32(h ^ 0x9e3779b9) % SEED_VEC_RANGE,
    fmix32(h ^ 0x3c6ef372) % SEED_VEC_RANGE,
    fmix32(h ^ 0xdaa66d2b) % SEED_VEC_RANGE,
  ];
}
