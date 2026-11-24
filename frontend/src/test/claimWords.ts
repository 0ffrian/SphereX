// Test helper (src/test/ is test-only code): fails when hunt text makes a claim the hunts must
// never make. A22.3.6 (Wording rules, extends A16.5): a candidate is never "discovered", "new" or
// "confirmed", and never "found a ...". Each rule is matched as a whole word, ignoring case, so
// "renew", "newly" and the tool's name "Discovery" pass. Issue #201; used by the hunt cards (HN-3).
import { expect } from 'vitest';

/** The A22.3.6 claims, one pattern each. `label` is what a failing test prints. */
const CLAIMS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'discovered', pattern: /\bdiscovered\b/gi },
  { label: 'new', pattern: /\bnew\b/gi },
  { label: 'confirmed', pattern: /\bconfirmed\b/gi },
  // "found a ..." and "found an ...": "found 24" is a count and passes.
  { label: 'found a ...', pattern: /\bfound\s+an?\b/gi },
];

/**
 * Every claim in `text`, in reading order. Each hit is the matched text with its original case and
 * spacing, not the rule's label (e.g. ["New", "found  A"]), so it can be printed as written.
 */
export function claimWordsIn(text: string): string[] {
  const hits: { at: number; word: string }[] = [];
  for (const { pattern } of CLAIMS)
    for (const m of text.matchAll(pattern)) hits.push({ at: m.index, word: m[0] });
  return hits.sort((a, b) => a.at - b.at).map((h) => h.word);
}

/** Fails the test when `text` holds an A22.3.6 claim word, naming each one it found. */
export function expectNoClaimWords(text: string): void {
  const hits = claimWordsIn(text);
  expect(
    hits,
    `A22.3.6: hunt text must not say ${CLAIMS.map((c) => `"${c.label}"`).join(', ')}; got ${JSON.stringify(text)}`,
  ).toEqual([]);
}
