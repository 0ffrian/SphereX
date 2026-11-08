// The colour composite reply (not in D-16, types.ts): parsing, the refusals, and the wording of
// its `missing` codes and errors.
import { describe, expect, it } from 'vitest';
import { fixtureFetch } from '@/test/fixtureFetch';
import { compositeAnnouncement, compositeErrorMessage, describeRefusalGroup } from '@/app/messages';
import { groupCompositeMissing } from '@/app/refusals';
import type { SkyError } from '@/state/store';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { parseComposite } from './validate';

// Test data only, not physical claims.
const band = (channel: string, wavelength_um: number) => ({
  channel,
  frame_id: `f-${channel}`,
  wavelength_um,
  time: '2025-05-03T01:00:00Z',
});

const good = () => ({
  id: 'obj',
  data_release: 'test',
  image_url: '/v1/objects/obj/composite.png?v=abc',
  width: 64,
  height: 48,
  scale_arcsec_px: 6.15,
  north_up: true,
  x: 31,
  y: 20,
  bands: [band('blue', 1.0), band('green', 2.0), { ...band('red', 4.0), bandwidth_um: 0.05 }],
  tag: 'derived',
  formula: 'false colour: B, G, R = frames at 1, 2, 4 µm',
  missing: [],
  cached_at: null,
});

const refused = () => ({
  id: 'obj',
  data_release: 'test',
  image_url: null,
  width: null,
  height: null,
  scale_arcsec_px: null,
  north_up: true,
  x: null,
  y: null,
  bands: [],
  tag: 'derived',
  formula: 'false colour: not drawn (see missing)',
  missing: ['composite:too_few_bands'],
  cached_at: null,
});

const refuses = (raw: unknown, what: RegExp) => {
  try {
    parseComposite(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).kind).toBe('bad_response');
    expect((e as ApiError).detail).toMatch(what);
    return;
  }
  throw new Error('expected the composite to be refused');
};

describe('parseComposite', () => {
  it('reads a complete composite and ignores unknown extras', () => {
    const c = parseComposite({ ...good(), ra: 1, dec: 2, epoch: '2025-05-03T00:00:00Z' });
    expect(c.image_url).toBe('/v1/objects/obj/composite.png?v=abc');
    expect([c.width, c.height, c.x, c.y]).toEqual([64, 48, 31, 20]);
    expect(c.bands.map((b) => b.channel)).toEqual(['blue', 'green', 'red']);
    expect(c.bands[2]!.bandwidth_um).toBe(0.05);
    expect(c.bands[0]!.bandwidth_um).toBeUndefined();
    expect(c.tag).toBe('derived');
  });

  it('reads a refused composite with null image fields', () => {
    const c = parseComposite(refused());
    expect(c.image_url).toBeNull();
    expect(c.width).toBeNull();
    expect(c.missing).toEqual(['composite:too_few_bands']);
    expect(parseComposite({ ...refused(), formula: null }).formula).toBeNull();
  });

  it('refuses a derived composite without a formula (D-02)', () => {
    refuses({ ...good(), formula: null }, /formula/);
    refuses({ ...good(), formula: '  ' }, /formula/);
    const { formula, ...noFormula } = good();
    void formula;
    refuses(noFormula, /formula/);
  });

  it('refuses incomplete or inconsistent images', () => {
    refuses({ ...good(), tag: 'measured' }, /tag/);
    refuses({ ...good(), width: null }, /width and height/);
    refuses({ ...good(), height: 2.5 }, /width and height/);
    refuses({ ...good(), scale_arcsec_px: 0 }, /scale/);
    refuses({ ...good(), x: null }, /object pixel/);
    refuses({ ...good(), north_up: false }, /north up/);
    refuses({ ...good(), bands: good().bands.slice(0, 2) }, /one band per channel/);
    refuses({ ...good(), bands: [band('blue', 1), band('blue', 2), band('red', 4)] }, /twice/);
    refuses({ ...good(), bands: [band('blue', 1), band('green', 2), band('ir', 4)] }, /channel/);
    refuses(
      {
        ...good(),
        bands: [band('blue', 1), band('green', 2), { ...band('red', 4), time: 'today' }],
      },
      /time/,
    );
    refuses({ ...good(), image_url: 42 }, /image_url/);
    refuses({ ...good(), missing: 'none' }, /missing/);
  });
});

