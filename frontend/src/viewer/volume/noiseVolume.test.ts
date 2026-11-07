// Issue #43: the baked noise cube is deterministic (same seed, same bytes) and well formed.
import { describe, expect, it } from 'vitest';
import {
  bakeNoiseVolume,
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
