// Issue #162: the spectrum check's one module on #161's endpoint. The reply check (the committed Eros
// pack's stored stage and the contract fixture), the HTTP answers (ok, 404 spectra_not_prepared → not
// run, anything else → unavailable), and loadDiscovery listing "Spectrum check not run" under Not shown.
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@/app/api/client';
import { areaFixture, areaIndexFixture, erosPackStage, spectraFixture } from '@/test/areaFixtures';
import { loadDiscovery, missingText } from './realArea';
import {
  httpSpectraApi,
  parseAreaSpectra,
  SPECTRUM_VERDICTS,
  type AreaSpectra,
  type SpectraApi,
} from './spectraApi';

const EROS = erosPackStage<AreaSpectra>('spectra');
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchOf = (res: () => Response | Promise<Response>) =>
  (async () => res()) as unknown as typeof fetch;

describe('reply check', () => {
  it('accepts the Eros pack: the verdicts A17.13 expects for the recorded area', () => {
    const r = parseAreaSpectra(EROS);
    expect(r.area_id).toBe('eros-2026-03');
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
    expect(Math.abs(t3.r_au - 1.157)).toBeLessThan(0.05);
  });

  it('accepts the contract fixture', () => {
    expect(parseAreaSpectra(spectraFixture()).tracks.length).toBeGreaterThan(0);
  });

  it('refuses a reply that breaks the contract', () => {
    const bad = (f: (o: AreaSpectra) => void) => {
      const o = structuredClone(EROS);
      f(o);
      return () => parseAreaSpectra(o);
    };
    expect(bad((o) => ((o.tracks[0] as { verdict: string }).verdict = 'asteroid'))).toThrow(
      /verdict/,
    );
    expect(bad((o) => ((o.tracks[0]!.pairs[0] as { rho: unknown }).rho = '1.2'))).toThrow(/rho/);
    expect(bad((o) => ((o.calibration[0] as { source: string }).source = 'guess'))).toThrow(
      /source/,
    );
    expect(bad((o) => ((o.tracks[0]!.points[0] as { used: unknown }).used = 1))).toThrow(/used/);
    expect(bad((o) => ((o.tracks[0]!.points[0] as { visit: unknown }).visit = null))).toThrow(
      /visit/,
    );
    expect(() => parseAreaSpectra(null)).toThrow();
    // The Spectrum section's badge reads provenance.points and provenance.colour: never guessed.
    expect(bad((o) => delete (o.provenance as Partial<AreaSpectra['provenance']>).colour)).toThrow(
      /provenance\.colour/,
    );
    expect(bad((o) => ((o.provenance.colour as { tag: string }).tag = 'artistic'))).toThrow(
      /provenance\.colour\.tag/,
    );
    expect(bad((o) => ((o.provenance.points as { tag: string }).tag = 'artistic'))).toThrow(
      /provenance\.points\.tag/,
    );
  });

  it('knows every verdict of A17.13', () => {
    expect(SPECTRUM_VERDICTS).toEqual([
      'rock',
      'very_red',
      'too_red',
      'too_blue',
      'flickers',
      'too_faint',
      'one_colour',
    ]);
  });
});

describe('the HTTP client', () => {
  it('ok; 404 spectra_not_prepared is not run; everything else unavailable', async () => {
    expect(
      (
        await httpSpectraApi(
          '/v1',
          fetchOf(() => reply(EROS)),
        ).areaSpectra('eros-2026-03')
      ).kind,
    ).toBe('ok');
    const artistic = {
      ...EROS,
      provenance: { ...EROS.provenance, colour: { ...EROS.provenance.colour, tag: 'artistic' } },
    };
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply(artistic)),
      ).areaSpectra('eros-2026-03'),
    ).toEqual({ kind: 'unavailable' });
    const noColour = structuredClone(EROS);
    delete (noColour.provenance as Partial<AreaSpectra['provenance']>).colour;
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply(noColour)),
      ).areaSpectra('eros-2026-03'),
    ).toEqual({ kind: 'unavailable' });
    const notRun = reply({ error: 'spectra_not_prepared', detail: 'x' }, 404);
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => notRun),
      ).areaSpectra('a'),
    ).toEqual({ kind: 'not_run' });
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply({ error: 'area_not_found' }, 404)),
      ).areaSpectra('a'),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply({}, 500)),
      ).areaSpectra('a'),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply({ tracks: 'no' })),
      ).areaSpectra('a'),
    ).toEqual({ kind: 'unavailable' });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await httpSpectraApi('/v1', offline).areaSpectra('a')).toEqual({ kind: 'unavailable' });
  });

  it("refuses another area's reply", async () => {
    expect(
      await httpSpectraApi(
        '/v1',
        fetchOf(() => reply(EROS)),
      ).areaSpectra('live-0123456789ab'),
    ).toEqual({ kind: 'unavailable' });
  });

  it('asks the area route, escaped', async () => {
    let url = '';
    const f = (async (u: string) => (
      (url = u),
      reply({ ...EROS, area_id: 'a b' })
    )) as unknown as typeof fetch;
    expect((await httpSpectraApi('/v1', f).areaSpectra('a b')).kind).toBe('ok');
    expect(url).toBe('/v1/areas/a%20b/spectra');
  });

  it("passes the caller's abort through", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const f = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(httpSpectraApi('/v1', f).areaSpectra('a', ctl.signal)).rejects.toThrow();
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
  const of = (a: Awaited<ReturnType<SpectraApi['areaSpectra']>>): SpectraApi => ({
    areaSpectra: async () => a,
  });

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
    const data = { ...structuredClone(EROS), missing: ['spectra:calibration_default'] };
    const r = await loadDiscovery(api, entry, 'synthetic', undefined, of({ kind: 'ok', data }));
    expect(r.spectra?.tracks).toHaveLength(9);
    expect(r.missing).toContain('spectra:calibration_default');
    expect(missingText('spectra:calibration_default')).toMatch(/default/);
  });
});
