// Issue #71 stream U: the zoom bar and the tool dock of the build view.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseUpStore } from '@/app/closeUpStore';
import { useShellStore } from '@/app/shell/shellStore';
import { BuildDock, ZoomBar, zoomPercent } from './BuildChrome';
import type { ViewerApp } from '@/viewer/ViewerApp';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCloseUpStore.getState().reset();
});
const q = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

describe('zoom bar', () => {
  it('writes the zoom as a percent', () => {
    expect(zoomPercent(1)).toBe('100%');
    expect(zoomPercent(1.5)).toBe('150%');
    expect(zoomPercent(1.2 * 1.2)).toBe('144%');
  });

  it('is off until the 3D view exists, then zooms it and reads its zoom back', async () => {
    await act(async () => root.render(<ZoomBar />));
    expect(q('build-zoom-value').disabled).toBe(true);
    let ratio = 1;
    const viewer = {
      zoom: vi.fn((d: 'in' | 'out') => {
        ratio *= d === 'in' ? 1.2 : 1 / 1.2;
      }),
      resetView: vi.fn(() => {
        ratio = 1;
      }),
      zoomRatio: vi.fn(() => ratio),
    } as unknown as ViewerApp;
    await act(async () => useCloseUpStore.getState().publish({ viewer }));
    const zoomIn = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
    await act(async () => zoomIn.click());
    expect(viewer.zoom).toHaveBeenCalledWith('in');
    expect(q('build-zoom-value').textContent).toBe('120%');
    await act(async () => q('build-zoom-value').click());
    expect(viewer.resetView).toHaveBeenCalled();
    expect(q('build-zoom-value').textContent).toBe('100%');
  });
});

describe('dock', () => {
  it('Area search is shown but off, and says so', async () => {
    await act(async () => root.render(<BuildDock pop={null} onPop={() => {}} />));
    const area = q('dock-area');
    expect(area.disabled).toBe(true);
    expect(area.getAttribute('aria-label')).toMatch(/not available yet/i);
  });

  it('the fingerprint opens Feel and closes it again; the sky button closes the build', async () => {
    const onPop = vi.fn();
    useShellStore.getState().openBuild(false);
    await act(async () => root.render(<BuildDock pop={null} onPop={onPop} />));
    await act(async () => q('dock-feel').click());
    expect(onPop).toHaveBeenLastCalledWith('feel');
    await act(async () => root.render(<BuildDock pop="feel" onPop={onPop} />));
    expect(q('dock-feel').getAttribute('aria-pressed')).toBe('true');
    await act(async () => q('dock-feel').click());
    expect(onPop).toHaveBeenLastCalledWith(null);
    await act(async () => q('dock-sky').click());
    expect(useShellStore.getState().build.open).toBe(false);
  });
});
