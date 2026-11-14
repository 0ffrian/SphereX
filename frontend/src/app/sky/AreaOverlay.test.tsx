// 1b6c849: a scan draws its own grid and frame (ScanOverlay), so the single-area outline is not
// drawn while the area tool is on its scan screen; elsewhere a set box is outlined. (The #144 drag
// and its readout were removed in PR #166.)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkyView } from '@/viewer/sky/SkyView';
import { useAreaStore, type AreaBox } from '@/app/shell/areaStore';
import { AreaOverlay } from './AreaOverlay';
import { registerAreaView } from './areaDraw';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const BOX: AreaBox = {
  a: { ra: 100.5, dec: 10.5 },
  b: { ra: 99.5, dec: 9.5 },
  widthDeg: 1,
  heightDeg: 1,
};
const view = { onRender: () => () => {} } as unknown as SkyView;

let host: HTMLDivElement;
let root: Root;
const initial = useAreaStore.getState();
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  registerAreaView({
    getView: () => ({ ra: 100, dec: 10, fovDeg: 4 }),
    getSize: () => ({ width: 1000, height: 600 }),
    setView: () => {},
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  registerAreaView(null);
  useAreaStore.setState(initial, true);
});

const outline = () => host.querySelector<HTMLElement>('[data-testid="area-box"]')!;

describe('AreaOverlay under a scan', () => {
  it('outlines a set box away from the scan screen', async () => {
    useAreaStore.setState({ box: BOX, screen: 'search' });
    await act(async () => root.render(<AreaOverlay view={view} />));
    expect(outline().style.display).toBe('block');
    expect(outline().textContent).not.toBe('');
  });

  it('draws no outline and no size while the scan screen shows', async () => {
    useAreaStore.setState({ box: BOX, screen: 'scan' });
    await act(async () => root.render(<AreaOverlay view={view} />));
    expect(outline().style.display).toBe('none');
    expect(outline().textContent).toBe('');
  });
});
