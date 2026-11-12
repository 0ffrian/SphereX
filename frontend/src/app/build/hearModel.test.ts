import { describe, expect, it } from 'vitest';
import { pitchToHz, wavelengthToPitch } from '@/sound/pitch';
import { cutoffHz, freqAt, howlHz, lamAt, loudness, SOUND_REF_MS, L0_UM, L1_UM } from './hearModel';

describe('hearModel pure functions', () => {
  it('cutoffHz rises with pressure and is clamped to 300..9300 Hz', () => {
    expect(cutoffHz(0)).toBe(300);
    expect(cutoffHz(1)).toBe(9300);
    expect(cutoffHz(50)).toBe(9300);
    expect(cutoffHz(0.25)).toBeCloseTo(4800, 6);
    expect(cutoffHz(0.5)).toBeGreaterThan(cutoffHz(0.1));
  });
  it('loudness rises with pressure and stays within 0.15..1', () => {
    expect(loudness(0)).toBeCloseTo(0.15, 9);
    expect(loudness(100)).toBe(1);
    expect(loudness(0.3)).toBeGreaterThan(loudness(0.1));
    for (const P of [0, 0.01, 0.5, 1, 90]) {
      expect(loudness(P)).toBeGreaterThanOrEqual(0.15);
      expect(loudness(P)).toBeLessThanOrEqual(1);
    }
  });
  it('howlHz is 180 Hz at the reference sound speed and scales linearly', () => {
    expect(howlHz(SOUND_REF_MS)).toBeCloseTo(180, 9);
    expect(howlHz(2 * SOUND_REF_MS)).toBeCloseTo(360, 9);
  });
  it('lamAt spans the SPHEREx range', () => {
    expect(lamAt(0)).toBe(L0_UM);
    expect(lamAt(1)).toBe(L1_UM);
  });
  it('freqAt follows pitch.ts (Q-446): 220 x 2^2.4 Hz at 0.75 um falling to 220 Hz at 5 um', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(freqAt(p)).toBeCloseTo(pitchToHz(wavelengthToPitch(lamAt(p))), 9);
    }
    expect(freqAt(0)).toBeCloseTo(220 * 2 ** 2.4, 6);
    expect(freqAt(1)).toBeCloseTo(220, 6);
    let prev = Infinity;
    for (let i = 0; i <= 20; i++) {
      const f = freqAt(i / 20);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });
});

describe('Hear it follows the app pitch polarity (Q-430)', () => {
  it('freqAt moves the same way as pitch.ts across the band', () => {
    // A flip of PITCH_RISES_WITH_WAVELENGTH would make these disagree.
    const appRises = pitchToHz(wavelengthToPitch(L1_UM)) > pitchToHz(wavelengthToPitch(L0_UM));
    const hearRises = freqAt(1) > freqAt(0);
    expect(hearRises).toBe(appRises);
  });
});
