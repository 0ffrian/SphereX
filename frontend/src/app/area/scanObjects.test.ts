// Circles and trajectories from a run's `found` events (issue #157, mock-up states 10 and 11).
import { describe, expect, it } from 'vitest';
import type { RunEvent } from './scanApi';
import { objectsFromEvents, rateOf, squaresText, visibleObjects } from './scanObjects';

const found = (
  square: number,
  object: Omit<NonNullable<RunEvent['object']>, 'square' | 'positions_tag'>,
  t = square,
): RunEvent => ({
  t,
  type: 'found',
  square,
  object: {
    ...object,
    square,
    positions_tag: object.kind === 'unexplained' ? 'measured' : 'model_dependent',
  },
});
const P = (ra: number, dec: number, time: string) => ({ ra, dec, time });

describe('objectsFromEvents', () => {
  const events: RunEvent[] = [
    { t: 0, type: 'run_started' },
    { t: 1, type: 'square_done', square: 2 },
    found(2, {
      kind: 'known',
      designation: '7051 Sean',
      positions: [P(30.4, 10, '2026-06-27T03:00:00Z'), P(30.2, 10, '2026-06-27T09:00:00Z')],
    }),
    found(2, {
      kind: 'predicted',
      designation: '2014 HX482',
      positions: [P(30.5, 9.8, '2026-06-27T03:00:00Z'), P(30.49, 9.79, '2026-06-27T09:00:00Z')],
    }),
    found(2, {
      kind: 'unexplained',
      track_id: 'T7',
      positions: [P(30.1, 9.5, '2026-06-27T03:00:00Z'), P(30.0, 9.45, '2026-06-28T03:00:00Z')],
    }),
    { t: 2, type: 'square_done', square: 3 },
    // Sean again, in square 3: one object; the shared time is not drawn twice.
    found(3, {
      kind: 'known',
      designation: '7051 Sean',
      positions: [P(30.2, 10, '2026-06-27T09:00:00Z'), P(29.9, 10, '2026-06-27T18:00:00Z')],
    }),
    found(3, {
      kind: 'unexplained',
      track_id: 'T7',
      positions: [P(28, 9, '2026-06-27T03:00:00Z'), P(28.1, 9, '2026-06-27T09:00:00Z')],
    }),
    found(3, { kind: 'known', designation: 'empty', positions: [] }),
  ];
  const objs = objectsFromEvents(events);

  it('merges a designation across squares into one trajectory in time order', () => {
    const sean = objs.find((o) => o.designation === '7051 Sean')!;
    expect(sean.squares).toEqual([2, 3]);
    expect(sean.positions.map((p) => p.ra)).toEqual([30.4, 30.2, 29.9]);
    expect(sean.title).toBe('7051 Sean');
    expect(sean.line).toBe('squares 2–3');
  });

  it('keeps tracks per square, labels kinds, drops objects without positions', () => {
    expect(objs.map((o) => o.key)).toEqual(['7051 Sean', '2014 HX482', '2:T7', '3:T7']);
    const t7 = objs.find((o) => o.key === '2:T7')!;
    expect(t7).toMatchObject({ kind: 'unexplained', title: 'T7 · unexplained' });
    expect(t7.line).toMatch(/^0\.\d\d°\/day$/);
    expect(objs.find((o) => o.key === '2014 HX482')).toMatchObject({
      kind: 'predicted',
      line: 'predicted',
    });
  });

  it('hides predicted-only objects unless asked', () => {
    expect(visibleObjects(objs, false).some((o) => o.kind === 'predicted')).toBe(false);
    expect(visibleObjects(objs, true)).toHaveLength(4);
  });

  it('a predicted designation later found is drawn as found', () => {
    const o = objectsFromEvents([
      found(1, {
        kind: 'predicted',
        designation: 'X',
        positions: [P(1, 1, '2026-01-01T00:00:00Z')],
      }),
      found(2, { kind: 'known', designation: 'X', positions: [P(1.1, 1, '2026-01-01T06:00:00Z')] }),
    ]);
    expect(o[0]).toMatchObject({ kind: 'known', squares: [1, 2] });
  });
});

describe('labels', () => {
  it('squaresText', () => {
    expect(squaresText([2])).toBe('square 2');
    expect(squaresText([3, 2])).toBe('squares 2–3');
    expect(squaresText([2, 5, 6, 7])).toBe('squares 2, 5–7');
  });
  it('rateOf: degrees per day, null with one time', () => {
    expect(
      rateOf([P(0, 0, '2026-01-01T00:00:00Z'), P(0, 0.5, '2026-01-02T00:00:00Z')]),
    ).toBeCloseTo(0.5, 6);
    expect(rateOf([P(0, 0, '2026-01-01T00:00:00Z')])).toBeNull();
  });
});
