// Q-430: the Hear it panel (the one the build view shows) says how the spectrum sounds: short
// wavelengths high, long wavelengths low, brighter louder (the same direction as hearModel.freqAt).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialAppData, initialSkyState, useAppStore } from '@/state/store';
import { freqAt } from './hearModel';
import { HEAR_SPEC_MAPPING, HearPanel } from './HearPanel';

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

describe('Hear it: the spectrum mapping copy (Q-430)', () => {
  it('shows "short high, long low, brighter louder" next to the spectrum player', async () => {
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
    const copy = host.querySelector('[data-testid="hear-spec-mapping"]');
    expect(copy?.textContent).toBe(HEAR_SPEC_MAPPING);
    expect(HEAR_SPEC_MAPPING).toBe(
      'Short wavelengths sound high, long wavelengths low. Brighter is louder.',
    );
    // The copy matches the sound: the sweep starts high at the short end and ends low.
    expect(freqAt(0)).toBeGreaterThan(freqAt(1));
  });
});
