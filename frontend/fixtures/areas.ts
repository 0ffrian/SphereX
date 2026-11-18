// DEV/TEST FIXTURES ONLY. The Area search routes (A17.8; issue #92, Q-208), served from the
// synthetic replies that backend/scripts/area_fixtures.py writes into shared/fixtures/area/.
// The JSON is served as it is on disk (read per request, so a regenerated fixture shows up
// without a restart). handler.ts adds the `X-SX-Fixture: synthetic` headers.
//
// Synthetic stand-ins, not the real backend's output: every stamp is the same 15 x 15 image
// (a centred Gaussian), and `export.ecsv` is a header-only stub; the real writer is P7 (A17.7).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AreaDots, AreaError } from '../src/contract';
import { encodePngGray } from './png';

const AREA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'shared',
  'fixtures',
  'area',
);

/** Fixture area id -> its folder under shared/fixtures/area/ (the index lists both). */
export const FIXTURE_AREA_DIRS: Readonly<Record<string, string>> = {
  'fixture:area-main': AREA_DIR,
  'fixture:area-multivisit': join(AREA_DIR, 'multivisit'),
};

export const AREA_STAMP_SIZE = 15;

/** `/v1/areas`, `/v1/areas/{id}` and its sub-routes (spectra: #162); `m[3]` is the stamp's dot id. */
const AREA_PATH =
  /^\/v1\/areas(?:\/([^/]+)(?:\/(known|dots|tracks|checks|spectra|export\.ecsv|stamps\/([^/]+)\.png))?)?$/;

export interface AreaAnswer {
  status: number;
  contentType: string;
  body: string | Uint8Array;
}

/** The one synthetic stamp: a Gaussian (sigma 1.5 px) on a flat background. Same bytes always. */
export function renderAreaStamp(): Uint8Array {
  const n = AREA_STAMP_SIZE;
  const c = (n - 1) / 2;
  const px = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r2 = (x - c) ** 2 + (y - c) ** 2;
      px[y * n + x] = Math.round(20 + 210 * Math.exp(-r2 / (2 * 1.5 ** 2)));
    }
  }
  return encodePngGray(n, n, px);
}

function jsonFile(dir: string, name: string): AreaAnswer {
  return {
    status: 200,
    contentType: 'application/json',
    body: readFileSync(join(dir, name), 'utf8'),
  };
}

function areaError(status: number, error: AreaError['error'], detail: string): AreaAnswer {
  const body: AreaError = { error, detail };
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function stamp(dir: string, segment: string): AreaAnswer {
  const dotId = decode(segment);
  const dots = JSON.parse(readFileSync(join(dir, 'dots.json'), 'utf8')) as AreaDots;
  const known = dots.visits.some((v) => v.dots.some((d) => d.dot_id === dotId));
  if (dotId === null || !known) return areaError(404, 'dot_not_found', 'No such dot in this area.');
  if (dots.missing.includes(`stamp:${dotId}`)) {
    return areaError(
      503,
      'stamp_unavailable',
      'Synthetic fixture: the cutout for this dot is deliberately not cached.',
    );
  }
  return { status: 200, contentType: 'image/png', body: renderAreaStamp() };
}

/** Null when the path is not an Area search route (handler.ts then tries the others). */
export function areaReply(pathname: string): AreaAnswer | null {
  const m = AREA_PATH.exec(pathname);
  if (!m) return null;
  if (m[1] === undefined) return jsonFile(AREA_DIR, 'index.json');
  const areaId = decode(m[1]);
  const dir =
    areaId !== null && Object.hasOwn(FIXTURE_AREA_DIRS, areaId)
      ? FIXTURE_AREA_DIRS[areaId]
      : undefined;
  if (dir === undefined) {
    return areaError(404, 'area_not_found', 'No prepared area has this id.');
  }
  const what = m[2];
  if (what === undefined) return jsonFile(dir, 'summary.json');
  if (what === 'export.ecsv') {
    return {
      status: 200,
      // ASSUMPTION: ECSV is served as plain text, as the backend serves its other text files.
      contentType: 'text/plain; charset=utf-8',
      body: readFileSync(join(dir, 'export.ecsv'), 'utf8'),
    };
  }
  if (m[3] !== undefined) return stamp(dir, m[3]);
  // The spectrum check (A17.13, #161): only the main fixture area has one; the other answers as an
  // area stored without it.
  if (what === 'spectra' && !existsSync(join(dir, 'spectra.json'))) {
    const body = {
      error: 'spectra_not_prepared',
      detail: 'Synthetic fixture: no spectrum check stored for this area.',
    };
    return { status: 404, contentType: 'application/json', body: JSON.stringify(body) };
  }
  return jsonFile(dir, `${what}.json`);
}
