// Which equirect loads first and which replaces it: smallest first, a larger one only where the
// GPU can hold it, and never above 4096 px wide on a phone (coarse pointer) or with Save-Data.
import { describe, expect, it } from 'vitest';
import type { SkySurvey } from '@/app/api/types';
import { pickSurvey, planSkyLoad, SKY_PHONE_MAX_WIDTH, usableEquirects } from './surveys';

const survey = (sizes: [number, number][], frame = 'icrs'): SkySurvey => ({
  id: 's',
  title: 'Test',
  credit: 'Test credit',
  tag: 'derived',
  formula: 'test formula',
  assumption: null,
  frame,
  convention: null,
  equirect: sizes.map(([width, height]) => ({ url: `/sky/${width}.jpg`, width, height })),
  hips: null,
});

const desktop = { maxTextureSize: 16384, coarsePointer: false, saveData: false };
const phone = { maxTextureSize: 16384, coarsePointer: true, saveData: false };

describe('planSkyLoad', () => {
  const both = survey([
    [8192, 4096],
    [4096, 2048],
  ]);

  it('desktop: 4096 first, then 8192', () => {
    const p = planSkyLoad(both, desktop);
    expect(p.first?.width).toBe(4096);
    expect(p.upgrade?.width).toBe(8192);
  });

  it('phone stays at 4096', () => {
    expect(SKY_PHONE_MAX_WIDTH).toBe(4096);
    const p = planSkyLoad(both, phone);
    expect(p.first?.width).toBe(4096);
    expect(p.upgrade).toBeNull();
  });

  it('Save-Data stays at 4096', () => {
    expect(planSkyLoad(both, { ...desktop, saveData: true }).upgrade).toBeNull();
  });

  it('a GPU limited to 4096 never gets 8192', () => {
    const p = planSkyLoad(both, { ...desktop, maxTextureSize: 4096 });
    expect(p.first?.width).toBe(4096);
    expect(p.upgrade).toBeNull();
  });

  it('nothing fits: nothing is loaded (refused, not resized)', () => {
    const p = planSkyLoad(survey([[8192, 4096]]), { ...desktop, maxTextureSize: 4096 });
    expect(p).toEqual({ first: null, upgrade: null });
  });

  it('ignores images that are not 2:1', () => {
    expect(usableEquirects(survey([[4096, 4096]]))).toEqual([]);
  });
});

describe('pickSurvey', () => {
  it('takes the first ICRS survey with a usable image', () => {
    const galactic = survey([[4096, 2048]], 'galactic');
    const icrs = survey([[4096, 2048]]);
    expect(pickSurvey([galactic, icrs])).toBe(icrs);
    expect(pickSurvey([galactic])).toBeNull();
    expect(pickSurvey([])).toBeNull();
  });
});
