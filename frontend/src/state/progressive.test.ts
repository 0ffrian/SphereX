// The store's progressive frame loading (flipbook/progressive.ts) on the SYNTHETIC progressive
// fixture: 4, 10, 18, then all 30 frames, plus one `outside_cutout` refusal (31 found).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import { fixtureFetch } from '@/test/fixtureFetch';
import { framesFetching, initialAppData, setSkyApi, useAppStore } from './store';

const fixtureApi = createApiClient({ fetchImpl: fixtureFetch });
const sky = () => useAppStore.getState().sky;
const store = () => useAppStore.getState();
const PROGRESSIVE = { q: 'Synthetic progressive', kind: 'name', origin: 'input' } as const;
const fid = (i: number) => `synthetic-progressive-f${String(i).padStart(3, '0')}`;

/** Advance the fake clock in small steps until `pred` holds. */
async function until(pred: () => boolean, maxMs = 60_000): Promise<void> {
  for (let t = 0; t <= maxMs; t += 100) {
    if (pred()) return;
    await vi.advanceTimersByTimeAsync(100);
  }
  throw new Error('condition not met');
}

/** The fixture API with call counters and an in-flight high-water mark for /frames. */
function counting(base: ApiClient = fixtureApi) {
  const c = { frames: 0, spectrum: 0, composite: 0, inFlight: 0, maxInFlight: 0 };
  const api: ApiClient = {
    ...base,
    frames: async (id, signal) => {
      c.frames += 1;
      c.inFlight += 1;
      c.maxInFlight = Math.max(c.maxInFlight, c.inFlight);
      try {
        return await base.frames(id, signal);
      } finally {
        c.inFlight -= 1;
      }
    },
    spectrum: (id, signal) => {
      c.spectrum += 1;
      return base.spectrum(id, signal);
    },
    composite: (id, signal) => {
      c.composite += 1;
      return base.composite(id, signal);
    },
  };
  return { api, c };
}

