// PR #131 review: the Eros card's honesty (D-21, A18.2) and what it says about the path. "Measured
// only" hides every Horizons layer (the path, the cutout's predicted position and path), whether
// the path is the backend's or the demo's; the Estimated badge sits on the path line only, and a
// path that is not ready yet says so.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAreaStore } from '@/app/shell/areaStore';
import { useAppStore } from '@/state/store';
import type { ErosDemo, ErosHop } from './areaService';
import { ErosCard } from './ErosCard';
import { drawTrackWindow, trackShown } from './erosDraw';
import { MEASURED_ONLY_NOTE } from './KnownPositionsLayer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const hop = (exposure: number, detector: string): ErosHop => ({
  frame_id: `f_${exposure}_${detector}`,
  exposure,
  detector,
  mjd_avg: 61119.36 + exposure * 0.001,
  hw_flags: [],
  nx: 58,
  ny: 59,
  x: 28.5,
  y: 29,
  wl_um: 1,
  flux: 100,
  stars: [],
  seg: [],
  north: [0, 1],
  east: [1, 0],
  png: '',
  flags_png: '',
  wide_px: [0, 0],
});
const EROS: ErosDemo = {
  object: { name: '433 Eros' },
  wide: { png: '', w: 10, h: 10 },
  track: [],
  hops: [hop(1, 'D1'), hop(1, 'D4')],
};
const OBJ = {
  id: '433',
  name: 'Eros',
  kind: 'asteroid',
  frames: 2,
  visits: 1,
  objectId: 'sbdb-20000433',
  trackAvailable: true,
};

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const box = (id: string) => q(id) as HTMLInputElement;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useAreaStore.getState().reset();
  useAppStore.setState({ honesty: 'derived' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useAreaStore.getState().reset();
  useAppStore.setState({ honesty: 'derived' });
});

describe('Eros card honesty (D-21)', () => {
  it('Measured only turns off the predicted position and path overlays, and says why', async () => {
    useAreaStore.setState({ flow: 'known', screen: 'eros', eros: EROS, trackSource: 'demo' });
    await act(async () => root.render(<ErosCard />));
    expect(box('eros-ov-pred').disabled).toBe(false);
    expect(q('eros-path')).toBeNull();
    await act(async () => useAppStore.setState({ honesty: 'measured' }));
    expect(box('eros-ov-pred').disabled).toBe(true);
    expect(box('eros-ov-pred').checked).toBe(false);
    expect(box('eros-ov-path').disabled).toBe(true);
    // Measured layers stay.
    expect(box('eros-ov-mask').disabled).toBe(false);
    expect(box('eros-ov-flags').disabled).toBe(false);
    expect(q('eros-path')?.textContent).toContain(MEASURED_ONLY_NOTE);
  });
  it('a real path: the Estimated badge is on the path line, not on the frame count', async () => {
    useAreaStore.setState({
      flow: 'known',
      screen: 'eros',
      eros: EROS,
      focus: OBJ,
      trackSource: 'real',
      trackPath: true,
    });
    await act(async () => root.render(<ErosCard />));
    expect(q('eros-real')?.textContent).toBe('2 frames from the backend');
    expect(q('eros-real')?.querySelector('[data-testid="provenance-badge"]')).toBeNull();
    expect(q('eros-path')?.textContent).toContain('Path from Horizons');
    expect(q('eros-path')?.querySelector('[data-testid="provenance-badge"]')).not.toBeNull();
  });
  it('no path: no Estimated badge; a path not ready yet says so', async () => {
    useAreaStore.setState({
      flow: 'known',
      screen: 'eros',
      eros: EROS,
      focus: OBJ,
      trackSource: 'real',
      trackPath: false,
    });
    await act(async () => root.render(<ErosCard />));
    expect(q('eros-path')?.textContent).toBe('No path for this object');
    expect(host.querySelector('.sx-kn-real [data-testid="provenance-badge"]')).toBeNull();
    await act(async () => useAreaStore.setState({ pathPending: true }));
    expect(q('eros-path')?.textContent).toContain('still being prepared');
  });
});

