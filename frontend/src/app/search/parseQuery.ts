// A4.1 stage 1 input: an object name or RA/Dec in decimal degrees. RA/Dec skips name
// resolution on the backend (D-19); this only decides which one the user typed.

export type ParsedQuery =
  | { kind: 'name'; q: string }
  | { kind: 'coords'; q: string; ra: number; dec: number }
  | { kind: 'invalid'; message: string };

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
/** "17:57:48 +04:41:36" or "17h57m48s": sexagesimal, which M1 does not parse. */
const SEXAGESIMAL = /^\d{1,3}[:h]\d/i;

export const DEGREES_HINT = 'Use RA, Dec in decimal degrees, for example 269.452, 4.693.';

export function validateCoords(ra: number, dec: number): string | null {
  if (!Number.isFinite(ra) || ra < 0 || ra >= 360) return 'RA must be from 0 up to 360 degrees.';
  if (!Number.isFinite(dec) || dec < -90 || dec > 90) return 'Dec must be from −90 to 90 degrees.';
  return null;
}

export function parseQuery(input: string): ParsedQuery {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text === '') return { kind: 'invalid', message: 'Type a name, or RA, Dec in degrees.' };
  if (SEXAGESIMAL.test(text)) return { kind: 'invalid', message: DEGREES_HINT };

  const tokens = text.split(/[\s,]+/).filter((t) => t !== '');
  const allNumbers = tokens.length > 0 && tokens.every((t) => NUMBER.test(t));

  if (allNumbers && tokens.length === 2) {
    const ra = Number(tokens[0]);
    const dec = Number(tokens[1]);
    const problem = validateCoords(ra, dec);
    if (problem) return { kind: 'invalid', message: problem };
    return { kind: 'coords', q: `${ra},${dec}`, ra, dec };
  }
  if (allNumbers && tokens.length >= 3) return { kind: 'invalid', message: DEGREES_HINT };

  // One number alone ("433") or anything with letters is a name: asteroid numbers, provisional
  // designations ("2024 AB") and comets ("C/2023 A3") all reach the resolver as typed (D-19).
  return { kind: 'name', q: text };
}
