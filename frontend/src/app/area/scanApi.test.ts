// Which scan API answers (PR #166 review): the opt-in mock only on the dev server; a production
// build asked for `?scan=mock` still talks to the backend.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScanApi, setScanApi } from './scanApi';

const REQ = { ra: 30, dec: 10, width_deg: 9, height_deg: 5.4, kind: 'discovery' as const };

afterEach(() => {
  setScanApi(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('getScanApi', () => {
  it('?scan=mock gives the mock on the dev server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    history.replaceState(null, '', '/?scan=mock');
    setScanApi(null);
    expect(await getScanApi().plan(REQ)).toMatchObject({ kind: 'plan' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a production build ignores ?scan=mock and asks the backend', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SX_SCANS', 'mock');
    const fetchSpy = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    history.replaceState(null, '', '/?scan=mock');
    setScanApi(null);
    expect(await getScanApi().plan(REQ)).toEqual({ kind: 'unavailable' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
