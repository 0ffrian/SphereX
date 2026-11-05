import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureFetch } from '@/test/fixtureFetch';
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
    const pending = api.resolve('x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(((await pending) as ApiError).kind).toBe('timeout');
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
