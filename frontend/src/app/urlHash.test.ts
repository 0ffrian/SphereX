import { describe, expect, it } from 'vitest';
import { formatHash, hashToQuery, parseHash } from './urlHash';

describe('URL hash (A10 hash routing)', () => {
  it('round-trips coordinates, name and frame', () => {
    const hash = formatHash({
      ra: 269.452083,
      dec: 4.693389,
      name: "Barnard's Star",
      frame: 'f-003',
    });
    expect(hash.startsWith('#ra=269.45208&dec=4.69339')).toBe(true);
    const parsed = parseHash(hash);
    expect(parsed).toEqual({
      ra: 269.45208,
      dec: 4.69339,
      name: "Barnard's Star",
      frame: 'f-003',
      problems: [],
    });
  });

  it('encodes characters that are unsafe in a URL', () => {
    const hash = formatHash({ ra: 1, dec: 2, name: 'C/2023 A3 & co' });
    expect(hash).not.toMatch(/ /);
    expect(parseHash(hash).name).toBe('C/2023 A3 & co');
  });

  it('prefers the name, then coordinates', () => {
    expect(hashToQuery(parseHash('#ra=1&dec=2&name=R%20Dra'))).toBe('R Dra');
    expect(hashToQuery(parseHash('#ra=1&dec=2'))).toBe('1,2');
    expect(hashToQuery(parseHash('#frame=x'))).toBeNull();
    expect(hashToQuery(parseHash(''))).toBeNull();
  });

  it.each(['#ra=abc&dec=2', '#ra=400&dec=2', '#ra=1&dec=-95', '#ra=1', '#dec=1', '#ra=&dec=1'])(
    'ignores bad coordinates in %s and says so',
    (hash) => {
      const parsed = parseHash(hash);
      expect(parsed.ra).toBeUndefined();
      expect(parsed.dec).toBeUndefined();
      expect(parsed.problems).toHaveLength(1);
    },
  );

  it('ignores unknown keys', () => {
    expect(parseHash('#foo=bar&ra=1&dec=2')).toEqual({ ra: 1, dec: 2, problems: [] });
  });

  it('formats an empty state as no hash', () => {
    expect(formatHash({})).toBe('');
  });
});
