// Known objects card and the Known positions layer on real /known replies (issue #130, A18.5, A18.2).
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAreaKnown } from '@/app/api/validate';
import { registerAreaView } from '@/app/sky/areaDraw';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import type { AreaIndexEntry } from '@/contract';
import { knownRow, type KnownObjectsResult } from './areaService';
import { KnownList, NO_TRACK_NOTE } from './KnownList';
import { distinctTimes, KnownPositionsLayer, knownPositionsVisible, MEASURED_ONLY_NOTE } from './KnownPositionsLayer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const KNOWN = parseAreaKnown(
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/area/known.json`, 'utf8')),
);
const RESULT: KnownObjectsResult = {
  demo: false,
  real: {
    entry: { area_id: 'fixture:area-main', data_release: 'qr2' } as AreaIndexEntry,
    known: KNOWN,
    missing: [...KNOWN.missing],
    synthetic: false,
  },
  objects: KNOWN.known.map(knownRow),
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

describe('KnownList rows (A18.5)', () => {
  it('Track it where track_available, Open (with the reason) where not; no Demo tag on real rows', async () => {
    await act(async () => root.render(<KnownList />));
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')];
    expect(rows).toHaveLength(KNOWN.known.length);
    expect(rows[0]!.dataset.track).toBe('yes');
    expect(rows[0]!.textContent).toContain('Track it');
    expect(rows[0]!.textContent).toContain(`${KNOWN.known[0]!.n_frames} frames in ${KNOWN.known[0]!.n_visits} visits`);
    expect(rows[0]!.querySelector('[data-testid="provenance-badge"]')?.getAttribute('data-tag')).toBe('model_dependent');
    expect(rows[1]!.dataset.track).toBe('no');
    expect(rows[1]!.textContent).toContain('Open');
    expect(rows[1]!.textContent).toContain(NO_TRACK_NOTE);
    expect(host.querySelector('[data-testid="demo-tag"]')).toBeNull();
    // SkyBoT answers per visit of the area, so the date is the card's, said once.
    expect(host.querySelector('[data-testid="known-skybot"]')?.textContent).toContain('SkyBoT last answered');
  });
  it('Track it opens the Eros card for that object', async () => {
    const open = vi.spyOn(useAreaStore.getState(), 'openEros').mockImplementation(() => {});
    useAreaStore.setState({ openEros: open });
    await act(async () => root.render(<KnownList />));
    await act(async () => host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')[0]!.click());
    expect(open).toHaveBeenCalledWith(RESULT.objects[0]);
  });
  it('Open searches the object as a marker click does and asks for no card', async () => {
    const skySearch = vi.fn(async () => {});
    useAppStore.setState({ skySearch });
    const cancel = vi.spyOn(useShellStore.getState(), 'cancelCard');
    useShellStore.setState({ cancelCard: cancel });
    await act(async () => root.render(<KnownList />));
    await act(async () => host.querySelectorAll<HTMLElement>('[data-testid="known-row"]')[1]!.click());
    expect(cancel).toHaveBeenCalled();
    expect(skySearch).toHaveBeenCalledWith({ q: KNOWN.known[1]!.designation, kind: 'name', origin: 'sky' });
  });
  it('lists skybot and horizons codes of `missing` as plain lines', async () => {
    useAreaStore.setState({ known: { ...RESULT, real: { ...RESULT.real!, missing: ['skybot:2', 'horizons:433 Eros'] } } });
    await act(async () => root.render(<KnownList />));
    const notes = host.querySelector('[data-testid="area-missing"]')!;
    expect(notes.textContent).toContain('SkyBoT) has no answer for visit 2');
    expect(notes.textContent).toContain('No predicted path for 433 Eros');
  });
  it('a refusal replaces the list', async () => {
    useAreaStore.setState({ known: null, refusal: { code: 'area:not_prepared', message: 'No prepared data for this area yet.' } });
    await act(async () => root.render(<KnownList />));
    expect(host.querySelector('[data-testid="area-refused"]')?.getAttribute('data-code')).toBe('area:not_prepared');
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
  it('is hidden in Measured only, with the note why', async () => {
    useAppStore.setState({ honesty: 'measured' });
    await act(async () => root.render(<KnownPositionsLayer view={view} />));
    expect(host.querySelector('[data-testid="known-positions"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="known-position"]')).toHaveLength(0);
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
