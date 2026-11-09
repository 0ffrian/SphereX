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

/** Fills the z-slabs [k0, k1) of `out` (RGBA, x fastest then y then z). Shared by the one-shot and the sliced bake, so both give the same bytes. */
function bakeSlabs(out: Uint8Array, size: number, s: number, k0: number, k1: number): void {
  const at = (i: number) => (i / (size - 1)) * 2 - 1;
  let o = k0 * size * size * 4;
  for (let k = k0; k < k1; k++) {
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
}

const seedOf = (seed: number): number => Math.floor(Number.isFinite(seed) ? seed : 0) | 0;

/** RGBA bytes of an `size`^3 cube, x fastest then y then z (the layout of a Data3DTexture). */
export function bakeNoiseVolume(seed: number, size: number = NOISE_VOLUME_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  bakeSlabs(out, size, seedOf(seed), 0, size);
  return out;
}

/** Longest the sliced bake runs before it hands the thread back to the browser (ms). */
export const NOISE_SLICE_MS = 6;

const yieldToBrowser = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * `bakeNoiseVolume` in time slices: no single task longer than about `NOISE_SLICE_MS` plus one
 * slab (about 4 ms at 48^3), so the page keeps drawing and answering input. Same bytes as the
 * one-shot bake. Resolves to null if `isCancelled()` turned true (the scene was torn down).
 */
export async function bakeNoiseVolumeSliced(
  seed: number,
  size: number = NOISE_VOLUME_SIZE,
  isCancelled: () => boolean = () => false,
  sliceMs: number = NOISE_SLICE_MS,
): Promise<Uint8Array | null> {
  const out = new Uint8Array(size * size * size * 4);
  const s = seedOf(seed);
  let k = 0;
  while (k < size) {
    const t0 = performance.now();
    do {
      bakeSlabs(out, size, s, k, k + 1);
      k++;
    } while (k < size && performance.now() - t0 < sliceMs);
    if (k < size) {
      await yieldToBrowser();
      if (isCancelled()) return null;
    }
  }
  return isCancelled() ? null : out;
}

const cache = new Map<number, Uint8Array>();
const CACHE_LIMIT = 6;

/** `bakeNoiseVolume` with a small cache by seed (a rebuilt scene does not bake again). */
export function noiseVolumeData(seed: number): Uint8Array {
  const hit = cache.get(seed);
  if (hit) return hit;
  const data = bakeNoiseVolume(seed);
  remember(seed, data);
  return data;
}

function remember(seed: number, data: Uint8Array): void {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as number);
  cache.set(seed, data);
}

const inflight = new Map<number, Promise<Uint8Array | null>>();
/** Bakes in flight: the viewer's `whenSettled` waits for these, so a golden frame has its noise. */
let pending = 0;
const idleWaiters: (() => void)[] = [];

/** True while a sliced bake is running. */
export const noiseBakePending = (): boolean => pending > 0;

/** Resolves when no sliced bake is running. */
export function whenNoiseIdle(): Promise<void> {
  return pending === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
}

/**
 * Cached cube if there is one, else a sliced bake that fills the cache (deduplicated by seed, so
 * two volumes of one scene bake once). Resolves to null if the caller cancelled meanwhile; the
 * shared bake itself always finishes (about 440 KB, cached for the next scene).
 */
export function noiseVolumeAsync(
  seed: number,
  isCancelled: () => boolean = () => false,
): Promise<Uint8Array | null> {
  const hit = cache.get(seed);
  if (hit) return Promise.resolve(isCancelled() ? null : hit);
  let p = inflight.get(seed);
  if (!p) {
    pending++;
    p = bakeNoiseVolumeSliced(seed).then((data) => {
      inflight.delete(seed);
      if (data) remember(seed, data);
      if (--pending === 0) for (const w of idleWaiters.splice(0)) w();
      return data;
    });
    inflight.set(seed, p);
  }
  return p.then((d) => (isCancelled() ? null : d));
}

/** The cached cube if baked already, else null (no work). */
export function noiseVolumeCached(seed: number): Uint8Array | null {
  return cache.get(seed) ?? null;
}
