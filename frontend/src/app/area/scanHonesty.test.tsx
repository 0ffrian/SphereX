// Issue #170: the scan surfaces follow Measured only (D-21) and show what #169 reports (tracks the
// known-object check could not judge, failed squares). Built against the `mock-gaps` scenario of
// the mock, which answers as #169 proposes; plain `mock` answers as a server from before #169.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { foundText, runFlags, runLine } from '@/app/shell/RunsMenu';
import { ScanCard, scanAnnounce, scanRows } from './ScanCard';
import { mockScanApi, summaryOf } from './scanMock';
import { measuredObjects, objectsFromEvents, uncheckedObjects } from './scanObjects';
import {
  setScanApi,
  squaresFailedOf,
  tracksOf,
  trackRowsOf,
  uncheckedOf,
  type RunRecord,
  type RunResults,
  type RunTotals,
} from './scanApi';
import { resetScans, useScanStore } from './scanStore';
import { ticksOf } from './replay';
import { scanEcsv } from './scanExport';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// 5 × 3 squares (#156's split); square 1 is stored, 2 fails, 3 has two unchecked tracks, 4 is skipped.
const REGION = { ra: 30, dec: 10, width_deg: 9, height_deg: 5.4 };
const T: RunTotals = { known: 3, found: 2, unexplained: 4, squares_done: 5, squares_skipped: 1 };

/** A finished mock run and its results, with or without #169's fields. */
async function finished(gaps: boolean): Promise<{ record: RunRecord; results: RunResults }> {
  let clock = 1_800_000_000_000;
  const api = mockScanApi({ squareMs: 1000, now: () => clock, persist: false, gaps });
  const started = await api.start({ ...REGION, kind: 'discovery' });
  if (started.kind !== 'started') throw new Error('mock did not start');
  clock += 60_000;
  const record = await api.run(started.run.run_id);
  return { record, results: await api.results(started.run.run_id) };
}

describe('#169 totals, read honestly', () => {
  it('a run recorded before #169 has no unchecked count: null, never 0', () => {
    expect(uncheckedOf(T)).toBeNull();
    expect(tracksOf(T)).toBe(6);
  });
  it('reads unchecked and squares_failed when the server sends them', () => {
    const t = { ...T, unchecked: 2, squares_failed: 1 } as RunTotals;
    expect(uncheckedOf(t)).toBe(2);
    expect(squaresFailedOf(t)).toBe(1);
    expect(tracksOf(t)).toBe(8);
  });
  it('counts failed squares from a record when the totals do not say', () => {
    expect(squaresFailedOf(T, [{ state: 'done' }, { state: 'failed' }, { state: 'failed' }])).toBe(
      2,
    );
    expect(squaresFailedOf(T)).toBe(0);
  });
});

describe('mock-gaps (#169 as proposed)', () => {
  it('ends done with one failed square and two unchecked tracks; plain mock sends neither field', async () => {
    const gaps = await finished(true);
    expect(gaps.record.state).toBe('done');
    expect(gaps.record.squares[1]!.state).toBe('failed');
    expect(uncheckedOf(gaps.record.totals)).toBe(2);
    expect(squaresFailedOf(gaps.record.totals)).toBe(1);
    expect(trackRowsOf(gaps.results).filter((t) => t.kind === 'unchecked')).toHaveLength(2);
    // The unchecked tracks have no `found` event (#169's proposal): the replay never invents one.
    expect(objectsFromEvents(gaps.record.events).some((o) => o.trackId?.startsWith('T3u'))).toBe(
      false,
    );
    const old = await finished(false);
    expect(uncheckedOf(old.record.totals)).toBeNull();
    expect('squares_failed' in old.record.totals).toBe(false);
  });
});

describe('scan rows by filter', () => {
  it('Found leaves out unchecked tracks; Not checked lists them; Tracks lists every track as measured', async () => {
    const { results } = await finished(true);
    const all = trackRowsOf(results).length;
    const found = scanRows(results, 'found');
    const unchecked = scanRows(results, 'unchecked');
    expect(found.length + unchecked.length).toBe(all);
    expect(unchecked.map((r) => r.name)).toEqual(['Track not checked', 'Track not checked']);
    expect(unchecked[0]!.line).toContain('known-object check did not answer');
    const tracks = scanRows(results, 'tracks');
    expect(tracks).toHaveLength(all);
    for (const r of tracks) {
      expect(r.name).toBe('Track');
      expect(r.known).toBeNull();
      // No verdict word, no rate (derived), no known name.
      expect(`${r.name} ${r.line}`).not.toMatch(/unexplained|found|°\/day|SkyBoT|Sean|Abramenko/);
      expect(r.line).toMatch(/^\d visits? · \d+ dots?$/);
    }
  });
});

