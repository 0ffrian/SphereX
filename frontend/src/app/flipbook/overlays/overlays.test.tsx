import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/app/api/client';
import type { Frame, OverlayFrame, OverlaysResponse } from '@/app/api/types';
import {
  initialAppData,
  initialOverlaysState,
  initialSkyState,
  useAppStore,
  setSkyApi,
  type SkyState,
} from '@/state/store';
import { fixtureFetch } from '@/test/fixtureFetch';
import { CombinePanel } from './CombinePanel';
import { FieldOfView, FOV_NO_FOOTPRINT } from './FieldOfView';
import { markerPercent, niceScale, tangentPlane, toMap } from './geometry';
import { MarkerLayer } from './MarkerLayer';
import { overlayView } from './model';
import { ContaminationNote, OverlayControls, OverlayDetails } from './OverlayPanel';
import { combineWarning, contaminationLines, describeCatalog } from './text';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Test data only, not physical claims.
const ovFrame: OverlayFrame = {
  frame_id: 'f1',
  flags_url: '/v1/objects/o/flags/f1.png',
  markers: [
    { catalog: 'gaia', id: 'g1', x: 9.5, y: 19.5 },
    { catalog: 'wise', id: 'w1', x: 0, y: 63 },
  ],
  contamination: [
    { catalog: 'gaia', id: 'g1', mag: 14.23, zone: 'aperture', sep_px: 1.84 },
    { catalog: 'wise', id: 'w1', mag: null, zone: 'annulus', sep_px: 7.1 },
    { catalog: 'wise', id: 'w2', mag: 12, zone: 'annulus', sep_px: 6.2 },
  ],
  footprint: [
    [10.5, 0.5],
    [9.5, 0.5],
    [9.5, -0.5],
    [10.5, -0.5],
  ],
  cutout_box: [
    [10.05, 0.05],
    [9.95, 0.05],
    [9.95, -0.05],
    [10.05, -0.05],
  ],
};

const data: OverlaysResponse = {
  id: 'o',
  data_release: 'test',
  cached_at: null,
  catalogs: [
    {
      catalog: 'gaia',
      available: true,
      table: 'gaia_table',
      epoch: 'J2016.0',
      mag_band: 'G',
      mag_limit: 19,
      sources: [{ id: 'g1', ra: 10, dec: 0, mag: 14.23, pmra_mas_yr: null, pmdec_mas_yr: null }],
    },
    {
      catalog: 'wise',
      available: true,
      table: 'wise_table',
      epoch: null,
      mag_band: 'W1',
      mag_limit: null,
      sources: [{ id: 'w1', ra: 10, dec: 0, mag: null, pmra_mas_yr: null, pmdec_mas_yr: null }],
    },
  ],
  aperture: { radius_px: 3, annulus_inner_px: 6, annulus_outer_px: 10 },
  flag_groups: [{ group: 'saturation', rgba: [255, 0, 0, 128], names: ['SAT'] }],
  frames: [ovFrame],
  missing: [],
  provenance: {
    catalog_positions: { tag: 'measured' },
    catalog_mags: { tag: 'measured' },
    markers: { tag: 'derived', formula: 'sky to pixel via WCS' },
    contamination: { tag: 'derived', formula: 'separation vs aperture' },
    footprint: { tag: 'measured' },
    cutout_box: { tag: 'derived', formula: 'pixel corners to sky' },
    flags_mask: { tag: 'measured' },
  },
};

const frame = (i: number, wl: number): Frame => ({
  frame_id: `f${i}`,
  time: '2025-05-03T00:00:00Z',
  wavelength_um: wl,
  x: 31,
  y: 31,
  cutout_url: `/c/${i}.png`,
  flags: [],
});

const readySky = (patch: Partial<SkyState['overlays']> = {}, d = data): SkyState => ({
  ...initialSkyState,
  status: 'ready',
  overlays: { ...initialOverlaysState, status: 'ready', data: d, ...patch },
});

