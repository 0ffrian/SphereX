// DEV/TEST FIXTURES ONLY. Answers the M1 endpoints (D-16), the M4 overlay endpoints (issue #12),
// the prototype sky index and its synthetic all-sky image (sky.ts) and the colour composite
// (`/composite`, `/composite.png`), from the synthetic generators, with the
// same shapes and error bodies as the real backend. Every reply carries `X-SX-Fixture: synthetic`
// so the UI labels the data as fixture data. Served by vitePlugin.ts under `vite --mode fixtures`.
//
// Two stateful bits, both SYNTHETIC: a progressive target (`progressive` in targets.ts) answers
// `/frames` in parts, each later reply listing more frames, like a live backend with a small
// SX_LIVE_CUTOUTS_PER_REQUEST; a resolve of it starts again from the first part. The parts are
// counted per browser session (a cookie the resolve sets), so parallel e2e tests do not share
// them. And `/v1/sky/cached` lists the targets whose frames are "cached" (complete).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiErrorBody,
  CombineOp,
  ResolveResponse,
  SkyCachedObject,
  SkyCachedResponse,
} from '../src/app/api/types';
import { combineInfo, makeOverlays, renderCombine, renderFlags } from './overlays';
import {
  FIXTURE_DATA_RELEASE,
  FIXTURE_MARKER,
  fixtureFrameId,
  makeComposite,
  makeFrames,
  makeSpectrum,
  renderComposite,
  renderCutout,
} from './synthetic';
import { FIXTURE_SKY_WIDTHS, fixtureSkyPath, makeSkyIndex, renderFixtureSky } from './sky';
import {
  findTargetByCoords,
  findTargetById,
  findTargetByName,
  FIXTURE_TARGETS,
  type FixtureTarget,
} from './targets';

export interface FixtureResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
  /** Wait this long before answering (vitePlugin.ts), so a progressive load can be watched. */
  delayMs?: number;
}

/** Request headers the handler reads (lower-case names). */
export interface FixtureRequestHeaders {
  cookie?: string;
}

/** Each progressive `/frames` reply waits this long: UI pacing for the dev server and e2e. */
export const PROGRESSIVE_DELAY_MS = 1200;
const SESSION_COOKIE = 'sx_fixture_session';
const SESSION_RE = /(?:^|;\s*)sx_fixture_session=([A-Za-z0-9]+)/;
/** Parts served so far, by session and target id. Bounded: dev and test only. */
const progressiveStage = new Map<string, number>();
let sessions = 0;

function sessionOf(headers: FixtureRequestHeaders | undefined): string | null {
  const m = SESSION_RE.exec(headers?.cookie ?? '');
  return m ? m[1]! : null;
}

/**
 * Targets the fixture `/v1/sky/cached` lists: two A1.1 targets (the sky marks them once, as
 * targets) and the synthetic cached spot, which only the cached list marks.
 */
export const FIXTURE_CACHED_IDS: readonly string[] = [
  'eps-indi-b',
  'r-dra',
  'synthetic-cached-spot',
  'aqua-prime',
];

function makeSkyCached(): SkyCachedResponse {
  const objects = FIXTURE_CACHED_IDS.flatMap((id): SkyCachedObject[] => {
    const t = FIXTURE_TARGETS.find((x) => x.id === id);
    if (!t) return [];
    const coords = t.id === 'synthetic-cached-spot';
    const tag = coords
      ? {
          tag: 'derived' as const,
          formula: 'ra, dec = the coordinates typed in the query (user input, not an observation)',
        }
      : { tag: 'measured' as const, source: 'synthetic fixture position' };
    return [
      {
        id: t.id,
        name: coords ? null : t.name,
        query: coords ? null : t.name,
        ra: t.ra,
        dec: t.dec,
        resolver: coords ? 'coords' : 'simbad',
        frames: makeFrames(t).frames.length,
        provenance: { ra: tag, dec: tag },
      },
    ];
  });
  return { objects, data_release: FIXTURE_DATA_RELEASE };
}

