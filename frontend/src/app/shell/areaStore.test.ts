import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaRefused } from '@/app/area/areaService';
import {
  erosList,
  formatAreaDims,
  formatAreaSize,
  refusalOf,
  useAreaStore,
  type AreaBox,
} from './areaStore';

const box: AreaBox = { a: { ra: 10, dec: 5 }, b: { ra: 11, dec: 4 }, widthDeg: 1, heightDeg: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  useAreaStore.getState().reset();
});
afterEach(() => {
  useAreaStore.getState().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('area store', () => {
  it('startFlow goes to drawing for that flow', () => {
    useAreaStore.getState().startFlow('known');
    const s = useAreaStore.getState();
    expect(s.flow).toBe('known');
    expect(s.stage).toBe('drawing');
    expect(s.screen).toBe('draw');
    expect(s.box).toBeNull();
  });
  it('Known: setBox starts the island search, and an unprepared area ends in a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
    useAreaStore.getState().startFlow('known');
    useAreaStore.getState().setBox(box);
    expect(useAreaStore.getState().screen).toBe('search');
    expect(useAreaStore.getState().say?.kind).toBe('searching');
    await vi.advanceTimersByTimeAsync(2000);
    expect(useAreaStore.getState().say?.text).toBe('No prepared data for this area yet.');
    await vi.advanceTimersByTimeAsync(1100);
    const s = useAreaStore.getState();
    expect(s.screen).toBe('list');
    expect(s.known).toBeNull();
    expect(s.refusal?.code).toBe('area:not_prepared');
  });
  it('redraw and reset clear the box and the refusal but keep the last area', () => {
    useAreaStore.setState({ refusal: { code: 'area:not_prepared', message: 'x' } });
    useAreaStore.getState().startFlow('discovery');
    useAreaStore.getState().setBox(box);
    useAreaStore.getState().redraw();
    const s = useAreaStore.getState();
    expect(s.box).toBeNull();
    expect(s.refusal).toBeNull();
    expect(s.last).toEqual(box);
  });
  it('setMinimised and toggleOv flip their flags', () => {
    useAreaStore.getState().setMinimised(true);
    expect(useAreaStore.getState().minimised).toBe(true);
    const before = useAreaStore.getState().ov.flags;
    useAreaStore.getState().toggleOv('flags');
    expect(useAreaStore.getState().ov.flags).toBe(!before);
  });
  it('setIndex ignores an empty exposure list', () => {
    useAreaStore.getState().setIndex(3);
    expect(useAreaStore.getState().index).toBe(0);
    expect(erosList(null, null)).toEqual([]);
  });
});

describe('area helpers', () => {
  it('maps a refusal and any other error', () => {
    expect(refusalOf(new AreaRefused()).code).toBe('area:not_prepared');
    expect(refusalOf(new Error('x')).code).toBe('area:failed');
  });
  it('formats sizes', () => {
    expect(formatAreaSize(3.21)).toBe('3.2°');
    expect(formatAreaSize(0.5)).toBe('30′');
    expect(formatAreaDims({ widthDeg: 1.27, heightDeg: 0.77 })).toBe('1.27° × 0.77°');
  });
});
