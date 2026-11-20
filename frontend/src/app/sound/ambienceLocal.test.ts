import { describe, expect, it } from 'vitest';
import { sampleLocal } from './ambienceLocal';
import { atmosphereOf } from '@/app/build/hearModel';

describe('sampleLocal', () => {
  it('returns null with no engine or place, so the sound uses the global values', () => {
    const r = atmosphereOf(null);
    expect(r.ok).toBe(false);
    // A minimal model: sampleLocal reads only the world store, which is empty here.
    const model = { P: 1, T: 288, c: 340, gas: 'air', gMs2: 9.8 } as unknown as Parameters<
      typeof sampleLocal
    >[0];
    expect(sampleLocal(model)).toBeNull();
  });
});
