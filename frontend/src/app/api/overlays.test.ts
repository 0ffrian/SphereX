// Contract checks and client calls for the M4 overlay endpoints (issue #12).
import { describe, expect, it, vi } from 'vitest';
import { fixtureFetch } from '@/test/fixtureFetch';
import { createApiClient, revokeObjectUrl } from './client';
import { ApiError } from './errors';
import { parseCombineInfo, parseOverlays } from './validate';

// Contract-shaped test data. Values are test data only, not physical claims.
const overlayFrame = {
  frame_id: 'f1',
  flags_url: '/v1/objects/obj-1/flags/f1.png',
  markers: [{ catalog: 'gaia', id: 'g1', x: 10, y: 12.5 }],
  contamination: [{ catalog: 'gaia', id: 'g1', mag: 14.2, zone: 'aperture', sep_px: 1.8 }],
  footprint: [
    [10, 1],
    [11, 1],
    [11, 2],
    [10, 2],
  ],
  cutout_box: [
    [10.4, 1.4],
    [10.5, 1.4],
    [10.5, 1.5],
    [10.4, 1.5],
  ],
};

const overlays = {
  id: 'obj-1',
  data_release: 'spherex_qr2',
  cached_at: null,
  catalogs: [
    {
      catalog: 'gaia',
      available: true,
      table: 'gaiadr3.gaia_source',
      epoch: 'J2016.0',
      mag_band: 'G',
      mag_limit: 19,
      sources: [{ id: 'g1', ra: 10.45, dec: 1.45, mag: 14.2, pmra_mas_yr: 1, pmdec_mas_yr: null }],
    },
    {
      catalog: 'wise',
      available: false,
      table: 'allwise_p3as_psd',
      epoch: null,
      mag_band: 'W1',
      mag_limit: null,
      sources: [],
    },
  ],
  aperture: { radius_px: 2, annulus_inner_px: 4, annulus_outer_px: 8 },
  flag_groups: [{ group: 'saturation', rgba: [255, 0, 0, 160], names: ['SATURATED'] }],
  frames: [overlayFrame],
  missing: ['overlay:wise'],
  provenance: {
    catalog_positions: { tag: 'measured', source: 'Gaia DR3' },
    markers: { tag: 'derived', formula: 'WCS sky to pixel' },
    note: { tag: 'model_dependent', assumption: 'test' },
  },
};

const combine = {
  op: 'sub',
  a: 'f1',
  b: 'f0',
  wavelength_a_um: 1.5,
  wavelength_b_um: 1.2,
  unit: 'MJy/sr',
  stretch: { kind: 'linear', params: {} },
  tag: 'derived',
  formula: 'A - B',
};

const badResponse = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).kind).toBe('bad_response');
    return (e as ApiError).detail;
  }
  throw new Error('expected a bad_response error');
};

const withFrame = (patch: Record<string, unknown>) => ({
  ...overlays,
  frames: [{ ...overlayFrame, ...patch }],
});

