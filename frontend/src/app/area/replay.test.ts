// Replay of a recorded run (issue #158): the run as it was at time t, the timeline marks, the
// labels' "found at" times, the clock text and the deterministic clock.
import { describe, expect, it } from 'vitest';
import {
  advance,
  clock,
  durationOf,
  foundAtOf,
  lengthText,
  recordAt,
  regionText,
  squareAt,
  ticksOf,
  whenText,
} from './replay';
import type { RunEvent, RunRecord } from './scanApi';
import { objectsFromEvents } from './scanObjects';

const box = (ra: number) => ({ ra, dec: -11.45, width_deg: 1.35, height_deg: 1.35 });
const pos = (ra: number, time: string) => ({ ra, dec: -11.4, time });
const EVENTS: RunEvent[] = [
  { t: 0, type: 'run_started' },
  { t: 0.03, type: 'square_started', square: 1 },
  { t: 600, type: 'square_done', square: 1, area_id: 'live-aaaaaaaaaaaa' },
  {
    t: 600,
    type: 'found',
    square: 1,
    area_id: 'live-aaaaaaaaaaaa',
    object: {
      kind: 'known',
      positions_tag: 'model_dependent',
      designation: '9532 Abramenko',
      square: 1,
      positions: [pos(208.4, '2025-06-27T10:00:00Z'), pos(208.41, '2025-06-27T11:30:00Z')],
    },
  },
  {
    t: 600,
    type: 'found',
    square: 1,
    area_id: 'live-aaaaaaaaaaaa',
    object: {
      kind: 'predicted',
      positions_tag: 'model_dependent',
      designation: '2020 AB1',
      square: 1,
      positions: [pos(208.3, '2025-06-27T10:00:00Z')],
    },
  },
  { t: 610, type: 'run_paused' },
  { t: 700, type: 'run_resumed' },
  { t: 700.02, type: 'square_started', square: 2 },
  { t: 1300, type: 'square_skipped', square: 2 },
  { t: 1300.01, type: 'square_started', square: 3 },
  { t: 1900, type: 'square_done', square: 3, area_id: 'live-bbbbbbbbbbbb' },
  {
    t: 1900,
    type: 'found',
    square: 3,
    area_id: 'live-bbbbbbbbbbbb',
    object: {
      kind: 'unexplained',
      positions_tag: 'measured',
      track_id: 'T7',
      square: 3,
      positions: [pos(207.2, '2025-06-27T10:00:00Z'), pos(207.21, '2025-06-27T11:30:00Z')],
    },
  },
  {
    t: 1900,
    type: 'found',
    square: 3,
    area_id: 'live-bbbbbbbbbbbb',
    object: {
      kind: 'known',
      positions_tag: 'model_dependent',
      designation: '9532 Abramenko',
      square: 3,
      positions: [pos(208.42, '2025-06-27T13:00:00Z')],
    },
  },
  { t: 1900.5, type: 'run_done' },
];
const RUN: RunRecord = {
  run_id: 'run-20261113T210927-411a00',
  kind: 'discovery',
  release: 'spherex_dr1',
  region: { ra: 207.9, dec: -11.45, width_deg: 3.6, height_deg: 1.2 },
  squares: [
    { index: 1, box: box(208.5), area_id: 'live-aaaaaaaaaaaa', state: 'done' },
    {
      index: 2,
      box: box(207.9),
      area_id: null,
      state: 'skipped',
      error: { code: 'area:no_visit_pair', detail: 'No pair.' },
    },
    { index: 3, box: box(207.3), area_id: 'live-bbbbbbbbbbbb', state: 'done' },
  ],
  state: 'done',
  created_at: '2026-11-13T21:09:27Z',
  started_at: '2026-11-13T21:09:27Z',
  finished_at: '2026-11-13T21:41:07Z',
  totals: { known: 2, found: 1, unexplained: 1, squares_done: 2, squares_skipped: 1 },
  events: EVENTS,
  provenance: {
    known_positions: { tag: 'model_dependent', source: 'Horizons' },
    track_positions: { tag: 'measured', source: 'dots' },
  },
} as RunRecord;

const states = (r: RunRecord) => r.squares.map((s) => s.state).join(',');

