// Ties the frontend's list of per-frame refusal reasons (refusals.ts FRAME_REASONS, each with its
// own wording in messages.ts) to the reasons the backend can emit. Reads the backend sources as
// text: Stage 2's STAGE2_REASONS tuple (measure/spectrum.py) and Stage 1's `return None, "<why>"`
// lines (find/frames.py). If this fails, add or remove the reason in FRAME_REASONS and FRAME_TEXT.
// The moving-object path search's codes (find/moving.py) must each have wording too.
// NOTE: frontend CI runs only on frontend/** changes, so a backend-only PR will not run this test.
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  describeRefusal,
  describeRefusalGroup,
  flagReasonsText,
  nonLayerMissingText,
  UNKNOWN_CODE_TEXT,
} from './messages';
import { countedCode, FRAME_REASONS, groupCompositeMissing, groupMissing } from './refusals';

// Read with node:fs (Vite does not serve files outside frontend/). A plain path, not
// `new URL(…, import.meta.url)`, which Vite would rewrite into an asset import.
const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend/app/core');
const backend = (path: string) => readFileSync(resolve(CORE, path), 'utf8');
const framesPy = backend('find/frames.py');
const spectrumPy = backend('measure/spectrum.py');
const movingPy = backend('find/moving.py');

/** Stage 2: the names in `STAGE2_REASONS = (...)`; bare constants resolve via `NAME = "value"`. */
function stage2Reasons(py: string): string[] {
  const body = /^STAGE2_REASONS = \(([^)]*)\)/m.exec(py)?.[1];
  if (body === undefined) throw new Error('STAGE2_REASONS = (...) not found in spectrum.py');
  return body
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => {
      const quoted = /^"([a-z_]+)"$/.exec(item);
      if (quoted) return quoted[1]!;
      const value = new RegExp(`^${item} = "([a-z_]+)"$`, 'm').exec(py)?.[1];
      if (value === undefined) throw new Error(`spectrum.py: constant ${item} has no string value`);
      return value;
    });
}

/** Stage 1: every `return None, "<reason>"` in frames.py. */
function stage1Reasons(py: string): string[] {
  return [...py.matchAll(/return None, "([a-z_]+)"/g)].map((m) => m[1]!);
}

describe('FRAME_REASONS matches the backend', () => {
  it('found the backend reasons', () => {
    expect(stage2Reasons(spectrumPy).length).toBeGreaterThan(5);
    expect(stage1Reasons(framesPy).length).toBeGreaterThan(2);
  });

  it('has wording for every reason the backend emits, and none it does not', () => {
    const backend = [...new Set([...stage2Reasons(spectrumPy), ...stage1Reasons(framesPy)])].sort();
    const frontend = [...FRAME_REASONS].sort();
    expect(frontend, 'refusals.ts FRAME_REASONS vs backend Stage 1 + Stage 2 reasons').toEqual(
      backend,
    );
  });
});

/** The `NAME = "code"` constants at the top of moving.py: the codes it adds to `missing`. */
function movingCodes(py: string): string[] {
  return [...py.matchAll(/^[A-Z_]+ = "([a-z_]+(?::[a-z_]+)?)"$/gm)].map((m) => m[1]!);
}

describe('moving-object path search codes (find/moving.py)', () => {
  it('found the codes', () => {
    expect(movingCodes(movingPy).length).toBeGreaterThan(8);
  });

  it('has wording for every code', () => {
    for (const base of movingCodes(movingPy)) {
      // Per-frame reasons take a frame id; counted codes a count; the rest stand alone.
      const code = !base.includes(':')
        ? `${base}:2026W17_1B_0634_4_D3`
        : countedCode(`${base}:3`)
          ? `${base}:3`
          : base;
      const [group] = groupMissing([code]);
      expect(group?.known, `${code} is known`).toBe(true);
      const text = describeRefusalGroup(group!);
      expect(text, code).not.toMatch(/Not available|reason code/);
    }
  });
});

// ---- Card, params, spectrum and composite codes (issue #146 section 3, A4.12, Q-196) -----------

// A raw code: a snake_case word or a `prefix:code` pair. Plain words such as "catalogue" are fine.
const RAW = /[a-zA-Z]+_[a-zA-Z]+|[a-z]+:[a-z]/;

