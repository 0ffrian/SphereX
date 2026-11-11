// The Area search fixtures (A17.9, Q-208) against the real JSON Schemas with ajv, and the joins
// the UI relies on. The full cross-reply rules run in the backend (tests/area_consistency.py).
import Ajv, { type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  AREA_DOT_LABELS,
  AREA_LINKERS,
  AREA_SED_LABELS,
  AREA_VERDICTS,
  type AreaChecks,
  type AreaDots,
  type AreaIndex,
  type AreaKnown,
  type AreaSummary,
  type AreaTracks,
} from '@/contract';
import areaIndexSchema from '../../../shared/schemas/area-index.schema.json';

const schemas = Object.values(
  import.meta.glob<{ $id: string }>('../../../shared/schemas/*.schema.json', {
    eager: true,
    import: 'default',
  }),
);
const ajv = new Ajv({ allErrors: true, strict: true });
for (const schema of schemas) ajv.addSchema(schema);
const validator = (kind: string): ValidateFunction => ajv.getSchema(`area-${kind}.schema.json`)!;

const files = import.meta.glob<unknown>('../../../shared/fixtures/area/**/*.json', {
  eager: true,
  import: 'default',
});
const AREA_ROOT = '../../../shared/fixtures/area/';
const KINDS = ['summary', 'known', 'dots', 'tracks', 'checks'] as const;
const DIRS: Record<string, string> = {
  'fixture:area-main': '',
  'fixture:area-multivisit': 'multivisit/',
};

function reply<T>(dir: string, kind: string): T {
  const data = files[`${AREA_ROOT}${dir}${kind}.json`];
  if (data === undefined) throw new Error(`no fixture ${dir}${kind}.json`);
  return data as T;
}

const index = reply<AreaIndex>('', 'index');

describe('Area search fixtures (A17.9)', () => {
  it('list one folder per index entry, each with every reply', () => {
    expect(index.areas.map((a) => a.area_id)).toEqual(Object.keys(DIRS).sort());
    const paths = Object.keys(files).map((p) => p.slice(AREA_ROOT.length));
    const expected = [
      'index.json',
      ...Object.values(DIRS).flatMap((dir) => KINDS.map((k) => `${dir}${k}.json`)),
    ];
    expect(paths.sort()).toEqual(expected.sort());
  });

  it.each(Object.keys(files).map((p) => [p.slice(AREA_ROOT.length)]))(
    '%s validates against its schema',
    (rel) => {
      const kind = rel.replace(/^.*\//, '').replace(/\.json$/, '');
      const validate = validator(kind);
      const data = files[`${AREA_ROOT}${rel}`];
      expect(validate(data), ajv.errorsText(validate.errors)).toBe(true);
    },
  );

  it('emit the enum lists the UI uses, equal to the schema', () => {
    const defs = areaIndexSchema.definitions;
    expect([...AREA_DOT_LABELS]).toEqual(defs.AreaDotLabel.enum);
    expect([...AREA_VERDICTS]).toEqual(defs.AreaVerdict.enum);
    expect([...AREA_SED_LABELS]).toEqual(defs.AreaSedLabel.enum);
    expect([...AREA_LINKERS]).toEqual(defs.AreaLinker.enum);
  });

  it.each(Object.entries(DIRS))('%s: the summary repeats its index entry', (areaId, dir) => {
    const entry = index.areas.find((a) => a.area_id === areaId)!;
    const summary = reply<AreaSummary>(dir, 'summary');
    for (const [key, value] of Object.entries(entry)) {
      expect(summary[key as keyof AreaSummary], key).toEqual(value);
    }
    expect(summary.frames).toHaveLength(entry.n_frames);
  });

  it.each(Object.entries(DIRS))('%s: every track dot joins a mover in /dots', (_id, dir) => {
    const dots = reply<AreaDots>(dir, 'dots');
    const tracks = reply<AreaTracks>(dir, 'tracks');
    const byId = new Map(dots.visits.flatMap((v) => v.dots.map((d) => [d.dot_id, d] as const)));
    const seen = new Set<string>();
    for (const t of tracks.tracks) {
      expect(t.track_id).toMatch(/^T[1-9][0-9]*$/);
      for (const tl of t.tracklets) {
        for (const id of tl.dot_ids) {
          expect(byId.get(id)?.label, `${t.track_id} ${id}`).toBe('mover');
          expect(seen.has(id), id).toBe(false);
          seen.add(id);
        }
      }
      // A verdict of unchecked names its reason, and the reason is a refusal code of the reply.
      expect(t.unchecked_by.length > 0).toBe(t.verdict === 'unchecked');
      for (const code of t.unchecked_by) expect(tracks.missing).toContain(code);
    }
  });

  it.each(Object.entries(DIRS))('%s: step counts match the dots and tracks', (_id, dir) => {
    const { steps } = reply<AreaSummary>(dir, 'summary');
    const dots = reply<AreaDots>(dir, 'dots').visits.flatMap((v) => v.dots);
    const tracks = reply<AreaTracks>(dir, 'tracks').tracks;
    const count = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length;
    expect(steps.n_dots).toBe(dots.length);
    expect(steps.n_glitches).toBe(count(dots, (d) => d.label === 'glitch'));
    expect(steps.n_stars).toBe(count(dots, (d) => d.label === 'star'));
    expect(steps.n_fixed).toBe(count(dots, (d) => d.label === 'fixed'));
    expect(steps.n_tracks).toBe(count(tracks, (t) => t.status === 'track'));
    expect(steps.n_possible).toBe(count(tracks, (t) => t.status === 'possible'));
    expect(steps.n_found_blind).toBe(count(tracks, (t) => t.verdict === 'found_blind'));
    expect(steps.n_unexplained).toBe(count(tracks, (t) => t.verdict === 'unexplained'));
    expect(steps.n_unchecked).toBe(count(tracks, (t) => t.verdict === 'unchecked'));
  });

  it.each(Object.entries(DIRS))('%s: known and tracks date their SkyBoT answers', (_id, dir) => {
    const n = reply<AreaSummary>(dir, 'summary').n_visits;
    for (const r of [reply<AreaKnown>(dir, 'known'), reply<AreaTracks>(dir, 'tracks')]) {
      expect(r.skybot.map((a) => a.visit)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it('checks: the main area ran them all, the multivisit area did not (Q-208 (12))', () => {
    const ran = reply<AreaChecks>('', 'checks');
    expect(ran.test_mover && ran.completeness && ran.control && ran.linker).toBeTruthy();
    expect(ran.method.checks).toBeDefined();
    expect(ran.missing).not.toContain('checks:not_run');
    const notRun = reply<AreaChecks>('multivisit/', 'checks');
    expect(notRun.missing).toEqual(['checks:not_run']);
    expect(notRun.test_mover ?? notRun.completeness ?? notRun.control ?? notRun.linker).toBe(
      undefined,
    );
    expect(notRun.provenance).toEqual({});
  });
});
