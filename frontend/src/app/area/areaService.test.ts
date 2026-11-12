// Q-414: the demo answers only inside the prepared Eros area and refuses elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AreaBox } from '@/app/shell/areaStore';
import {
  AreaRefused,
  areaSearch,
  boxOverlapsEros,
  discoverIn,
  erosArea,
  knownObjectsIn,
  type ErosDemo,
} from './areaService';

// The prepared area of public/demo/eros/eros.json: centre RA 91.118, Dec 13.453, 1280 x 720 px at 0.0015625 deg/px.
const DEMO = {
  object: { name: '433 Eros' },
  wide: { png: '', w: 1280, h: 720, center: [91.118, 13.453], deg_per_px: 0.0015625 },
  track: [],
  hops: [],
} as unknown as ErosDemo;

const box = (ra: number, dec: number, w = 0.6, h = 0.4): AreaBox => ({
  a: { ra: ra - w / 2, dec: dec + h / 2 },
  b: { ra: ra + w / 2, dec: dec - h / 2 },
  widthDeg: w,
  heightDeg: h,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => structuredClone(DEMO) })));
});
afterEach(() => vi.unstubAllGlobals());

describe('prepared Eros area', () => {
  it('is 2 by 1.125 degrees around the image centre', () => {
    const e = erosArea(DEMO)!;
    expect(e.halfW).toBeCloseTo(1.0, 6);
    expect(e.halfH).toBeCloseTo(0.5625, 6);
  });
  it('overlaps a box inside, partly over the edge, and not one far away', () => {
    expect(boxOverlapsEros(box(91.118, 13.453), DEMO)).toBe(true);
    expect(boxOverlapsEros(box(92.2, 13.453), DEMO)).toBe(true);
    expect(boxOverlapsEros(box(200, -30), DEMO)).toBe(false);
    expect(boxOverlapsEros(box(91.118, 20), DEMO)).toBe(false);
  });
  it('has no area when the file lacks the centre', () => {
    const bare = { ...DEMO, wide: { png: '', w: 10, h: 10 } } as ErosDemo;
    expect(erosArea(bare)).toBeNull();
    expect(boxOverlapsEros(box(91.118, 13.453), bare)).toBe(false);
  });
  it('handles a box across RA 0 / 360', () => {
    expect(boxOverlapsEros(box(359.9, 0.1, 0.4, 0.4), DEMO)).toBe(false);
  });
});

describe('area service', () => {
  it('Known objects answers inside the area, flagged demo', async () => {
    const r = await knownObjectsIn(box(91.118, 13.453));
    expect(r.demo).toBe(true);
    expect(r.objects.map((o) => o.id)).toEqual(['433']);
  });
  it('Discovery answers inside the area with demo-labelled counts', async () => {
    const r = await discoverIn(box(91.118, 13.453));
    expect(r.demo).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    for (const s of r.steps) expect(s.result).toContain('(demo)');
  });
  it('refuses elsewhere with area:not_prepared', async () => {
    const far = box(200, -30);
    await expect(knownObjectsIn(far)).rejects.toMatchObject({ code: 'area:not_prepared', message: 'No prepared data for this area yet.' });
    await expect(discoverIn(far)).rejects.toBeInstanceOf(AreaRefused);
    await expect(areaSearch(far, 'known')).rejects.toMatchObject({ code: 'area:not_prepared' });
  });
});
