// M1 API client (D-16): resolve, frames and spectrum; M4 (issue #12): overlays and the combine
// image; plus the sky index, the cached positions and the colour composite (not in D-16, see
// types.ts). Cutouts and flag masks are plain <img> URLs taken from the reply as given. Every reply
// is checked against the contract (validate.ts).
import {
  API_BASE,
  API_QUICK_TIMEOUT_MS,
  API_TIMEOUT_MS,
  ASSET_STATUS_HEADER,
  COMBINE_HEADER,
  FIXTURE_HEADER,
} from './config';
import { ApiError } from './errors';
import type {
  AreaDots,
  AreaIndex,
  AreaKnown,
  AreaSummary,
  AreaTracks,
  ObjectCard,
  RenderParams,
} from '@/contract';
import type {
  CombineInfo,
  CombineOp,
  CompositeResponse,
  FramesResponse,
  OverlaysResponse,
  ResolveResponse,
  SkyCachedResponse,
  SkyIndexResponse,
  SpectrumResponse,
} from './types';
import {
  parseApiError,
  parseAreaDots,
  parseAreaIndex,
  parseAreaKnown,
  parseAreaSummary,
  parseAreaTracks,
  parseCombineInfo,
  parseComposite,
  parseFrames,
  parseObjectCard,
  parseOverlays,
  parseRenderParams,
  parseResolve,
  parseSkyCached,
  parseSkyIndex,
  parseSpectrum,
} from './validate';

/** Set when the dev fixture server answered: the data is synthetic, not SPHEREx. */
export type FixtureKind = 'synthetic' | null;

export interface ApiResult<T> {
  data: T;
  fixture: FixtureKind;
  /** The `X-SX-Asset-Status` header ("saved", "generated" or "sketch"); null when not sent. */
  assetStatus?: string | null;
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
  /** Sky background index (prototype, not in D-16): the all-sky images that are installed. */
  skyIndex(signal?: AbortSignal): Promise<ApiResult<SkyIndexResponse>>;
  /** SPHEREx colour composite of the object (not in D-16): one RGB picture from three frames. */
  composite(id: string, signal?: AbortSignal): Promise<ApiResult<CompositeResponse>>;
  /** Positions whose frame list is complete in the backend cache (not in D-16): load at once. */
  skyCached(signal?: AbortSignal): Promise<ApiResult<SkyCachedResponse>>;
  /** `GET /v1/objects/{id}/card` (D-16): the ObjectCard of the 3D view (issue #60). */
  card(id: string, signal?: AbortSignal): Promise<ApiResult<ObjectCard>>;
  /** `GET /v1/objects/{id}/render-params` (D-16): what the 3D view may draw (issue #60). */
  renderParams(id: string, signal?: AbortSignal): Promise<ApiResult<RenderParams>>;
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
  /** Area search (A17.8; issue #96): `GET /v1/areas`, the prepared areas. */
  areaIndex(signal?: AbortSignal): Promise<ApiResult<AreaIndex>>;
  /** `GET /v1/areas/{area_id}`: the area's box, frames and step counts. */
  area(id: string, signal?: AbortSignal): Promise<ApiResult<AreaSummary>>;
  /** `GET /v1/areas/{area_id}/dots`. */
  areaDots(id: string, signal?: AbortSignal): Promise<ApiResult<AreaDots>>;
  /** `GET /v1/areas/{area_id}/tracks`. */
  areaTracks(id: string, signal?: AbortSignal): Promise<ApiResult<AreaTracks>>;
  /** `GET /v1/areas/{area_id}/known` (P9's Known card). */
  areaKnown(id: string, signal?: AbortSignal): Promise<ApiResult<AreaKnown>>;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Timeout of `resolve` (issue #102, Q-451). Defaults to API_QUICK_TIMEOUT_MS. */
  quickTimeoutMs?: number;
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
  const slowTimeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  const quickTimeoutMs = options.quickTimeoutMs ?? API_QUICK_TIMEOUT_MS;
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
    timeoutMs: number = slowTimeoutMs,
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
        ? new ApiError(
            'timeout',
            `No answer within ${Math.round(timeoutMs / 1000)} s.`,
            null,
            null,
            timeoutMs,
          )
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
      return {
        data: await read(res, ifAborted),
        fixture,
        assetStatus: res.headers.get(ASSET_STATUS_HEADER),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  function getJson<T>(
    path: string,
    parse: (raw: unknown) => T,
    signal?: AbortSignal,
    timeoutMs: number = slowTimeoutMs,
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
      timeoutMs,
    );
  }

  const objectPath = (id: string) => `/objects/${encodeURIComponent(id)}`;
  const areaPath = (id: string) => `/areas/${encodeURIComponent(id)}`;

  return {
    // Issue #102 (Q-451): only resolve uses the quick timeout. Offline, `/card` waits for the
    // object's job with no limit of its own (Q-111 (2), A4.10), so it keeps the long one.
    resolve: (q, signal) =>
      getJson(`/resolve?q=${encodeURIComponent(q)}`, parseResolve, signal, quickTimeoutMs),
    frames: (id, signal) => getJson(`${objectPath(id)}/frames`, parseFrames, signal),
    spectrum: (id, signal) => getJson(`${objectPath(id)}/spectrum`, parseSpectrum, signal),
    skyIndex: (signal) => getJson('/sky/index.json', parseSkyIndex, signal),
    skyCached: (signal) => getJson('/sky/cached', parseSkyCached, signal),
    composite: (id, signal) => getJson(`${objectPath(id)}/composite`, parseComposite, signal),
    card: (id, signal) => getJson(`${objectPath(id)}/card`, parseObjectCard, signal),
    renderParams: (id, signal) =>
      getJson(`${objectPath(id)}/render-params`, parseRenderParams, signal),
    getOverlays: (id, signal) => getJson(`${objectPath(id)}/overlays`, parseOverlays, signal),
    areaIndex: (signal) => getJson('/areas', parseAreaIndex, signal),
    area: (id, signal) => getJson(areaPath(id), parseAreaSummary, signal),
    areaDots: (id, signal) => getJson(`${areaPath(id)}/dots`, parseAreaDots, signal),
    areaTracks: (id, signal) => getJson(`${areaPath(id)}/tracks`, parseAreaTracks, signal),
    areaKnown: (id, signal) => getJson(`${areaPath(id)}/known`, parseAreaKnown, signal),
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
