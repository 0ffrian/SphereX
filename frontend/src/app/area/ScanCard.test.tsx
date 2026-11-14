// The scan card before its first record (a run opened from the Runs list, or restored after a
// reload): "Reading the scan…", and once the server has not answered for a while, the same
// "Lost touch with the scan" notice a scan in progress shows (it used to wait in silence for good).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanCard } from './ScanCard';
import { resetScans, useScanStore, type ScanView } from './scanStore';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const REGION = { ra: 30, dec: 10, width_deg: 9, height_deg: 5.4 };
const reading = (stale: boolean): ScanView => ({
  kind: 'run',
  flow: 'discovery',
  runId: 'run-20261113T070000-aaaaaa',
  region: REGION,
  record: null,
  square: null,
  results: null,
  stale,
  stopping: false,
});

describe('scan card with no record yet', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetScans();
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('says it is reading the scan', async () => {
    useScanStore.setState({ view: reading(false) });
    await act(async () => root.render(<ScanCard />));
    expect(q('scan-card')?.textContent).toContain('Reading the scan…');
    expect(q('scan-stale')).toBeNull();
  });
  it('says it lost touch when the server does not answer', async () => {
    useScanStore.setState({ view: reading(true) });
    await act(async () => root.render(<ScanCard />));
    expect(q('scan-stale')?.textContent).toContain('Lost touch with the scan');
  });
});
