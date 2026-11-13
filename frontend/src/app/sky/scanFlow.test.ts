// The scan flow's glue (issue #157; PR #159 review): selecting a region (one square: the single-area
// flow; more: the scan offer), one scan at a time, the dock reopening a scan, Back to the scan from
// an object, and the restore after a reload (only a scan still going opens its tool).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { mockScanApi, setScanApi } from '@/app/area/scanApi';
import { resetScans, useScanStore } from '@/app/area/scanStore';
import {
  backToScan,
  pickRegionAt,
  registerAreaView,
  reopenScan,
  restoreSavedScan,
} from './areaDraw';

let cam = { ra: 30, dec: 10, fovDeg: 17 };
let clock = 1_800_000_000_000;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  cam = { ra: 30, dec: 10, fovDeg: 17 };
  clock = 1_800_000_000_000;
  // Instant flights (reduced motion): the view is set at once.
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduce'),
    addEventListener() {},
    removeEventListener() {},
  }));
  registerAreaView({
    getView: () => cam,
    getSize: () => ({ width: 1280, height: 800 }),
    setView: (v) => (cam = v),
  });
  setScanApi(mockScanApi({ squareMs: 1000, now: () => clock, persist: false }));
  useShellStore.getState().setTool('area');
  useAreaStore.getState().startFlow('discovery');
});
afterEach(() => {
  resetScans();
  setScanApi(null);
  registerAreaView(null);
  useAreaStore.getState().reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('selecting a region', () => {
  it('more than one square: the scan offer, the sky flown to the region', async () => {
    pickRegionAt(640, 400);
    expect(useAreaStore.getState()).toMatchObject({ screen: 'scan', stage: 'set' });
    expect(cam.fovDeg).toBeCloseTo(6, 1);
    await flush();
    expect(useScanStore.getState().view).toMatchObject({ kind: 'offer', flow: 'discovery' });
  });

  it('one square: the single-area flow, no scan', () => {
    cam = { ra: 30, dec: 10, fovDeg: 3 };
    pickRegionAt(640, 400);
    expect(useAreaStore.getState().screen).not.toBe('scan');
    expect(useAreaStore.getState().box?.widthDeg).toBeCloseTo(1.68, 1);
    expect(useScanStore.getState().view).toBeNull();
  });

  it('one scan at a time: selecting while one runs brings it back instead of dropping it', async () => {
    pickRegionAt(640, 400);
    await flush();
    await useScanStore.getState().start();
    const runId =
      useScanStore.getState().view?.kind === 'run' ? useScanStore.getState().view : null;
    expect(runId).not.toBeNull();
    // The other tool, a new selection somewhere else.
    useAreaStore.getState().startFlow('known');
    cam = { ra: 100, dec: -20, fovDeg: 17 };
    pickRegionAt(640, 400);
    expect(useScanStore.getState().view).toBe(runId);
    expect(useAreaStore.getState()).toMatchObject({ screen: 'scan', flow: 'discovery' });
    expect(cam.ra).toBeCloseTo(30, 0);
  });
});

describe('back to the scan', () => {
  it('the dock reopens a held scan; Back from an object returns to it and flies to its region', async () => {
    pickRegionAt(640, 400);
    await flush();
    await useScanStore.getState().start();
    await flush();
    // An object opened from the scan card: its Back says scan.
    useAreaStore
      .getState()
      .openEros({ id: '7051', name: 'Sean', kind: 'asteroid', frames: 0, visits: 0 });
    expect(useAreaStore.getState()).toMatchObject({ screen: 'eros', trackBack: 'scan' });
    cam = { ra: 31, dec: 11, fovDeg: 2 };
    backToScan();
    expect(useAreaStore.getState().screen).toBe('scan');
    expect(cam).toMatchObject({ ra: 30, dec: 10 });
    // The tool closed and opened again from the dock.
    useAreaStore.getState().startFlow('discovery');
    expect(reopenScan('discovery')).toBe(true);
    expect(useAreaStore.getState().screen).toBe('scan');
  });

  it('no scan: the dock starts selecting', () => {
    expect(reopenScan('discovery')).toBe(false);
  });
});

describe('restore after a reload', () => {
  const save = (runId: string) =>
    localStorage.setItem(
      'sx-scan-run',
      JSON.stringify({
        runId,
        flow: 'discovery',
        region: { ra: 30, dec: 10, width_deg: 9.6, height_deg: 6 },
      }),
    );

  it('a scan still going opens its tool on the plain sky', async () => {
    const api = mockScanApi({ squareMs: 1000, now: () => clock, persist: false });
    setScanApi(api);
    const started = await api.start({
      ra: 30,
      dec: 10,
      width_deg: 9.6,
      height_deg: 6,
      kind: 'discovery',
    });
    if (started.kind !== 'started') throw new Error('not started');
    save(started.run.run_id);
    useShellStore.getState().setTool('sky');
    useAreaStore.getState().reset();
    restoreSavedScan();
    await flush();
    expect(useScanStore.getState().view).toMatchObject({ kind: 'run', runId: started.run.run_id });
    expect(useShellStore.getState().tool).toBe('area');
    expect(useAreaStore.getState().screen).toBe('scan');
  });

  it('a finished scan is only followed (no tool opened); a run the server lost is forgotten', async () => {
    const api = mockScanApi({ squareMs: 1000, now: () => clock, persist: false });
    setScanApi(api);
    const started = await api.start({
      ra: 30,
      dec: 10,
      width_deg: 9.6,
      height_deg: 6,
      kind: 'discovery',
    });
    if (started.kind !== 'started') throw new Error('not started');
    clock += 120_000;
    save(started.run.run_id);
    useShellStore.getState().setTool('sky');
    restoreSavedScan();
    await flush();
    expect(useScanStore.getState().view).toMatchObject({ kind: 'run' });
    expect(useShellStore.getState().tool).toBe('sky');
    resetScans();
    save('run-gone');
    restoreSavedScan();
    await flush();
    expect(useScanStore.getState().view).toBeNull();
    expect(localStorage.getItem('sx-scan-run')).toBeNull();
  });
});
