import { describe, expect, it } from 'vitest';
import type { AreaIndexEntry } from '@/contract';
import { areaIndexFixture } from '@/test/areaFixtures';
import { snapToArea } from './snap';

const index = areaIndexFixture();

const entry = (id: string, ra: number, dec: number, w = 1, h = 1): AreaIndexEntry => ({
  ...index.areas[0]!,
  area_id: id,
  ra,
  dec,
  width_deg: w,
  height_deg: h,
});

describe('snapToArea (Q-406 (1))', () => {
  it('snaps a square whose centre is in the main fixture area', () => {
    expect(snapToArea({ ra: 150.2, dec: 10.1, sideDeg: 0.5 }, index.areas)?.area_id).toBe(
      'fixture:area-main',
    );
  });

  it('gives null outside every area (area:not_prepared)', () => {
    expect(snapToArea({ ra: 30, dec: 0, sideDeg: 0.5 }, index.areas)).toBeNull();
    expect(snapToArea({ ra: 30, dec: 0, sideDeg: 0.5 }, [])).toBeNull();
  });

  it('needs the centre inside, not just an overlap', () => {
    expect(snapToArea({ ra: 150.7, dec: 10, sideDeg: 1 }, index.areas)).toBeNull();
  });

  it('largest overlap wins; a tie goes to the first in the index', () => {
    const a = entry('a', 10, 0, 1, 1);
    const b = entry('b', 10.4, 0, 1, 1);
    expect(snapToArea({ ra: 10.3, dec: 0, sideDeg: 0.6 }, [a, b])?.area_id).toBe('b');
    const c = entry('c', 10, 0, 1, 1);
    expect(snapToArea({ ra: 10, dec: 0, sideDeg: 0.5 }, [a, c])?.area_id).toBe('a');
  });

  it('wraps RA at 0/360', () => {
    expect(snapToArea({ ra: 359.9, dec: 0, sideDeg: 0.3 }, [entry('w', 0.1, 0)])?.area_id).toBe(
      'w',
    );
  });

  it('uses on-sky width at high Dec (cos Dec)', () => {
    const high = entry('h', 100, 80, 1, 1);
    // 2° of RA at Dec 80 is about 0.35° on the sky: inside a 1° box.
    expect(snapToArea({ ra: 101.0, dec: 80, sideDeg: 0.2 }, [high])?.area_id).toBe('h');
    // 4° of RA is about 0.69° on the sky: outside.
    expect(snapToArea({ ra: 104, dec: 80, sideDeg: 0.2 }, [high])).toBeNull();
  });
});
