// Issue #162: the spectrum check's one module. The reply check, the HTTP answers (ok, 404 → not run,
// anything else → unavailable), the mock only behind `?spectra=mock` and only for the Eros area, and
// loadDiscovery listing "Spectrum check not run" under Not shown.
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/app/api/client';
import { areaFixture, areaIndexFixture } from '@/test/areaFixtures';
import { loadDiscovery, missingText } from './realArea';
import {
  httpSpectraApi,
  MOCK_AREA_ID,
  mockSpectraApi,
  parseAreaSpectra,
  spectraMockFromUrl,
  SPECTRUM_VERDICTS,
  type AreaSpectra,
  type SpectraApi,
} from './spectraApi';
import MOCK from './spectraMock.json';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchOf = (res: () => Response | Promise<Response>) => (async () => res()) as unknown as typeof fetch;

describe('reply check', () => {
  it('accepts the mock reply (the Eros values of the mock-up)', () => {
    const r = parseAreaSpectra(MOCK);
    expect(r.area_id).toBe(MOCK_AREA_ID);
    expect(r.tracks.map((t) => [t.track_id, t.verdict])).toEqual([
      ['T1', 'rock'],
      ['T2', 'one_colour'],
      ['T3', 'rock'],
      ['T4', 'rock'],
      ['T5', 'one_colour'],
      ['T6', 'one_colour'],
      ['T7', 'one_colour'],
      ['T8', 'very_red'],
      ['T9', 'one_colour'],
    ]);
    const t3 = r.tracks[2]!;
    expect(t3.heat_glow).toBe(true);
    expect(t3.r_source).toBe('parallax');
  });

  it('refuses a reply that breaks the contract', () => {
    const bad = (f: (o: AreaSpectra) => void) => {
      const o = structuredClone(MOCK) as unknown as AreaSpectra;
      f(o);
      return () => parseAreaSpectra(o);
    };
    expect(bad((o) => ((o.tracks[0] as { verdict: string }).verdict = 'asteroid'))).toThrow(/verdict/);
    expect(bad((o) => ((o.tracks[0]!.pairs[0] as { rho: unknown }).rho = '1.2'))).toThrow(/rho/);
    expect(bad((o) => ((o.calibration[0] as { source: string }).source = 'guess'))).toThrow(/source/);
    expect(bad((o) => ((o.tracks[0]!.points[0] as { used: unknown }).used = 1))).toThrow(/used/);
    expect(() => parseAreaSpectra(null)).toThrow();
  });

  it('knows every verdict of A17.13', () => {
    expect(SPECTRUM_VERDICTS).toEqual(['rock', 'very_red', 'too_red', 'too_blue', 'flickers', 'too_faint', 'one_colour']);
  });
});

describe('the HTTP client', () => {
  it('ok, 404 (not run), and everything else unavailable', async () => {
    expect((await httpSpectraApi('/v1', fetchOf(() => reply(MOCK))).areaSpectra('eros-2026-03')).kind).toBe('ok');
    const notRun = reply({ error: 'spectra_not_prepared', detail: 'x' }, 404);
    expect(await httpSpectraApi('/v1', fetchOf(() => notRun)).areaSpectra('a')).toEqual({ kind: 'not_run' });
    // A backend from before #161 has no route: the check was not run either.
    expect(await httpSpectraApi('/v1', fetchOf(() => reply({ detail: 'Not Found' }, 404))).areaSpectra('a')).toEqual({ kind: 'not_run' });
    expect(await httpSpectraApi('/v1', fetchOf(() => reply({}, 500))).areaSpectra('a')).toEqual({ kind: 'unavailable' });
    expect(await httpSpectraApi('/v1', fetchOf(() => reply({ tracks: 'no' }))).areaSpectra('a')).toEqual({ kind: 'unavailable' });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await httpSpectraApi('/v1', offline).areaSpectra('a')).toEqual({ kind: 'unavailable' });
  });

  it('asks the area route, escaped', async () => {
    let url = '';
    const f = (async (u: string) => ((url = u), reply(MOCK))) as unknown as typeof fetch;
    await httpSpectraApi('/v1', f).areaSpectra('a b');
    expect(url).toBe('/v1/areas/a%20b/spectra');
  });
});

describe('the mock', () => {
  it('answers only with ?spectra=mock', () => {
    expect(spectraMockFromUrl('')).toBeNull();
    expect(spectraMockFromUrl('?live=mock')).toBeNull();
    expect(spectraMockFromUrl('?spectra=1')).toBeNull();
    expect(spectraMockFromUrl('?spectra=mock')).not.toBeNull();
  });

  it('answers for the Eros area only, so no verdict is made up for another area', async () => {
    const api = mockSpectraApi(async () => MOCK);
    expect((await api.areaSpectra(MOCK_AREA_ID)).kind).toBe('ok');
    expect(await api.areaSpectra('live-0123456789ab')).toEqual({ kind: 'not_run' });
  });
});

describe('loadDiscovery', () => {
  const f = areaFixture('multivisit');
  const entry = areaIndexFixture().areas[1]!;
  const api = {
    area: async () => ({ data: f.summary, fixture: 'synthetic' }),
    areaDots: async () => ({ data: f.dots, fixture: 'synthetic' }),
    areaTracks: async () => ({ data: f.tracks, fixture: 'synthetic' }),
  } as unknown as ApiClient;
  const of = (a: Awaited<ReturnType<SpectraApi['areaSpectra']>>): SpectraApi => ({ areaSpectra: async () => a });

  it('404: no verdicts, and "Spectrum check not run" under Not shown', async () => {
    const r = await loadDiscovery(api, entry, 'synthetic', undefined, of({ kind: 'not_run' }));
    expect(r.spectra).toBeNull();
    expect(r.missing).toContain('spectra:not_run');
    expect(missingText('spectra:not_run')).toBe('Spectrum check not run.');
  });

  it('a failed check never fails the area', async () => {
    const throws: SpectraApi = {
      areaSpectra: async () => {
        throw new Error('boom');
      },
    };
    const r = await loadDiscovery(api, entry, 'synthetic', undefined, throws);
    expect(r.tracks).not.toBeNull();
    expect(r.missing).toContain('spectra:unavailable');
  });

  it('keeps the reply and its own missing codes', async () => {
    const data = { ...(structuredClone(MOCK) as unknown as AreaSpectra), missing: ['spectra:calibration_default'] };
    const r = await loadDiscovery(api, entry, 'synthetic', undefined, of({ kind: 'ok', data }));
    expect(r.spectra?.tracks).toHaveLength(9);
    expect(r.missing).toContain('spectra:calibration_default');
    expect(missingText('spectra:calibration_default')).toMatch(/default/);
  });
});
