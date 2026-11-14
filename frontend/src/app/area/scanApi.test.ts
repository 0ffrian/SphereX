// Which scan API answers (PR #166 review): the opt-in mock only on the dev server; a production
// build asked for `?scan=mock` still talks to the backend.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScanApi, httpScanApi, RunGone, setScanApi } from './scanApi';
import { scanFailureText } from './scanStore';

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

// The HTTP client on the backend's own replies (a run recorded from the real backend, 13 Nov): the
// requests it sends, what it reads back, and that none of them can wait for good.
describe('httpScanApi', () => {
  const RUN = JSON.parse(
    readFileSync(`${process.cwd()}/e2e/fixtures/runs/run-dr1.json`, 'utf8'),
  ) as {
    run_id: string;
  };
  const RESULTS: unknown = JSON.parse(
    readFileSync(`${process.cwd()}/e2e/fixtures/runs/run-dr1-results.json`, 'utf8'),
  );
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const id = RUN.run_id;
  function client(answer: (url: string, init?: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = httpScanApi('/v1', (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer(String(url), init);
    }) as typeof fetch);
    return { api, calls };
  }

  it('starts a scan with the contract body and reads the run the server answers with', async () => {
    const { api, calls } = client(() => reply(202, RUN));
    const answer = await api.start(REQ);
    expect(answer.kind).toBe('started');
    expect(answer.kind === 'started' && answer.run.run_id).toBe(id);
    expect(calls[0]!.url).toBe('/v1/scans');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ ...REQ, start: true });
  });

  it('reads a run, its results, and pauses, resumes and stops it on the documented routes', async () => {
    const { api, calls } = client((url, init) =>
      init?.method === 'DELETE'
        ? reply(204)
        : url.endsWith('/results')
          ? reply(200, RESULTS)
          : reply(200, RUN),
    );
    expect((await api.run(id)).run_id).toBe(id);
    expect((await api.results(id)).run_id).toBe(id);
    expect((await api.pause(id)).run_id).toBe(id);
    expect((await api.resume(id)).run_id).toBe(id);
    await api.stop(id);
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      `GET /v1/runs/${id}`,
      `GET /v1/runs/${id}/results`,
      `POST /v1/runs/${id}/pause`,
      `POST /v1/runs/${id}/resume`,
      `DELETE /v1/runs/${id}`,
    ]);
  });

  it('gives every request a time limit, so a server that never answers cannot hold the card', async () => {
    const { api, calls } = client((url, init) =>
      init?.method === 'DELETE'
        ? reply(204)
        : url.endsWith('/results')
          ? reply(200, RESULTS)
          : reply(200, RUN),
    );
    await api.plan(REQ);
    await api.start(REQ);
    await api.run(id);
    await api.results(id);
    await api.pause(id);
    await api.resume(id);
    await api.stop(id);
    await api.list().catch(() => undefined);
    expect(calls).toHaveLength(8);
    for (const c of calls) expect(c.init?.signal, c.url).toBeInstanceOf(AbortSignal);
  });

  it('a plan that times out says the server is not reachable; a Start that times out may have started', async () => {
    const timeout = () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    const { api } = client(timeout);
    expect(await api.plan(REQ)).toEqual({ kind: 'error', code: 'scan:unreachable', detail: '' });
    expect(scanFailureText('scan:unreachable').title).toBe('Server not reachable');
    // The server may have queued the scan before the time limit: never "Nothing was started".
    const noAnswer = { kind: 'error', code: 'scan:no_answer', detail: '' };
    expect(await api.start(REQ)).toEqual(noAnswer);
    expect(scanFailureText('scan:no_answer').line).toMatch(/may have started/);
    await expect(api.pause(id)).rejects.toThrow();
    await expect(api.stop(id)).rejects.toThrow();
  });

  it('a Start whose reply cannot be read may have started; one that never got through did not', async () => {
    const garbled = client(() => reply(202, { nope: true }));
    expect(await garbled.api.start(REQ)).toEqual({
      kind: 'error',
      code: 'scan:no_answer',
      detail: '',
    });
    const offline = client(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await offline.api.start(REQ)).toEqual({
      kind: 'error',
      code: 'scan:unreachable',
      detail: '',
    });
  });

  it('a run the server no longer has is RunGone', async () => {
    const { api } = client(() => reply(404, { error: 'run_not_found', detail: '' }));
    await expect(api.run(id)).rejects.toBeInstanceOf(RunGone);
  });
});