describe('sky objects', () => {
  it('unchecked tracks come from the results, dotted amber, named as not checked', async () => {
    const { results } = await finished(true);
    const u = uncheckedObjects(results);
    expect(u.map((o) => o.kind)).toEqual(['unchecked', 'unchecked']);
    expect(u[0]!.title).toMatch(/^T3u1 · not checked$/);
    expect(uncheckedObjects(null)).toEqual([]);
  });
  it('Measured only: every track as a neutral ring from the results; before them, measured events only', async () => {
    const { record, results } = await finished(true);
    const fromResults = measuredObjects(record.events, results);
    expect(fromResults).toHaveLength(trackRowsOf(results).length);
    for (const o of fromResults) {
      expect(o.kind).toBe('track');
      expect(o.designation).toBeUndefined();
      expect(o.title).toMatch(/^T\d/);
      expect(o.rateDegDay).toBeNull();
    }
    // Before the results: a matched known object's event carries Horizons positions, so it waits.
    const fromEvents = measuredObjects(record.events, null);
    expect(fromEvents.length).toBeGreaterThan(0);
    expect(fromEvents.length).toBeLessThan(fromResults.length);
  });
});

describe('Runs row', () => {
  const base = summaryOf(
    {
      run_id: 'run-20261113T072844-aaaaaa',
      kind: 'discovery',
      release: 'spherex_dr1',
      region: REGION,
      squares: Array.from({ length: 4 }, (_, i) => ({
        index: i + 1,
        box: REGION,
        area_id: null,
        state: 'done',
      })) as RunRecord['squares'],
      state: 'done',
      created_at: '2026-11-13T07:28:44Z',
      started_at: '2026-11-13T07:28:44Z',
      finished_at: '2026-11-13T07:42:44Z',
      totals: { ...T, unchecked: 4, squares_failed: 1 } as RunTotals,
      events: [],
      provenance: {} as RunRecord['provenance'],
    },
    0,
  );
  it('says not checked (amber) and failed squares (red), each only when above 0', () => {
    expect(runFlags(base)).toEqual([
      { text: '4 not checked', tone: 'warn' },
      { text: '1 of 4 squares failed', tone: 'fail' },
    ]);
    expect(runLine(base).flags).toHaveLength(2);
    // As the approved mock-up orders them: the counts, the flags, then the length.
    expect(runLine(base).line).toBe('13 Nov 07:28 UTC · 4 squares · 2 found, 4 unexplained');
    expect(runLine(base).tail).toBe('14 min');
    expect(runLine({ ...base, totals: T }).flags).toBeUndefined();
  });
  it('a failed run already says Failed: no failed-squares flag', () => {
    expect(runFlags({ ...base, state: 'failed' }).map((f) => f.tone)).toEqual(['warn']);
  });
  it('Measured only: "n tracks", the not-checked count folded in, failed squares kept', () => {
    expect(foundText(base, false, true)).toBe('10 tracks');
    expect(runLine(base, true).line).toContain('10 tracks');
    expect(runLine(base, true).line).not.toMatch(/found|unexplained/);
    expect(runFlags(base, true)).toEqual([{ text: '1 of 4 squares failed', tone: 'fail' }]);
  });
});

describe('replay marks at Measured only', () => {
  it('every find is a plain mark named by its track; skipped and failed squares keep theirs', async () => {
    const { record } = await finished(true);
    const normal = ticksOf(record);
    const measured = ticksOf(record, true);
    expect(normal.some((k) => k.kind === 'known')).toBe(true);
    expect(measured.filter((k) => k.kind !== 'skipped').every((k) => k.kind === 'track')).toBe(
      true,
    );
    for (const k of measured.filter((x) => x.kind === 'track'))
      expect(k.label).toMatch(/^Track T\w+ found, square \d+$/);
    expect(measured.filter((k) => k.kind === 'skipped')).toHaveLength(
      normal.filter((k) => k.kind === 'skipped').length,
    );
  });
});

describe('what a screen reader hears', () => {
  const view = (record: RunRecord) =>
    ({
      kind: 'run',
      flow: 'discovery',
      runId: record.run_id,
      region: REGION,
      record,
      square: null,
      results: null,
      stale: false,
      stopping: false,
    }) as const;
  it('the square that starts, then the end once, with the not-checked count', async () => {
    const { record } = await finished(true);
    const running = {
      ...record,
      state: 'running',
      squares: record.squares.map((s, i) => (i === 5 ? { ...s, state: 'running' } : s)),
    } as RunRecord;
    expect(scanAnnounce(view(running), false)).toBe('Square 6 of 15.');
    expect(scanAnnounce(view(record), false)).toMatch(
      /^Scan done: \d+ found, \d+ unexplained, 2 not checked\.$/,
    );
    expect(scanAnnounce(view(record), true)).toMatch(/^Scan done: \d+ tracks\.$/);
    expect(scanAnnounce(null, false)).toBe('');
  });
});

