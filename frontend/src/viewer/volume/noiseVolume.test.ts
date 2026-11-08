// Issue #43: the baked noise cube is deterministic (same seed, same bytes) and well formed.
import { describe, expect, it, vi } from 'vitest';
import {
  bakeNoiseVolume,
  bakeNoiseVolumeSliced,
  noiseBakePending,
  noiseVolumeAsync,
  noiseVolumeCached,
  whenNoiseIdle,
  NOISE_CHANNELS,
  NOISE_VOLUME_SIZE,
  noiseVolumeData,
  noiseVoxel,
} from './noiseVolume';

describe('baked volume noise', () => {
  it('has size^3 RGBA voxels', () => {
    expect(bakeNoiseVolume(1, 8)).toHaveLength(8 * 8 * 8 * 4);
    expect(noiseVolumeData(1)).toHaveLength(NOISE_VOLUME_SIZE ** 3 * 4);
  });

  it('is byte-identical for the same seed and different for another', () => {
    const a = bakeNoiseVolume(42, 12);
    const b = bakeNoiseVolume(42, 12);
    const c = bakeNoiseVolume(43, 12);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('a cached cube is the same bytes as a fresh bake', () => {
    const cached = noiseVolumeData(7);
    expect(noiseVolumeData(7)).toBe(cached);
    expect(Buffer.from(cached).equals(Buffer.from(bakeNoiseVolume(7)))).toBe(true);
  });

  it('uses the whole 0..255 range in every channel (no flat channel)', () => {
    const d = bakeNoiseVolume(5, 16);
    for (const ch of Object.values(NOISE_CHANNELS)) {
      let lo = 255;
      let hi = 0;
      for (let i = ch; i < d.length; i += 4) {
        lo = Math.min(lo, d[i]!);
        hi = Math.max(hi, d[i]!);
      }
      expect(hi - lo).toBeGreaterThan(60);
    }
  });

  it('voxel values are a pure function of position and seed', () => {
    expect(noiseVoxel(0.1, -0.4, 0.7, 3)).toEqual(noiseVoxel(0.1, -0.4, 0.7, 3));
    expect(noiseVoxel(0.1, -0.4, 0.7, 3)).not.toEqual(noiseVoxel(0.1, -0.4, 0.7, 4));
  });

  it('an invalid seed bakes like seed 0 instead of throwing', () => {
    expect(Buffer.from(bakeNoiseVolume(NaN, 6)).equals(Buffer.from(bakeNoiseVolume(0, 6)))).toBe(
      true,
    );
  });
});

describe('sliced noise bake (no long task)', () => {
  it('gives the same bytes as the one-shot bake, with a yield between slabs', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const sliced = await bakeNoiseVolumeSliced(42, 12, () => false, 0);
    // sliceMs 0: one slab per slice, so 12 slabs make 11 yields.
    expect(spy.mock.calls.filter((c) => c[1] === 0).length).toBeGreaterThanOrEqual(11);
    spy.mockRestore();
    expect(Buffer.from(sliced!).equals(Buffer.from(bakeNoiseVolume(42, 12)))).toBe(true);
  });

  it('stops and returns null when cancelled', async () => {
    let calls = 0;
    const out = await bakeNoiseVolumeSliced(1, 12, () => ++calls > 2, 0);
    expect(out).toBeNull();
  });

  it('the cached async bake is the one-shot bytes, deduplicated by seed, and reports idle', async () => {
    expect(noiseVolumeCached(9001)).toBeNull();
    const a = noiseVolumeAsync(9001);
    const b = noiseVolumeAsync(9001);
    expect(noiseBakePending()).toBe(true);
    await whenNoiseIdle();
    expect(noiseBakePending()).toBe(false);
    const [x, y] = await Promise.all([a, b]);
    expect(x).toBe(y);
    expect(noiseVolumeCached(9001)).toBe(x);
    expect(Buffer.from(x!).equals(Buffer.from(bakeNoiseVolume(9001)))).toBe(true);
  }, 30_000);

  it('a cancelled waiter gets null but the cube is still cached for the next scene', async () => {
    const out = await noiseVolumeAsync(9002, () => true);
    expect(out).toBeNull();
    await whenNoiseIdle();
    expect(noiseVolumeCached(9002)).not.toBeNull();
  }, 30_000);
});
