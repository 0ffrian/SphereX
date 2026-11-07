// DEV/TEST FIXTURES ONLY. Answers the M1 endpoints (D-16) and the M4 overlay endpoints (issue #12) from the synthetic generators, with the
// same shapes and error bodies as the real backend. Every reply carries `X-SX-Fixture: synthetic`
// so the UI labels the data as fixture data. Served by vitePlugin.ts under `vite --mode fixtures`.
import type { ApiErrorBody, CombineOp, ResolveResponse } from '../src/app/api/types';
import { combineInfo, makeOverlays, renderCombine, renderFlags } from './overlays';
import {
  FIXTURE_MARKER,
  fixtureFrameId,
  makeFrames,
  makeSpectrum,
  renderCutout,
} from './synthetic';
import { findTargetByCoords, findTargetById, findTargetByName } from './targets';

export interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

const BASE_HEADERS = {
  'x-sx-fixture': 'synthetic',
  'x-sx-fixture-generator': FIXTURE_MARKER,
  'cache-control': 'no-store',
};

function json(status: number, data: unknown): FixtureResponse {
  return {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function error(status: number, code: string, detail: string): FixtureResponse {
  const body: ApiErrorBody = { error: code, detail };
  return json(status, body);
}

const COORDS = /^\s*([+-]?\d+(?:\.\d*)?|[+-]?\.\d+)\s*,\s*([+-]?\d+(?:\.\d*)?|[+-]?\.\d+)\s*$/;

function resolve(q: string | null): FixtureResponse {
  if (q === null || q.trim() === '')
    return error(400, 'bad_query', 'Give a name or "ra,dec" in degrees.');
  const m = COORDS.exec(q);
  if (m) {
    const ra = Number(m[1]);
    const dec = Number(m[2]);
    if (!(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) {
      return error(400, 'bad_query', 'RA must be 0–360 and Dec −90–90 degrees.');
    }
    const t = findTargetByCoords(ra, dec);
    if (!t)
      return error(404, 'not_found', 'No fixture object within 1 arcmin of these coordinates.');
    const body: ResolveResponse = {
      id: t.id,
      name: null,
      ra: t.ra,
      dec: t.dec,
      moving: t.moving,
      resolver: 'coords',
      cached_at: null,
    };
    return json(200, body);
  }
  const t = findTargetByName(q);
  if (!t) return error(404, 'not_found', `No fixture object is called "${q}".`);
  const body: ResolveResponse = {
    id: t.id,
    name: t.name,
    ra: t.ra,
    dec: t.dec,
    moving: t.moving,
    resolver: t.moving ? 'sbdb' : 'simbad',
    cached_at: null,
  };
  return json(200, body);
}

const OBJECT_PATH =
  /^\/v1\/objects\/([^/]+)\/(frames|spectrum|overlays|combine\.png|(cutouts|flags)\/([^/]+)\.png)$/;

function png(body: Uint8Array, extra: Record<string, string> = {}): FixtureResponse {
  return { status: 200, headers: { ...BASE_HEADERS, 'content-type': 'image/png', ...extra }, body };
}

/** JSON for a response header: non-ASCII characters escaped, as HTTP headers need. */
function headerJson(data: unknown): string {
  return JSON.stringify(data).replace(
    /[\u007f-\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Returns null for paths outside `/v1/`, so the dev server handles them as usual. */
export function handleFixtureRequest(method: string, url: string): FixtureResponse | null {
  const u = new URL(url, 'http://fixtures.invalid');
  if (!u.pathname.startsWith('/v1/')) return null;
  if (method !== 'GET' && method !== 'HEAD') return error(405, 'method_not_allowed', 'Only GET.');

  if (u.pathname === '/v1/resolve') return resolve(u.searchParams.get('q'));

  const m = OBJECT_PATH.exec(u.pathname);
  if (!m) return error(404, 'not_found', 'No such endpoint.');
  const t = findTargetById(decodeURIComponent(m[1]!));
  if (!t) return error(404, 'not_found', 'Unknown object id.');

  if (m[2] === 'frames') return json(200, makeFrames(t));
  if (m[2] === 'spectrum') return json(200, makeSpectrum(t));
  if (m[2] === 'overlays') return json(200, makeOverlays(t));

  const indexOf = (frameId: string | null) =>
    frameId === null
      ? undefined
      : Array.from({ length: t.frameCount }, (_, k) => k).find(
          (k) => !t.refuseFrames && fixtureFrameId(t, k) === frameId,
        );

  if (m[2] === 'combine.png') {
    const op = u.searchParams.get('op');
    // Same statuses and codes as backend/app/api/overlays.py. Like the backend, a == b is
    // accepted (A - A is flat mid-grey); the UI is what keeps users from asking for it.
    if (op !== 'add' && op !== 'sub') return error(400, 'bad_request', 'op must be add or sub.');
    const a = indexOf(u.searchParams.get('a'));
    const b = indexOf(u.searchParams.get('b'));
    if (a === undefined || b === undefined) {
      return error(404, 'frame_not_found', 'Unknown frame id.');
    }
    if (t.brokenCutouts?.includes(a) || t.brokenCutouts?.includes(b)) {
      return error(
        503,
        'cutout_unavailable',
        'Synthetic fixture: a cutout is deliberately missing.',
      );
    }
    return png(renderCombine(t, op as CombineOp, a, b), {
      'x-sx-combine': headerJson(combineInfo(t, op as CombineOp, a, b)),
      'access-control-expose-headers': 'X-SX-Combine',
    });
  }

  const i = indexOf(decodeURIComponent(m[4]!));
  if (i === undefined) return error(404, 'not_found', 'Unknown frame id.');
  if (t.brokenCutouts?.includes(i)) {
    return error(404, 'cutout_missing', 'Synthetic fixture: this cutout is deliberately missing.');
  }
  return png(m[3] === 'flags' ? renderFlags(t, i) : renderCutout(t, i));
}