describe('the Done card', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no matchMedia or IntersectionObserver (the animated icons ask for them).
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetScans();
    setScanApi(null);
    useAppStore.setState({ honesty: 'derived' });
    vi.unstubAllGlobals();
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const show = async (gaps: boolean) => {
    const { record, results } = await finished(gaps);
    useScanStore.setState({
      view: {
        kind: 'run',
        flow: 'discovery',
        runId: record.run_id,
        region: REGION,
        record,
        square: null,
        results,
        stale: false,
        stopping: false,
      },
    });
    await act(async () => root.render(<ScanCard />));
    return { record, results };
  };

  it('normal: four totals, the not-checked message and filter, two provenance tags, the new lines', async () => {
    await show(true);
    expect(q('scan-totals')?.textContent).toContain('found');
    expect(q('scan-totals')?.textContent).not.toContain('found by Discovery');
    expect(q('scan-total-unchecked')?.textContent).toBe('2not checked');
    expect(q('scan-unchecked')?.textContent).toContain('Known-object check did not answer');
    expect(q('scan-filter-unchecked')?.textContent).toBe('Not checked 2');
    expect(q('scan-prov-tags')?.querySelectorAll('[data-testid="provenance-badge"]')).toHaveLength(
      2,
    );
    expect(q('scan-rates')?.textContent).toContain('How many movers a scan misses is not known.');
    expect(host.textContent).not.toContain('Treat possible tracks as leads');
  });
  it('a run from before #169: no fourth total, no message, no Not checked filter', async () => {
    await show(false);
    expect(q('scan-total-unchecked')).toBeNull();
    expect(q('scan-unchecked')).toBeNull();
    expect(q('scan-filter-unchecked')).toBeNull();
  });
  it('Measured only: tracks only, no verdict word, rate, known name, Track it or Known filter', async () => {
    useAppStore.setState({ honesty: 'measured' });
    const { results } = await show(true);
    expect(q('scan-totals')?.textContent).toBe(`${trackRowsOf(results).length}tracks`);
    expect(q('scan-filter')?.querySelectorAll('button')).toHaveLength(1);
    expect(q('scan-filter-tracks')).not.toBeNull();
    expect(q('scan-filter-known')).toBeNull();
    const rows = q('scan-rows')!;
    expect(rows.textContent).not.toMatch(/unexplained|Unexplained|°\/day|SkyBoT|Sean|Abramenko/);
    expect(rows.querySelector('[data-testid="scan-track"]')).toBeNull();
    expect(q('scan-prov-tags')?.querySelectorAll('[data-testid="provenance-badge"]')).toHaveLength(
      1,
    );
    expect(q('scan-predicted')).toBeNull();
    // The not-checked message stays: a check that did not run is a fact about the run.
    expect(q('scan-unchecked')).not.toBeNull();
  });
  it('switching back from Measured only restores the verdicts without a reload', async () => {
    useAppStore.setState({ honesty: 'measured' });
    await show(true);
    expect(q('scan-filter-found')).toBeNull();
    await act(async () => useAppStore.setState({ honesty: 'derived' }));
    expect(q('scan-filter-found')).not.toBeNull();
    expect(q('scan-rows')?.textContent).toMatch(/Unexplained track|Sean|Abramenko/);
  });
  it('announces the end once, in a live region; the honesty toggle does not re-announce it', async () => {
    await show(true);
    const live = q('scan-announce')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    const said = live.textContent;
    expect(said).toMatch(/^Scan done: /);
    await act(async () => useAppStore.setState({ honesty: 'measured' }));
    expect(q('scan-announce')!.textContent).toBe(said);
  });
  it('a scan from the dev-server mock wears the Test data tag', async () => {
    setScanApi(mockScanApi({ persist: false }));
    await show(true);
    expect(q('scan-test-data')?.textContent).toBe('Test data');
  });
});

describe('ECSV export at Measured only', () => {
  it('holds the tracks only: no known rows, designations, status, magnitudes or rates', async () => {
    const { record, results } = await finished(true);
    const normal = scanEcsv(results, REGION);
    const measured = scanEcsv(results, REGION, true);
    expect(normal).toMatch(/^known,/m);
    expect(measured).not.toMatch(/^known,/m);
    expect(measured).toContain('honesty: measured only');
    const body = measured.split('\n').filter((l) => l.startsWith('track,'));
    expect(body).toHaveLength(trackRowsOf(results).length);
    for (const l of body) expect(l).toMatch(/^track,,T\w+,,,,/);
    expect(measured).not.toMatch(/Sean|Abramenko|unexplained,|unchecked,/);
    expect(record.run_id).toBeTruthy();
  });
});

describe('replay marks match the sky at Measured only', () => {
  it('a matched known object (Horizons positions) has no mark', async () => {
    const { record } = await finished(true);
    const measuredKeys = new Set(
      measuredObjects(record.events, null).map((o) => `${o.squares[0]}:${o.trackId}`),
    );
    const marks = ticksOf(record, true).filter((k) => k.kind === 'track');
    expect(marks.length).toBe(measuredKeys.size);
  });
});
