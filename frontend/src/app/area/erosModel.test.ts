import { describe, expect, it } from 'vitest';
import type { ErosDemo, ErosHop } from './areaService';
import { detectorIndex, detectorsWithFrames, isoToMjd, mjdDay, mjdHM, mjdYear, trackAt } from './erosModel';

const hop = (detector: string): ErosHop => ({ detector, mjd_avg: 1 }) as ErosHop;
const eros = {
  hops: [hop('D1'), hop('D4'), hop('D4')],
  track: [
    { t: '2026-03-20T00:00:00.000Z', px: [100, 200] },
    { t: '2026-03-20T02:00:00.000Z', px: [200, 100] },
  ],
} as unknown as ErosDemo;

describe('erosModel', () => {
  it('converts times to MJD and back to UTC text', () => {
    const m = isoToMjd('2026-03-20T08:38:00.000Z');
    expect(m).toBeCloseTo(61119.359722, 5);
    expect(mjdHM(m)).toBe('08:38');
    expect(mjdDay(m)).toBe('20 Mar');
    expect(mjdYear(m)).toBe(2026);
  });
  it('reads the detector index and the detectors that have frames', () => {
    expect(detectorIndex(hop('D6'))).toBe(5);
    expect([...detectorsWithFrames(eros)].sort()).toEqual([0, 3]);
  });
  it('interpolates the path linearly and clamps at the ends', () => {
    const t0 = isoToMjd('2026-03-20T00:00:00.000Z');
    const t1 = isoToMjd('2026-03-20T02:00:00.000Z');
    expect(trackAt(eros, t0 - 1)).toEqual([100, 200]);
    expect(trackAt(eros, t1 + 1)).toEqual([200, 100]);
    const mid = trackAt(eros, (t0 + t1) / 2);
    expect(mid[0]).toBeCloseTo(150, 6);
    expect(mid[1]).toBeCloseTo(150, 6);
  });
  it('gives the origin for an empty track', () => {
    expect(trackAt({ ...eros, track: [] } as ErosDemo, 5)).toEqual([0, 0]);
  });
});
