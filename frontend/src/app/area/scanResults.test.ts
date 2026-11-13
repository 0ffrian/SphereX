// State 11 (issue #157): the combined result rows of a filter, and the ECSV of the merged results.
import { describe, expect, it } from 'vitest';
import { dayOf, scanRows } from './ScanCard';
import { mockResultsOf, mockScanApi } from './scanApi';
import { scanEcsv } from './scanExport';

const REGION = { ra: 30, dec: 10, width_deg: 9, height_deg: 5.4 };

async function finishedResults() {
  let t = 1_800_000_000_000;
  const api = mockScanApi({ squareMs: 1000, now: () => t, persist: false });
  const started = await api.start({ ...REGION, kind: 'discovery' });
  if (started.kind !== 'started') throw new Error('not started');
  t += 60_000;
  return mockResultsOf(await api.run(started.run.run_id));
}

describe('scanRows', () => {
  it('Found: known objects found blind and unexplained tracks; rows name their squares and date', async () => {
    const res = await finishedResults();
    const found = scanRows(res, 'found');
    const sean = found.find((r) => r.known?.designation === '7051 Sean')!;
    expect(sean).toMatchObject({ num: '7051', name: 'Sean', where: 'squares 2–3 · 27 Jun' });
    expect(sean.line).toBe('asteroid · V 17.4 · detected');
    const t3 = found.find((r) => r.num === 'T3')!;
    expect(t3).toMatchObject({ name: 'Unexplained track', where: 'square 3 · 27 Jun' });
    // The rate is derived from its merged dots.
    expect(t3.line).toMatch(/^\d+\.\d\d°\/day · not in SkyBoT$/);
    expect(found.every((r) => r.track !== null)).toBe(true);
  });

  it('Known: every known object, detected or predicted', async () => {
    const res = await finishedResults();
    const known = scanRows(res, 'known');
    expect(known).toHaveLength(res.known.length);
    expect(known.some((r) => r.line.endsWith('predicted'))).toBe(true);
  });

  it('dayOf', () => {
    expect(dayOf('2026-06-27T03:10:00Z')).toBe('27 Jun');
    expect(dayOf('2026-07-02T06:30:00Z', true)).toBe('2 Jul 2026');
    expect(dayOf('nope')).toBe('');
  });
});

describe('scanEcsv', () => {
  it('writes the ECSV header, the run meta and one row per object or track', async () => {
    const res = await finishedResults();
    const text = scanEcsv(res, REGION);
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('# %ECSV 1.0');
    expect(text).toContain(`#   run_id: ${res.run_id}`);
    expect(text).toContain('#   squares_skipped: [4]');
    const header = lines.findIndex((l) => l.startsWith('kind,'));
    expect(lines.length - header - 1).toBe(res.known.length + res.tracks.length);
    expect(text).toContain(
      'known,"7051 Sean",,detected,17.4,,"2 3","2026-06-27T03:10:00Z 2026-06-28T03:10:00Z",',
    );
  });
});