describe('parseOverlays (issue #12 contract)', () => {
  it('accepts a valid reply and keeps nulls as nulls', () => {
    const parsed = parseOverlays({ ...overlays, extra: 1 });
    expect(parsed.catalogs[1]).toMatchObject({ available: false, epoch: null, mag_limit: null });
    expect(parsed.catalogs[0]!.sources[0]!.pmdec_mas_yr).toBeNull();
    expect(parsed.frames[0]!.markers[0]).toEqual({ catalog: 'gaia', id: 'g1', x: 10, y: 12.5 });
    expect(parsed.provenance.markers).toEqual({ tag: 'derived', formula: 'WCS sky to pixel' });
    expect('extra' in parsed).toBe(false);
  });

  it('accepts a null footprint', () => {
    expect(parseOverlays(withFrame({ footprint: null })).frames[0]!.footprint).toBeNull();
  });

  it.each(['id', 'catalogs', 'aperture', 'flag_groups', 'frames', 'missing', 'provenance'])(
    'refuses a reply without %s',
    (key) => {
      const copy: Record<string, unknown> = { ...overlays };
      delete copy[key];
      badResponse(() => parseOverlays(copy));
    },
  );

  it.each(['flags_url', 'markers', 'contamination', 'footprint', 'cutout_box'])(
    'refuses a frame without %s',
    (key) => {
      const copy: Record<string, unknown> = { ...overlayFrame };
      delete copy[key];
      badResponse(() => parseOverlays({ ...overlays, frames: [copy] }));
    },
  );

  it('refuses unknown catalogues, zones and flag groups', () => {
    badResponse(() =>
      parseOverlays({ ...overlays, catalogs: [{ ...overlays.catalogs[0], catalog: '2mass' }] }),
    );
    badResponse(() =>
      parseOverlays(withFrame({ markers: [{ catalog: 'sdss', id: 'x', x: 1, y: 1 }] })),
    );
    badResponse(() =>
      parseOverlays(
        withFrame({
          contamination: [{ catalog: 'gaia', id: 'g', mag: null, zone: 'halo', sep_px: 1 }],
        }),
      ),
    );
    badResponse(() =>
      parseOverlays({
        ...overlays,
        flag_groups: [{ group: 'cosmic', rgba: [0, 0, 0, 0], names: [] }],
      }),
    );
  });

  it('refuses a catalogue listed twice', () => {
    expect(
      badResponse(() =>
        parseOverlays({ ...overlays, catalogs: [overlays.catalogs[0], overlays.catalogs[0]] }),
      ),
    ).toMatch(/twice/);
  });

  it('refuses bad numbers, coordinates and colours', () => {
    badResponse(() =>
      parseOverlays(withFrame({ markers: [{ catalog: 'gaia', id: 'g', x: 'ten', y: 1 }] })),
    );
    badResponse(() =>
      parseOverlays(
        withFrame({
          contamination: [{ catalog: 'gaia', id: 'g', mag: 1, zone: 'aperture', sep_px: -1 }],
        }),
      ),
    );
    badResponse(() =>
      parseOverlays(withFrame({ cutout_box: overlayFrame.cutout_box.slice(0, 3) })),
    );
    badResponse(() =>
      parseOverlays(
        withFrame({
          footprint: [
            [400, 0],
            [1, 1],
            [2, 2],
          ],
        }),
      ),
    );
    badResponse(() => parseOverlays(withFrame({ footprint: [[1, 1]] })));
    badResponse(() =>
      parseOverlays({
        ...overlays,
        flag_groups: [{ group: 'saturation', rgba: [256, 0, 0, 1], names: [] }],
      }),
    );
    badResponse(() =>
      parseOverlays({ ...overlays, aperture: { ...overlays.aperture, radius_px: -1 } }),
    );
  });

  it('requires nullable fields to be present (null, not left out)', () => {
    const cat: Record<string, unknown> = { ...overlays.catalogs[0] };
    delete cat.epoch;
    badResponse(() => parseOverlays({ ...overlays, catalogs: [cat] }));
  });

  it('refuses provenance that breaks R3.1', () => {
    badResponse(() => parseOverlays({ ...overlays, provenance: { markers: { tag: 'guess' } } }));
    expect(
      badResponse(() =>
        parseOverlays({ ...overlays, provenance: { markers: { tag: 'derived' } } }),
      ),
    ).toMatch(/formula/);
    badResponse(() =>
      parseOverlays({ ...overlays, provenance: { m: { tag: 'model_dependent', formula: 'x' } } }),
    );
  });
});

