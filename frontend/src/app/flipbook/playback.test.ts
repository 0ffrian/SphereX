import { describe, expect, it } from 'vitest';
import { clampIndex, nextIndex, readyToPlay } from './playback';

describe('playback helpers', () => {
  it('wraps to the first frame after the last', () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });

  it('clamps indices', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2.7, 5)).toBe(2);
    expect(clampIndex(3, 0)).toBe(0);
  });

  it('is ready once the current and next few frames have settled', () => {
    const settled = new Set([0, 1, 2, 3]);
    expect(readyToPlay(0, 24, (i) => settled.has(i))).toBe(true);
    expect(readyToPlay(1, 24, (i) => settled.has(i))).toBe(false);
  });

  it('wraps the look-ahead and caps it at the frame count', () => {
    const settled = new Set([22, 23, 0, 1]);
    expect(readyToPlay(22, 24, (i) => settled.has(i))).toBe(true);
    expect(readyToPlay(0, 2, (i) => i < 2)).toBe(true);
    expect(readyToPlay(0, 0, () => true)).toBe(false);
  });
});