function framesReply(t: FixtureTarget, session: string | null): FixtureResponse {
  if (!t.progressive) return json(200, makeFrames(t));
  const key = `${session ?? '-'}:${t.id}`;
  const stage = progressiveStage.get(key) ?? 0;
  progressiveStage.set(key, Math.min(stage + 1, t.progressive.length - 1));
  const listed = t.progressive[Math.min(stage, t.progressive.length - 1)];
  return { ...json(200, makeFrames(t, listed)), delayMs: PROGRESSIVE_DELAY_MS };
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

/** A resolve of a progressive target starts its parts again, and gives the browser a session. */
function withProgressReset(
  reply: FixtureResponse,
  t: FixtureTarget | undefined,
  session: string | null,
): FixtureResponse {
  if (!t?.progressive) return reply;
  const headers = { ...reply.headers };
  // A client without the cookie (unit tests, curl) shares one count; a browser gets its own.
  progressiveStage.delete(`${session ?? '-'}:${t.id}`);
  if (session === null) {
    sessions += 1;
    headers['set-cookie'] = `${SESSION_COOKIE}=s${sessions}; Path=/; SameSite=Lax`;
  }
  if (progressiveStage.size > 1000) progressiveStage.clear();
  return { ...reply, headers };
}

function resolve(q: string | null, session: string | null): FixtureResponse {
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
    return withProgressReset(resolveCoords(t), t, session);
  }
  const t = findTargetByName(q);
  if (!t) return error(404, 'not_found', `No fixture object is called "${q}".`);
  return withProgressReset(resolveName(t), t, session);
}

function resolveCoords(t: FixtureTarget): FixtureResponse {
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

function resolveName(t: FixtureTarget): FixtureResponse {
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
  /^\/v1\/objects\/([^/]+)\/(frames|spectrum|card|render-params|composite|composite\.png|overlays|combine\.png|(cutouts|flags)\/([^/]+)\.png)$/;

/**
 * Issue #60: `/card` and `/render-params` answer only for a target that names a shared 3D fixture
 * (`body` in targets.ts); the files are served as they are (shared/fixtures, D-18). Any other
 * target has no 3D model: 404, like a backend that has none.
 */
function bodyReply(t: FixtureTarget, what: 'cards' | 'params'): FixtureResponse {
  if (!t.body) return error(404, 'not_found', 'No 3D model for this object.');
  // A path, not `new URL(template, import.meta.url)`: Vite would turn that into an asset glob.
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'shared',
    'fixtures',
    what,
    `${t.body}.json`,
  );
  return json(200, JSON.parse(readFileSync(file, 'utf8')) as unknown);
}

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
export function handleFixtureRequest(
  method: string,
  url: string,
  headers?: FixtureRequestHeaders,
): FixtureResponse | null {
  const u = new URL(url, 'http://fixtures.invalid');
  const session = sessionOf(headers);
  if (!u.pathname.startsWith('/v1/')) return null;
  if (method !== 'GET' && method !== 'HEAD') return error(405, 'method_not_allowed', 'Only GET.');

  if (u.pathname === '/v1/resolve') return resolve(u.searchParams.get('q'), session);
  if (u.pathname === '/v1/sky/index.json') return json(200, makeSkyIndex());
  if (u.pathname === '/v1/sky/cached') return json(200, makeSkyCached());
  for (const w of FIXTURE_SKY_WIDTHS) {
    if (u.pathname === fixtureSkyPath(w)) {
      return {
        status: 200,
        headers: { ...BASE_HEADERS, 'content-type': 'image/png' },
        body: renderFixtureSky(w),
      };
    }
  }

  const m = OBJECT_PATH.exec(u.pathname);
  if (!m) return error(404, 'not_found', 'No such endpoint.');
  const t = findTargetById(decodeURIComponent(m[1]!));
  if (!t) return error(404, 'not_found', 'Unknown object id.');

  if (m[2] === 'frames') return framesReply(t, session);
  if (m[2] === 'card') return bodyReply(t, 'cards');
  if (m[2] === 'render-params') return bodyReply(t, 'params');
  if (m[2] === 'spectrum') return json(200, makeSpectrum(t));
  if (m[2] === 'composite') return json(200, makeComposite(t));
  if (m[2] === 'composite.png') {
    // `?v=` is ignored, like the backend's cache-busting parameter.
    if (makeComposite(t).image_url === null) {
      return error(404, 'not_found', 'No composite for this object.');
    }
    return {
      status: 200,
      headers: { ...BASE_HEADERS, 'content-type': 'image/png' },
      body: renderComposite(t),
    };
  }
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
