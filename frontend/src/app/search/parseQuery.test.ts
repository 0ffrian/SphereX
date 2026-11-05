import { describe, expect, it } from 'vitest';
import { DEGREES_HINT, parseQuery } from './parseQuery';

describe('parseQuery (A4.1 input)', () => {
  it.each([
    ["Barnard's Star", "Barnard's Star"],
    ['  R   Dra ', 'R Dra'],
    ['433 Eros', '433 Eros'],
    ['2024 AB', '2024 AB'],
    ['C/2023 A3', 'C/2023 A3'],
    ['3I/ATLAS', '3I/ATLAS'],
    ['433', '433'],
  ])('%s is a name', (input, q) => {
    expect(parseQuery(input)).toEqual({ kind: 'name', q });
  });

  it.each([
    ['269.452, 4.693', 269.452, 4.693],
    ['269.452,4.693', 269.452, 4.693],
    ['269.452 4.693', 269.452, 4.693],
    ['0, -90', 0, -90],
    ['359.9 +90', 359.9, 90],
    ['.5, -.25', 0.5, -0.25],
  ])('%s is coordinates', (input, ra, dec) => {
    expect(parseQuery(input)).toEqual({ kind: 'coords', q: `${ra},${dec}`, ra, dec });
  });

  it.each(['360, 0', '-1, 0', '10, 91', '10, -90.5'])('%s is out of range', (input) => {
    expect(parseQuery(input).kind).toBe('invalid');
  });

  it.each(['17 57 48.5 +04 41 36', '1 2 3', '17:57:48 +04:41:36', '17h57m48s +4d41m'])(
    '%s asks for decimal degrees',
    (input) => {
      expect(parseQuery(input)).toEqual({ kind: 'invalid', message: DEGREES_HINT });
    },
  );

  it('refuses empty input', () => {
    expect(parseQuery('   ').kind).toBe('invalid');
  });
});