describe('composite refusals in plain words', () => {
  const lines = (codes: string[]) => groupCompositeMissing(codes).map(describeRefusalGroup);

  it('words every composite reason the backend sends', () => {
    expect(
      lines([
        'composite:too_few_bands',
        'composite:saturated',
        'composite:no_common_pass',
        'composite:moving_object',
        'composite:no_proper_motion',
        'composite:pixel_scale',
        'composite:blue:no_frame',
        'composite:green:saturated',
        'composite:red:no_usable_frame',
        'composite:red:stretch',
      ]),
    ).toEqual([
      'There are not enough usable frames near the three colour wavelengths to make a composite.',
      'In at least one colour band, every frame near its wavelength had the object’s centre flagged as saturated or unusable.',
      'There are frames for each colour, but they come from different scans of the sky, taken too far apart in time to combine.',
      'Colour composites are not built for moving Solar System objects: the object is in a different place in each frame.',
      'The catalogue gives no proper motion, so the picture is centred on the catalogue position.',
      'The pixel size on the sky can’t be worked out, so the frames can’t be aligned.',
      'Blue band: no frame near its wavelength.',
      'Green band: every frame near its wavelength had the object’s centre flagged as saturated or unusable.',
      'Red band: no usable frame near its wavelength.',
      'Red band: the chosen frame is blank or flat and can’t be shown.',
    ]);
  });

  it('groups skipped nearer frames with the frame reasons, and keeps unknown codes', () => {
    const groups = groupCompositeMissing([
      'composite:blue:skipped:saturated:f1',
      'composite:green:skipped:saturated:f2',
      'composite:purple:odd',
      'cutouts:deferred:3',
    ]);
    const sat = groups.find((g) => g.reason === 'saturated');
    expect(sat?.frameIds).toEqual(['f1', 'f2']);
    expect(describeRefusalGroup(sat!)).toMatch(/^2 frames where the detector flagged/);
    const all = groups.map(describeRefusalGroup);
    expect(all).toContain('Not available: composite:purple:odd');
    expect(all).toContain(
      '3 frames are left out because they have not been downloaded yet. Fetch the rest of the frames above to include them.',
    );
  });

  it('announces a composite and a refusal', () => {
    expect(compositeAnnouncement(parseComposite(good()))).toBe(
      'Colour composite shown: blue 1.000 µm, green 2.000 µm, red 4.000 µm.',
    );
    expect(compositeAnnouncement(parseComposite(refused()))).toBe(
      'No colour composite: There are not enough usable frames near the three colour wavelengths to make a composite.',
    );
    expect(compositeAnnouncement(parseComposite({ ...refused(), missing: [] }))).toBe(
      'There is no SPHEREx colour composite for this object. The server gave no reason.',
    );
  });

  it('words request errors by their backend code', () => {
    const err = (kind: SkyError['kind'], status: number | null, code: string | null): SkyError => ({
      kind,
      status,
      code,
      detail: null,
    });
    expect(compositeErrorMessage(err('server', 503, 'offline_cache_miss'))).toMatch(/offline mode/);
    expect(compositeErrorMessage(err('server', 503, 'upstream_unavailable'))).toMatch(
      /archive is not answering/,
    );
    expect(compositeErrorMessage(err('not_found', 404, 'not_found'))).toBe(
      'There is no colour composite for this object.',
    );
    expect(compositeErrorMessage(err('bad_response', null, null))).toMatch(/can’t read/);
    expect(compositeErrorMessage(err('network', null, null))).toMatch(/Can’t reach the server/);
  });
});

describe('composite client and fixtures', () => {
  const api = createApiClient({ fetchImpl: fixtureFetch });

  it('fetches a synthetic composite with three bands', async () => {
    const r = await api.composite('eps-indi-b');
    expect(r.fixture).toBe('synthetic');
    expect(r.data.image_url).toMatch(/^\/v1\/objects\/eps-indi-b\/composite\.png\?v=[0-9a-f]{8}$/);
    expect(r.data.formula).toMatch(/^SYNTHETIC/);
    const wl = r.data.bands.map((b) => b.wavelength_um);
    expect(wl[0]!).toBeLessThan(wl[1]!);
    expect(wl[1]!).toBeLessThan(wl[2]!);
  });

  it('fetches the refused ones', async () => {
    expect((await api.composite('r-dra')).data.missing).toContain('composite:too_few_bands');
    for (const id of ['synthetic-mover', 'synthetic-refused-mover']) {
      const c = (await api.composite(id)).data;
      expect(c.image_url).toBeNull();
      expect(c.missing).toEqual(['composite:moving_object']);
    }
  });

  it('turns a 503 into a server error with its code', async () => {
    const offline = createApiClient({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ error: 'offline_cache_miss', detail: 'Not cached; offline.' }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch,
    });
    await expect(offline.composite('x')).rejects.toMatchObject({
      kind: 'server',
      status: 503,
      code: 'offline_cache_miss',
    });
  });
});
