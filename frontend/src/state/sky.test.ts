// The flipbook session slice of the app store (A1.1, UML 08 and 09).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type ApiResult } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import type { ResolveResponse } from '@/app/api/types';
import { fixtureFetch } from '@/test/fixtureFetch';
import { initialAppData, setSkyApi, useAppStore } from './store';

const fixtureApi = createApiClient({ fetchImpl: fixtureFetch });
const sky = () => useAppStore.getState().sky;
const store = () => useAppStore.getState();

describe('sky slice', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppData);
    setSkyApi(fixtureApi);
  });
  afterEach(() => setSkyApi(fixtureApi));

  it('starts idle', () => {
    expect(sky().status).toBe('idle');
    expect(sky().fps).toBe(2);
    expect(sky().viewMode).toBe('frames');
  });

  it('resolves, then loads frames, and marks fixture data', async () => {
    await store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
    const s = sky();
    expect(s.status).toBe('ready');
    expect(s.resolved?.name).toBe('RW Aurigae');
    expect(s.frames?.frames).toHaveLength(24);
    expect(s.fixture).toBe(true);
    expect(s.fixtureSeen).toBe(true);
    expect(s.index).toBe(0);
    expect(s.announcement).toMatch(/24 frames loaded/);
  });

  it('opens on the frame named in a shared link', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'hash', frameId: 'r-dra-f007' });
    expect(sky().index).toBe(7);
  });

  it('shows a 404 as an error with the server detail', async () => {
    await store().skySearch({ q: 'Nowhere', kind: 'name', origin: 'input' });
    expect(sky().status).toBe('error');
    expect(sky().error?.kind).toBe('not_found');
    expect(sky().error?.detail).toMatch(/Nowhere/);
  });

  it('handles an empty frame list with a refusal in missing', async () => {
    await store().skySearch({ q: 'Synthetic refused mover', kind: 'name', origin: 'input' });
    expect(sky().status).toBe('ready');
    expect(sky().frames?.frames).toEqual([]);
    expect(sky().frames?.missing).toEqual(['frames:moving_object_search']);
    store().skyPlay();
    expect(sky().playing).toBe(false);
  });

  it('drops a late reply from an older search', async () => {
    let releaseFirst: (v: ApiResult<ResolveResponse>) => void = () => {};
    const slow: ApiClient = {
      ...fixtureApi,
      resolve: (q, signal) =>
        q === 'first'
          ? new Promise((resolve) => {
              releaseFirst = resolve;
              void signal;
            })
          : fixtureApi.resolve(q, signal),
    };
    setSkyApi(slow);
    const first = store().skySearch({ q: 'first', kind: 'name', origin: 'input' });
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    releaseFirst({
      data: {
        id: 'stale',
        name: 'Stale',
        ra: 1,
        dec: 1,
        moving: false,
        resolver: 'simbad',
        cached_at: null,
      },
      fixture: null,
    });
    await first;
    expect(sky().resolved?.id).toBe('r-dra');
    expect(sky().status).toBe('ready');
  });

  it('keeps an aborted request silent', async () => {
    setSkyApi({
      ...fixtureApi,
      resolve: async () => {
        throw new ApiError('aborted', null);
      },
    });
    await store().skySearch({ q: 'x', kind: 'name', origin: 'input' });
    expect(sky().status).toBe('resolving');
    expect(sky().error).toBeNull();
  });

  it('plays, advances only onto settled frames, wraps, and pauses with an announcement', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    store().skyPlay();
    expect(sky().playing).toBe(true);
    store().skyAdvance(() => false);
    expect(sky().index).toBe(0);
    store().skyAdvance(() => true);
    expect(sky().index).toBe(1);
    store().skySeek(23);
    expect(sky().playing).toBe(false);
    store().skyPlay();
    store().skyAdvance(() => true);
    expect(sky().index).toBe(0);
    store().skyPause();
    expect(sky().playing).toBe(false);
    expect(sky().announcement).toMatch(/^Paused\. Frame 1 of 24, \d\.\d{3} µm, 2025-05-03/);
  });

  it('steps and seeks with clamping, by index or frame id', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    store().skyStep(-1);
    expect(sky().index).toBe(0);
    store().skySeek(99);
    expect(sky().index).toBe(23);
    store().skySeekFrame('r-dra-f004');
    expect(sky().index).toBe(4);
    store().skySeekFrame('no-such-frame');
    expect(sky().index).toBe(4);
  });

  it('switches view mode and announces it', async () => {
    store().skySetViewMode('trails');
    expect(sky().viewMode).toBe('trails');
    expect(sky().announcement).toMatch(/Rainbow Trails/);
  });

  it('loads the spectrum and retries a failed one', async () => {
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    setSkyApi({
      ...fixtureApi,
      spectrum: async () => {
        throw new ApiError('server', 'Archive timed out.', 504, 'upstream_timeout');
      },
    });
    await store().skyLoadSpectrum();
    expect(sky().spectrum.status).toBe('error');
    expect(sky().spectrum.error?.status).toBe(504);

    setSkyApi(fixtureApi);
    await store().skyRetry();
    expect(sky().spectrum.status).toBe('ready');
    expect(sky().spectrum.data?.spectrum).toHaveLength(22);
    expect(sky().announcement).toMatch(
      /^Spectrum loaded: 22 points, 3 flagged, \d\.\d{3} µm to \d\.\d{3} µm\. 2 frames not measured\.$/,
    );
  });

  it('announces why a saturated object has no spectrum', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    const pending = store().skyLoadSpectrum();
    // The resolved name, as in the panel heading, not the typed query.
    expect(sky().announcement).toBe('Loading the spectrum of R Draconis.');
    await pending;
    expect(sky().spectrum.data?.spectrum).toEqual([]);
    expect(sky().announcement).toBe(
      'No spectrum for R Draconis: the detector flagged the object’s centre as saturated or unusable in 21 of 25 frames.',
    );
  });

  it('a new search clears the old spectrum and keeps the fixture banner flag', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    await store().skyLoadSpectrum();
    const pending = store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
    expect(sky().spectrum.status).toBe('idle');
    expect(sky().fixture).toBe(false);
    expect(sky().fixtureSeen).toBe(true);
    await pending;
  });

  // Review finding 2: a cleared hash (Back to the start page) left the old object on screen.
  it('skyReset returns to idle, drops late replies and keeps speed and the banner flag', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    store().skySetFps(8);
    const pending = store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
    store().skyReset();
    await pending;
    expect(sky().status).toBe('idle');
    expect(sky().resolved).toBeNull();
    expect(sky().frames).toBeNull();
    expect(sky().query).toBeNull();
    expect(sky().fps).toBe(8);
    expect(sky().fixtureSeen).toBe(true);
  });

  // Review finding 3: problems in a shared link were never shown.
  it('shows and announces link problems until the next search', async () => {
    store().skySetLinkProblems(['Link coordinates ignored: RA must be from 0 up to 360 degrees.']);
    expect(sky().linkProblems).toHaveLength(1);
    expect(sky().announcement).toMatch(/Link coordinates ignored/);
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    expect(sky().linkProblems).toEqual([]);
  });

  it('switches Raw | Colour, pauses for the composite and keeps the choice across searches', async () => {
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    store().skyPlay();
    store().skySetColour({ on: true, view: 'tint' });
    expect(sky().playing).toBe(true); // the tint plays like the raw frames
    expect(sky().announcement).toMatch(/^Wavelength tint/);
    store().skySetColour({ on: true, view: 'composite' });
    expect(sky().playing).toBe(false);
    expect(sky().announcement).toMatch(/^SPHEREx composite/);
    store().skyPlay();
    expect(sky().playing).toBe(false);
    await store().skySearch({ q: 'RW Aur', kind: 'name', origin: 'input' });
    expect(sky().colour).toEqual({ on: true, view: 'composite' });
    store().skySetColour({ on: false, view: 'composite' });
    store().skyPlay();
    expect(sky().playing).toBe(true);
  });

  it('plays the frames in Measured only even with the composite asked for (D-21)', async () => {
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    store().setHonesty('measured');
    store().skySetColour({ on: true, view: 'composite' });
    expect(sky().announcement).toMatch(/Measured only/);
    store().skyPlay();
    expect(sky().playing).toBe(true);
    // Back to + Estimated: the composite shows again, so playback stops.
    store().setHonesty('derived');
    expect(sky().playing).toBe(false);
  });

  it('loads the composite once per object and serves it from the cache', async () => {
    let calls = 0;
    setSkyApi({
      ...fixtureApi,
      composite: (id, signal) => {
        calls++;
        return fixtureApi.composite(id, signal);
      },
    });
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    await store().skyLoadComposite();
    expect(sky().composite.status).toBe('ready');
    expect(sky().composite.data?.bands).toHaveLength(3);
    expect(sky().announcement).toMatch(/^Colour composite shown: blue/);
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    expect(sky().composite.status).toBe('idle');
    await store().skyLoadComposite();
    expect(sky().composite.status).toBe('ready');
    expect(calls).toBe(1);
  });

  it('keeps a refused composite as ready with its reasons, and an error for retry', async () => {
    await store().skySearch({ q: 'R Dra', kind: 'name', origin: 'input' });
    await store().skyLoadComposite();
    expect(sky().composite.data?.image_url).toBeNull();
    expect(sky().announcement).toMatch(/^No colour composite: /);

    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    setSkyApi({
      ...fixtureApi,
      composite: async () => {
        throw new ApiError('server', 'Not cached; offline.', 503, 'offline_cache_miss');
      },
    });
    await store().skySearch({ q: 'eps Ind B', kind: 'name', origin: 'input' });
    await store().skyLoadComposite();
    expect(sky().composite.status).toBe('error');
    expect(sky().composite.error?.code).toBe('offline_cache_miss');
  });
});
