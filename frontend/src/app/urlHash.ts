// A10 hash routing (optional challenge item): a shareable link with coordinates.
// Format: #ra=<deg>&dec=<deg>[&name=<search text>][&frame=<frame_id>]
// `name` is kept when the search was by name, so a link to a moving object reopens the same
// object id rather than whatever sits at those coordinates.
import { validateCoords } from './search/parseQuery';

export interface HashState {
  name?: string;
  ra?: number;
  dec?: number;
  frame?: string;
}

export interface ParsedHash extends HashState {
  /** Parts that were present but unusable; they are ignored, never guessed. */
  problems: string[];
}

const COORD_DP = 5;

export function parseHash(hash: string): ParsedHash {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const out: ParsedHash = { problems: [] };

  const name = params.get('name')?.trim();
  if (name) out.name = name;

  const raText = params.get('ra');
  const decText = params.get('dec');
  if (raText !== null || decText !== null) {
    const ra = raText === null || raText.trim() === '' ? NaN : Number(raText);
    const dec = decText === null || decText.trim() === '' ? NaN : Number(decText);
    const problem = validateCoords(ra, dec);
    if (problem) out.problems.push(`Link coordinates ignored: ${problem}`);
    else {
      out.ra = ra;
      out.dec = dec;
    }
  }

  const frame = params.get('frame')?.trim();
  if (frame) out.frame = frame;
  return out;
}

export function formatHash(state: HashState): string {
  const params = new URLSearchParams();
  if (state.ra !== undefined && state.dec !== undefined) {
    params.set('ra', state.ra.toFixed(COORD_DP));
    params.set('dec', state.dec.toFixed(COORD_DP));
  }
  if (state.name) params.set('name', state.name);
  if (state.frame) params.set('frame', state.frame);
  const s = params.toString();
  return s === '' ? '' : `#${s}`;
}

/** The search a hash asks for: the name when present, else the coordinates. */
export function hashToQuery(h: ParsedHash): string | null {
  if (h.name) return h.name;
  if (h.ra !== undefined && h.dec !== undefined) return `${h.ra},${h.dec}`;
  return null;
}
