import { describe, expect, it } from 'vitest';
import { StarEngine } from './StarEngine';
import {
  closeView,
  globeRot,
  GLOBE_HALF,
  GLOBE_TILT,
  nudge,
  pickSurface,
  projectSurface,
  viewPoint,
} from './starPick';

describe('star globe pick', () => {
  it('round-trips: click -> lat/lon -> the same point on the globe, and the close-up centre -> the same place', () => {
    for (const time of [3, 40]) {
      const rot = globeRot(time);
      for (const [x, y] of [
        [0, 0],
        [0.4, 0.3],
        [-0.7, 0.2],
        [0.1, -0.8],
        [-0.3, -0.5],
      ] as const) {
        const p = pickSurface([x, y], rot, GLOBE_TILT)!;
        const back = projectSurface(p, rot, GLOBE_TILT);
        expect(back.visible).toBe(true);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
        // The close-up (artifact L305-L307) centred on that place maps the place to its centre.
        const v = closeView(p);
        const centre = pickSurface([0, 0], v.rot, v.tilt)!;
        expect(centre.lat).toBeCloseTo(p.lat, 9);
        expect(Math.cos(centre.lon - p.lon)).toBeCloseTo(1, 9);
        const mid = projectSurface(p, v.rot, v.tilt);
        expect(Math.hypot(mid.x, mid.y)).toBeLessThan(1e-9);
      }
    }
  });
  it('the limb and space pick nothing; pixels map to star radii', () => {
    expect(pickSurface([1, 0], 0.5, 0.1)).toBeNull();
    expect(pickSurface([0.9, 0.9], 0.5, 0.1)).toBeNull();
    expect(viewPoint(0.5, 0.5, 1.6, GLOBE_HALF)).toEqual([0, 0]);
    expect(viewPoint(1, 0, 1.6, GLOBE_HALF)[1]).toBeCloseTo(GLOBE_HALF, 12);
  });
  it('arrow nudges move 5 degrees, keep off the poles and wrap longitude', () => {
    const p = nudge({ lat: 1.5, lon: 3.1 }, (5 * Math.PI) / 180, (5 * Math.PI) / 180);
    expect(p.lat).toBeCloseTo((85 * Math.PI) / 180, 9);
    expect(p.lon).toBeLessThan(0);
  });
  it('the engine overrides the close-up target and returns it, and Back returns to the strongest group', () => {
    const e = new StarEngine(document.createElement('div'), { mode: 'globe' });
    e.setStar({ id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true });
    const best = e.closeTarget();
    e.setCloseTarget({ lat: 0.3, lon: -1 });
    expect(e.closeTarget()).toEqual({ lat: 0.3, lon: -1 });
    e.setCloseTarget(null);
    expect(e.closeTarget()).toEqual(best);
    e.dispose();
  });
});
