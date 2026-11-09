// Sky index (prototype) checks: the provenance rule (derived needs a formula), sizes, optional
// HiPS, and the fixture index passing the same checks.
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest } from '../../../fixtures/handler';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { parseSkyIndex } from './validate';

const survey = {
  id: '2mass_color',
  title: '2MASS colour',
  credit: 'Test credit',
  tag: 'derived',
  formula: 'test formula',
  frame: 'icrs',
  convention: 'test',
  equirect: [{ url: '/v1/sky/a.jpg', width: 4096, height: 2048 }],
  hips: { url: '/v1/sky/2mass_color/hips', max_order_local: 4, tile_width: 512, format: 'jpeg' },
};

describe('parseSkyIndex', () => {
  it('accepts the brief shape', () => {
    const r = parseSkyIndex({ surveys: [survey] });
    expect(r.surveys[0]?.tag).toBe('derived');
    expect(r.surveys[0]?.hips?.max_order_local).toBe(4);
    expect(r.surveys[0]?.assumption).toBeNull();
  });

  it('accepts an empty list (no sky image installed)', () => {
    expect(parseSkyIndex({ surveys: [] }).surveys).toEqual([]);
  });

  it('refuses a derived image without a formula (R3.1)', () => {
    expect(() => parseSkyIndex({ surveys: [{ ...survey, formula: null }] })).toThrow(ApiError);
    expect(() => parseSkyIndex({ surveys: [{ ...survey, formula: undefined }] })).toThrow(ApiError);
  });

  it('refuses an unknown tag and bad sizes', () => {
    expect(() => parseSkyIndex({ surveys: [{ ...survey, tag: 'made_up' }] })).toThrow(ApiError);
    expect(() =>
      parseSkyIndex({ surveys: [{ ...survey, equirect: [{ url: '/x', width: 0, height: 0 }] }] }),
    ).toThrow(ApiError);
  });

  it('treats a missing hips block as none', () => {
    const { hips: _hips, ...rest } = survey;
    void _hips;
    expect(parseSkyIndex({ surveys: [rest] }).surveys[0]?.hips).toBeNull();
  });
});

describe('fixture sky', () => {
  it('the fixture index is valid and marked synthetic', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const r = handleFixtureRequest('GET', url)!;
      return new Response(r.body as BodyInit, { status: r.status, headers: r.headers });
    }) as typeof fetch;
    const api = createApiClient({ fetchImpl });
    const res = await api.skyIndex();
    expect(res.fixture).toBe('synthetic');
    const s = res.data.surveys[0]!;
    expect(s.title).toMatch(/Synthetic/);
    expect(s.equirect.map((e) => [e.width, e.height])).toEqual([
      [512, 256],
      [1024, 512],
    ]);
  });

  it('serves each listed image as a PNG of the stated size, deterministically', () => {
    const index = JSON.parse(handleFixtureRequest('GET', '/v1/sky/index.json')!.body as string) as {
      surveys: { equirect: { url: string; width: number; height: number }[] }[];
    };
    for (const e of index.surveys[0]!.equirect) {
      const a = handleFixtureRequest('GET', e.url)!;
      expect(a.status).toBe(200);
      expect(a.headers['content-type']).toBe('image/png');
      const png = a.body as Uint8Array;
      const view = new DataView(png.buffer, png.byteOffset);
      expect(view.getUint32(16)).toBe(e.width);
      expect(view.getUint32(20)).toBe(e.height);
      expect(png[25]).toBe(2); // RGB
      const b = handleFixtureRequest('GET', e.url)!.body as Uint8Array;
      expect(Buffer.from(b).equals(Buffer.from(png))).toBe(true);
    }
  });
});
