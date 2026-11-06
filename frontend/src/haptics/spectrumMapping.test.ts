// R8.6: the shared spectrum → sample mapping (normalisation, quiet, noisy, interpolation) and the
// pitch mapping it uses.
import { describe, expect, it } from 'vitest';
import { latitudeToPitch, pitchToHz, wavelengthToPitch } from './pitch';
import { buildSpectrumMapping, type SpectrumMappingPoint } from './spectrumMapping';
import { PITCH_MIN_HZ, PITCH_OCTAVES } from './tuning';

const pt = (
  wavelength_um: number,
  flux: number,
  error = 0,
  flagged = false,
): SpectrumMappingPoint => ({
  wavelength_um,
  flux,
  error,
  flagged,
});

describe('spectrumMapping (R8.6)', () => {
  it('normalises by the largest unflagged flux and interpolates linearly in λ', () => {
    const m = buildSpectrumMapping([pt(2, 10), pt(1, 5), pt(3, 999, 0, true), pt(4, 0)]);
    expect(m.count).toBe(3);
    expect([m.lambdaMinUm, m.lambdaMaxUm]).toEqual([1, 4]);
    expect(m.sampleAt(1)!.strength).toBeCloseTo(0.5);
    expect(m.sampleAt(1.5)!.strength).toBeCloseTo(0.75);
    expect(m.sampleAt(2)!.strength).toBeCloseTo(1);
    expect(m.sampleAt(3)!.strength).toBeCloseTo(0.5); // between 2 µm and 4 µm, flagged 3 µm dropped
  });

  it('is quiet below 20% (absorption dips)', () => {
    const m = buildSpectrumMapping([pt(1, 10), pt(2, 1), pt(3, 10)]);
    expect(m.sampleAt(2)!.quiet).toBe(true);
    expect(m.sampleAt(1)!.quiet).toBe(false);
    expect(m.sampleAt(1.9)!.quiet).toBe(true); // 0.19
    expect(m.sampleAt(1.85)!.quiet).toBe(false); // 0.235
  });

  it('is noisy where σ/flux > 0.3 at the nearest point', () => {
    const m = buildSpectrumMapping([pt(1, 10, 1), pt(2, 10, 4), pt(3, -1, 1)]);
    expect(m.sampleAt(1)!.noisy).toBe(false);
    expect(m.sampleAt(1.6)!.noisy).toBe(true);
    expect(m.sampleAt(3)!.noisy).toBe(true); // non-positive flux with an error
    expect(m.sampleAt(3)!.strength).toBe(0);
  });

  it('gives null outside the data and when nothing is usable', () => {
    const m = buildSpectrumMapping([pt(1, 1), pt(2, 2)]);
    expect(m.sampleAt(0.5)).toBeNull();
    expect(m.sampleAt(2.5)).toBeNull();
    expect(m.sampleAt(NaN)).toBeNull();
    expect(buildSpectrumMapping([]).empty).toBe(true);
    expect(buildSpectrumMapping([pt(1, 0), pt(2, -3)]).empty).toBe(true);
    expect(buildSpectrumMapping([pt(1, 5, 0, true)]).sampleAt(1)).toBeNull();
    expect(buildSpectrumMapping([pt(1, NaN), pt(2, 4)]).count).toBe(1);
  });

  it('averages points that share a λ (mean flux, mean σ)', () => {
    const m = buildSpectrumMapping([pt(1, 4, 0.4), pt(2, 10), pt(1, 2, 2)]);
    expect(m.count).toBe(2);
    expect(m.sampleAt(1)!.strength).toBeCloseTo(0.3); // (4 + 2) / 2 / 10
    expect(m.sampleAt(1)!.noisy).toBe(true); // mean σ 1.2 / mean flux 3 = 0.4
  });

  it('reuses the out object and takes pitch from λ, not brightness (Q-58)', () => {
    const m = buildSpectrumMapping([pt(1, 10), pt(4, 1)]);
    const out = { wavelengthUm: 0, strength: 0, quiet: false, noisy: false, pitch: 0 };
    expect(m.sampleAt(2, out)).toBe(out);
    expect(out.pitch).toBeCloseTo(wavelengthToPitch(2));
    const bright = m.sampleAt(1)!.pitch;
    const dim = m.sampleAt(4)!.pitch;
    expect(dim).toBeGreaterThan(bright); // longer λ, higher pitch, though dimmer
  });
});

describe('pitch (R8.9)', () => {
  it('maps 0–1 exponentially onto the tuning range', () => {
    expect(pitchToHz(0)).toBeCloseTo(PITCH_MIN_HZ);
    expect(pitchToHz(1)).toBeCloseTo(PITCH_MIN_HZ * 2 ** PITCH_OCTAVES);
    expect(pitchToHz(2)).toBeCloseTo(pitchToHz(1));
    expect(pitchToHz(undefined)).toBeCloseTo(pitchToHz(0.5));
  });

  it('maps λ over the SPHEREx band and latitude over ±90°', () => {
    expect(wavelengthToPitch(0.75)).toBe(0);
    expect(wavelengthToPitch(5)).toBe(1);
    expect(wavelengthToPitch(10)).toBe(1);
    expect(wavelengthToPitch(2, 2, 2)).toBe(0.5);
    expect(latitudeToPitch(-90)).toBe(0);
    expect(latitudeToPitch(0)).toBe(0.5);
    expect(latitudeToPitch(90)).toBe(1);
  });
});
