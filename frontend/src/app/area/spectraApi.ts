// The spectrum check of a stored area (A17.13, A18.7, Q-474; issue #162): `GET /v1/areas/{id}/spectra`
// behind ONE module, so swapping the contract copy below for #161's generated types (`AreaSpectra`
// in `@/contract`) touches this file only.
//
// Which implementation answers:
//   - the HTTP backend by default. 404 `spectra_not_prepared` (or a backend from before #161, which
//     has no such route) is `not_run`: the UI lists "Spectrum check not run" under Not shown. Any
//     other failure (no backend, a server error, a reply that does not match the contract) is
//     `unavailable`: no verdict is drawn and the code goes to `missing`.
//   - the MOCK only when asked, on the dev server only: `?spectra=mock` in the page URL. It answers
//     for the recorded Eros area (`eros-2026-03`) alone, with the values of the spectrum-check
//     mock-up (spectraMock.json, made from the committed pack's real dots by the prototype that made
//     the mock-up's numbers), so no verdict is ever made up for another area. Any other area is
//     `not_run`. A public build never loads it.
import { API_BASE } from '@/app/api/config';

// ---- Contract (issue #162's copy of A17.13; #161's schema replaces it) --------------------------

export type SpectrumVerdict = 'rock' | 'very_red' | 'too_red' | 'too_blue' | 'flickers' | 'too_faint' | 'one_colour';
export const SPECTRUM_VERDICTS: readonly SpectrumVerdict[] = [
  'rock',
  'very_red',
  'too_red',
  'too_blue',
  'flickers',
  'too_faint',
  'one_colour',
];

export interface SpectrumPair {
  visit: number;
  exposure: number;
  time: string;
  lambda_short_um: number;
  lambda_long_um: number;
  rho: number;
  rho_err: number;
  limit: 'lower' | 'upper' | null;
  rho_max: number;
}
export interface SpectrumStep {
  visit: number;
  detector: number;
  time_a: string;
  time_b: string;
  change: number;
  allowed: number;
  ok: boolean;
}
export interface SpectrumPoint {
  dot_id: string;
  lambda_um: number;
  flux_uJy: number;
  flux_err: number;
  snr: number;
  arm: 'short' | 'long';
  rel: number | null;
  used: boolean;
}
export interface TrackSpectrum {
  track_id: string;
  verdict: SpectrumVerdict;
  heat_glow: boolean | null;
  r_au: number | null;
  r_source: 'parallax' | 'worst_case';
  pairs: SpectrumPair[];
  steps: SpectrumStep[];
  points: SpectrumPoint[];
}
export interface SpectrumCalibration {
  visit: number;
  detector: number;
  sigma_sys: number;
  n_pairs: number;
  source: 'stars' | 'default';
}
export interface AreaSpectra {
  area_id: string;
  cached_at: string;
  computed_at: string;
  missing: string[];
  provenance: Record<string, unknown>;
  method: {
    spectrum_version: string;
    settings: Record<string, unknown>;
    formulas: Record<string, string>;
    sun: Record<string, unknown>;
  };
  calibration: SpectrumCalibration[];
  tracks: TrackSpectrum[];
}

export type SpectraAnswer =
  | { kind: 'ok'; data: AreaSpectra }
  /** 404 `spectra_not_prepared`: the area has no stored check. */
  | { kind: 'not_run' }
  /** No route, no backend, or a reply that does not match the contract. */
  | { kind: 'unavailable' };

/** The `missing` codes the answers add (worded by realArea.missingText). */
export const SPECTRA_NOT_RUN = 'spectra:not_run';
export const SPECTRA_UNAVAILABLE = 'spectra:unavailable';

// ---- Reply check (every field the UI reads) ----------------------------------------------------

class BadSpectra extends Error {
  constructor(path: string, what: string) {
    super(`spectra: ${path}: ${what}`);
    this.name = 'BadSpectra';
  }
}
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, p: string): Obj => {
  if (!isObj(v)) throw new BadSpectra(p, 'expected an object');
  return v;
};
const arr = (o: Obj, k: string, p: string): unknown[] => {
  const v = o[k];
  if (!Array.isArray(v)) throw new BadSpectra(`${p}.${k}`, 'expected an array');
  return v;
};
const num = (o: Obj, k: string, p: string): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadSpectra(`${p}.${k}`, 'expected a number');
  return v;
};
const numOrNull = (o: Obj, k: string, p: string): number | null => (o[k] === null ? null : num(o, k, p));
const str = (o: Obj, k: string, p: string): string => {
  const v = o[k];
  if (typeof v !== 'string') throw new BadSpectra(`${p}.${k}`, 'expected a string');
  return v;
};
const oneOf = <T extends string>(o: Obj, k: string, p: string, allowed: readonly T[]): T => {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    throw new BadSpectra(`${p}.${k}`, `expected one of ${allowed.join(', ')}`);
  return v as T;
};
const bool = (o: Obj, k: string, p: string): boolean => {
  if (typeof o[k] !== 'boolean') throw new BadSpectra(`${p}.${k}`, 'expected true or false');
  return o[k] as boolean;
};

