// Test helper (src/test/ is test-only code): the SYNTHETIC Area search replies in
// shared/fixtures/area/ (issue #92), main (2 visits) and multivisit (4 visits). Test code only.
import type { AreaDots, AreaIndex, AreaKnown, AreaSummary, AreaTracks } from '@/contract';

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
