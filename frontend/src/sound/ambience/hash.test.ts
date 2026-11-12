// App. B (amendment 1): hash32 is FNV-1a 32-bit over parts.join('|').
import { describe, expect, it } from 'vitest';
import { hash32 } from './hash';

describe('hash32', () => {
  it('matches the FNV-1a reference vectors', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('a')).toBe(0xe40c292c);
    expect(hash32('foobar')).toBe(0xbf9cf968);
  });
  it('joins its parts with "|" (§9.3 seed_bed)', () => {
    expect(hash32(12345, 'S1_land', 0)).toBe(hash32('12345|S1_land|0'));
    expect(hash32(12345, 'S1_land', 0)).not.toBe(hash32(12345, 'S1_land', 1));
  });
  it('is an unsigned 32-bit integer', () => {
    const h = hash32('x', 1.5, -2);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});
