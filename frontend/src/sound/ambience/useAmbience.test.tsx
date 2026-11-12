// #116: the hook's kill switch and rAF gating, and the holder's 2-minute keep-alive across mounts (§13, blue 30, 32).
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { heldAmbience, releaseAmbience, reportIdle, setPaletteFactory, sharedPalette } from './ambienceHolder';
import { makeFakeEngine, makeWorld } from './fakeEngine.testutil';
import type { WorldEngineWithSpinup } from './place';
import { KEEP_ALIVE_MS } from './tuning';
import { useAmbience } from './useAmbience';

let container: HTMLDivElement;
let root: Root;
const engine = { ...makeFakeEngine(), spinup: 0 } as WorldEngineWithSpinup;
const world = makeWorld();

function Host({ paused = false }: { paused?: boolean }) {
  useAmbience({ engine, world, entered: true, paused, failed: false });
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  useAppStore.setState({ honesty: 'artistic' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem('sx.ambience.kill');
  setPaletteFactory(null);
  releaseAmbience();
});

describe('useAmbience', () => {
  it('runs a 10 Hz rAF loop only while the fly view is live', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await act(async () => root.render(<Host paused />));
    expect(raf).not.toHaveBeenCalled();
    await act(async () => root.render(<Host />));
    expect(raf).toHaveBeenCalled();
  });

  it('the kill switch mounts nothing (no rAF)', async () => {
    localStorage.setItem('sx.ambience.kill', '1');
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await act(async () => root.render(<Host />));
    expect(raf).not.toHaveBeenCalled();
  });

  it('StrictMode mount, unmount, mount is safe', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await act(async () =>
      root.render(
        <StrictMode>
          <Host />
        </StrictMode>,
      ),
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('ambience holder keep-alive (§13)', () => {
  it('releases the palette 2 minutes after every loop went idle; activity cancels it', () => {
    const dispose = vi.fn();
    setPaletteFactory(() => ({ palette: { request() {}, get: () => null, unavailable: () => [] }, dispose }));
    expect(sharedPalette()).not.toBeNull();
    const a = {},
      b = {};
    reportIdle(a, false);
    reportIdle(b, false);
    reportIdle(a, true);
    expect(heldAmbience().releasePending).toBe(false);
    reportIdle(b, true);
    expect(heldAmbience().releasePending).toBe(true);
    vi.advanceTimersByTime(KEEP_ALIVE_MS - 10);
    reportIdle(b, false); // back within 2 minutes: the beds are reused
    vi.advanceTimersByTime(KEEP_ALIVE_MS);
    expect(dispose).not.toHaveBeenCalled();
    reportIdle(b, true);
    vi.advanceTimersByTime(KEEP_ALIVE_MS + 1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(heldAmbience().palette).toBe(false);
  });
});
