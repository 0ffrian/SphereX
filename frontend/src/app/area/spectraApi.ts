// The spectrum check of a stored area (A17.13, A18.7, Q-474; issue #162): `GET /v1/areas/{id}/spectra`
// (#161, `shared/schemas/area-spectra.schema.json`) behind ONE module, typed by the generated
// contract (D-18).
//
// Answers: the reply (checked below for every field the UI reads), `not_run` for 404
// `spectra_not_prepared` (the UI lists "Spectrum check not run" under Not shown), and `unavailable`
// for anything else (no backend, another error, a reply that breaks the contract): no verdict is
// drawn and `spectra:unavailable` goes to `missing`. Nothing is ever made up: the demo path never
// asks (Q-414), and there is no mock.
import { API_BASE } from '@/app/api/config';
import type {
  AreaSpectra,
  AreaSpectraCalibration,
  AreaSpectraPair,
  AreaSpectraPoint,
  AreaSpectraStep,
  AreaSpectraTrack,
  AreaSpectraVerdict,
} from '@/contract';

export type { AreaSpectra };
export type SpectrumVerdict = AreaSpectraVerdict;
export type TrackSpectrum = AreaSpectraTrack;
export type SpectrumPair = AreaSpectraPair;
export type SpectrumStep = AreaSpectraStep;
export type SpectrumPoint = AreaSpectraPoint;
export type SpectrumCalibration = AreaSpectraCalibration;

export const SPECTRUM_VERDICTS: readonly SpectrumVerdict[] = [
  'rock',
  'very_red',
  'too_red',
  'too_blue',
  'flickers',
  'too_faint',
  'one_colour',
];

export type SpectraAnswer =
  | { kind: 'ok'; data: AreaSpectra }
  /** 404 `spectra_not_prepared`: the area has no stored check. */
  | { kind: 'not_run' }
  /** No backend, another error, or a reply that does not match the contract. */
  | { kind: 'unavailable' };

/** The `missing` codes the answers add (worded by realArea.missingText). */
export const SPECTRA_NOT_RUN = 'spectra:not_run';
export const SPECTRA_UNAVAILABLE = 'spectra:unavailable';

// ---- Reply check (every field the UI reads; the backend checks the whole reply) ----------------

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
const num = (o: Obj, k: string, p: string): void => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadSpectra(`${p}.${k}`, 'expected a number');
};
const numOrNull = (o: Obj, k: string, p: string): void => {
  if (o[k] !== null) num(o, k, p);
};
const str = (o: Obj, k: string, p: string): void => {
  if (typeof o[k] !== 'string') throw new BadSpectra(`${p}.${k}`, 'expected a string');
};
const oneOf = (o: Obj, k: string, p: string, allowed: readonly string[]): void => {
  const v = o[k];
  if (typeof v !== 'string' || !allowed.includes(v)) throw new BadSpectra(`${p}.${k}`, `expected one of ${allowed.join(', ')}`);
};
const bool = (o: Obj, k: string, p: string): void => {
  if (typeof o[k] !== 'boolean') throw new BadSpectra(`${p}.${k}`, 'expected true or false');
};

/** Checks a `/spectra` reply; throws on the first field the UI reads that does not match. */
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
  obj(m.formulas, `${p}.method.formulas`);
  arr(o, 'calibration', p).forEach((c, i) => {
    const cp = `${p}.calibration[${i}]`;
    const co = obj(c, cp);
    for (const k of ['visit', 'detector', 'sigma_sys', 'n_pairs']) num(co, k, cp);
    oneOf(co, 'source', cp, ['stars', 'default']);
  });
  arr(o, 'tracks', p).forEach((t, i) => {
    const tp = `${p}.tracks[${i}]`;
    const to = obj(t, tp);
    str(to, 'track_id', tp);
    oneOf(to, 'verdict', tp, SPECTRUM_VERDICTS);
    if (to.heat_glow !== null) bool(to, 'heat_glow', tp);
    num(to, 'r_au', tp);
    oneOf(to, 'r_source', tp, ['parallax', 'worst_case']);
    arr(to, 'pairs', tp).forEach((x, j) => {
      const xp = `${tp}.pairs[${j}]`;
      const xo = obj(x, xp);
      for (const k of ['visit', 'exposure', 'lambda_short_um', 'lambda_long_um', 'rho', 'rho_max']) num(xo, k, xp);
      numOrNull(xo, 'rho_err', xp);
      str(xo, 'time', xp);
      if (xo.limit !== null) oneOf(xo, 'limit', xp, ['lower', 'upper']);
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
      str(xo, 'time', xp);
      for (const k of ['visit', 'detector', 'lambda_um', 'flux_uJy', 'flux_err', 'snr']) num(xo, k, xp);
      oneOf(xo, 'arm', xp, ['short', 'long']);
      numOrNull(xo, 'rel', xp);
      bool(xo, 'point', xp);
      bool(xo, 'used', xp);
    });
  });
  return o as unknown as AreaSpectra;
}

// ---- Client ------------------------------------------------------------------------------------

export interface SpectraApi {
  areaSpectra(areaId: string, signal?: AbortSignal): Promise<SpectraAnswer>;
}

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** The backend. Throws only when the caller aborts. */
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
        if (res.status === 404 && isObj(body) && body.error === 'spectra_not_prepared') return { kind: 'not_run' };
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

let api: SpectraApi | null = null;
/** The spectra API in use. */
export function getSpectraApi(): SpectraApi {
  api ??= httpSpectraApi();
  return api;
}
/** Tests: put an implementation in place (null: the backend again). */
export function setSpectraApi(next: SpectraApi | null): void {
  api = next;
}

/** `GET /v1/areas/{area_id}/spectra` (issue #162's client method). */
export function areaSpectra(areaId: string, signal?: AbortSignal): Promise<SpectraAnswer> {
  return getSpectraApi().areaSpectra(areaId, signal);
}