/** Every `type:exoplanet_*` the classifier emits (classify/rules.py). */
const typeCodes = [
  ...new Set(
    [...backend('classify/rules.py').matchAll(/"(type:exoplanet_[a-z_]+)"/g)].map((m) => m[1]!),
  ),
];

describe('card and params codes that are not layers', () => {
  it('found the type codes in the backend', () => {
    expect(typeCodes.length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    'catalogue',
    'exoplanet_archive',
    'star_catalogue',
    'spectrum',
    'measuring:spectrum',
    'measuring:frames',
    'measuring:mesh',
    ...typeCodes,
  ])('%s has plain wording and no raw code', (code) => {
    const text = nonLayerMissingText(code);
    expect(text, code).not.toBeNull();
    expect(text, code).not.toBe(UNKNOWN_CODE_TEXT);
    expect(text!, code).not.toMatch(RAW);
    const line = describeRefusal({ id: code, reason: 'backend' });
    expect(line).toBe(text);
    expect(line).not.toMatch(/Layer|“/);
  });

  it('a layer id is still worded as a layer', () => {
    expect(nonLayerMissingText('mesh')).toBeNull();
    expect(describeRefusal({ id: 'mesh', reason: 'backend' })).toBe(
      'Shape model: not drawn. The data pipeline left it out.',
    );
  });

  it('an unknown prefixed or layer code gets generic words, never the code', () => {
    const line = describeRefusal({ id: 'zzz_unknown', reason: 'backend' });
    expect(line).not.toContain('zzz');
    expect(describeRefusal({ id: 'type:exoplanet_zzz', reason: 'backend' })).toBe(
      UNKNOWN_CODE_TEXT,
    );
    expect(describeRefusal({ id: 'measuring:zzz_unknown', reason: 'backend' })).not.toContain(
      'zzz',
    );
  });
});

describe('spectrum and composite codes', () => {
  it('words extended_source (whole and per frame) without the code', () => {
    const [whole] = groupMissing(['spectrum:extended_source']);
    expect(whole!.known).toBe(true);
    expect(describeRefusalGroup(whole!)).not.toMatch(RAW);
    const [frame] = groupMissing(['extended_source:2026W17_1B_0634_4_D3']);
    expect(frame!.known).toBe(true);
    expect(describeRefusalGroup(frame!)).toMatch(/^1 frame where/);
    expect(describeRefusalGroup(frame!)).not.toMatch(RAW);
  });

  it('words composite:flags_unmasked:<id> as a frame group', () => {
    const [g] = groupCompositeMissing([
      'composite:flags_unmasked:f1',
      'composite:flags_unmasked:f2',
    ]);
    expect(g!.kind).toBe('frames');
    expect(g!.known).toBe(true);
    expect(g!.count).toBe(2);
    expect(describeRefusalGroup(g!)).not.toMatch(RAW);
    expect(describeRefusalGroup(g!)).toMatch(/^2 frames whose bad-pixel map/);
  });

  it('unknown codes never print the raw code', () => {
    for (const code of ['spectrum:zzz_new', 'zzz_new:f1', 'composite:zzz', 'zzz_plain']) {
      const [g] = groupMissing([code]);
      expect(describeRefusalGroup(g!), code).not.toContain('zzz');
    }
  });
});

describe('flag_reasons', () => {
  it('words outlier_core and the backend flag names, never raw', () => {
    const text = flagReasonsText([
      'outlier_core',
      'no_proper_motion',
      'OUTLIER',
      'NONFINITE',
      'HOT',
    ]);
    expect(text).not.toMatch(/outlier_core|no_proper_motion|OUTLIER|NONFINITE|HOT/);
    expect(text).toMatch(/moving object/);
  });

  it('a name with no wording gets the generic phrase', () => {
    expect(flagReasonsText(['SUR_ERROR', 'ZZZ_NEW'])).toBe('some pixels carried a quality flag');
  });

  it('covers every flag the backend can drop', () => {
    const cfg = backend('measure/config.py');
    const names = [
      ...(/REJECT_FLAGS: tuple\[str, \.\.\.\] = \(([^)]*)\)/.exec(cfg)?.[1] ?? '').matchAll(
        /"([A-Z_]+)"/g,
      ),
    ].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(flagReasonsText([n]), n).not.toMatch(/[A-Z]{3}/);
  });
});
