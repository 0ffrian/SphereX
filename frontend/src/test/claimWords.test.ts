// Issue #201: the A22.3.6 claim-word helper, tested on its own before the hunt cards use it.
import { describe, expect, it } from 'vitest';
import { claimWordsIn, expectNoClaimWords } from './claimWords';

describe('expectNoClaimWords (A22.3.6)', () => {
  it.each([
    'We discovered a new asteroid',
    'Discovered: 3 candidates',
    'A new variable star',
    'NEW candidate',
    'Status: confirmed',
    'Confirmed by Gaia',
    'Found a mover in square 4',
    'found an eclipsing pair',
    'We FOUND  A binary',
  ])('fails on %j', (text) => {
    expect(() => expectNoClaimWords(text)).toThrow(/A22\.3\.6/);
  });

  it.each([
    '24 candidates',
    'Discovery hunts',
    'Not checked against VSX',
    'Renew the cache',
    'Newly measured',
    'Unconfirmed match',
    'A recovery of 433 Eros',
    'Type: contact eclipsing pair (suggested, p = 0.81)',
    'found 24 tracks',
    'Square 3: not covered',
    '',
  ])('passes %j', (text) => {
    expect(() => expectNoClaimWords(text)).not.toThrow();
  });

  it('names every claim it finds, in reading order, as written', () => {
    expect(claimWordsIn('New: we found a pair, then discovered and confirmed it')).toEqual([
      'New',
      'found a',
      'discovered',
      'confirmed',
    ]);
  });

  it('gives the same answer on repeated calls (the patterns hold no state)', () => {
    expect(claimWordsIn('new new')).toEqual(['new', 'new']);
    expect(claimWordsIn('new new')).toEqual(['new', 'new']);
  });
});
