// #116 C6: the Sound chip renders inside WorldFlyStage (the fly view's own controls), whatever SHOW_FLY_BAR is, once
// the fly view is entered at "+ Artistic"; it is gone below "+ Artistic" and when the close-up is closed.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectCard } from '@/contract';
import { cardToWorld, type CardToWorldOk } from '@/engine/worlds/cardToWorld';
import { stubGL } from '@/engine/worlds/glStub.testutil';
import { clearTerrainCache } from '@/engine/worlds/terrainCache.js';
import { WorldEngine } from '@/engine/worlds/WorldEngine';
import { useAppStore } from '@/state/store';
import { releaseAmbience } from '@/sound/ambience/ambienceHolder';
import { useAmbienceStore } from '@/sound/ambience/ambienceStore';
import { IDLE_UI } from '@/sound/ambience/ambienceLoop';
import { resetWeatherBus } from '@/sound/ambience/weatherBus';
import { WorldFlyStage } from './WorldEngineStage';
import { useWorldStore } from './worldStore';

const CARD = {
  id: 'x-planet',
  name: 'X b',
  type: 'planet_rocky',
  radius_rjup: { value: 0.1, tag: 'measured' },
  mass_mearth: { value: 1, tag: 'measured' },
  orbit_au: { value: 0.05, tag: 'measured' },
  orbital_period_d: { value: 5, tag: 'measured' },
  host_teff_K: { value: 3000, tag: 'measured' },
  host_radius_rsun: { value: 0.2, tag: 'measured' },
  host_mass_msun: { value: 0.2, tag: 'measured' },
  rot_period_h: { value: 120, tag: 'measured' },
} as unknown as ObjectCard;

let container: HTMLDivElement;
let root: Root;
let world: CardToWorldOk;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const stub = stubGL();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stub.gl as unknown as RenderingContext);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(WorldEngine.prototype, 'tick').mockImplementation(() => {});
  vi.spyOn(WorldEngine.prototype, 'spinup', 'get').mockReturnValue(0);
  vi.spyOn(WorldEngine.prototype, 'view').mockReturnValue({ gx: 0, gw: 100, w: 100, h: 100, tilt: 0, spin: 0, frame: 1 });
  const w = cardToWorld(CARD);
  if (!w.ok) throw new Error('the test card must give a world');
  world = w;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearTerrainCache();
  useWorldStore.setState({ globe: null, fly: null });
  useAmbienceStore.setState({ ui: IDLE_UI });
  releaseAmbience();
  resetWeatherBus();
});

const chip = () => container.querySelector('[data-testid="world-fly-sound"]');

describe('WorldFlyStage sound chip (#116, C6)', () => {
  it('appears in the fly view at + Artistic, with its label, badge and controls', async () => {
    useAppStore.setState({ honesty: 'artistic' });
    await act(async () => root.render(<WorldFlyStage world={world} reduced={false} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const c = chip();
    expect(c).not.toBeNull();
    expect(c!.textContent).toContain('Imagined sound');
    expect(c!.querySelector('[aria-expanded]')?.textContent).toBe('What you hear');
    await act(async () => root.unmount());
  });

  it('is not shown below + Artistic, nor while the close-up is closed', async () => {
    useAppStore.setState({ honesty: 'derived' });
    await act(async () => root.render(<WorldFlyStage world={world} reduced={false} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(chip()).toBeNull();
    useAppStore.setState({ honesty: 'artistic' });
    await act(async () => root.render(<WorldFlyStage world={world} reduced={false} paused />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(chip()).toBeNull();
    await act(async () => root.unmount());
  });
});
