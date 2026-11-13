// Known objects card and the Known positions layer on real /known replies (issue #130, A18.5, A18.2).
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAreaKnown, parseAreaSummary, parseAreaTracks } from '@/app/api/validate';
import { registerAreaView } from '@/app/sky/areaDraw';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import type { AreaIndexEntry } from '@/contract';
import { knownRow, sortKnown, type KnownObject, type KnownObjectsResult } from './areaService';
import { filterKnown, KnownList, NO_ID_NOTE, PAGE, PREDICTED_NOTE, rowLine, trackAround } from './KnownList';
import { distinctTimes, KnownPositionsLayer, knownPositionsVisible, MEASURED_ONLY_NOTE } from './KnownPositionsLayer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const KNOWN = parseAreaKnown(
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/area/known.json`, 'utf8')),
);
const TRACKS = parseAreaTracks(
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/area/tracks.json`, 'utf8')),
);
const SUMMARY = parseAreaSummary(
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/area/summary.json`, 'utf8')),
);
const RESULT: KnownObjectsResult = {
  demo: false,
  real: {
    entry: { area_id: 'fixture:area-main', data_release: 'qr2' } as AreaIndexEntry,
    known: KNOWN,
    summary: SUMMARY,
    tracks: TRACKS,
    dots: null,
    missing: [...KNOWN.missing],
    synthetic: false,
  },
  objects: sortKnown(KNOWN.known.map((k) => knownRow(k, TRACKS.tracks))),
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useAreaStore.getState().reset();
  useAreaStore.setState({ flow: 'known', screen: 'list', known: RESULT, refusal: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  registerAreaView(null);
  useAreaStore.getState().reset();
  useAppStore.setState({ honesty: 'derived' });
  vi.restoreAllMocks();
});

const row = (over: Partial<KnownObject>): KnownObject => ({
  id: '7347', name: '1993 EW', kind: 'asteroid', frames: 14, visits: 2, designation: '7347 1993 EW',
  objectId: 'sbdb-7347', trackAvailable: false, positions: [], number: 7347, vMag: 17.9, detection: null, ...over,
});

describe('KnownList rows (A18.5, Q-466)', () => {
  it('Detected (found blind by a track) first, then Predicted; chips, lines and the note', async () => {
    await act(async () => root.render(<KnownList />));
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')];
    expect(rows).toHaveLength(KNOWN.known.length);
    expect(rows[0]!.dataset.object).toBe('Synthetic fixture A1');
    expect(rows[0]!.querySelector('[data-testid="known-chip"]')?.getAttribute('data-kind')).toBe('detected');
    expect(rows[0]!.textContent).toContain('0.42 px from predicted');
    expect(rows[1]!.querySelector('[data-testid="known-chip"]')?.getAttribute('data-kind')).toBe('predicted');
    expect(rows[1]!.textContent).toContain(`${KNOWN.known[1]!.n_frames} frames in ${KNOWN.known[1]!.n_visits} visit`);
    expect(host.querySelector('[data-testid="known-predicted-note"]')?.textContent).toBe(PREDICTED_NOTE);
    expect(host.querySelector('[data-testid="demo-tag"]')).toBeNull();
    // SkyBoT answers per visit of the area, so the date is the card's, said once.
    expect(host.querySelector('[data-testid="known-skybot"]')?.textContent).toContain('SkyBoT last answered');
    expect(host.querySelector('[data-testid="area-precomputed"]')?.textContent).toMatch(/^Precomputed · /);
    expect(host.querySelector('[data-testid="area-visits"]')?.textContent).toMatch(/^Visits .* · \d+ frames$/);
  });
  it('sorts detected first, then brighter first, unknown V last (sortKnown)', () => {
    const list = sortKnown([
      row({ id: 'a', designation: 'a', vMag: null }),
      row({ id: 'b', designation: 'b', vMag: 20 }),
      row({ id: 'c', designation: 'c', vMag: 21, detection: { trackId: 'T1', sepPx: 0.2 } }),
      row({ id: 'd', designation: 'd', vMag: 17 }),
    ]);
    expect(list.map((o) => o.id)).toEqual(['c', 'd', 'b', 'a']);
  });
  it('the filter works on a 144-row list, and long lists show PAGE rows until "Show all"', async () => {
    const objects = Array.from({ length: 144 }, (_, i) =>
      row({ id: String(100000 + i), designation: `${100000 + i} X${i}`, vMag: 15 + i / 10, detection: i < 2 ? { trackId: `T${i + 1}`, sepPx: 0.3 } : null }),
    );
    useAreaStore.setState({ known: { ...RESULT, objects: sortKnown(objects) } });
    await act(async () => root.render(<KnownList />));
    const count = () => host.querySelectorAll('[data-testid="known-row"]').length;
    expect(host.querySelector('[data-testid="known-filter-all"]')?.textContent).toBe('All 144');
    expect(host.querySelector('[data-testid="known-filter-detected"]')?.textContent).toBe('Detected 2');
    expect(host.querySelector('[data-testid="known-filter-predicted"]')?.textContent).toBe('Predicted 142');
    expect(count()).toBe(PAGE);
    await act(async () => host.querySelector<HTMLElement>('[data-testid="known-more"]')!.click());
    expect(count()).toBe(144);
    await act(async () => host.querySelector<HTMLElement>('[data-testid="known-filter-detected"]')!.click());
    expect(count()).toBe(2);
    expect(host.querySelector('[data-testid="known-filter-detected"]')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => host.querySelector<HTMLElement>('[data-testid="known-filter-predicted"]')!.click());
    expect(count()).toBe(PAGE);
    expect(filterKnown(objects, 'predicted')).toHaveLength(142);
    // Held UI issue 3: the full number is in its own column, never cut ("10021…").
    const nums = [...host.querySelectorAll('.sx-kr-num')].map((n) => n.textContent);
    expect(nums).toContain('100002');
  });
  it('no filter when the tracks did not load (detected or not is not known)', async () => {
    const objects = KNOWN.known.map((k) => knownRow(k));
    useAreaStore.setState({ known: { ...RESULT, objects } });
    await act(async () => root.render(<KnownList />));
    expect(host.querySelector('[data-testid="known-filter"]')).toBeNull();
    expect(host.querySelector('[data-testid="known-chip"]')).toBeNull();
  });
  it('rowLine: kind, V and the separation or the frames', () => {
    expect(rowLine(row({ detection: { trackId: 'T1', sepPx: 0.24 }, vMag: 17.42 }))).toBe('asteroid · V 17.4 · 0.24 px from predicted');
    expect(rowLine(row({ vMag: null }))).toBe('asteroid · 14 frames in 2 visits');
  });
  it('Track it: the Track view at once when Track-available (and for 433 Eros)', async () => {
    const eros = row({ id: '433', name: 'Eros', objectId: 'sbdb-20000433', designation: '433 Eros', trackAvailable: false });
    const ready = row({ id: '9', name: 'Metis', objectId: 'sbdb-20000009', designation: '9 Metis', trackAvailable: true });
    useAreaStore.setState({ known: { ...RESULT, objects: [eros, ready] } });
    const open = vi.fn();
    useAreaStore.setState({ openEros: open });
    await act(async () => root.render(<KnownList />));
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')];
    expect(rows.map((r) => r.dataset.track)).toEqual(['yes', 'yes']);
    await act(async () => rows[0]!.querySelector<HTMLElement>('[data-testid="known-track"]')!.click());
    await act(async () => rows[1]!.querySelector<HTMLElement>('[data-testid="known-track"]')!.click());
    expect(open.mock.calls).toEqual([[eros], [ready]]);
  });
  it('Track it computes the Track first (±3 days of its frame times), or is off with no JPL id', async () => {
    const t = (iso: string) => ({ frame_id: 'f', time: iso, ra: 150, dec: 10 });
    const todo = row({ positions: [t('2026-06-27T04:48:00Z'), t('2026-06-27T06:30:00Z')] });
    const noId = row({ id: '1', name: 'Nobody', designation: '1 Nobody', objectId: null });
    useAreaStore.setState({ known: { ...RESULT, objects: [todo, noId] } });
    const openTrack = vi.fn();
    useAreaStore.setState({ openTrack });
    await act(async () => root.render(<KnownList />));
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')];
    expect(rows.map((r) => r.dataset.track)).toEqual(['compute', 'no']);
    const off = rows[1]!.querySelector<HTMLButtonElement>('[data-testid="known-track"]')!;
    expect(off.disabled).toBe(true);
    expect(off.title).toBe(NO_ID_NOTE);
    await act(async () => rows[0]!.querySelector<HTMLElement>('[data-testid="known-track"]')!.click());
    expect(openTrack).toHaveBeenCalledWith(todo, '2026-06-27T05:39:00Z', 'qr2');
    expect(trackAround(row({ positions: [] }), RESULT.real)).not.toBeNull(); // from the area's visits
    expect(trackAround(row({ positions: [] }), null)).toBeNull();
  });
  it('Build it searches the object as a marker click does, then opens the build view', async () => {
    const skySearch = vi.fn(async () => {});
    useAppStore.setState({ skySearch });
    const cancel = vi.spyOn(useShellStore.getState(), 'cancelCard');
    useShellStore.setState({ cancelCard: cancel });
    await act(async () => root.render(<KnownList />));
    await act(async () => host.querySelectorAll<HTMLElement>('[data-testid="known-build"]')[1]!.click());
    expect(cancel).toHaveBeenCalled();
    expect(skySearch).toHaveBeenCalledWith({ q: KNOWN.known[1]!.designation, kind: 'name', origin: 'sky' });
    expect(useShellStore.getState().build.open).toBe(false); // not before the name resolves
    await act(async () =>
      useAppStore.setState((s) => ({ sky: { ...s.sky, resolved: { id: 'x', name: 'x', moving: true } as never } })),
    );
    expect(useShellStore.getState().build.open).toBe(true);
    useShellStore.getState().closeBuild();
  });
  it('lists skybot and horizons codes of `missing` as plain lines', async () => {
    useAreaStore.setState({ known: { ...RESULT, real: { ...RESULT.real!, missing: ['skybot:2', 'horizons:433 Eros'] } } });
    await act(async () => root.render(<KnownList />));
    const notes = host.querySelector('[data-testid="area-missing"]')!;
    expect(notes.textContent).toContain('SkyBoT) has no answer for visit 2');
    expect(notes.textContent).toContain('No predicted path for 433 Eros');
  });
  it('a refusal replaces the list with a title, one line and Draw again (held UI issue 6)', async () => {
    useAreaStore.setState({ known: null, refusal: { code: 'area:not_prepared', message: 'No prepared data for this area yet.' } });
    await act(async () => root.render(<KnownList />));
    const r = host.querySelector('[data-testid="area-refused"]')!;
    expect(r.getAttribute('data-code')).toBe('area:not_prepared');
    expect(r.querySelector('b')?.textContent).toBe('No data for this area here');
    expect(r.querySelector('span')?.textContent).toContain('Draw again');
    expect(host.querySelector('[data-testid="area-redraw"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="known-list"]')).toBeNull();
  });
  it('the fallback demo row wears the Demo tag', async () => {
    useAreaStore.setState({
      known: { demo: true, real: null, objects: [{ id: '433', name: 'Eros', kind: 'asteroid', frames: 16, visits: 2, trackAvailable: true }] },
    });
    await act(async () => root.render(<KnownList />));
    expect(host.querySelector('[data-testid="demo-tag"]')).not.toBeNull();
  });
});

describe('Known positions on the sky (A18.2)', () => {
  const view = { onRender: () => () => {} };
  beforeEach(() => {
    // A flat fake projection: one pixel per hundredth of a degree.
    registerAreaView({
      getView: () => ({ ra: 150, dec: 10, fovDeg: 5 }),
      getSize: () => ({ width: 1000, height: 600 }),
      setView: () => {},
    });
  });
  it('is visible except in Measured only', () => {
    expect(knownPositionsVisible('derived')).toBe(true);
    expect(knownPositionsVisible('artistic')).toBe(true);
    expect(knownPositionsVisible('measured')).toBe(false);
  });
  it('draws a diamond per frame time, tagged model_dependent', async () => {
    useAppStore.setState({ honesty: 'derived' });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    const svg = host.querySelector('[data-testid="known-positions"]')!;
    expect(svg.getAttribute('data-tag')).toBe('model_dependent');
    const all = KNOWN.known.flatMap((k) => distinctTimes(k.positions));
    expect(distinctTimes(KNOWN.known[0]!.positions).length).toBeLessThan(KNOWN.known[0]!.positions.length); // two detectors share a time
    expect(host.querySelectorAll('[data-testid="known-position"]')).toHaveLength(all.length);
    expect(host.querySelector('[data-testid="known-positions-tag"]')).not.toBeNull();
  });
  it('predicted paths are dashed; a detected object is solid, with its measured dots and a label', async () => {
    useAppStore.setState({ honesty: 'derived' });
    const det = { ...RESULT.objects[0]!, detection: { trackId: 'T1', sepPx: 0.4, points: [{ ra: 150.01, dec: 10.01 }] } };
    useAreaStore.setState({ known: { ...RESULT, objects: [det, RESULT.objects[1]!] } });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    const g = host.querySelector('[data-detected="true"]')!;
    expect(g.querySelector('polyline')?.getAttribute('class')).toContain('sx-det');
    expect(g.querySelectorAll('[data-testid="known-measured"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="known-label"]')).toHaveLength(1); // the detected one
  });
  it('is hidden in Measured only, with the note why; measured dots stay', async () => {
    useAppStore.setState({ honesty: 'measured' });
    const det = { ...RESULT.objects[0]!, detection: { trackId: 'T1', sepPx: 0.4, points: [{ ra: 150.01, dec: 10.01 }] } };
    useAreaStore.setState({ known: { ...RESULT, objects: [det, RESULT.objects[1]!] } });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    expect(host.querySelectorAll('[data-testid="known-position"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="known-measured"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="known-positions-note"]')?.textContent).toBe(MEASURED_ONLY_NOTE);
  });
  it('draws nothing for a refused area or another flow', async () => {
    useAreaStore.setState({ refusal: { code: 'area:not_prepared', message: 'x' } });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    expect(host.querySelector('[data-testid="known-positions"]')).toBeNull();
    useAreaStore.setState({ refusal: null, flow: 'discovery' });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    expect(host.querySelector('[data-testid="known-positions"]')).toBeNull();
  });
});
