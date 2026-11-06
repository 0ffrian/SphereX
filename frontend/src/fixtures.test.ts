// The dev/test fixtures: deterministic, valid against the client's contract checks, clearly
// synthetic, and never imported by app code (so they cannot reach a build).
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest } from '../fixtures/handler';
import { crc32, PNG_SIGNATURE } from '../fixtures/png';
import {
  CUTOUT_SIZE,
  FIXTURE_DATA_RELEASE,
  makeFrames,
  makeSpectrum,
  renderCutout,
} from '../fixtures/synthetic';
import { FIXTURE_TARGETS, findTargetByCoords, findTargetByName } from '../fixtures/targets';
import { parseFrames, parseResolve, parseSpectrum } from './app/api/validate';

const json = (url: string) => {
  const r = handleFixtureRequest('GET', url)!;
  return { status: r.status, headers: r.headers, data: JSON.parse(r.body as string) as unknown };
};

const A1_1_TARGETS = [
  "Barnard's Star",
  'Epsilon Indi B',
  'WISE 0855-0714',
  'RW Aurigae',
  'R Draconis',
];

describe('synthetic fixtures', () => {
  it.each(A1_1_TARGETS)('%s resolves and has valid frames and spectrum', (name) => {
    const r = json(`/v1/resolve?q=${encodeURIComponent(name)}`);
    expect(r.status).toBe(200);
    expect(r.headers['x-sx-fixture']).toBe('synthetic');
    const resolved = parseResolve(r.data);
    const frames = parseFrames(json(`/v1/objects/${resolved.id}/frames`).data);
    const spectrum = parseSpectrum(json(`/v1/objects/${resolved.id}/spectrum`).data);
    expect(frames.frames.length).toBeGreaterThan(1);
    expect(frames.data_release).toBe(FIXTURE_DATA_RELEASE);
    expect(frames.north_up).toBe(false);
    expect(spectrum.flux_unit).toMatch(/synthetic/);
    // Like the backend (A4.2): every listed frame is either a point or a `<reason>:<id>` refusal.
    const points = new Set(spectrum.spectrum.map((p) => p.frame_id));
    for (const f of frames.frames) {
      const refusals = spectrum.missing.filter((m) => m.endsWith(`:${f.frame_id}`));
      expect(Number(points.has(f.frame_id)) + refusals.length, f.frame_id).toBe(1);
    }
    // Stage 1's own refusals are passed through.
    for (const m of frames.missing) expect(spectrum.missing).toContain(m);
    expect(spectrum.light_curve.map((p) => p.frame_id)).toEqual(
      spectrum.spectrum.map((p) => p.frame_id),
    );
    for (const f of frames.frames) expect(f.time.endsWith('Z')).toBe(true);
  });

  // Shapes mirror the 6 Nov full-cache run against the real backend (numbers are synthetic).
  it.each([
    ['barnards-star', 0, 0, { saturated: 23, aperture_flags: 1 }],
    ['eps-indi-b', 22, 3, { aperture_flags: 2 }],
    ['wise-0855', 22, 3, { aperture_flags: 2 }],
    ['rw-aur', 4, 0, { saturated: 18, aperture_flags: 1, aperture_edge: 1 }],
    ['r-dra', 0, 0, { saturated: 21, aperture_edge: 2, cutout: 1, outside_cutout: 1 }],
  ] as const)('%s spectrum: %i points, %i flagged, refusals %o', (id, n, flagged, refusals) => {
    const spectrum = parseSpectrum(json(`/v1/objects/${id}/spectrum`).data);
    expect(spectrum.spectrum).toHaveLength(n);
    expect(spectrum.spectrum.filter((p) => p.flagged)).toHaveLength(flagged);
    const counts: Record<string, number> = {};
    for (const m of spectrum.missing) {
      const reason = m.slice(0, m.indexOf(':'));
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
    expect(counts).toEqual(refusals);
    // Not every listed frame is saturated in any of them, so no `spectrum:saturated`.
    expect(spectrum.missing).not.toContain('spectrum:saturated');
  });

  it('R Draconis frames list a Stage 1 refusal of an unlisted frame', () => {
    const frames = parseFrames(json('/v1/objects/r-dra/frames').data);
    expect(frames.frames).toHaveLength(24);
    expect(frames.missing).toEqual(['cutout:r-dra-f005', 'outside_cutout:r-dra-f024']);
  });

  it('RW Aurigae keeps only short-wavelength points', () => {
    const spectrum = parseSpectrum(json('/v1/objects/rw-aur/spectrum').data);
    expect(Math.max(...spectrum.spectrum.map((p) => p.wavelength_um))).toBeLessThan(1.5);
  });

  it('adds spectrum:saturated exactly when every listed frame is saturated (backend rule)', () => {
    const base = FIXTURE_TARGETS.find((t) => t.id === 'barnards-star')!;
    const allSat = makeSpectrum({ ...base, id: 'all-saturated', spectrumShape: { measured: [] } });
    expect(allSat.spectrum).toEqual([]);
    expect(allSat.light_curve).toEqual([]);
    expect(allSat.missing).toContain('spectrum:saturated');
    expect(allSat.missing.filter((m) => m.startsWith('saturated:'))).toHaveLength(24);
  });

  it('the mover is on a north-up grid with per-frame positions', () => {
    const frames = parseFrames(json('/v1/objects/synthetic-mover/frames').data);
    expect(frames.north_up).toBe(true);
    expect(frames.frames.every((f) => f.ra !== undefined && f.dec !== undefined)).toBe(true);
  });

  it('the refused mover has no frames and says why', () => {
    const frames = parseFrames(json('/v1/objects/synthetic-refused-mover/frames').data);
    expect(frames.frames).toEqual([]);
    expect(frames.missing).toEqual(['frames:moving_object_search']);
  });

  it('is deterministic: same target, same bytes', () => {
    for (const t of FIXTURE_TARGETS) {
      expect(JSON.stringify(makeFrames(t))).toBe(JSON.stringify(makeFrames(t)));
      expect(JSON.stringify(makeSpectrum(t))).toBe(JSON.stringify(makeSpectrum(t)));
      if (t.frameCount > 0) expect(renderCutout(t, 0)).toEqual(renderCutout(t, 0));
    }
  });

  it('serves well-formed PNG cutouts', () => {
    const r = handleFixtureRequest('GET', '/v1/objects/rw-aur/cutouts/rw-aur-f000.png')!;
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    const png = r.body as Uint8Array;
    expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // IHDR: length 13, then width and height.
    expect(view.getUint32(8)).toBe(13);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(CUTOUT_SIZE);
    expect(view.getUint32(20)).toBe(CUTOUT_SIZE);
    // Every chunk's CRC is right.
    let pos = 8;
    const types: string[] = [];
    while (pos < png.length) {
      const len = view.getUint32(pos);
      const typeAndData = png.subarray(pos + 4, pos + 8 + len);
      types.push(String.fromCharCode(...typeAndData.subarray(0, 4)));
      expect(view.getUint32(pos + 8 + len)).toBe(crc32(typeAndData));
      pos += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('answers unknown names, ids, frames and broken cutouts with JSON errors', () => {
    expect(json('/v1/resolve?q=Nowhere').status).toBe(404);
    expect(json('/v1/resolve?q=Nowhere').data).toMatchObject({ error: 'not_found' });
    expect(json('/v1/resolve?q=').status).toBe(400);
    expect(json('/v1/objects/nope/frames').status).toBe(404);
    expect(json('/v1/objects/rw-aur/cutouts/nope.png').status).toBe(404);
    expect(json('/v1/objects/r-dra/cutouts/r-dra-f005.png').status).toBe(404);
    expect(handleFixtureRequest('GET', '/src/main.tsx')).toBeNull();
  });

  it('matches names loosely and coordinates within 1 arcmin', () => {
    expect(findTargetByName('barnards star')?.id).toBe('barnards-star');
    expect(findTargetByName('R-DRA')?.id).toBe('r-dra');
    const t = findTargetByName('WISE 0855')!;
    expect(findTargetByCoords(t.ra + 0.005, t.dec)?.id).toBe(t.id);
    expect(findTargetByCoords(t.ra + 0.5, t.dec)).toBeUndefined();
    const r = json(`/v1/resolve?q=${t.ra},${t.dec}`);
    expect(parseResolve(r.data)).toMatchObject({ id: t.id, name: null, resolver: 'coords' });
  });
});

/** Every module specifier in a source text: `from 'x'`, `import 'x'`, `import('x')`. */
function importSpecifiers(text: string): string[] {
  const re = /\b(?:from|import)\s*\(?\s*(['"])([^'"\n]+)\1/g;
  return [...text.matchAll(re)].map((m) => m[2]!);
}

/** Specifiers app code must not use: the fixtures folder and the test-only helpers in src/test/. */
function isForbiddenImport(spec: string): boolean {
  return (
    /(^|\/)fixtures(\/|$)/.test(spec) ||
    /^@\/test(\/|$)/.test(spec) ||
    /^(\.{1,2}\/)+(.*\/)?test(\/|$)/.test(spec)
  );
}

describe('import guard', () => {
  // Review finding 7: side-effect imports and @/test/ imports were missed.
  it.each([
    ["import { x } from '../fixtures/handler';", true],
    ["import '../fixtures/vitePlugin';", true],
    ['import "../../fixtures/png";', true],
    ["const m = await import('../fixtures/synthetic');", true],
    ["import { fixtureFetch } from '@/test/fixtureFetch';", true],
    ["import '@/test/fixtureFetch';", true],
    ["import { y } from './test/fixtureFetch';", true],
    ["export * from '../fixtures/targets';", true],
    ["import { useAppStore } from '@/state/store';", false],
    ["import type { Frame } from '@/app/api/types';", false],
    ["import { TEST_TARGETS } from './testTargets';", false],
    ["import './index.css';", false],
  ])('%s → forbidden: %s', (text, forbidden) => {
    expect(importSpecifiers(text).some(isForbiddenImport)).toBe(forbidden);
  });
});

describe('fixtures stay out of the app', () => {
  const sources = import.meta.glob<string>(
    ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./test/**'],
    { query: '?raw', import: 'default', eager: true },
  );

  it('found the app sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('no app module imports fixtures/ or the test helpers', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => importSpecifiers(text).some(isForbiddenImport))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
