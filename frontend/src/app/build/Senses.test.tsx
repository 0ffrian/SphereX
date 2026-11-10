// Issue #71 stream U: the build pane's Feel and Hear it panels never fake a result.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialAppData, useAppStore, initialSkyState } from '@/state/store';
import {
  FeelPanel,
  FEEL_UNAVAILABLE,
  HEAR_NOTE_LOADING,
  HEAR_NOTE_NONE,
  HearPanel,
} from './Senses';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('Feel it', () => {
  it('has the mock-up heading and sentence, and says it is not available yet', async () => {
    await act(async () => root.render(<FeelPanel />));
    expect(host.textContent).toContain('Feel it');
    expect(host.textContent).toContain('Bumps buzz and smooth ground stays quiet.');
    expect(q('feel-unavailable')!.textContent).toBe(FEEL_UNAVAILABLE);
    // No fake vibration reading: the meter shows a dash, not "0 Hz".
    expect(host.textContent).not.toMatch(/\d+ Hz/);
  });
});

describe('Hear it', () => {
  it('without an object there is nothing to play', async () => {
    await act(async () => root.render(<HearPanel active name={undefined} />));
    expect(q('hear-note')!.textContent).toBe(HEAR_NOTE_NONE);
    expect((q('hear-play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for the spectrum when opened and says it is loading', async () => {
    const load = vi.fn(async () => {});
    useAppStore.setState({
      skyLoadSpectrum: load,
      sky: {
        ...initialSkyState,
        resolved: { id: 'x', name: 'X', moving: false } as never,
        spectrum: { status: 'idle', data: null, error: null },
      },
    });
    await act(async () => root.render(<HearPanel active name="X" />));
    expect(load).toHaveBeenCalledOnce();
    expect(q('hear-note')!.textContent).toBe(HEAR_NOTE_LOADING);
  });

  it('plays the measured spectrum: the button is on and the note names the object', async () => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      wavelength_um: 0.8 + i * 0.35,
      flux: 1 + Math.sin(i),
      error: 0.01,
      flagged: false,
    }));
    useAppStore.setState({
      sky: {
        ...initialSkyState,
        resolved: { id: 'x', name: 'X', moving: false } as never,
        spectrum: {
          status: 'ready',
          error: null,
          data: {
            id: 'x',
            spectrum: points as never,
            light_curve: [],
            flux_unit: 'MJy/sr',
            tag: 'measured',
            cached_at: null,
            missing: [],
          },
        },
      },
    });
    await act(async () => root.render(<HearPanel active name="X" />));
    expect((q('hear-play') as HTMLButtonElement).disabled).toBe(false);
    expect(q('hear-note')!.textContent).toMatch(/measured SPHEREx spectrum of X, not an example/);
    expect(q('hear-canvas')!.getAttribute('aria-label')).toMatch(/spectrum of X/);
  });
});
