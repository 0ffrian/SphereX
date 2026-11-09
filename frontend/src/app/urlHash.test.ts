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

  it('round-trips the colour view, and old links without it stay raw', () => {
    const hash = formatHash({ ra: 1, dec: 2, name: 'R Dra', frame: 'f-1', colour: 'composite' });
    expect(hash).toBe('#ra=1.00000&dec=2.00000&name=R+Dra&frame=f-1&colour=composite');
    expect(parseHash(hash).colour).toBe('composite');
    expect(parseHash('#ra=1&dec=2&colour=tint')).toEqual({
      ra: 1,
      dec: 2,
      colour: 'tint',
      problems: [],
    });
    // A link made before the colour views: no `colour`, so the flipbook shows the raw frames.
    expect(parseHash('#ra=1&dec=2&name=R%20Dra').colour).toBeUndefined();
    expect(formatHash({ ra: 1, dec: 2 })).not.toContain('colour');
  });

  it('ignores an unknown colour view and says so', () => {
    const parsed = parseHash('#ra=1&dec=2&colour=rainbow');
    expect(parsed.colour).toBeUndefined();
    expect(parsed.problems).toEqual([
      'Link colour view “rainbow” ignored; showing the raw frames.',
    ]);
    expect(hashToQuery(parsed)).toBe('1,2');
  });

  it('formats an empty state as no hash', () => {
    expect(formatHash({})).toBe('');
  });

  it('carries the build pane as a bare `build` flag (issue #60, mock-up #build)', () => {
    expect(formatHash({ build: true })).toBe('#build');
    expect(formatHash({ ra: 1, dec: 2, name: 'Aqua Prime', build: true })).toBe(
      '#ra=1.00000&dec=2.00000&name=Aqua+Prime&build',
    );
    expect(parseHash('#build')).toEqual({ build: true, problems: [] });
    expect(parseHash('#ra=1&dec=2&build').build).toBe(true);
    expect(parseHash('#ra=1&dec=2').build).toBeUndefined();
    expect(hashToQuery(parseHash('#build'))).toBeNull();
  });
});
