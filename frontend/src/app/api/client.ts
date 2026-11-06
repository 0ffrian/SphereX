// M1 API client (D-16): resolve, frames and spectrum; M4 (issue #12): overlays and the combine
// image. Cutouts and flag masks are plain <img> URLs taken from the reply as given. Every reply is
// checked against the contract (validate.ts).
import { API_BASE, API_TIMEOUT_MS, COMBINE_HEADER, FIXTURE_HEADER } from './config';
import { ApiError } from './errors';
import type {
  CombineInfo,
  CombineOp,
  FramesResponse,
  OverlaysResponse,
  ResolveResponse,
  SpectrumResponse,
} from './types';
import {
  parseApiError,
  parseCombineInfo,
  parseFrames,
  parseOverlays,
  parseResolve,
  parseSpectrum,
} from './validate';

/** Set when the dev fixture server answered: the data is synthetic, not SPHEREx. */
export type FixtureKind = 'synthetic' | null;

export interface ApiResult<T> {
  data: T;
  fixture: FixtureKind;
}

/** A combined image: an object URL for the PNG (revoke it with revokeObjectUrl) and its header. */
export interface CombineResult {
  objectUrl: string;
  info: CombineInfo;
}

export interface ApiClient {
  resolve(q: string, signal?: AbortSignal): Promise<ApiResult<ResolveResponse>>;
  frames(id: string, signal?: AbortSignal): Promise<ApiResult<FramesResponse>>;
  spectrum(id: string, signal?: AbortSignal): Promise<ApiResult<SpectrumResponse>>;
  /** `GET /v1/objects/{id}/overlays` (issue #12). */
  getOverlays(id: string, signal?: AbortSignal): Promise<ApiResult<OverlaysResponse>>;
  /** `GET /v1/objects/{id}/combine.png?op=&a=&b=` (issue #12). The caller owns the object URL. */
  getCombine(
    id: string,
    op: CombineOp,
    a: string,
    b: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<CombineResult>>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Turns the combine PNG into a URL for <img>. Defaults to URL.createObjectURL. */
  createObjectUrl?: (blob: Blob) => string;
}

function defaultCreateObjectUrl(blob: Blob): string {
  if (typeof URL.createObjectURL !== 'function') {
    throw new ApiError('bad_response', 'This browser cannot show the combined image.');
  }
  return URL.createObjectURL(blob);
}

/** Frees an object URL made by getCombine. Safe to call with a non-blob URL or twice. */
export function revokeObjectUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:') || typeof URL.revokeObjectURL !== 'function') return;
  URL.revokeObjectURL(url);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? API_BASE;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  const createObjectUrl = options.createObjectUrl ?? defaultCreateObjectUrl;
  // Looked up per call, so tests can stub globalThis.fetch after the client is made.
  const doFetch: typeof fetch =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  /**
   * One request with the timeout and the caller's abort signal. `read` turns an OK reply into
   * the result; error replies become ApiError with the backend's `{error, detail}` when present.
   */
  async function request<T>(
    path: string,
    accept: string,
    read: (res: Response, aborted: () => ApiError | null) => Promise<T>,
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
    const ifAborted = () => (controller.signal.aborted ? abortedError() : null);

    try {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${path}`, {
          signal: controller.signal,
          headers: { Accept: accept },
        });
      } catch (e) {
        if (controller.signal.aborted) throw abortedError();
        throw new ApiError('network', e instanceof Error ? e.message : 'Request failed.');
      }

      const fixture: FixtureKind =
        res.headers.get(FIXTURE_HEADER) === 'synthetic' ? 'synthetic' : null;

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          const a = ifAborted();
          if (a) throw a;
        }
        const err = parseApiError(body);
        const kind =
          res.status === 404 ? 'not_found' : res.status >= 500 ? 'server' : 'bad_request';
        throw new ApiError(kind, err?.detail || null, res.status, err?.error ?? null);
      }
      return { data: await read(res, ifAborted), fixture };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  function getJson<T>(
    path: string,
    parse: (raw: unknown) => T,
    signal?: AbortSignal,
  ): Promise<ApiResult<T>> {
    return request(
      path,
      'application/json',
      async (res, aborted) => {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw aborted() ?? new ApiError('bad_response', 'The reply is not JSON.', res.status);
        }
        return parse(body);
      },
      signal,
    );
  }

  const objectPath = (id: string) => `/objects/${encodeURIComponent(id)}`;

  return {
    resolve: (q, signal) => getJson(`/resolve?q=${encodeURIComponent(q)}`, parseResolve, signal),
    frames: (id, signal) => getJson(`${objectPath(id)}/frames`, parseFrames, signal),
    spectrum: (id, signal) => getJson(`${objectPath(id)}/spectrum`, parseSpectrum, signal),
    getOverlays: (id, signal) => getJson(`${objectPath(id)}/overlays`, parseOverlays, signal),
    getCombine: (id, op, a, b, signal) => {
      const query = new URLSearchParams({ op, a, b }).toString();
      return request(
        `${objectPath(id)}/combine.png?${query}`,
        'image/png',
        async (res, aborted) => {
          // The header is checked before the body is read, so a bad reply makes no object URL.
          const info = parseCombineInfo(res.headers.get(COMBINE_HEADER));
          if (info.op !== op || info.a !== a || info.b !== b) {
            throw new ApiError('bad_response', `${COMBINE_HEADER}: does not match the request`);
          }
          let blob: Blob;
          try {
            blob = await res.blob();
          } catch {
            throw aborted() ?? new ApiError('bad_response', 'The image could not be read.');
          }
          return { objectUrl: createObjectUrl(blob), info };
        },
        signal,
      );
    },
  };
}
