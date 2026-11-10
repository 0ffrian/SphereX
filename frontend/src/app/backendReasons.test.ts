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
import { describeRefusalGroup } from './messages';
import { countedCode, FRAME_REASONS, groupMissing } from './refusals';

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
