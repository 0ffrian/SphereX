// Issue #177: two source files whose paths differ only by case (ScanRings.tsx and scanRings.ts)
// broke the dev server on Windows and macOS, where file names ignore case: an import without an
// extension found the wrong file (`.ts` is tried before `.tsx`). Linux, where the tests run, never
// sees it, so this test fails the suite on any new such pair.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const DIRS = ['src', 'e2e', 'scripts'];
/** Known pairs, safe only because every import names the extension. Do not add to this list. */
const ALLOWED = new Set(['src/app/starcloseup']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
/** A path as an import without its extension sees it, lower-cased (`a/B.test.ts` -> `a/b.test`). */
const key = (p: string) =>
  relative(ROOT, p)
    .replace(/\.[^./]+$/, '')
    .toLowerCase();

describe('file names', () => {
  it('no two source files differ only by case', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of DIRS.flatMap((d) => files(join(ROOT, d)))) {
      const k = key(f);
      const other = seen.get(k);
      const rel = relative(ROOT, f);
      if (
        other &&
        other.replace(/\.[^./]+$/, '') !== rel.replace(/\.[^./]+$/, '') &&
        !ALLOWED.has(k)
      )
        clashes.push(`${other} <-> ${rel}`);
      else if (!other) seen.set(k, rel);
    }
    expect(clashes).toEqual([]);
  });
});
