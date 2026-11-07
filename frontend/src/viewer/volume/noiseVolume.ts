// Issue #43: the density noise of the volumes, baked once on the CPU into a small RGBA 3D texture
// and sampled by the ray-march (one lookup per step instead of several noise evaluations: the
// march cost is then steps x one fetch, which is what the phone budget needs). Deterministic: the
// same seed gives byte-identical data (the integer-hash noise of fields/noise.ts, no Math.random).
// Every channel is a visual-only texture, so anything drawn from it is `artistic` (R7.7).
import { fbm } from '../fields/noise';

/** Edge of the cube in voxels. 48^3 x 4 bytes = 442 KB. Display choice. */
export const NOISE_VOLUME_SIZE = 48;

/** Channel meaning (RGBA, each 0..255 for 0..1). */
export const NOISE_CHANNELS = {
  /** Filament field, 4 octaves: thin crests where it crosses 0.5. */
  filament: 0,
  /** Colour field, 2 octaves: mixes the two emission lines. */
  species: 1,
  /** Clumps and soft grain, 4 octaves. */
  grain: 2,
  /** Fine ridges, 3 octaves: thin line-emitting filaments. */
  ridge: 3,
} as const;

const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** One voxel's four channels at box-space point (x, y, z) in [-1, 1]^3. */
export function noiseVoxel(
  x: number,
  y: number,
  z: number,
  seed: number,
): [number, number, number, number] {
  return [
    fbm(x * 2 + 4, y * 2 + 4, z * 2 + 4, 4, seed),
    fbm(x * 2.6 + 20, y * 2.6 + 20, z * 2.6 + 20, 2, seed + 1),
    fbm(x * 2.6, y * 2.6, z * 2.6, 4, seed + 2),
    fbm(x * 4.5 + 7, y * 4.5 + 7, z * 4.5 + 7, 3, seed + 3),
  ];
}

/** RGBA bytes of an `size`^3 cube, x fastest then y then z (the layout of a Data3DTexture). */
export function bakeNoiseVolume(seed: number, size: number = NOISE_VOLUME_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const s = Math.floor(Number.isFinite(seed) ? seed : 0) | 0;
  const at = (i: number) => (i / (size - 1)) * 2 - 1;
  let o = 0;
  for (let k = 0; k < size; k++) {
    const z = at(k);
    for (let j = 0; j < size; j++) {
      const y = at(j);
      for (let i = 0; i < size; i++) {
        const v = noiseVoxel(at(i), y, z, s);
        out[o++] = q(v[0]);
        out[o++] = q(v[1]);
        out[o++] = q(v[2]);
        out[o++] = q(v[3]);
      }
    }
  }
  return out;
}

const cache = new Map<number, Uint8Array>();
const CACHE_LIMIT = 6;

/** `bakeNoiseVolume` with a small cache by seed (a rebuilt scene does not bake again). */
export function noiseVolumeData(seed: number): Uint8Array {
  const hit = cache.get(seed);
  if (hit) return hit;
  const data = bakeNoiseVolume(seed);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as number);
  cache.set(seed, data);
  return data;
}
