import { describe, expect, it } from 'vitest';
import {
  formatCoords,
  formatFlux,
  formatNumber,
  formatUtc,
  formatWavelength,
  TIME_WITHOUT_ZONE,
} from './format';

describe('formatting', () => {
  it('formats UTC times in a fixed form', () => {
    expect(formatUtc('2025-05-03T14:22:10.123Z')).toBe('2025-05-03 14:22:10 UTC');
    expect(formatUtc('2025-05-03T18:22:10+04:00')).toBe('2025-05-03 14:22:10 UTC');
    expect(formatUtc('2025-05-03T14:22Z')).toBe('2025-05-03 14:22:00 UTC');
  });

  it('never reads a zone-less time as local time', () => {
    expect(formatUtc('2025-05-03T14:22:10')).toBe(TIME_WITHOUT_ZONE);
    expect(formatUtc('not a time')).toBe(TIME_WITHOUT_ZONE);
  });

  it('formats wavelengths, numbers, flux and coordinates', () => {
    expect(formatWavelength(1.42)).toBe('1.420 µm');
    expect(formatNumber(3.14159)).toBe('3.14');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(123456)).toBe('1.23e+5');
    expect(formatNumber(0.0001234)).toBe('1.23e-4');
    expect(formatFlux(3.14159, 0.2, 'mJy')).toBe('3.14 ± 0.2 mJy');
    expect(formatCoords(269.452083, -4.693389)).toBe('RA 269.45208°, Dec −4.69339°');
  });
});