/** Checks a `/spectra` reply against the contract; throws on the first field that does not match. */
export function parseAreaSpectra(raw: unknown): AreaSpectra {
  const p = 'spectra';
  const o = obj(raw, p);
  str(o, 'area_id', p);
  str(o, 'cached_at', p);
  str(o, 'computed_at', p);
  arr(o, 'missing', p).forEach((m, i) => {
    if (typeof m !== 'string') throw new BadSpectra(`${p}.missing[${i}]`, 'expected a string');
  });
  obj(o.provenance, `${p}.provenance`);
  const m = obj(o.method, `${p}.method`);
  str(m, 'spectrum_version', `${p}.method`);
  obj(m.settings, `${p}.method.settings`);
  obj(m.sun, `${p}.method.sun`);
  Object.entries(obj(m.formulas, `${p}.method.formulas`)).forEach(([k, v]) => {
    if (typeof v !== 'string') throw new BadSpectra(`${p}.method.formulas.${k}`, 'expected a string');
  });
  arr(o, 'calibration', p).forEach((c, i) => {
    const cp = `${p}.calibration[${i}]`;
    const co = obj(c, cp);
    num(co, 'visit', cp);
    num(co, 'detector', cp);
    num(co, 'sigma_sys', cp);
    num(co, 'n_pairs', cp);
    oneOf(co, 'source', cp, ['stars', 'default'] as const);
  });
  arr(o, 'tracks', p).forEach((t, i) => {
    const tp = `${p}.tracks[${i}]`;
    const to = obj(t, tp);
    str(to, 'track_id', tp);
    oneOf(to, 'verdict', tp, SPECTRUM_VERDICTS);
    if (to.heat_glow !== null) bool(to, 'heat_glow', tp);
    numOrNull(to, 'r_au', tp);
    oneOf(to, 'r_source', tp, ['parallax', 'worst_case'] as const);
    arr(to, 'pairs', tp).forEach((x, j) => {
      const xp = `${tp}.pairs[${j}]`;
      const xo = obj(x, xp);
      for (const k of ['visit', 'exposure', 'lambda_short_um', 'lambda_long_um', 'rho', 'rho_err', 'rho_max']) num(xo, k, xp);
      str(xo, 'time', xp);
      if (xo.limit !== null) oneOf(xo, 'limit', xp, ['lower', 'upper'] as const);
    });
    arr(to, 'steps', tp).forEach((x, j) => {
      const xp = `${tp}.steps[${j}]`;
      const xo = obj(x, xp);
      for (const k of ['visit', 'detector', 'change', 'allowed']) num(xo, k, xp);
      str(xo, 'time_a', xp);
      str(xo, 'time_b', xp);
      bool(xo, 'ok', xp);
    });
    arr(to, 'points', tp).forEach((x, j) => {
      const xp = `${tp}.points[${j}]`;
      const xo = obj(x, xp);
      str(xo, 'dot_id', xp);
      for (const k of ['lambda_um', 'flux_uJy', 'flux_err', 'snr']) num(xo, k, xp);
      oneOf(xo, 'arm', xp, ['short', 'long'] as const);
      numOrNull(xo, 'rel', xp);
      bool(xo, 'used', xp);
    });
  });
  return o as unknown as AreaSpectra;
}

// ---- Implementations ---------------------------------------------------------------------------

export interface SpectraApi {
  areaSpectra(areaId: string, signal?: AbortSignal): Promise<SpectraAnswer>;
}

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** The backend (#161). Throws only when the caller aborts. */
export function httpSpectraApi(
  base = API_BASE,
  fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init),
): SpectraApi {
  return {
    async areaSpectra(areaId, signal) {
      try {
        const res = await fetchImpl(`${base}/areas/${encodeURIComponent(areaId)}/spectra`, {
          headers: { Accept: 'application/json' },
          signal,
        });
        const type = res.headers.get('content-type') ?? '';
        const body: unknown = type.includes('json') ? await res.json().catch(() => null) : null;
        // 404 `spectra_not_prepared`; a backend from before #161 has no route at all (404 too): either
        // way the check was not run for this area.
        if (res.status === 404) return { kind: 'not_run' };
        if (!res.ok) return { kind: 'unavailable' };
        return { kind: 'ok', data: parseAreaSpectra(body) };
      } catch (e) {
        if (aborted(e) || signal?.aborted) throw e;
        if (import.meta.env?.DEV && e instanceof BadSpectra) console.warn('[spectra]', e.message);
        return { kind: 'unavailable' };
      }
    },
  };
}

/** The area the mock answers for: the recorded Eros area of the committed pack. */
export const MOCK_AREA_ID = 'eros-2026-03';

/** The mock (dev only): the mock-up's Eros values for `eros-2026-03`, `not_run` for any other area. */
export function mockSpectraApi(load: () => Promise<unknown> = () => import('./spectraMock.json').then((m) => m.default)): SpectraApi {
  return {
    async areaSpectra(areaId) {
      if (areaId !== MOCK_AREA_ID) return { kind: 'not_run' };
      try {
        return { kind: 'ok', data: parseAreaSpectra(await load()) };
      } catch {
        return { kind: 'unavailable' };
      }
    },
  };
}

/** The mock when the page URL asks for it (`?spectra=mock`), else null. Pure, for the tests. */
export function spectraMockFromUrl(search: string): SpectraApi | null {
  return new URLSearchParams(search).get('spectra') === 'mock' ? mockSpectraApi() : null;
}

let api: SpectraApi | null = null;
/** The spectra API in use: the opt-in mock (dev server only), else the backend. */
export function getSpectraApi(): SpectraApi {
  if (!api) {
    // The URL switch works on the dev server only: a public build never shows the mock's verdicts
    // because of a link, and drops the mock (and its JSON) from the bundle.
    const mock = import.meta.env.DEV && typeof location !== 'undefined' ? spectraMockFromUrl(location.search) : null;
    api = mock ?? httpSpectraApi();
  }
  return api;
}
/** Tests: put an implementation in place (null: choose again from the URL). */
export function setSpectraApi(next: SpectraApi | null): void {
  api = next;
}

/** `GET /v1/areas/{area_id}/spectra` through the API in use (issue #162's client method). */
export function areaSpectra(areaId: string, signal?: AbortSignal): Promise<SpectraAnswer> {
  return getSpectraApi().areaSpectra(areaId, signal);
}
