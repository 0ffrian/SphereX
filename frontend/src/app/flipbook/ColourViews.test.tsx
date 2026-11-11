// The colour views in the DOM: the composite (legend, badge,
// marker, refusal in words) and the transport bar locked while the composite shows.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '@/app/api/client';
import { Transport } from '@/app/shell/Transport';
import { initialAppData, setSkyApi, useAppStore } from '@/state/store';
import { fixtureFetch } from '@/test/fixtureFetch';
import { COMPOSITE_TRANSPORT_NOTE } from './colourMode';
import { CompositeView, TintLegend } from './ColourViews';
import { Flipbook } from './Flipbook';
import { FlipbookSessionProvider } from './session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const fixtureApi = createApiClient({ fetchImpl: fixtureFetch });
let host: HTMLDivElement;
let root: Root;

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

/** Lets the store's async work (fixture fetches, then React) finish. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  setSkyApi(fixtureApi);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('TintLegend', () => {
  it('marks the current wavelength and states the formula and stretch', () => {
    act(() => root.render(<TintLegend wavelengthUm={2.875} stretch="Display stretch asinh" />));
    expect(q('tint-legend-marker')!.style.left).toBe('50%');
    expect(q('tint-legend-current')!.textContent).toBe('This frame: 2.875 µm');
    expect(q('badge-estimated')!.textContent).toContain('false colour: hue = wavelength');
    expect(q('badge-estimated')!.textContent).toContain('asinh');
  });
});

describe('CompositeView', () => {
  async function show(name: string) {
    await useAppStore.getState().skySearch({ q: name, kind: 'name', origin: 'input' });
    await act(async () =>
      root.render(
        <CompositeView
          name={name}
          fixture={useAppStore.getState().sky.fixture}
          onShowSpectrum={() => {}}
        />,
      ),
    );
    await settle();
  }

  it('shows the picture pixel-sharp with the badge, formula, 3-band legend and marker', async () => {
    await show('eps Ind B');
    const img = q('composite-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/composite\.png\?v=/);
    expect(img.style.imageRendering).toBe('pixelated');
    expect(q('badge-estimated')!.getAttribute('title')).toMatch(/^SYNTHETIC fixture/);
    expect(q('badge-estimated-formula')!.textContent).toMatch(/SYNTHETIC fixture/);
    const bands = qa('composite-band');
    expect(bands.map((b) => b.dataset.channel)).toEqual(['blue', 'green', 'red']);
    expect(bands[0]!.textContent).toMatch(/Blue:\d\.\d{3} µm/);
    expect(bands[0]!.textContent).toMatch(/2025-05-03 \d\d:\d\d:\d\d UTC/);
    // Fixture data never wears Measured (Q-32).
    expect(bands[0]!.querySelector('[data-testid="badge"]')!.textContent).toBe('Fixture');
    expect(q('composite-orientation')!.textContent).toMatch(/^North up, east left/);
    // Object pixel (32, 31) of 64 × 64: its centre is at (32.5 / 64, 31.5 / 64).
    const marker = q('composite-marker')!;
    expect(marker.style.left).toBe(`${(32.5 / 64) * 100}%`);
    expect(marker.style.top).toBe(`${(31.5 / 64) * 100}%`);
    expect(host.textContent).toContain('SYNTHETIC');
  });

  it('says in plain words why a composite is refused, never a blank box', async () => {
    await show('R Dra');
    expect(q('composite-image')).toBeNull();
    const box = q('composite-refused')!;
    expect(box.textContent).toContain('There is no SPHEREx colour composite for this object.');
    expect(box.textContent).toContain(
      'There are not enough usable frames near the three colour wavelengths to make a composite.',
    );
    expect(box.textContent).toContain('Red band: every frame near its wavelength');
    expect(box.textContent).not.toContain('Not available:');
  });

  it('waits for a progressive frame list before building, then builds it', async () => {
    let calls = 0;
    setSkyApi({
      ...fixtureApi,
      composite: (id, signal) => {
        calls++;
        return fixtureApi.composite(id, signal);
      },
    });
    await show('Synthetic progressive');
    expect(useAppStore.getState().sky.progress?.phase).toBe('fetching');
    expect(q('composite-waiting')!.textContent).toBe(
      'The SPHEREx colour composite is built once all frames have been downloaded (4 of 31 ready).',
    );
    expect(q('composite-image')).toBeNull();
    expect(q('loading')).toBeNull();
    expect(calls).toBe(0);
    // The remaining parts arrive (0.5 s apart on the real clock), then the composite is built.
    for (let i = 0; i < 40 && useAppStore.getState().sky.progress !== null; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }
    await settle();
    expect(q('composite-waiting')).toBeNull();
    expect(q('composite-image')).not.toBeNull();
    expect(calls).toBe(1);
  });

  it('shows the moving-object refusal', async () => {
    await show('Synthetic mover');
    expect(q('composite-refused')!.textContent).toContain(
      'Colour composites are not built for moving Solar System objects',
    );
  });
});

describe('Transport with the composite', () => {
  it('disables playback with the note while the composite shows, and restores it', async () => {
    await useAppStore.getState().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    act(() =>
      root.render(
        <FlipbookSessionProvider>
          <Transport />
        </FlipbookSessionProvider>,
      ),
    );
    expect(q('scrubber')).not.toBeNull();
    expect(q('transport-locked')).toBeNull();
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next frame"]')!;
    expect(next.disabled).toBe(false);

    act(() => useAppStore.getState().skySetColour({ on: true, view: 'composite' }));
    const play = q('play-pause') as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    expect(q('scrubber')).toBeNull();
    const note = q('transport-locked')!;
    expect(note.textContent).toBe(COMPOSITE_TRANSPORT_NOTE);
    expect(play.getAttribute('aria-describedby')).toBe(note.id);

    // Measured only hides the composite: the frames play again.
    act(() => useAppStore.getState().setHonesty('measured'));
    expect(q('transport-locked')).toBeNull();
    expect(next.disabled).toBe(false);

    act(() => useAppStore.getState().setHonesty('derived'));
    expect(q('transport-locked')).not.toBeNull();
    act(() => useAppStore.getState().skySetColour({ on: true, view: 'tint' }));
    expect(q('transport-locked')).toBeNull();
    expect(q('scrubber')).not.toBeNull();
  });
});

describe('Flipbook colour views and Measured only (D-21)', () => {
  it('tints at + Estimated, falls back to grey with a note in Measured only', async () => {
    await useAppStore.getState().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    useAppStore.getState().skySetColour({ on: true, view: 'tint' });
    act(() =>
      root.render(
        <FlipbookSessionProvider>
          <Flipbook onClose={() => undefined} />
        </FlipbookSessionProvider>,
      ),
    );
    expect(q('frame-viewer')!.dataset.colour).toBe('tint');
    expect(q('tint-legend')).not.toBeNull();
    expect(q('colour-hidden-note')).toBeNull();
    expect(q('cutout')!.getAttribute('alt')).toMatch(/Tinted by wavelength \(false colour\)\.$/);

    act(() => useAppStore.getState().setHonesty('measured'));
    expect(q('frame-viewer')!.dataset.colour).toBe('raw');
    expect(q('tint-legend')).toBeNull();
    expect(q('tint-overlay')).toBeNull();
    expect(q('colour-hidden-note')!.textContent).toMatch(/hidden in Measured only/);
    expect(q('cutout')!.getAttribute('alt')).not.toMatch(/Tinted/);

    // The composite asked for in Measured only: the grey frames, no request for the composite.
    act(() => useAppStore.getState().skySetColour({ on: true, view: 'composite' }));
    expect(q('composite')).toBeNull();
    expect(q('frame-viewer')).not.toBeNull();
    expect(useAppStore.getState().sky.composite.status).toBe('idle');

    act(() => useAppStore.getState().setHonesty('derived'));
    expect(q('composite')).not.toBeNull();
    expect(q('frame-viewer')).toBeNull();
    // The About tab keeps describing the frames, so its orientation line stays while the composite shows.
    await settle();
  });
});
