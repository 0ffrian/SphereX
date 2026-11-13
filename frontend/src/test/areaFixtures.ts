// Test helper (src/test/ is test-only code): the SYNTHETIC Area search replies in
// shared/fixtures/area/ (issue #92), main (2 visits) and multivisit (4 visits). Test code only.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaDots, AreaIndex, AreaKnown, AreaSpectra, AreaSummary, AreaTracks } from '@/contract';

const files = import.meta.glob('../../../shared/fixtures/area/**/*.json', {
  eager: true,
  import: 'default',
});

function pick<T>(dir: '' | 'multivisit/', name: string): T {
  const key = Object.keys(files).find((k) => k.endsWith(`/area/${dir}${name}.json`));
  if (!key) throw new Error(`no area fixture ${dir}${name}`);
  // A deep copy, so a test that edits it never changes another test's data.
  return structuredClone(files[key]) as T;
}

export interface AreaFixtureSet {
  summary: AreaSummary;
  dots: AreaDots;
  tracks: AreaTracks;
  known: AreaKnown;
}

export const areaIndexFixture = (): AreaIndex => pick<AreaIndex>('', 'index');

export function areaFixture(which: 'main' | 'multivisit'): AreaFixtureSet {
  const dir = which === 'main' ? '' : 'multivisit/';
  return {
    summary: pick<AreaSummary>(dir, 'summary'),
    dots: pick<AreaDots>(dir, 'dots'),
    tracks: pick<AreaTracks>(dir, 'tracks'),
    known: pick<AreaKnown>(dir, 'known'),
  };
}

/** The main fixture area's spectrum check (#161's synthetic `spectra.json`). */
export const spectraFixture = (): AreaSpectra => pick<AreaSpectra>('', 'spectra');

/**
 * One stored stage of the committed Eros pack (backend/assets/areas, area eros-2026-03): the real
 * backend's bytes, parsed. `spectra` is #161's spectrum check of the recorded Eros area.
 */
export function erosPackStage<T>(stage: 'summary' | 'dots' | 'tracks' | 'spectra'): T {
  const root = join(process.cwd(), '..', 'backend', 'assets', 'areas', 'v1', 'derived.area', 'spherex_qr2');
  for (const dir of readdirSync(root))
    for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith('.json'))) {
      const meta = JSON.parse(readFileSync(join(root, dir, f), 'utf8')) as { key: { query: { stage: string; id: string } } };
      if (meta.key.query.stage === stage && meta.key.query.id === 'eros-2026-03')
        return JSON.parse(readFileSync(join(root, dir, f.replace(/\.json$/, '.body')), 'utf8')) as T;
    }
  throw new Error(`no ${stage} stage of eros-2026-03 in the pack`);
}
