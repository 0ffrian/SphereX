// The Area search routes of the dev fixture server (A17.8; issue #92): every route answers with
// the Fixture header, the JSON validates against its schema, and the error bodies are the ones
// A17.8 names.
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest } from '../fixtures/handler';
import { AREA_STAMP_SIZE, renderAreaStamp } from '../fixtures/areas';
import { PNG_SIGNATURE } from '../fixtures/png';
import type { AreaDots } from '@/contract';

const schemas = Object.values(
  import.meta.glob<{ $id: string }>('../../shared/schemas/*.schema.json', {
    eager: true,
    import: 'default',
  }),
);
const ajv = new Ajv({ allErrors: true, strict: true });
for (const schema of schemas) ajv.addSchema(schema);
const errorSchema = ajv.getSchema('area-index.schema.json#/definitions/AreaError')!;

const MAIN = '/v1/areas/fixture:area-main';
const MULTI = '/v1/areas/fixture:area-multivisit';

const get = (url: string, method = 'GET') => handleFixtureRequest(method, url)!;
const body = (url: string) => JSON.parse(get(url).body as string) as unknown;

function expectFixtureHeaders(headers: Record<string, string>, contentType: string) {
  expect(headers['x-sx-fixture']).toBe('synthetic');
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['content-type']).toBe(contentType);
}

function dotIds(area: string): { ok: string; unavailable: string } {
  const dots = body(`${area}/dots`) as AreaDots;
  const unavailable = dots.missing.find((m) => m.startsWith('stamp:'))?.slice('stamp:'.length);
  const ok = dots.visits[0]!.dots.find((d) => d.dot_id !== unavailable)!.dot_id;
  return { ok, unavailable: unavailable ?? '' };
}

describe('Area search fixture routes (A17.8)', () => {
  it.each([
    ['/v1/areas', 'area-index'],
    [MAIN, 'area-summary'],
    [`${MAIN}/known`, 'area-known'],
    [`${MAIN}/dots`, 'area-dots'],
    [`${MAIN}/tracks`, 'area-tracks'],
    [`${MAIN}/checks`, 'area-checks'],
    [MULTI, 'area-summary'],
    [`${MULTI}/tracks`, 'area-tracks'],
    [`${MULTI}/checks`, 'area-checks'],
  ])('%s answers a valid %s reply', (url, schema) => {
    const r = get(url);
    expect(r.status).toBe(200);
    expectFixtureHeaders(r.headers, 'application/json');
    const validate = ajv.getSchema(`${schema}.schema.json`)!;
    expect(validate(JSON.parse(r.body as string)), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('accepts a percent-encoded area id and HEAD', () => {
    expect(get('/v1/areas/fixture%3Aarea-main/known').status).toBe(200);
    expect(get(`${MAIN}/tracks`, 'HEAD').status).toBe(200);
  });

  it('answers checks:not_run for the multivisit area', () => {
    expect((body(`${MULTI}/checks`) as { missing: string[] }).missing).toEqual(['checks:not_run']);
  });

  it('serves the header-only ECSV stub', () => {
    const r = get(`${MAIN}/export.ecsv`);
    expect(r.status).toBe(200);
    expectFixtureHeaders(r.headers, 'text/plain; charset=utf-8');
    expect(r.body as string).toMatch(/^# %ECSV 1\.0\n/);
    expect(r.body as string).toContain('synthetic fixture');
  });

  it('serves one fixed 15 x 15 stamp for every dot with a cached cutout', () => {
    const { ok } = dotIds(MAIN);
    const r = get(`${MAIN}/stamps/${encodeURIComponent(ok)}.png`);
    expect(r.status).toBe(200);
    expectFixtureHeaders(r.headers, 'image/png');
    const png = r.body as Uint8Array;
    expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([AREA_STAMP_SIZE, AREA_STAMP_SIZE]);
    expect(png).toEqual(renderAreaStamp());
    expect(get(`${MAIN}/stamps/${ok}.png`).body).toEqual(png);
  });

  it.each([
    ['/v1/areas/fixture:nowhere', 404, 'area_not_found'],
    ['/v1/areas/fixture:nowhere/dots', 404, 'area_not_found'],
    ['/v1/areas/toString/known', 404, 'area_not_found'],
    ['/v1/areas/%E0%A4%A/tracks', 404, 'area_not_found'],
    ['/v1/areas/fixture:nowhere/stamps/x:1.png', 404, 'area_not_found'],
    [`${MAIN}/stamps/fixture-nope:1.png`, 404, 'dot_not_found'],
  ])('%s -> %i %s', (url, status, code) => {
    const r = get(url);
    expect(r.status).toBe(status);
    expectFixtureHeaders(r.headers, 'application/json');
    const data = JSON.parse(r.body as string) as unknown;
    expect(errorSchema(data), ajv.errorsText(errorSchema.errors)).toBe(true);
    expect((data as { error: string }).error).toBe(code);
  });

  it('answers 503 stamp_unavailable for a dot listed as stamp:<dot_id>', () => {
    const { unavailable } = dotIds(MAIN);
    expect(unavailable).not.toBe('');
    const r = get(`${MAIN}/stamps/${encodeURIComponent(unavailable)}.png`);
    expect(r.status).toBe(503);
    const data = JSON.parse(r.body as string) as unknown;
    expect(errorSchema(data)).toBe(true);
    expect((data as { error: string }).error).toBe('stamp_unavailable');
  });

  it('leaves other paths to the existing routes', () => {
    expect(get('/v1/areas/').status).toBe(404);
    expect(get(`${MAIN}/frames`).status).toBe(404);
    expect(get(`${MAIN}/known`, 'POST').status).toBe(405);
  });
});
