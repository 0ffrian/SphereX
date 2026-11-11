// Issue #93 C5: the world engine stage with a compile that never finishes (the stub driver never reports
// COMPLETION_STATUS_KHR, so `whenReady` never resolves). Unmounting mid-compile must not call loseContext() (it blocks
// on the compile) nor update React after the unmount; the ready watchdog must hand over to the three.js path (onFail).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectCard } from '@/contract';
import { cardToWorld, type CardToWorldOk } from '@/engine/worlds/cardToWorld';
import { stubGL, type Call } from '@/engine/worlds/glStub.testutil';
import { clearTerrainCache } from '@/engine/worlds/terrainCache.js';
import { ENGINE_READY_TIMEOUT_MS } from './engineWatchdog';
import { WorldGlobeStage } from './WorldEngineStage';
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
let calls: Call[];
let world: CardToWorldOk;
let errors: ReturnType<typeof vi.spyOn>;

const loseCalls = () => calls.filter((c) => c[0] === 'loseContext').length;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const stub = stubGL({ lateBy: 1e9 }); // the compile never finishes
  calls = stub.calls;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => stub.gl as unknown as RenderingContext,
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
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
});

describe('WorldGlobeStage lifecycle (issue #93 C5)', () => {
  it('unmount mid-compile: no loseContext, no late React update', async () => {
    const onFail = vi.fn();
    await act(async () => {
      root.render(<WorldGlobeStage world={world} onFail={onFail} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // the engine is created a tick after mount
    });
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(calls.some((c) => c[0] === 'createProgram')).toBe(true); // a real WorldEngine on the stub driver
    expect(container.querySelector('[data-testid="world-forming"]')).not.toBeNull();
    await act(async () => root.unmount());
    expect(loseCalls()).toBe(0);
    // Past every watchdog: nothing fires after the unmount, and the context is never lost while the compile runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENGINE_READY_TIMEOUT_MS.globe + 200_000);
    });
    expect(loseCalls()).toBe(0);
    expect(onFail).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('the ready watchdog hands over to the three.js path (onFail) when the compile never finishes', async () => {
    const onFail = vi.fn();
    await act(async () => {
      root.render(<WorldGlobeStage world={world} onFail={onFail} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENGINE_READY_TIMEOUT_MS.globe - 1_000);
    });
    expect(onFail).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).toBeNull(); // the failed engine's canvas is gone
    await act(async () => root.unmount());
    expect(loseCalls()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});
