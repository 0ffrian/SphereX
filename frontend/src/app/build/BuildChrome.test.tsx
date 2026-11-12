// Issue #71 stream U: the zoom bar and the tool dock of the build view.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseUpStore } from '@/app/closeUpStore';
import { PAPER_PENDING, ReadPaper, ZoomBar, zoomPercent } from './BuildChrome';
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
  it('Read paper says the paper is not out yet, and links to it once it is (Q-457)', async () => {
    await act(async () => root.render(<ReadPaper url={null} />));
    expect(q('build-paper').getAttribute('aria-disabled')).toBe('true');
    expect(q('build-paper').getAttribute('aria-label')).toContain(PAPER_PENDING);
    await act(async () => q('build-paper').click());
    expect(q('build-paper-note').textContent).toBe(PAPER_PENDING);
    await act(async () => root.render(<ReadPaper url="https://example.org/paper.pdf" />));
    expect(q('build-paper').getAttribute('href')).toBe('https://example.org/paper.pdf');
  });
});
