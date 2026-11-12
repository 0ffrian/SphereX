// Issue #71: the generated notes equal what the preview says today (skipped where the preview is not checked out).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script, no types
import { extractWorldNotes } from '../../scripts/gen-world-notes.mjs';
import * as gen from './worldNotes.generated';

const PREVIEW =
  process.env.SX_PREVIEW_HTML ??
  '/home/moon/Desktop/Projects/SphereX/.claude/worktrees/sculptor-reference/sculptor-preview-next.html';

describe('worldNotes.generated', () => {
  it('has the new Lava item, the updated crust item and the full honesty paragraph', () => {
    expect(gen.WORLD_NOTE_LINES.some((l) => l.startsWith('Lava:'))).toBe(true);
    expect(gen.WORLD_NOTE_LINES.find((l) => l.startsWith('Crust and carbon:'))).toMatch(
      /stagnant lid/,
    );
    expect(gen.WORLD_HONESTY).toMatch(/lava example/);
    expect(gen.ERROR_BARS_NOTE).toMatch(/^Once error bars are wired in/);
    expect(gen.COMET_FORMULA_PLAIN).toBe('N = 4π Δ² F / (g h ν) → Q = 2 v N / (π ρ)');
  });
  it.skipIf(!existsSync(PREVIEW))('matches the preview file', () => {
    const n = extractWorldNotes(readFileSync(PREVIEW, 'utf8'));
    expect(gen.WORLD_NOTE_LINES).toEqual(n.lines);
    expect(gen.WORLD_HONESTY).toBe(n.honesty);
    expect(gen.FLY_NOTE).toBe(n.flyNote);
    expect(gen.ERROR_BARS_NOTE).toBe(n.errorBars);
    expect(gen.COMET_FORMULA_PLAIN).toBe(n.cometFormula);
    expect(gen.COMET_FORMULA_NOTE).toBe(n.cometNote);
  });
});
