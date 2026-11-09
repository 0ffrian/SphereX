// Issue #60: a body that failed to load for a transient reason is asked for again; a real 404 is not.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/api/errors';
import type { ApiClient } from '@/app/api/client';
import { getSkyApi, setSkyApi } from '@/state/store';
import { fixture } from '@/test/sharedFixtures';
import { useShellStore } from '@/app/shell/shellStore';
import { isTransient, loadBodyFor } from './selectedBody';

const flush = () => new Promise((r) => setTimeout(r, 0));

function apiFailing(err: ApiError) {
  const f = fixture('planet_water');
  let calls = 0;
  const client = {
    ...getSkyApi(),
    card: vi.fn(async () => {
      calls++;
      if (calls === 1) throw err;
      return { data: f.card, fixture: null };
    }),
    renderParams: vi.fn(async () => ({ data: f.params, fixture: null })),
  } as unknown as ApiClient;
  return { client, calls: () => calls };
}

let original: ApiClient;
beforeEach(() => {
  original = getSkyApi();
  useShellStore.setState({ body: { status: 'idle' } });
  return () => setSkyApi(original);
});

describe('loadBodyFor', () => {
  it('classifies transient errors', () => {
    expect(isTransient(new ApiError('timeout', null))).toBe(true);
    expect(isTransient(new ApiError('network', null))).toBe(true);
    expect(isTransient(new ApiError('server', null, 503))).toBe(true);
    expect(isTransient(new ApiError('not_found', null, 404))).toBe(false);
    expect(isTransient(new Error('x'))).toBe(false);
  });

  it('retries after a timeout, on the next ask', async () => {
    const { client, calls } = apiFailing(new ApiError('timeout', null));
    setSkyApi(client);
    loadBodyFor('aqua');
    await flush();
    expect(useShellStore.getState().body).toMatchObject({ status: 'none', transient: true });
    loadBodyFor('aqua');
    await flush();
    expect(calls()).toBe(2);
    expect(useShellStore.getState().body).toMatchObject({ status: 'ready', id: 'aqua' });
  });

  it('does not retry a real 404 ("no 3D model")', async () => {
    const { client, calls } = apiFailing(new ApiError('not_found', null, 404));
    setSkyApi(client);
    loadBodyFor('rw-aur');
    await flush();
    expect(useShellStore.getState().body).toMatchObject({ status: 'none', transient: false });
    loadBodyFor('rw-aur');
    await flush();
    expect(calls()).toBe(1);
  });
});

describe('loadBodyFor and the asset status (Q-164)', () => {
  function apiWithStatus(assetStatus: string | null) {
    const f = fixture('planet_water');
    return {
      ...getSkyApi(),
      card: vi.fn(async () => ({ data: f.card, fixture: null, assetStatus })),
      renderParams: vi.fn(async () => ({ data: f.params, fixture: null, assetStatus })),
    } as unknown as ApiClient;
  }

  it('marks a saved asset as prebuilt', async () => {
    setSkyApi(apiWithStatus('saved'));
    loadBodyFor('aqua');
    await flush();
    expect(useShellStore.getState().body).toMatchObject({ status: 'ready', prebuilt: true });
  });

  it('does not mark a generated asset or a reply with no status', async () => {
    setSkyApi(apiWithStatus('generated'));
    loadBodyFor('aqua');
    await flush();
    expect(useShellStore.getState().body).toMatchObject({ status: 'ready', prebuilt: false });
    useShellStore.setState({ body: { status: 'idle' } });
    setSkyApi(apiWithStatus(null));
    loadBodyFor('aqua');
    await flush();
    expect(useShellStore.getState().body).toMatchObject({ status: 'ready', prebuilt: false });
  });
});
