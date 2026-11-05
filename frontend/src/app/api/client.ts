// M1 API client (D-16): resolve, frames and spectrum. Cutouts are plain <img> URLs taken from
// `cutout_url` as given. Every reply is checked against the contract (validate.ts).
import { API_BASE, API_TIMEOUT_MS, FIXTURE_HEADER } from './config';
import { ApiError } from './errors';
import type { FramesResponse, ResolveResponse, SpectrumResponse } from './types';
import { parseApiError, parseFrames, parseResolve, parseSpectrum } from './validate';

/** Set when the dev fixture server answered: the data is synthetic, not SPHEREx. */
export type FixtureKind = 'synthetic' | null;

export interface ApiResult<T> {
  data: T;
  fixture: FixtureKind;
}

export interface ApiClient {
  resolve(q: string, signal?: AbortSignal): Promise<ApiResult<ResolveResponse>>;
  frames(id: string, signal?: AbortSignal): Promise<ApiResult<FramesResponse>>;
  spectrum(id: string, signal?: AbortSignal): Promise<ApiResult<SpectrumResponse>>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? API_BASE;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  // Looked up per call, so tests can stub globalThis.fetch after the client is made.
  const doFetch: typeof fetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function getJson<T>(
    path: string,
    parse: (raw: unknown) => T,
    signal?: AbortSignal,
  ): Promise<ApiResult<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onOuterAbort, { once: true });

    const abortedError = () =>
      timedOut
        ? new ApiError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} s.`)
        : new ApiError('aborted', 'Replaced by a newer request.');

    try {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${path}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
      } catch (e) {
        if (controller.signal.aborted) throw abortedError();
        throw new ApiError('network', e instanceof Error ? e.message : 'Request failed.');
      }

      const fixture: FixtureKind =
        res.headers.get(FIXTURE_HEADER) === 'synthetic' ? 'synthetic' : null;

      let body: unknown = null;
      let bodyOk = true;
      try {
        body = await res.json();
      } catch {
        if (controller.signal.aborted) throw abortedError();
        bodyOk = false;
      }

      if (!res.ok) {
        const err = bodyOk ? parseApiError(body) : null;
        const kind =
          res.status === 404 ? 'not_found' : res.status >= 500 ? 'server' : 'bad_request';
        throw new ApiError(kind, err?.detail || null, res.status, err?.error ?? null);
      }
      if (!bodyOk) throw new ApiError('bad_response', 'The reply is not JSON.', res.status);
      return { data: parse(body), fixture };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  return {
    resolve: (q, signal) => getJson(`/resolve?q=${encodeURIComponent(q)}`, parseResolve, signal),
    frames: (id, signal) =>
      getJson(`/objects/${encodeURIComponent(id)}/frames`, parseFrames, signal),
    spectrum: (id, signal) =>
      getJson(`/objects/${encodeURIComponent(id)}/spectrum`, parseSpectrum, signal),
  };
}
