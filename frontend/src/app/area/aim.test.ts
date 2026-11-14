// A single live area's size label (issue #144, Q-462).
import { describe, expect, it } from 'vitest';
import { formatBoxDeg, MAX_SIDE_DEG } from './aim';

describe('single area', () => {
  it('is at most 2° a side and reads its sides with two decimals', () => {
    expect(MAX_SIDE_DEG).toBe(2);
    expect(formatBoxDeg(0.98, 0.61)).toBe('0.98° × 0.61°');
  });
});