describe('recordAt', () => {
  it('replays the squares from their events', () => {
    expect(states(recordAt(RUN, -1))).toBe('todo,todo,todo');
    expect(states(recordAt(RUN, 1))).toBe('running,todo,todo');
    expect(states(recordAt(RUN, 600))).toBe('done,todo,todo');
    expect(states(recordAt(RUN, 800))).toBe('done,running,todo');
    expect(states(recordAt(RUN, 1300.005))).toBe('done,skipped,todo');
    expect(states(recordAt(RUN, 1900.5))).toBe('done,skipped,done');
  });
  it('gives a square its results and its error only once it has finished', () => {
    const at = recordAt(RUN, 800);
    expect(at.squares[1]!.area_id).toBeNull();
    expect(at.squares[1]!.error).toBeUndefined();
    expect(recordAt(RUN, 1301).squares[1]!.error?.code).toBe('area:no_visit_pair');
  });
  it('keeps only the events up to t, so objects appear when they were found', () => {
    expect(objectsFromEvents(recordAt(RUN, 599).events)).toHaveLength(0);
    const at = objectsFromEvents(recordAt(RUN, 600).events).map((o) => o.key);
    expect(at).toEqual(['9532 Abramenko', '2020 AB1']);
    // The known object found again in square 3 carries its trajectory across the border.
    const all = objectsFromEvents(recordAt(RUN, 1900).events);
    expect(all.find((o) => o.key === '9532 Abramenko')?.positions).toHaveLength(3);
  });
  it("is running, paused, then the run's own end state", () => {
    expect(recordAt(RUN, 300).state).toBe('running');
    expect(recordAt(RUN, 650).state).toBe('paused');
    expect(recordAt(RUN, 650).finished_at).toBeNull();
    expect(recordAt(RUN, 900).state).toBe('running');
    expect(recordAt(RUN, durationOf(RUN)).state).toBe('done');
    expect(recordAt(RUN, durationOf(RUN)).finished_at).toBe(RUN.finished_at);
  });
  it('counts the totals at t', () => {
    expect(recordAt(RUN, 600).totals).toEqual({
      known: 2,
      found: 1,
      unexplained: 0,
      squares_done: 1,
      squares_skipped: 0,
    });
    // Abramenko, found in squares 1 and 3, counts once (as its circle does).
    expect(recordAt(RUN, 1900).totals).toMatchObject({
      known: 2,
      found: 1,
      unexplained: 1,
      squares_done: 2,
      squares_skipped: 1,
    });
  });
  it('ends on the run itself: the end frame has the server totals', () => {
    expect(recordAt(RUN, durationOf(RUN)).totals).toEqual(RUN.totals);
  });
  it('is deterministic: the same t gives the same frame', () => {
    expect(recordAt(RUN, 1234.5)).toEqual(recordAt(RUN, 1234.5));
    expect(JSON.stringify(recordAt(RUN, 1234.5))).toBe(JSON.stringify(recordAt(RUN, 1234.5)));
  });
  it('does not change the record it replays', () => {
    const before = JSON.stringify(RUN);
    recordAt(RUN, 800);
    expect(JSON.stringify(RUN)).toBe(before);
  });
});

describe('timeline', () => {
  it('lasts from started to finished (or to the last event of a run still going)', () => {
    expect(durationOf(RUN)).toBe(1900.5);
    const going = { ...RUN, state: 'running', finished_at: null } as RunRecord;
    expect(durationOf(going)).toBe(1900.5);
    expect(
      durationOf({ ...RUN, started_at: null, finished_at: null, events: [] } as RunRecord),
    ).toBe(0);
  });
  it('marks finds (once per object, never predicted) and skipped squares', () => {
    const ticks = ticksOf(RUN);
    expect(ticks.map((k) => [k.t, k.kind])).toEqual([
      [600, 'known'],
      [1300, 'skipped'],
      [1900, 'unexplained'],
    ]);
    expect(ticks[0]!.label).toBe('9532 Abramenko found');
    expect(ticks[1]!.label).toBe('Square 2 skipped');
  });
  it('knows the square being analysed', () => {
    expect(squareAt(RUN, 0)).toBe(0);
    expect(squareAt(RUN, 100)).toBe(1);
    expect(squareAt(RUN, 800)).toBe(2);
    expect(squareAt(RUN, 1900)).toBe(3);
  });
  it('labels each object with when it was first found, keyed as the overlay keys it', () => {
    const at = foundAtOf(RUN);
    expect(at.get('9532 Abramenko')).toBe(600);
    expect(at.get('3:T7')).toBe(1900);
    for (const o of objectsFromEvents(RUN.events)) expect(at.has(o.key)).toBe(true);
  });
});

describe('clock', () => {
  it('advances by wall time times the speed, and stops at the end', () => {
    expect(advance(0, 1000, 60, 1900, false)).toBe(60);
    expect(advance(100, 2500, 10, 1900, false)).toBe(125);
    expect(advance(1890, 1000, 600, 1900, false)).toBe(1900);
  });
  it('moves in whole seconds of wall time under reduced motion', () => {
    expect(advance(0, 999, 60, 1900, true)).toBe(0);
    expect(advance(0, 1500, 60, 1900, true)).toBe(60);
  });
  it('writes times as the mock-up does', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(4745)).toBe('1:19:05');
    expect(lengthText(40)).toBe('40 s');
    expect(lengthText(540)).toBe('9 min');
    expect(lengthText(13930)).toBe('3 h 52 min');
    expect(lengthText(7200)).toBe('2 h');
    expect(whenText('2026-11-13T07:28:44Z')).toBe('13 Nov 07:28');
    expect(regionText({ ra: 207.9, dec: -11.45, width_deg: 9.6, height_deg: 6 })).toBe(
      '9.6° × 6.0° near RA 208°, Dec −11°',
    );
    expect(regionText({ ra: 359.8, dec: 0.2, width_deg: 2, height_deg: 1.2 })).toBe(
      '2.0° × 1.2° near RA 0°, Dec 0°',
    );
    expect(regionText({ ra: 270, dec: 66, width_deg: 4, height_deg: 2 })).toBe(
      '4.0° × 2.0° near RA 270°, Dec +66°',
    );
  });
});