describe('parseCombineInfo (X-SX-Combine header)', () => {
  it('reads a valid header', () => {
    expect(parseCombineInfo(JSON.stringify(combine))).toEqual(combine);
  });

  it('refuses a missing, non-JSON or wrong header', () => {
    badResponse(() => parseCombineInfo(null));
    badResponse(() => parseCombineInfo('{op: sub'));
    badResponse(() => parseCombineInfo(JSON.stringify({ ...combine, tag: 'measured' })));
    badResponse(() => parseCombineInfo(JSON.stringify({ ...combine, op: 'mul' })));
    badResponse(() => parseCombineInfo(JSON.stringify({ ...combine, formula: ' ' })));
    badResponse(() => parseCombineInfo(JSON.stringify({ ...combine, wavelength_b_um: null })));
  });
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const pngResponse = (headers: Record<string, string>) =>
  new Response(png, { status: 200, headers: { 'content-type': 'image/png', ...headers } });

describe('overlay client calls', () => {
  it('fetches and validates the fixture overlays', async () => {
    const api = createApiClient({ fetchImpl: fixtureFetch });
    const r = await api.getOverlays('rw-aur');
    expect(r.fixture).toBe('synthetic');
    expect(r.data.catalogs.map((c) => c.catalog)).toEqual(['gaia', 'wise']);
    expect(r.data.frames).toHaveLength(24);
  });

  it('fetches combine.png as an object URL with its validated header', async () => {
    const calls: string[] = [];
    const created: Blob[] = [];
    const api = createApiClient({
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return pngResponse({ 'x-sx-combine': JSON.stringify(combine) });
      }) as typeof fetch,
      createObjectUrl: (blob) => {
        created.push(blob);
        return 'blob:test/1';
      },
    });
    const r = await api.getCombine('obj 1', 'sub', 'f1', 'f0');
    expect(calls[0]).toBe('/v1/objects/obj%201/combine.png?op=sub&a=f1&b=f0');
    expect(r.data.objectUrl).toBe('blob:test/1');
    expect(r.data.info.wavelength_a_um).toBe(1.5);
    expect(created).toHaveLength(1);
  });

  it('refuses a combine reply whose header is missing or names other frames', async () => {
    const createObjectUrl = vi.fn(() => 'blob:x');
    const make = (headers: Record<string, string>) =>
      createApiClient({
        fetchImpl: (async () => pngResponse(headers)) as typeof fetch,
        createObjectUrl,
      });
    const e1 = (await make({})
      .getCombine('o', 'sub', 'f1', 'f0')
      .catch((e: unknown) => e)) as ApiError;
    expect(e1.kind).toBe('bad_response');
    const e2 = (await make({ 'x-sx-combine': JSON.stringify(combine) })
      .getCombine('o', 'add', 'f1', 'f0')
      .catch((e: unknown) => e)) as ApiError;
    expect(e2.kind).toBe('bad_response');
    // No object URL is made for a refused reply.
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('maps combine errors like the other endpoints', async () => {
    const api = createApiClient({
      fetchImpl: (async () =>
        // A real backend refusal (combine.CombineError -> 400 bad_request).
        new Response(JSON.stringify({ error: 'bad_request', detail: 'Units differ.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });
    const err = (await api.getCombine('o', 'add', 'f1', 'f2').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('bad_request');
    expect(err.code).toBe('bad_request');
    expect(err.detail).toBe('Units differ.');
  });

  it('serves the fixture combine image with its header', async () => {
    const api = createApiClient({ fetchImpl: fixtureFetch, createObjectUrl: () => 'blob:f' });
    const r = await api.getCombine('rw-aur', 'add', 'rw-aur-f003', 'rw-aur-f002');
    expect(r.fixture).toBe('synthetic');
    expect(r.data.info).toMatchObject({ op: 'add', a: 'rw-aur-f003', b: 'rw-aur-f002' });
  });

  it('revokes only blob URLs', () => {
    const revoke = vi.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      revokeObjectUrl('blob:abc');
      revokeObjectUrl('/v1/x.png');
      revokeObjectUrl(null);
    } finally {
      URL.revokeObjectURL = original;
    }
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });
});
