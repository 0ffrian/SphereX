import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureFetch } from '@/test/fixtureFetch';
import { fixture } from '@/test/sharedFixtures';
import { createApiClient } from './client';
import { ApiError } from './errors';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('API client (D-16)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the X-SX-Asset-Status header (Q-39, Q-164)', async () => {
    const params = fixture('planet_water').params;
    const reply = (headers: Record<string, string>) =>
      createApiClient({
        fetchImpl: (async () => jsonResponse(200, params, headers)) as typeof fetch,
      }).renderParams(params.id);
    expect((await reply({ 'X-SX-Asset-Status': 'saved' })).assetStatus).toBe('saved');
    expect((await reply({})).assetStatus).toBeNull();
  });

  it('builds encoded URLs under /v1', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (String(input).includes('/resolve')) {
        return jsonResponse(200, {
          id: 'a b/c',
          name: null,
          ra: 1,
          dec: 2,
          moving: false,
          resolver: 'coords',
          cached_at: null,
        });
      }
      return jsonResponse(404, { error: 'not_found', detail: 'nope' });
    });
    const api = createApiClient({ fetchImpl: fetchImpl as typeof fetch });
    await api.resolve("Barnard's Star");
    await expect(api.frames('a b/c')).rejects.toBeInstanceOf(ApiError);
    expect(calls[0]).toBe("/v1/resolve?q=Barnard's%20Star");
    expect(calls[1]).toBe('/v1/objects/a%20b%2Fc/frames');
  });

  it('reads the fixture header and parses fixture replies', async () => {
    const api = createApiClient({ fetchImpl: fixtureFetch });
    const r = await api.resolve('R Dra');
    expect(r.fixture).toBe('synthetic');
    expect(r.data.id).toBe('r-dra');
    const f = await api.frames(r.data.id);
    expect(f.data.frames.length).toBe(24);
    expect(f.data.data_release).toBe('synthetic_fixture');
  });

  it('has no fixture flag on a normal reply', async () => {
    const api = createApiClient({
      fetchImpl: (async () =>
        jsonResponse(200, {
          id: 'x',
          name: 'X',
          ra: 10,
          dec: 10,
          moving: false,
          resolver: 'simbad',
          cached_at: '2026-11-05T10:00:00Z',
        })) as typeof fetch,
    });
    expect((await api.resolve('X')).fixture).toBeNull();
  });

  it.each([
    [404, 'not_found'],
    [400, 'bad_request'],
    [500, 'server'],
    [504, 'server'],
  ] as const)('maps HTTP %i to %s and keeps the server detail', async (status, kind) => {
    const api = createApiClient({
      fetchImpl: (async () =>
        jsonResponse(status, { error: 'code_x', detail: 'Human sentence.' })) as typeof fetch,
    });
    const err = await api.resolve('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe(kind);
    expect((err as ApiError).status).toBe(status);
    expect((err as ApiError).code).toBe('code_x');
    expect((err as ApiError).detail).toBe('Human sentence.');
  });

  it('copes with an error reply that is not JSON', async () => {
    const api = createApiClient({
      fetchImpl: (async () =>
        new Response('<html>Bad gateway</html>', { status: 502 })) as typeof fetch,
    });
    const err = (await api.resolve('x').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('server');
    expect(err.detail).toBeNull();
  });

  it('reports a network failure', async () => {
    const api = createApiClient({
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch,
    });
    const err = (await api.resolve('x').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('network');
  });

  it('times out a hung request', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const api = createApiClient({ fetchImpl, timeoutMs: 1000 });
    const pending = api.frames('x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1001);
    const err = (await pending) as ApiError;
    expect(err.kind).toBe('timeout');
    expect(err.timeoutMs).toBe(1000);
  });

  it('gives resolve the quick timeout; card, render-params and frames keep the long one (#102)', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    // The defaults: 25 s for resolve, 90 s for the rest.
    const api = createApiClient({ fetchImpl });
    const settled = new Set<string>();
    const track = (name: string, p: Promise<unknown>) =>
      p.catch((e: unknown) => {
        settled.add(name);
        return e;
      });
    const resolve = track('resolve', api.resolve('x'));
    // Offline, /card waits for the object's job with no limit of its own (Q-111 (2)).
    const slow = [
      track('card', api.card('x')),
      track('renderParams', api.renderParams('x')),
      track('frames', api.frames('x')),
    ];
    await vi.advanceTimersByTimeAsync(25_001);
    expect([...settled]).toEqual(['resolve']);
    const quickErr = (await resolve) as ApiError;
    expect(quickErr.kind).toBe('timeout');
    expect(quickErr.timeoutMs).toBe(25_000);
    await vi.advanceTimersByTimeAsync(90_000 - 25_001);
    for (const p of slow) expect(((await p) as ApiError).timeoutMs).toBe(90_000);
  });

  it('reports a caller abort as aborted, not as an error to show', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const api = createApiClient({ fetchImpl });
    const controller = new AbortController();
    const pending = api.resolve('x', controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(((await pending) as ApiError).kind).toBe('aborted');
  });

  it('refuses a reply that does not match the contract', async () => {
    const api = createApiClient({
      fetchImpl: (async () => jsonResponse(200, { id: 'x', ra: 'ten' })) as typeof fetch,
    });
    const err = (await api.resolve('x').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('bad_response');
  });
});
