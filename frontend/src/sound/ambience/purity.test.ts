// Guard: the ambience physics core stays pure and deterministic, reads the engine only through the contract, and does
// not depend on the haptics folder (deleted in #111).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'src', 'sound', 'ambience');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.testutil.ts'));
const ALLOWED = [/^\.\//, /^@\/contract$/, /^@\/engine\/worlds\/types$/, /^@\/engine\/worlds\/cardToWorld$/, /^@\/engine\/worlds\/presets\.js$/];

describe('ambience core purity', () => {
  it.each(files)('%s: no clocks, no randomness, allowed imports only', (f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    expect(src).not.toMatch(/haptics\//);
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      expect(ALLOWED.some((r) => r.test(m[1]!))).toBe(true);
    }
  });
});
