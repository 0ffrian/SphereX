import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { readFileSync } from 'node:fs';
import {
  isIsoWithZone,
  parseApiError,
  parseAreaIndex,
  parseAreaKnown,
  parseFrames,
  parseResolve,
  parseSpectrum,
  parseTrackPath,
} from './validate';

const shared = (rel: string): unknown =>
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/${rel}`, 'utf8'));

// Contract-shaped test data. Values are test data only, not physical claims.
const resolve = {
  id: 'obj-1',
  name: 'Test object',
  ra: 12.5,
  dec: -30,
  moving: false,
  resolver: 'simbad',
  cached_at: null,
};

const frame = {
  frame_id: 'f1',
  time: '2025-05-03T14:22:10.123Z',
  wavelength_um: 1.5,
  x: 31,
  y: 32,
  cutout_url: '/v1/objects/obj-1/cutouts/f1.png',
  flags: [],
};

const frames = {
  id: 'obj-1',
  frames: [frame],
  north_up: false,
  stretch: { kind: 'asinh', params: { a: 0.1 } },
  data_release: 'spherex_qr2',
  cached_at: '2026-11-05T09:00:00+00:00',
  missing: [],
};

const spectrum = {
  id: 'obj-1',
  spectrum: [{ wavelength_um: 1.5, flux: 2, error: 0.1, flagged: false, frame_id: 'f1' }],
  light_curve: [{ time: '2025-05-03T14:22:10Z', flux: 2, error: 0.1, frame_id: 'f1' }],
  flux_unit: 'mJy',
  tag: 'measured',
  cached_at: null,
  missing: [],
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

describe('contract checks (D-16, M1 brief)', () => {
  it('accepts valid replies', () => {
    expect(parseResolve(resolve)).toEqual(resolve);
    expect(parseFrames(frames).frames[0]).toEqual(frame);
    expect(parseSpectrum(spectrum).spectrum).toHaveLength(1);
  });

  it('ignores unknown extra fields and keeps known optional ones', () => {
    const parsed = parseFrames({
      ...frames,
      provenance: { cutout: 'measured', stretch: 'derived' },
      future_field: 42,
      frames: [{ ...frame, ra: 10, dec: -5, north_angle_deg: 12.5, mirrored: false, extra: 'x' }],
    });
    expect(parsed.provenance).toEqual({ cutout: 'measured', stretch: 'derived' });
    expect(parsed.frames[0]).toEqual({
      ...frame,
      ra: 10,
      dec: -5,
      north_angle_deg: 12.5,
      mirrored: false,
    });
    expect('future_field' in parsed).toBe(false);
  });

  it('accepts the optional spectrum extras from #2 and refuses bad ones', () => {
    const point = { ...spectrum.spectrum[0]!, flagged: true };
    const parsed = parseSpectrum({
      ...spectrum,
      method: 'aperture',
      bandwidth_um: 0.02,
      data_release: 'spherex_qr2',
      provenance: {},
      spectrum: [{ ...point, flag_reasons: ['cosmic_ray'], dropped_weight_fraction: 0.25 }],
      light_curve: [{ ...spectrum.light_curve[0]!, wavelength_um: 1.5 }],
    });
    expect(parsed.spectrum[0]).toMatchObject({
      flag_reasons: ['cosmic_ray'],
      dropped_weight_fraction: 0.25,
    });
    badResponse(() =>
      parseSpectrum({ ...spectrum, spectrum: [{ ...point, dropped_weight_fraction: 1.5 }] }),
    );
    badResponse(() => parseSpectrum({ ...spectrum, spectrum: [{ ...point, flag_reasons: 'x' }] }));
  });

  it('treats null optional fields as absent', () => {
    const parsed = parseFrames({ ...frames, frames: [{ ...frame, ra: null }] });
    expect(parsed.frames[0]).not.toHaveProperty('ra');
  });

  it('requires north_up', () => {
    const copy: Record<string, unknown> = { ...frames };
    delete copy.north_up;
    expect(badResponse(() => parseFrames(copy))).toMatch(/north_up/);
  });

  it.each(['2025-05-03T14:22:10', '2025-05-03 14:22:10Z', '2025-05-03', 'yesterday'])(
    'rejects a time without a zone or in the wrong form: %s',
    (t) => {
      expect(isIsoWithZone(t)).toBe(false);
      expect(
        badResponse(() => parseFrames({ ...frames, frames: [{ ...frame, time: t }] })),
      ).toMatch(/time/);
    },
  );

  it('accepts Z and explicit offsets', () => {
    for (const t of [
      '2025-05-03T14:22:10Z',
      '2025-05-03T14:22:10.5+04:00',
      '2025-05-03T14:22-0130',
    ]) {
      expect(isIsoWithZone(t)).toBe(true);
    }
  });

  it.each(['id', 'ra', 'dec', 'moving', 'resolver'])('refuses resolve without %s', (key) => {
    const copy: Record<string, unknown> = { ...resolve };
    delete copy[key];
    badResponse(() => parseResolve(copy));
  });

  it('refuses an unknown resolver and out-of-range coordinates', () => {
    badResponse(() => parseResolve({ ...resolve, resolver: 'guess' }));
    badResponse(() => parseResolve({ ...resolve, ra: 360 }));
    badResponse(() => parseResolve({ ...resolve, dec: -91 }));
  });

  it.each(['frame_id', 'time', 'wavelength_um', 'x', 'y', 'cutout_url', 'flags'])(
    'refuses a frame without %s',
    (key) => {
      const copy: Record<string, unknown> = { ...frame };
      delete copy[key];
      badResponse(() => parseFrames({ ...frames, frames: [copy] }));
    },
  );

  it('refuses spectrum points with missing or bad numbers, and a tag other than measured', () => {
    const point = spectrum.spectrum[0]!;
    badResponse(() => parseSpectrum({ ...spectrum, spectrum: [{ ...point, flux: null }] }));
    badResponse(() => parseSpectrum({ ...spectrum, spectrum: [{ ...point, error: -1 }] }));
    badResponse(() => parseSpectrum({ ...spectrum, spectrum: [{ ...point, flux: Number.NaN }] }));
    badResponse(() => parseSpectrum({ ...spectrum, tag: 'derived' }));
  });

  it('reads error bodies best-effort', () => {
    expect(parseApiError({ error: 'not_found', detail: 'No such object.' })).toEqual({
      error: 'not_found',
      detail: 'No such object.',
    });
    expect(parseApiError('oops')).toBeNull();
    expect(parseApiError({ detail: 'no code' })).toBeNull();
  });
});

describe('Area search replies (A17.8, A19.5; issue #130)', () => {
  it('accepts the shared fixtures', () => {
    expect(parseAreaIndex(shared('area/index.json')).areas).toHaveLength(2);
    const known = parseAreaKnown(shared('area/known.json'));
    expect(known.known[0]!.track_available).toBe(true);
    expect(known.known[0]!.positions.length).toBeGreaterThan(0);
    expect(parseTrackPath(shared('track/eros-2026-03/path.json')).frame_points).toHaveLength(16);
  });
  it('refuses an index without the areas list or with a bad size', () => {
    const idx = shared('area/index.json') as { areas: Record<string, unknown>[] };
    expect(() => parseAreaIndex({ ...idx, areas: undefined })).toThrow(ApiError);
    expect(() => parseAreaIndex({ ...idx, areas: [{ ...idx.areas[0], width_deg: 0 }] })).toThrow(
      /width_deg/,
    );
  });
  it('refuses a known object with a bad kind, count or position', () => {
    const k = shared('area/known.json') as { known: Record<string, unknown>[] };
    const bad = (patch: Record<string, unknown>) =>
      parseAreaKnown({ ...k, known: [{ ...k.known[0], ...patch }] });
    expect(() => bad({ kind: 'planet' })).toThrow(/kind/);
    expect(() => bad({ n_frames: 0 })).toThrow(/n_frames/);
    expect(() => bad({ positions: [{ frame_id: 'f', time: 'soon', ra: 1, dec: 1 }] })).toThrow(
      /time/,
    );
    expect(() =>
      bad({ positions: [{ frame_id: 'f', time: '2026-03-20T00:00:00.000Z', ra: 400, dec: 1 }] }),
    ).toThrow(/ra/);
    expect(() =>
      parseAreaKnown({
        ...k,
        provenance: { positions: { tag: 'artistic' }, skybot: { tag: 'measured' } },
      }),
    ).toThrow(/tag/);
  });
  it('refuses a path that is not model_dependent', () => {
    const p = shared('track/eros-2026-03/path.json') as Record<string, unknown>;
    expect(() => parseTrackPath({ ...p, tag: 'measured' })).toThrow(/model_dependent/);
  });
  it('refuses a path with the wrong observer, step, null-time shape or refusal code', () => {
    const p = shared('track/eros-2026-03/path.json') as Record<string, unknown>;
    expect(() => parseTrackPath({ ...p, observer: '500@399' })).toThrow(/observer/);
    expect(() => parseTrackPath({ ...p, step_min: 0 })).toThrow(/step_min/);
    expect(() => parseTrackPath({ ...p, fetched_at: undefined })).toThrow(/fetched_at/);
    expect(() => parseTrackPath({ ...p, missing: ['path:made_up'] })).toThrow(/missing/);
  });
});
