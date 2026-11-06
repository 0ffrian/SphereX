// The overlay and combine parts of the sky slice (issue #12).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import { fixtureFetch } from '@/test/fixtureFetch';
import { initialAppData, OVERLAYS_OFF, setSkyApi, useAppStore } from './store';

let urlCount = 0;
const fixtureApi = createApiClient({
  fetchImpl: fixtureFetch,
  createObjectUrl: () => `blob:test/${++urlCount}`,
});
const sky = () => useAppStore.getState().sky;
const store = () => useAppStore.getState();

/** Lets queued promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('overlays in the sky slice', () => {
  let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(async () => {
    useAppStore.setState(initialAppData);
    revoke = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revoke;
    setSkyApi(fixtureApi);
    await store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
  });
  afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
    setSkyApi(fixtureApi);
  });

  it('starts with every layer off and nothing loaded', () => {
    expect(sky().overlays.toggles).toEqual(OVERLAYS_OFF);
    expect(sky().overlays.status).toBe('idle');
  });

  it('loads lazily on the first switch-on, and only once', async () => {
    const getOverlays = vi.spyOn(fixtureApi, 'getOverlays');
    store().skyToggleOverlay('gaia');
    expect(sky().overlays.toggles.gaia).toBe(true);
    expect(sky().overlays.status).toBe('loading');
    await flush();
    await flush();
    expect(sky().overlays.status).toBe('ready');
    expect(sky().overlays.data?.id).toBe('rw-aur');
    store().skyToggleOverlay('wise');
    store().skyToggleOverlay('gaia');
    expect(sky().overlays.toggles).toEqual({ gaia: false, wise: true, flags: false, fov: false });
    expect(getOverlays).toHaveBeenCalledTimes(1);
    getOverlays.mockRestore();
  });

  it('asks again for a catalogue the backend was still fetching (overlay:<layer>:pending)', async () => {
    const real = fixtureApi.getOverlays.bind(fixtureApi);
    let pending = true;
    const getOverlays = vi.spyOn(fixtureApi, 'getOverlays').mockImplementation(async (...args) => {
      const res = await real(...args);
      return pending
        ? { ...res, data: { ...res.data, missing: [...res.data.missing, 'overlay:gaia:pending'] } }
        : res;
    });
    store().skyToggleOverlay('gaia');
    await flush();
    await flush();
    expect(sky().overlays.data?.missing).toContain('overlay:gaia:pending');
    // A layer that is not pending does not reload.
    store().skyToggleOverlay('wise');
    expect(getOverlays).toHaveBeenCalledTimes(1);
    pending = false;
    store().skyToggleOverlay('gaia'); // off
    store().skyToggleOverlay('gaia'); // on again: reloads
    await flush();
    await flush();
    expect(getOverlays).toHaveBeenCalledTimes(2);
    expect(sky().overlays.data?.missing).not.toContain('overlay:gaia:pending');
    getOverlays.mockRestore();
  });

  it('keeps the previous reply drawn while a reload runs', async () => {
    store().skyToggleOverlay('fov');
    await flush();
    await flush();
    const before = sky().overlays.data;
    expect(before).not.toBeNull();
    const reload = store().skyLoadOverlays();
    expect(sky().overlays.status).toBe('loading');
    expect(sky().overlays.data).toBe(before);
    await reload;
    expect(sky().overlays.status).toBe('ready');
  });

  it('does not load on switch-off or on a search', async () => {
    const getOverlays = vi.spyOn(fixtureApi, 'getOverlays');
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    expect(getOverlays).not.toHaveBeenCalled();
    getOverlays.mockRestore();
  });

  it('resets on a new search', async () => {
    store().skyToggleOverlay('fov');
    await flush();
    await flush();
    expect(sky().overlays.status).toBe('ready');
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    expect(sky().overlays.status).toBe('idle');
    expect(sky().overlays.data).toBeNull();
    expect(sky().overlays.toggles).toEqual(OVERLAYS_OFF);
  });

  it('keeps the flipbook when overlays fail, and retries on the next switch-on', async () => {
    const failing: ApiClient = {
      ...fixtureApi,
      getOverlays: () => Promise.reject(new ApiError('server', 'down', 503)),
    };
    setSkyApi(failing);
    store().skyToggleOverlay('gaia');
    await flush();
    expect(sky().overlays.status).toBe('error');
    expect(sky().overlays.error?.status).toBe(503);
    expect(sky().status).toBe('ready');
    expect(sky().frames?.frames).toHaveLength(24);
    setSkyApi(fixtureApi);
    store().skyToggleOverlay('gaia'); // off
    store().skyToggleOverlay('gaia'); // on again: retries
    await flush();
    await flush();
    expect(sky().overlays.status).toBe('ready');
  });

  it('drops an overlays reply that arrives after a new search', async () => {
    let release: () => void = () => {};
    const slow: ApiClient = {
      ...fixtureApi,
      getOverlays: (id, signal) =>
        new Promise((resolve) => {
          release = () => void fixtureApi.getOverlays(id, signal).then(resolve);
        }),
    };
    setSkyApi(slow);
    store().skyToggleOverlay('gaia');
    setSkyApi(fixtureApi);
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    release();
    await flush();
    await flush();
    expect(sky().overlays.status).toBe('idle');
    expect(sky().overlays.data).toBeNull();
  });
});

describe('combine in the sky slice', () => {
  let revoke: ReturnType<typeof vi.fn<(url: string) => void>>;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(async () => {
    useAppStore.setState(initialAppData);
    revoke = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revoke;
    setSkyApi(fixtureApi);
    await store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
  });
  afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
  });

  it('opens with the current frame as A and the previous one as B', () => {
    store().skySeek(5);
    store().skyCombineOpen(true);
    expect(sky().combine).toMatchObject({ open: true, a: 'rw-aur-f005', b: 'rw-aur-f004' });
  });

  it('uses the next frame as B on the first frame', () => {
    store().skyCombineOpen(true);
    expect(sky().combine).toMatchObject({ a: 'rw-aur-f000', b: 'rw-aur-f001' });
  });

  it('shows a result and revokes it when replaced, cleared or on a new search', async () => {
    store().skySeek(3);
    store().skyCombineOpen(true);
    await store().skyCombineShow();
    const first = sky().combine.result!;
    expect(sky().combine.status).toBe('ready');
    expect(first.info).toMatchObject({ op: 'sub', a: 'rw-aur-f003', b: 'rw-aur-f002' });
    expect(sky().fixture).toBe(true);

    store().skyCombineSet({ op: 'add' });
    expect(sky().combine.result).toBeNull();
    expect(revoke).toHaveBeenCalledWith(first.objectUrl);

    await store().skyCombineShow();
    const second = sky().combine.result!;
    store().skyCombineClear();
    expect(revoke).toHaveBeenCalledWith(second.objectUrl);

    await store().skyCombineShow();
    const third = sky().combine.result!;
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    expect(revoke).toHaveBeenCalledWith(third.objectUrl);
    expect(sky().combine.open).toBe(false);
  });

  it('does nothing for the same frame twice', async () => {
    store().skyCombineOpen(true);
    store().skyCombineSet({ b: sky().combine.a! });
    await store().skyCombineShow();
    expect(sky().combine.status).toBe('idle');
  });

  it('shows a server refusal as an error', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    store().skySeek(5); // r-dra-f005 has no cutout in the fixtures
    store().skyCombineOpen(true);
    await store().skyCombineShow();
    expect(sky().combine.status).toBe('error');
    expect(sky().combine.error?.status).toBe(503);
  });
});
