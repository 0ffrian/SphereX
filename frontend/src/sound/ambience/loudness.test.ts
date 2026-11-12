// @vitest-environment node
// §11.4/§11.7: the bake measures loudness with ITU-R BS.1770 K-weighting and gating; checked against the standard's
// reference (a 997 Hz full-scale sine in one channel reads −3.01 LUFS) at 48 kHz and at the bed rates.
import { describe, expect, it } from 'vitest';
import { fft, kWeighting, measureLufs } from './dsp';

function sine(f: number, sr: number, seconds: number, amp = 1): Float64Array {
  const n = Math.round(sr * seconds),
    x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
}

describe('K-weighting', () => {
  it('matches the BS.1770 48 kHz shelf coefficients', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 4);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 4);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 4);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 4);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 4);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 4);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 4);
  });
  it.each([48000, 32000, 29000])(
    '997 Hz sine, amplitude 1, one channel → −3.01 LUFS at %i Hz',
    (sr) => {
      const x = sine(997, sr, 5);
      const silent = new Float64Array(x.length);
      expect(measureLufs([x, silent], sr, false)).toBeCloseTo(-3.01, 1);
    },
  );
  it('scales by 20·log10 of the gain and gates silence', () => {
    const x = sine(997, 32000, 5, 0.1);
    expect(measureLufs([x], 32000, false)).toBeCloseTo(-23.01, 1);
    expect(measureLufs([new Float64Array(32000 * 2)], 32000, false)).toBe(-Infinity);
  });
  it('the relative gate drops a quiet tail', () => {
    const loud = sine(997, 32000, 4, 1),
      quiet = sine(997, 32000, 4, 1e-3);
    const both = new Float64Array(loud.length + quiet.length);
    both.set(loud);
    both.set(quiet, loud.length);
    expect(measureLufs([both], 32000, false)).toBeCloseTo(measureLufs([loud], 32000, false), 0);
  });
});

describe('fft', () => {
  it('round-trips and keeps energy (Parseval)', () => {
    const n = 1024,
      re = new Float64Array(n),
      im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.sin(i * 0.37) + 0.2 * Math.cos(i * 1.9);
      im[i] = Math.cos(i * 0.11);
    }
    const r0 = re.slice(),
      i0 = im.slice();
    const e0 = r0.reduce((a, v, i) => a + v * v + i0[i]! ** 2, 0);
    fft(re, im, false);
    const e1 = re.reduce((a, v, i) => a + v * v + im[i]! ** 2, 0) / n;
    expect(e1).toBeCloseTo(e0, 6);
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      expect(re[i]! / n).toBeCloseTo(r0[i]!, 9);
      expect(im[i]! / n).toBeCloseTo(i0[i]!, 9);
    }
  });
});