describe('progressive frames', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(initialAppData);
    setSkyApi(fixtureApi);
  });
  afterEach(() => {
    store().skyReset();
    vi.useRealTimers();
    setSkyApi(fixtureApi);
  });

  it('shows the first part at once, then merges the rest without moving the user', async () => {
    const { api, c } = counting();
    setSkyApi(api);
    await store().skySearch(PROGRESSIVE);
    expect(sky().status).toBe('ready');
    expect(sky().frames?.frames).toHaveLength(4);
    expect(sky().progress).toMatchObject({ phase: 'fetching', replies: 1 });
    expect(framesFetching(sky())).toBe(true);
    expect(sky().announcement).toBe(
      'Found 31 frames for Synthetic progressive (fixture); 4 ready, fetching the rest from the archive.',
    );

    // The user moves to the third frame and plays; the next part must not reset either.
    store().skySeek(2);
    store().skyPlay();
    await until(() => (sky().frames?.frames.length ?? 0) === 10);
    expect(sky().frames?.frames[sky().index]?.frame_id).toBe(fid(2));
    expect(sky().playing).toBe(true);
    expect(sky().progress?.replies).toBe(2);

    await until(() => sky().progress === null);
    expect(sky().frames?.frames.map((f) => f.frame_id)).toEqual(
      Array.from({ length: 30 }, (_, i) => fid(i)),
    );
    expect(sky().frames?.missing).toEqual([`outside_cutout:${fid(30)}`]);
    expect(sky().frames?.frames[sky().index]?.frame_id).toBe(fid(2));
    expect(sky().announcement).toBe(
      'Finished fetching frames: 30 frames ready for Synthetic progressive (fixture) (1 not usable).',
    );
    expect(c.frames).toBe(4);
    expect(c.maxInFlight).toBe(1);
  });

  it('asks for the spectrum and composite only once the frame list is complete', async () => {
    const { api, c } = counting();
    setSkyApi(api);
    await store().skySearch(PROGRESSIVE);
    await store().skyLoadSpectrum();
    await store().skyLoadComposite();
    expect(sky().spectrum.status).toBe('waiting');
    expect(sky().composite.status).toBe('idle');
    expect(c.spectrum + c.composite).toBe(0);

    await until(() => sky().progress === null);
    // The waiting spectrum is measured on its own, from the complete list.
    await until(() => sky().spectrum.status === 'ready');
    expect(c.spectrum).toBe(1);
    expect(sky().spectrum.data?.spectrum.length).toBeGreaterThan(0);
    await store().skyLoadComposite();
    expect(c.composite).toBe(1);
    expect(sky().composite.status).toBe('ready');
  });

  it('Stop keeps the frames playable; Continue fetches the rest', async () => {
    const { api, c } = counting();
    setSkyApi(api);
    await store().skySearch(PROGRESSIVE);
    store().skyStopFrames();
    expect(sky().progress?.phase).toBe('stopped');
    expect(sky().announcement).toBe('Stopped fetching frames. 4 of 31 ready.');
    const calls = c.frames;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.frames).toBe(calls);
    expect(sky().frames?.frames).toHaveLength(4);
    store().skyPlay();
    expect(sky().playing).toBe(true);
    // Stopped: the spectrum can be measured from the frames found so far.
    expect(framesFetching(sky())).toBe(false);

    store().skyContinueFrames();
    expect(sky().progress?.phase).toBe('fetching');
    await until(() => sky().progress === null);
    expect(sky().frames?.frames).toHaveLength(30);
  });

  it('Continue drops a spectrum and composite still being made from the partial list', async () => {
    // Both answer only when released, so they are still in flight when Continue is pressed.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { api, c } = counting();
    setSkyApi({
      ...api,
      spectrum: async (id, signal) => {
        if (c.spectrum === 0) {
          c.spectrum += 1;
          await gate;
          return fixtureApi.spectrum(id, signal);
        }
        return api.spectrum(id, signal);
      },
      composite: async (id, signal) => {
        if (c.composite === 0) {
          c.composite += 1;
          await gate;
          return fixtureApi.composite(id, signal);
        }
        return api.composite(id, signal);
      },
    });
    await store().skySearch(PROGRESSIVE);
    store().skyStopFrames();
    const spectrum = store().skyLoadSpectrum();
    const composite = store().skyLoadComposite();
    expect(sky().spectrum.status).toBe('loading');
    expect(sky().composite.status).toBe('loading');

    store().skyContinueFrames();
    expect(sky().spectrum.status).toBe('waiting');
    expect(sky().composite.status).toBe('idle');
    // The partial replies land late and are ignored.
    release();
    await spectrum;
    await composite;
    expect(sky().spectrum.status).toBe('waiting');
    expect(sky().composite.status).toBe('idle');

    await until(() => sky().progress === null);
    await until(() => sky().spectrum.status === 'ready');
    expect(c.spectrum).toBe(2);
    expect(sky().spectrum.data?.missing.some((m) => m.startsWith('cutouts:deferred:'))).toBe(false);
  });

  it('a new search cancels the progressive load and ignores its late replies', async () => {
    const { api, c } = counting();
    setSkyApi(api);
    await store().skySearch(PROGRESSIVE);
    await store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
    const calls = c.frames;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.frames).toBe(calls);
    expect(sky().resolved?.id).toBe('rw-aur');
    expect(sky().frames?.frames).toHaveLength(24);
    expect(sky().progress).toBeNull();
  });

  it('backs off after errors, gives up keeping the frames, and Try again resumes', async () => {
    let failing = false;
    const flaky: ApiClient = {
      ...fixtureApi,
      frames: async (id, signal) => {
        if (failing) throw new ApiError('server', 'IRSA is down', 503);
        return fixtureApi.frames(id, signal);
      },
    };
    setSkyApi(flaky);
    await store().skySearch(PROGRESSIVE);
    failing = true;
    await until(() => sky().progress?.retry !== null && sky().progress?.retry !== undefined);
    expect(sky().progress?.retry).toMatchObject({ timeout: false, failures: 1, delayMs: 2000 });
    expect(sky().announcement).toBe('The server did not answer; trying again in 2 seconds.');
    await until(() => sky().progress?.phase === 'failed', 120_000);
    expect(sky().status).toBe('ready');
    expect(sky().frames?.frames).toHaveLength(4);
    expect(sky().progress?.error).toMatchObject({ kind: 'server', detail: 'IRSA is down' });

    failing = false;
    await store().skyRetry();
    expect(sky().progress?.phase).toBe('fetching');
    await until(() => sky().progress === null);
    expect(sky().frames?.frames).toHaveLength(30);
  });

  it('a first request that times out is asked again, not shown as an error', async () => {
    let first = true;
    setSkyApi({
      ...fixtureApi,
      frames: async (id, signal) => {
        if (first) {
          first = false;
          throw new ApiError('timeout', 'No answer within 90 s.');
        }
        return fixtureApi.frames(id, signal);
      },
    });
    const search = store().skySearch(PROGRESSIVE);
    await until(() => sky().progress?.retry !== null && sky().progress?.retry !== undefined);
    expect(sky().status).toBe('loading_frames');
    expect(sky().progress?.retry).toMatchObject({ timeout: true, failures: 1 });
    expect(sky().error).toBeNull();
    await until(() => sky().status === 'ready');
    await search;
    expect(sky().frames?.frames).toHaveLength(4);
  });

  it('a server error on the first request still shows the error at once', async () => {
    setSkyApi({
      ...fixtureApi,
      frames: async () => {
        throw new ApiError('server', 'down', 503);
      },
    });
    await store().skySearch(PROGRESSIVE);
    expect(sky().status).toBe('error');
    expect(sky().error?.kind).toBe('server');
    expect(sky().progress).toBeNull();
  });

  it('opens a shared-link frame once it arrives, unless the user moved first', async () => {
    await store().skySearch({ ...PROGRESSIVE, origin: 'hash', frameId: fid(12) });
    expect(sky().index).toBe(0);
    expect(sky().progress?.pendingFrameId).toBe(fid(12));
    await until(() => (sky().frames?.frames.length ?? 0) >= 18);
    expect(sky().frames?.frames[sky().index]?.frame_id).toBe(fid(12));
    expect(sky().progress?.pendingFrameId ?? null).toBeNull();

    await store().skySearch({ ...PROGRESSIVE, origin: 'hash', frameId: fid(12) });
    store().skySeek(1);
    await until(() => sky().progress === null);
    expect(sky().frames?.frames[sky().index]?.frame_id).toBe(fid(1));
  });

  it('skyReset stops the requests', async () => {
    const { api, c } = counting();
    setSkyApi(api);
    await store().skySearch(PROGRESSIVE);
    store().skyReset();
    const calls = c.frames;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.frames).toBe(calls);
    expect(sky().status).toBe('idle');
  });
});