describe('overlay geometry', () => {
  it('places markers like the object ring: (x + 0.5) / w', () => {
    expect(markerPercent(31.5, 64)).toBe(50);
    expect(markerPercent(0, 64)).toBeCloseTo(0.78125);
    expect(markerPercent(63, 64)).toBeCloseTo(99.21875);
  });

  it('projects north up and east left around the centre', () => {
    expect(tangentPlane(10, 0, 10, 0)).toEqual({ xi: 0, eta: 0 });
    const east = toMap(10, 0, [10.1, 0])!; // larger RA is east → drawn on the left
    const north = toMap(10, 0, [10, 0.1])!; // larger Dec is north → drawn above
    expect(east.u).toBeLessThan(0);
    expect(north.v).toBeLessThan(0);
    expect(tangentPlane(0, 0, 180, 0)).toBeNull();
  });

  it('picks a round scale-bar length', () => {
    expect(niceScale(0.5).label).toBe('30′');
    expect(niceScale(0.04).label).toBe('2′');
    expect(niceScale(3).label).toBe('2°');
  });
});

describe('overlay wording', () => {
  it('an available catalogue with no rows says so', () => {
    const wise = data.catalogs[1]!;
    expect(describeCatalog({ ...wise, sources: [] })).toBe(
      'Table wise_table, epoch not stated. The catalogue has no sources in this area.',
    );
    expect(describeCatalog(wise)).toBe('Table wise_table, epoch not stated');
  });

  it('says what sits in the aperture and the annulus', () => {
    expect(contaminationLines(ovFrame.contamination, data)).toEqual([
      '1 Gaia star inside the photometry aperture (G 14.2, 1.8 px away)',
      '2 WISE sources in the background annulus (W1 12.0, 6.2 px away; W1 magnitude unknown, 7.1 px away)',
    ]);
    expect(contaminationLines([], data)).toEqual([]);
  });

  it('the combine warning names both wavelengths', () => {
    expect(combineWarning(1.2, 3.456)).toBe(
      'Frames are at different wavelengths (1.200 µm and 3.456 µm); the result mixes spectral shape with change over time.',
    );
    expect(combineWarning(1.2, 1.2)).toMatch(/both at 1\.200 µm/);
  });
});

describe('overlay view (refuse rather than invent)', () => {
  it('draws only switched-on layers that are available and tagged', () => {
    const v = overlayView(
      {
        ...initialOverlaysState,
        status: 'ready',
        data,
        toggles: { ...initialOverlaysState.toggles, gaia: true },
      },
      'f1',
    )!;
    expect(v.show).toEqual({
      gaia: true,
      wise: false,
      flags: false,
      fov: false,
      contamination: true,
    });
    expect(v.missing).toEqual([]);
    // Nothing added: the reply's own array, so memos keyed on it hold across renders.
    expect(v.missing).toBe(data.missing);
  });

  it('refuses a layer without provenance and lists the code', () => {
    const { markers: _m, ...rest } = data.provenance;
    void _m;
    const v = overlayView(
      {
        ...initialOverlaysState,
        status: 'ready',
        data: { ...data, provenance: rest },
        toggles: { gaia: true, wise: false, flags: false, fov: false },
      },
      'f1',
    )!;
    expect(v.show.gaia).toBe(false);
    expect(v.missing).toEqual(['provenance:markers']);
  });

  it('refuses the flag mask of a frame listed in missing', () => {
    const v = overlayView(
      {
        ...initialOverlaysState,
        status: 'ready',
        data: { ...data, missing: ['flags_mask:f1'] },
        toggles: { gaia: false, wise: false, flags: true, fov: false },
      },
      'f1',
    )!;
    expect(v.show.flags).toBe(false);
  });
});

