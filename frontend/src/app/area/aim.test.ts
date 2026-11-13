// Aim and draw geometry (issue #144, Q-462): the aim rectangle's scale, the 2° clamp and its readout.
import { describe, expect, it } from 'vitest';
import type { AreaDrag } from '@/app/shell/areaStore';
import {
  AIM_HEIGHT_DEG,
  aimLabel,
  aimSizePx,
  aimViewDeg,
  clampCentred,
  clampDrag,
  drawReadout,
  formatBoxDeg,
  MAX_SIDE_DEG,
} from './aim';

/** A flat sky: 100 px per degree on both axes. */
const flat = (d: AreaDrag) => ({ w: Math.abs(d.x1 - d.x0) / 100, h: Math.abs(d.y1 - d.y0) / 100 });

describe('aim rectangle', () => {
  it('is the whole screen when the view already is 2.2° tall', () => {
    const r = aimSizePx(AIM_HEIGHT_DEG, 1600, 1000);
    expect(r.h).toBeCloseTo(1000, 6);
    expect(r.w).toBeCloseTo(1600, 6);
  });
  it('has the screen shape and shrinks as the view zooms out (to scale)', () => {
    const at20 = aimSizePx(20, 1280, 800);
    const at40 = aimSizePx(40, 1280, 800);
    expect(at20.w / at20.h).toBeCloseTo(1280 / 800, 9);
    expect(at40.h).toBeLessThan(at20.h);
    // Gnomonic scale: tan(1.1°)/tan(10°) of the height at 20°.
    expect(at20.h).toBeCloseTo((800 * Math.tan((1.1 * Math.PI) / 180)) / Math.tan((10 * Math.PI) / 180), 6);
  });
  it('names the next view: 2.2° tall, wider by the aspect', () => {
    const v = aimViewDeg(1280, 800);
    expect(v.h).toBe(2.2);
    expect(v.w).toBeCloseTo(3.52, 2);
    expect(aimLabel(1280, 800)).toBe('Next view · 3.5° × 2.2°');
  });
});

describe('2° clamp', () => {
  it('leaves a box under 2° alone', () => {
    const d = clampDrag({ x0: 10, y0: 10, x1: 150, y1: 90 }, flat);
    expect(d).toEqual({ x0: 10, y0: 10, x1: 150, y1: 90, held: false });
  });
  it('stops each side at 2° from the anchor, in any drag direction', () => {
    const d = clampDrag({ x0: 500, y0: 500, x1: 120, y1: 320 }, flat);
    expect(d.held).toBe(true);
    expect(d.x0).toBe(500);
    expect(d.y0).toBe(500);
    expect(flat(d).w).toBeCloseTo(MAX_SIDE_DEG, 4);
    expect(flat(d).h).toBeCloseTo(1.8, 6); // the short side is not touched
    expect(d.x1).toBeLessThan(500); // still drawn to the left
    expect(flat(d).w).toBeLessThanOrEqual(MAX_SIDE_DEG);
  });
  it('holds both sides when both are over', () => {
    const d = clampDrag({ x0: 0, y0: 0, x1: 900, y1: 700 }, flat);
    expect(flat(d).w).toBeCloseTo(2, 4);
    expect(flat(d).h).toBeCloseTo(2, 4);
  });
  it('a centred box (Enter) stays centred and at most 2° a side', () => {
    const d = clampCentred(640, 400, 300, 180, flat);
    expect((d.x0 + d.x1) / 2).toBeCloseTo(640, 9);
    expect((d.y0 + d.y1) / 2).toBeCloseTo(400, 9);
    expect(flat(d).w).toBeCloseTo(2, 4);
    expect(flat(d).h).toBeCloseTo(2, 4);
    expect(clampCentred(640, 400, 50, 30, flat)).toEqual({ x0: 590, y0: 370, x1: 690, y1: 430 });
  });
  it('no "too large" box exists: a huge drag on a curved measure still ends at 2°', () => {
    // A measure that grows faster than linear, as the gnomonic projection does off-centre.
    const curved = (d: AreaDrag) => ({ w: Math.tan(Math.abs(d.x1 - d.x0) / 1000) * 5, h: Math.abs(d.y1 - d.y0) / 100 });
    const d = clampDrag({ x0: 0, y0: 0, x1: 1400, y1: 50 }, curved);
    expect(curved(d).w).toBeLessThanOrEqual(2);
    expect(curved(d).w).toBeCloseTo(2, 4);
  });
});

describe('2° clamp on a curved sky (review of PR #148)', () => {
  it('both sides held: the width, measured across the final box, is not over 2°', () => {
    // The width grows with the box's height too (as the gnomonic middle line moves).
    const skew = (d: AreaDrag) => {
      const h = Math.abs(d.y1 - d.y0) / 100;
      return { w: (Math.abs(d.x1 - d.x0) / 100) * (1 + 0.02 * (3 - h)), h };
    };
    const d = clampDrag({ x0: 0, y0: 0, x1: 900, y1: 700 }, skew);
    expect(skew(d).w).toBeLessThanOrEqual(2);
    expect(skew(d).h).toBeLessThanOrEqual(2);
    expect(skew(d).w).toBeCloseTo(2, 4);
  });
});

describe('readouts', () => {
  it('reads the box in degrees with two decimals, and says "2° max" when held', () => {
    expect(formatBoxDeg(0.98, 0.61)).toBe('0.98° × 0.61°');
    expect(drawReadout(1.2, 0.8, false)).toBe('1.20° × 0.80°');
    expect(drawReadout(1.9999999, 1.06, true)).toBe('2.00° × 1.06° · 2° max');
  });
});
