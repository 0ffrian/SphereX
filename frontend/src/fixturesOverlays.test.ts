// The overlay fixtures (issue #12): valid against the client's contract checks, consistent with
// the synthetic frames and cutouts, deterministic, and clearly synthetic.
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest } from '../fixtures/handler';
import { crc32, PNG_SIGNATURE } from '../fixtures/png';
import { CUTOUT_SIZE, makeFrames } from '../fixtures/synthetic';
import {
  FIXTURE_NO_FOOTPRINT_INDEX,
  makeOverlays,
  renderCombine,
  renderFlags,
} from '../fixtures/overlays';
import { FIXTURE_TARGETS } from '../fixtures/targets';
import { parseCombineInfo, parseOverlays } from './app/api/validate';

const json = (url: string) => {
  const r = handleFixtureRequest('GET', url)!;
  return { status: r.status, headers: r.headers, data: JSON.parse(r.body as string) as unknown };
};

/** PNG chunk list with CRCs checked; returns the IHDR colour type. */
function checkPng(png: Uint8Array): { width: number; height: number; colorType: number } {
  expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const typeAndData = png.subarray(pos + 4, pos + 8 + len);
    expect(view.getUint32(pos + 8 + len)).toBe(crc32(typeAndData));
    pos += 12 + len;
  }
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: png[25]! };
}

const withFrames = FIXTURE_TARGETS.filter((t) => !t.refuseFrames);

describe('overlay fixtures', () => {
  it.each(withFrames.map((t) => t.id))('%s: overlays are valid and match the frames', (id) => {
    const r = json(`/v1/objects/${id}/overlays`);
    expect(r.status).toBe(200);
    expect(r.headers['x-sx-fixture']).toBe('synthetic');
    const o = parseOverlays(r.data);
    const t = FIXTURE_TARGETS.find((x) => x.id === id)!;
    const frames = makeFrames(t).frames;
    expect(o.frames.map((f) => f.frame_id)).toEqual(frames.map((f) => f.frame_id));
    expect(o.catalogs.map((c) => c.catalog)).toEqual(['gaia', 'wise']);
    for (const f of o.frames) {
      for (const m of f.markers) {
        expect(m.x).toBeGreaterThanOrEqual(-0.5);
        expect(m.x).toBeLessThan(CUTOUT_SIZE - 0.5);
      }
    }
    // Every marker is a catalogue source.
    const ids = new Set(o.catalogs.flatMap((c) => c.sources.map((s) => `${c.catalog}:${s.id}`)));
    for (const f of o.frames)
      for (const m of f.markers) expect(ids.has(`${m.catalog}:${m.id}`)).toBe(true);
    // One frame per target has no footprint, and says so.
    const noFoot = frames[FIXTURE_NO_FOOTPRINT_INDEX]!.frame_id;
    expect(o.frames[FIXTURE_NO_FOOTPRINT_INDEX]!.footprint).toBeNull();
    expect(o.missing).toContain(`footprint:${noFoot}`);
    expect(o.provenance.markers?.tag).toBe('derived');
    expect(o.provenance.catalog_positions?.tag).toBe('measured');
  });

  it('a star target has contamination in the aperture and in the annulus', () => {
    const o = makeOverlays(FIXTURE_TARGETS.find((t) => t.id === 'eps-indi-b')!);
    const zones = new Set(o.frames[0]!.contamination.map((c) => c.zone));
    expect(zones).toEqual(new Set(['aperture', 'annulus']));
  });

  it('WISE 0855 has no Gaia catalogue: refused, not invented', () => {
    const o = makeOverlays(FIXTURE_TARGETS.find((t) => t.id === 'wise-0855')!);
    const gaia = o.catalogs.find((c) => c.catalog === 'gaia')!;
    expect(gaia.available).toBe(false);
    expect(gaia.sources).toEqual([]);
    expect(o.missing).toContain('overlay:gaia');
    expect(o.frames.flatMap((f) => f.markers).some((m) => m.catalog === 'gaia')).toBe(false);
  });

  it('R Draconis has no flag mask for its broken cutout', () => {
    const o = makeOverlays(FIXTURE_TARGETS.find((t) => t.id === 'r-dra')!);
    expect(o.missing).toContain('flags_mask:r-dra-f005');
    expect(json('/v1/objects/r-dra/flags/r-dra-f005.png').status).toBe(404);
  });

  it('serves RGBA flag masks the size of the cutout', () => {
    const r = handleFixtureRequest('GET', '/v1/objects/rw-aur/flags/rw-aur-f001.png')!;
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(checkPng(r.body as Uint8Array)).toEqual({
      width: CUTOUT_SIZE,
      height: CUTOUT_SIZE,
      colorType: 6,
    });
  });

  it('serves combine.png with an X-SX-Combine header', () => {
    const r = handleFixtureRequest(
      'GET',
      '/v1/objects/rw-aur/combine.png?op=sub&a=rw-aur-f004&b=rw-aur-f003',
    )!;
    expect(r.status).toBe(200);
    expect(checkPng(r.body as Uint8Array).colorType).toBe(0);
    const info = parseCombineInfo(r.headers['x-sx-combine']!);
    expect(info).toMatchObject({ op: 'sub', a: 'rw-aur-f004', b: 'rw-aur-f003', tag: 'derived' });
    // Header values must be plain ASCII.
    expect(/^[\x20-\x7e]*$/.test(r.headers['x-sx-combine']!)).toBe(true);
  });

  it('answers bad combine requests with the backend codes', () => {
    const base = '/v1/objects/rw-aur/combine.png';
    expect(json(`${base}?op=mul&a=rw-aur-f001&b=rw-aur-f002`)).toMatchObject({
      status: 400,
      data: { error: 'bad_request' },
    });
    expect(json(`${base}?op=add&a=nope&b=rw-aur-f001`)).toMatchObject({
      status: 404,
      data: { error: 'frame_not_found' },
    });
    expect(json('/v1/objects/r-dra/combine.png?op=add&a=r-dra-f005&b=r-dra-f004')).toMatchObject({
      status: 503,
      data: { error: 'cutout_unavailable' },
    });
  });

  it('accepts a frame combined with itself, like the backend (A - A is flat mid-grey)', () => {
    const r = handleFixtureRequest(
      'GET',
      '/v1/objects/rw-aur/combine.png?op=sub&a=rw-aur-f001&b=rw-aur-f001',
    )!;
    expect(r.status).toBe(200);
    expect(checkPng(r.body as Uint8Array).colorType).toBe(0);
  });

  it('is deterministic', () => {
    for (const t of withFrames) {
      expect(JSON.stringify(makeOverlays(t))).toBe(JSON.stringify(makeOverlays(t)));
      expect(renderFlags(t, 1)).toEqual(renderFlags(t, 1));
      expect(renderCombine(t, 'sub', 1, 0)).toEqual(renderCombine(t, 'sub', 1, 0));
    }
  });
});
