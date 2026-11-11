// The Area search slice (A18.9; issue #96): loading, snapping, aborts, errors, visits and blink.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '@/app/api/client';
import { fixtureFetch } from '@/test/fixtureFetch';
import { AREA_OPEN_DEFAULTS, initialAreaState, resetAreaRequests } from './area';
import { initialAppData, setSkyApi, useAppStore } from './store';

const fixtureApi = createApiClient({ fetchImpl: fixtureFetch });
const area = () => useAppStore.getState().area;
const store = () => useAppStore.getState();
const IN_MAIN = { ra: 150.1, dec: 10.05, sideDeg: 0.4 };

describe('area slice', () => {
  beforeEach(() => {
    resetAreaRequests();
    useAppStore.setState({ ...initialAppData, area: initialAreaState });
    setSkyApi(fixtureApi);
  });
  afterEach(() => setSkyApi(fixtureApi));

  it('snaps a square to the prepared area and loads summary, dots and tracks', async () => {
    expect(await store().areaSearchSquare(IN_MAIN)).toBe(true);
    expect(area().areaId).toBe('fixture:area-main');
    expect(area().summary.status).toBe('ready');
    expect(area().layers).toEqual(AREA_OPEN_DEFAULTS.layers);
    expect(area().step).toBe(5);
    expect(area().visit).toBe(1);
    expect(area().fixture).toBe(true);
    expect(area().lastSquare).toEqual(IN_MAIN);
    await expect.poll(() => area().tracks.status).toBe('ready');
    expect(area().dots.status).toBe('ready');
    expect(store().sky.announcement).toMatch(/^Area found: 1\.00° by 0\.60°, 2 visits\.$/);
  });

  it('refuses a square outside every area with area:not_prepared', async () => {
    expect(await store().areaSearchSquare({ ra: 30, dec: 0, sideDeg: 0.5 })).toBe(false);
    expect(area().refusal).toBe('area:not_prepared');
    expect(area().areaId).toBeNull();
    expect(store().sky.announcement).toBe('This part of the sky is not prepared.');
  });

  it('a newer area drops the older reply (abort per area)', async () => {
    const first = store().areaOpen('fixture:area-main', 'fly');
    const second = store().areaOpen('fixture:area-multivisit', 'fly');
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(area().areaId).toBe('fixture:area-multivisit');
    expect(area().summary.data?.area_id).toBe('fixture:area-multivisit');
  });

  it('an unknown area from a link is a link problem; otherwise not found', async () => {
    expect(await store().areaOpen('nope', 'hash')).toBe(false);
    expect(store().sky.linkProblems).toEqual(['Link area “nope” is not prepared on this server.']);
    expect(await store().areaOpen('nope', 'fly')).toBe(false);
    expect(area().refusal).toBe('area:not_found');
  });

  it('a 404 area_not_found on the summary becomes area:not_found', async () => {
    await store().areaLoadIndex();
    useAppStore.setState((s) => ({
      area: {
        ...s.area,
        index: {
          ...s.area.index,
          data: {
            ...s.area.index.data!,
            areas: [{ ...s.area.index.data!.areas[0]!, area_id: 'gone' }],
          },
        },
      },
    }));
    expect(await store().areaOpen('gone', 'fly')).toBe(false);
    expect(area().refusal).toBe('area:not_found');
    expect(area().summary.error?.code).toBe('area_not_found');
  });

  it('an index that fails is an error the card can retry', async () => {
    setSkyApi(createApiClient({ fetchImpl: async () => new Response('{}', { status: 500 }) }));
    expect(await store().areaLoadIndex()).toBeNull();
    expect(area().index.status).toBe('error');
    setSkyApi(fixtureApi);
    expect((await store().areaLoadIndex())?.areas.length).toBe(2);
  });

  it('visits: set by hand is announced; the blink step is not', async () => {
    await store().areaOpen('fixture:area-multivisit', 'fly');
    store().areaSetVisit(3);
    expect(area().visit).toBe(3);
    expect(store().sky.announcement).toMatch(/^Visit 3 of 4, /);
    useAppStore.setState((s) => ({ sky: { ...s.sky, announcement: '' } }));
    store().areaStepVisit(false);
    store().areaStepVisit(false);
    expect(area().visit).toBe(1);
    expect(store().sky.announcement).toBe('');
  });

  it('blink needs two visits; a new area stops it', async () => {
    await store().areaOpen('fixture:area-main', 'fly');
    store().areaSetBlink(true);
    expect(area().blink).toBe(true);
    await store().areaOpen('fixture:area-multivisit', 'fly');
    expect(area().blink).toBe(false);
  });

  it('turning Tracks off clears the selection', async () => {
    await store().areaOpen('fixture:area-main', 'fly');
    store().areaSelectResult('T1');
    store().areaSetLayer('tracks', false);
    expect(area().selectedResult).toBeNull();
  });

  it('a square refusal is said', () => {
    store().areaRefuse('square:too_small');
    expect(area().refusal).toBe('square:too_small');
    expect(store().sky.announcement).toBe('Drag a bigger square.');
  });
});