describe('demo labels follow the cutouts', () => {
  const brightnessBadge = () =>
    host.querySelector('.sx-kn-spec-t [data-testid="provenance-badge"]');
  it('real frames with demo cutouts: the "Demo cutouts" tag and the demo-photometry badge show', async () => {
    useAreaStore.setState({
      flow: 'known',
      screen: 'eros',
      eros: EROS,
      focus: OBJ,
      trackSource: 'real',
    });
    await act(async () => root.render(<ErosCard />));
    expect(q('demo-tag')?.textContent).toContain('Demo cutouts');
    expect(brightnessBadge()).not.toBeNull();
  });
  it('real frames with no cutout at all: neither the tag nor the badge is shown', async () => {
    const bare: ErosDemo = {
      ...EROS,
      hops: EROS.hops.map((h) => ({ ...h, no_cutout: true, flux: Number.NaN })),
    };
    useAreaStore.setState({
      flow: 'known',
      screen: 'eros',
      eros: bare,
      focus: OBJ,
      trackSource: 'real',
    });
    await act(async () => root.render(<ErosCard />));
    expect(q('demo-tag')).toBeNull();
    expect(host.textContent).not.toContain('Demo cutouts');
    expect(brightnessBadge()).toBeNull();
  });
});

/** A 2D context that records the labels drawn; every other call is a no-op. */
function recordingContext(): { g: CanvasRenderingContext2D; labels: string[] } {
  const labels: string[] = [];
  const g = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'fillText') return (text: string) => labels.push(text);
        if (k === 'measureText') return () => ({ width: 10 });
        return () => {};
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { g, labels };
}

describe('the track window path', () => {
  it('labels each 6-hour mark once, whatever the sampling step (the real /path is 10-minute)', () => {
    const start = Date.parse('2026-03-20T00:00:00.000Z');
    const track = Array.from({ length: 6 * 36 + 1 }, (_, i) => ({
      t: new Date(start + i * 10 * 60_000).toISOString(),
      px: [i, i] as [number, number],
    }));
    const eros: ErosDemo = { ...EROS, wide: { png: '', w: 400, h: 400 }, track };
    const { g, labels } = recordingContext();
    const rect = { x0: 0, y0: 0, x1: 400, y1: 400 };
    drawTrackWindow(
      g,
      rect,
      eros,
      { mode: 'eros', now: 61119.5, step: 0, sel: -1, disc: null, name: 'Eros' },
      () => {},
    );
    const marks = labels.filter((l) => /\d\dh$/.test(l));
    // 00h, 06h, 12h, 18h on 20 Mar and 00h, 06h, 12h on 21 Mar.
    expect(marks).toHaveLength(7);
    expect(new Set(marks).size).toBe(7);
  });
  it('Measured only draws no path and no marks on the track window (D-21)', () => {
    const start = Date.parse('2026-03-20T00:00:00.000Z');
    const track = Array.from({ length: 13 }, (_, i) => ({
      t: new Date(start + i * 3_600_000).toISOString(),
      px: [i, i] as [number, number],
    }));
    const eros: ErosDemo = { ...EROS, wide: { png: '', w: 400, h: 400 }, track };
    const rect = { x0: 0, y0: 0, x1: 400, y1: 400 };
    const st = { mode: 'eros' as const, now: 61119.2, step: 0, sel: -1, disc: null, name: 'Eros' };
    const shown = recordingContext();
    drawTrackWindow(shown.g, rect, trackShown(eros, false), st, () => {});
    expect(shown.labels.filter((l) => /\d\dh$/.test(l))).toEqual([
      '20 Mar 00h',
      '20 Mar 06h',
      '20 Mar 12h',
    ]);
    expect(shown.labels.some((l) => l.startsWith('Eros ·'))).toBe(true);
    const hidden = recordingContext();
    drawTrackWindow(hidden.g, rect, trackShown(eros, true), st, () => {});
    expect(hidden.labels).toEqual([]);
  });
});