describe('overlay components', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(initialAppData);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const qa = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

  it('marker layer: positions in percent, shape per catalogue, no pointer events', () => {
    act(() => root.render(<MarkerLayer markers={ovFrame.markers} width={64} height={64} />));
    const layer = q('marker-layer')!;
    expect(layer.getAttribute('class')).toContain('pointer-events-none');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const [g, w] = qa('marker');
    expect(g!.getAttribute('x')).toBe(`${((9.5 + 0.5) / 64) * 100}%`);
    expect(g!.getAttribute('y')).toBe(`${((19.5 + 0.5) / 64) * 100}%`);
    expect(g!.dataset.shape).toBe('circle');
    expect(g!.querySelector('circle')).not.toBeNull();
    expect(w!.dataset.shape).toBe('diamond');
    expect(w!.querySelector('path')).not.toBeNull();
    expect(w!.getAttribute('y')).toBe(`${((63 + 0.5) / 64) * 100}%`);
  });

  it('toggles are aria-pressed buttons that switch layers in the store', () => {
    act(() => {
      useAppStore.setState({ sky: readySky() });
    });
    const render = () => {
      const s = useAppStore.getState().sky;
      root.render(<OverlayControls sky={s} view={overlayView(s.overlays, 'f1')} />);
    };
    act(render);
    const gaia = q('overlay-toggle-gaia')!;
    expect(gaia.getAttribute('aria-pressed')).toBe('false');
    expect(gaia.className).toContain('fb-ov'); // D-38 chip: 36 px high, above the 24 px WCAG 2.5.8 floor
    act(() => gaia.click());
    act(render);
    expect(useAppStore.getState().sky.overlays.toggles.gaia).toBe(true);
    expect(q('overlay-toggle-gaia')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('overlay-toggle-flags')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('a catalogue that is not available is disabled with a visible reason', () => {
    const noGaia = {
      ...data,
      catalogs: data.catalogs.map((c) =>
        c.catalog === 'gaia' ? { ...c, available: false, sources: [] } : c,
      ),
      missing: ['overlay:gaia'],
    };
    const s = readySky({}, noGaia);
    act(() => root.render(<OverlayControls sky={s} view={overlayView(s.overlays, 'f1')} />));
    const gaia = q('overlay-toggle-gaia') as HTMLButtonElement;
    expect(gaia.disabled).toBe(true);
    const reason = q('overlay-reason')!;
    expect(reason.textContent).toBe('Gaia stars are not available for this object.');
    expect(gaia.getAttribute('aria-describedby')).toBe(reason.id);
    expect((q('overlay-toggle-wise') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a catalogue still loading stays enabled, and Try again reloads it through the button', async () => {
    const fixtureApi = createApiClient({
      fetchImpl: fixtureFetch,
      createObjectUrl: () => 'blob:t',
    });
    setSkyApi(fixtureApi);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    await act(() =>
      useAppStore.getState().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' }),
    );
    const real = fixtureApi.getOverlays.bind(fixtureApi);
    let pending = true;
    const getOverlays = vi.spyOn(fixtureApi, 'getOverlays').mockImplementation(async (...args) => {
      const res = await real(...args);
      if (!pending) return res;
      return {
        ...res,
        data: {
          ...res.data,
          catalogs: res.data.catalogs.map((c) =>
            c.catalog === 'gaia' ? { ...c, available: false, sources: [] } : c,
          ),
          missing: [...res.data.missing, 'overlay:gaia:pending'],
        },
      };
    });
    const render = () => {
      const s = useAppStore.getState().sky;
      root.render(
        <OverlayControls sky={s} view={overlayView(s.overlays, s.frames!.frames[0]!.frame_id)} />,
      );
    };
    act(render);
    await act(async () => {
      q('overlay-toggle-gaia')!.click();
      await flush();
      await flush();
    });
    act(render);
    const gaia = q('overlay-toggle-gaia') as HTMLButtonElement;
    expect(gaia.disabled).toBe(false);
    expect(gaia.getAttribute('aria-pressed')).toBe('true');
    expect(q('overlay-reason')).toBeNull();
    expect(q('overlay-pending-line')!.textContent).toBe(
      'Gaia stars are still loading from the archive. Try again in a minute.',
    );
    expect(getOverlays).toHaveBeenCalledTimes(1);

    pending = false;
    await act(async () => {
      q('overlay-retry')!.click();
      await flush();
      await flush();
    });
    act(render);
    expect(getOverlays).toHaveBeenCalledTimes(2);
    expect(q('overlay-pending')).toBeNull();
    expect(useAppStore.getState().sky.overlays.toggles.gaia).toBe(true);
    getOverlays.mockRestore();
  });

  it('shows the overlay error without breaking anything else', () => {
    const s: SkyState = {
      ...initialSkyState,
      overlays: {
        ...initialOverlaysState,
        status: 'error',
        error: { kind: 'server', status: 503, code: null, detail: 'down' },
      },
    };
    act(() => root.render(<OverlayControls sky={s} view={null} />));
    expect(q('error')!.getAttribute('role')).toBe('alert');
    expect(q('error')!.textContent).toMatch(/Overlays could not be loaded/);
  });

  it('contamination line under the caption, with the Estimated badge and its formula', () => {
    const s = readySky();
    act(() =>
      root.render(<ContaminationNote view={overlayView(s.overlays, 'f1')!} fixture={false} />),
    );
    expect(qa('contamination-line').map((l) => l.textContent)).toEqual(
      contaminationLines(ovFrame.contamination, data),
    );
    expect(q('badge-estimated')!.getAttribute('title')).toBe('separation vs aperture');
  });

  it('no contamination line when the frame has none', () => {
    const s = readySky({}, { ...data, frames: [{ ...ovFrame, contamination: [] }] });
    act(() =>
      root.render(<ContaminationNote view={overlayView(s.overlays, 'f1')!} fixture={false} />),
    );
    expect(q('contamination')).toBeNull();
  });

  it('keeps the note’s space on a frame without one, so playback does not move the layout', () => {
    const quiet = { ...ovFrame, frame_id: 'f2', contamination: [] };
    const s = readySky({}, { ...data, frames: [ovFrame, quiet] });
    act(() =>
      root.render(<ContaminationNote view={overlayView(s.overlays, 'f2')!} fixture={false} />),
    );
    // The other frame's note is laid out but invisible (not read out); no line is current.
    const cell = q('contamination-cell')!;
    expect(cell.querySelectorAll('ul')).toHaveLength(1);
    expect(cell.querySelector('ul')!.className).toContain('invisible');
    expect(qa('contamination-line')).toHaveLength(0);
    expect(q('badge-estimated')!.parentElement!.parentElement!.className).toContain('invisible');

    act(() =>
      root.render(<ContaminationNote view={overlayView(s.overlays, 'f1')!} fixture={false} />),
    );
    expect(cell.querySelector('ul')!.className).not.toContain('invisible');
    expect(qa('contamination-line').map((l) => l.textContent)).toEqual(
      contaminationLines(ovFrame.contamination, data),
    );
  });

  it('details: catalogue table and epoch, badges, marker list, refusals', () => {
    const s = readySky(
      { toggles: { gaia: true, wise: true, flags: false, fov: false } },
      {
        ...data,
        missing: ['overlay:wise', 'footprint:f9', 'brand_new:thing'],
      },
    );
    act(() =>
      root.render(
        <OverlayDetails
          view={overlayView(s.overlays, 'f1')!}
          sky={s}
          frame={frame(1, 1)}
          index={0}
          center={{ ra: 10, dec: 0 }}
          flagFailed={false}
        />,
      ),
    );
    const lines = qa('catalog-line').map((l) => l.textContent);
    expect(lines[0]).toBe('Gaia: Table gaia_table, epoch J2016.0, G to 19.0');
    expect(lines[1]).toBe('WISE: Table wise_table, epoch not stated');
    expect(qa('badge').map((b) => b.textContent)).toEqual(['Measured', 'Measured']);
    expect(q('badge-estimated')!.getAttribute('title')).toBe('sky to pixel via WCS');
    expect(qa('marker-item').map((m) => m.textContent)).toEqual([
      'Gaia star g1, G 14.2',
      'WISE source w1, W1 magnitude unknown',
    ]);
    const missing = q('overlay-missing')!.textContent!;
    expect(missing).toContain('WISE source positions are not available for this object');
    expect(missing).toContain('1 frame with no detector footprint on record');
    // Unknown codes get generic words, never the raw code.
    expect(missing).toContain('not used for another reason');
    expect(missing).not.toContain('brand_new');
  });

  it('fixture data wears Fixture badges, never Measured', () => {
    const s = {
      ...readySky({ toggles: { gaia: true, wise: false, flags: true, fov: false } }),
      fixture: true,
    };
    act(() =>
      root.render(
        <OverlayDetails
          view={overlayView(s.overlays, 'f1')!}
          sky={s}
          frame={frame(1, 1)}
          index={0}
          center={{ ra: 10, dec: 0 }}
          flagFailed={false}
        />,
      ),
    );
    const badges = qa('badge').map((b) => b.textContent);
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set(['Fixture']));
    expect(q('flag-legend')!.textContent).toContain('Saturated');
    expect(q('flag-legend')!.textContent).toContain('SAT');
  });

  it('field of view draws the footprint, box and target, and states the orientation', () => {
    act(() =>
      root.render(
        <FieldOfView
          frame={ovFrame}
          center={{ ra: 10, dec: 0 }}
          footprintTag={{ tag: 'measured' }}
          boxTag={{ tag: 'derived', formula: 'pixel corners to sky' }}
          fixture={false}
          frameLabel="frame 1"
        />,
      ),
    );
    expect(q('fov-footprint')).not.toBeNull();
    expect(q('fov-box')).not.toBeNull();
    expect(q('fov-target')).not.toBeNull();
    expect(q('fov-caption')!.textContent).toMatch(/North up, east left/);
    expect(q('fov-map')!.getAttribute('aria-label')).toMatch(/north up and east left/);
  });

  it('field of view refuses a null footprint', () => {
    act(() =>
      root.render(
        <FieldOfView
          frame={{ ...ovFrame, footprint: null }}
          center={{ ra: 10, dec: 0 }}
          footprintTag={{ tag: 'measured' }}
          boxTag={{ tag: 'derived', formula: 'x' }}
          fixture={false}
          frameLabel="frame 1"
        />,
      ),
    );
    expect(q('fov-map')).toBeNull();
    expect(q('fov-refused')!.textContent).toBe(FOV_NO_FOOTPRINT);
  });

  it('combine panel always warns with both wavelengths', () => {
    const frames = [frame(0, 0.9), frame(1, 2.25)];
    act(() => useAppStore.setState({ sky: { ...readySky(), frames: null, index: 1 } }));
    const render = () =>
      root.render(<CombinePanel sky={useAppStore.getState().sky} frames={frames} />);
    act(render);
    expect(q('combine-warning')).toBeNull(); // closed
    act(() => {
      useAppStore.setState({
        sky: {
          ...useAppStore.getState().sky,
          combine: { ...useAppStore.getState().sky.combine, open: true, a: 'f1', b: 'f0' },
        },
      });
    });
    act(render);
    expect(q('combine-warning')!.textContent).toBe(
      'Frames are at different wavelengths (2.250 µm and 0.900 µm); the result mixes spectral shape with change over time.',
    );
    act(() => {
      useAppStore.setState({
        sky: {
          ...useAppStore.getState().sky,
          combine: {
            ...useAppStore.getState().sky.combine,
            status: 'ready',
            result: {
              objectUrl: 'blob:x',
              info: {
                op: 'sub',
                a: 'f1',
                b: 'f0',
                wavelength_a_um: 2.25,
                wavelength_b_um: 0.9,
                unit: 'MJy/sr',
                stretch: { kind: 'linear', params: {} },
                tag: 'derived',
                formula: 'A - B on A grid',
              },
            },
          },
        },
      });
    });
    act(render);
    expect(q('combine-warning')!.textContent).toMatch(/2\.250 µm and 0\.900 µm/);
    expect(q('combine-image')!.getAttribute('src')).toBe('blob:x');
    expect(q('badge-estimated')!.getAttribute('title')).toBe('A - B on A grid');
    expect(q('combine-caption')!.textContent).toBe(
      'Subtract (A − B), on frame A’s grid. Unit MJy/sr. Shown with a linear brightness scale.',
    );
    expect(q('combine-caption')!.textContent).not.toContain('{');
  });

  it('combine panel: Show is disabled for the same frame, with the reason', () => {
    const frames = [frame(0, 0.9), frame(1, 2.25)];
    const s: SkyState = {
      ...readySky(),
      combine: { ...initialSkyState.combine, open: true, a: 'f0', b: 'f0' },
    };
    act(() => root.render(<CombinePanel sky={s} frames={frames} />));
    expect((q('combine-show') as HTMLButtonElement).disabled).toBe(true);
    expect(q('combine-same')!.textContent).toBe('Pick two different frames.');
    expect(q('combine-warning')).toBeNull();
  });
});
