// A10 hash routing (optional challenge item): a shareable link with coordinates.
// Format: #ra=<deg>&dec=<deg>[&name=<search text>][&frame=<frame_id>][&colour=tint|composite]
//         [&area=<area_id>][&build]
// `build` (issue #60, as the mock-up's `#build`) is there while the build pane is open; on its own
// (`#build`) it is the 3D view with no object searched.
// `name` is kept when the search was by name, so a link to a moving object reopens the same
// object id rather than whatever sits at those coordinates. `colour` is the flipbook's colour view
// (colourMode.ts); without it the flipbook shows the raw frames, so older links keep working.
// `area` (A18.9, A21.11; issue #96) opens Area search on that prepared area; a hash with only
// `area` is valid (no object needed).
import { parseColourParam, type ColourView } from './flipbook/colourMode';
import { validateCoords } from './search/parseQuery';

export interface HashState {
  name?: string;
  ra?: number;
  dec?: number;
  frame?: string;
  colour?: ColourView;
  /** The build pane is open (issue #60). */
  build?: boolean;
  /** Area search is open on this prepared area (A18.9). */
  area?: string;
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

  const colour = params.get('colour')?.trim();
  if (colour) {
    const view = parseColourParam(colour);
    if (view) out.colour = view;
    else out.problems.push(`Link colour view “${colour}” ignored; showing the raw frames.`);
  }
  const area = params.get('area')?.trim();
  if (area) out.area = area;
  if (params.has('build')) out.build = true;
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
  if (state.colour) params.set('colour', state.colour);
  if (state.area) params.set('area', state.area);
  const s = params.toString();
  // A bare `build` flag, written without "=" so the link reads as the mock-up's `#build`.
  const all = state.build ? (s === '' ? 'build' : `${s}&build`) : s;
  return all === '' ? '' : `#${all}`;
}

/** The search a hash asks for: the name when present, else the coordinates. */
export function hashToQuery(h: ParsedHash): string | null {
  if (h.name) return h.name;
  if (h.ra !== undefined && h.dec !== undefined) return `${h.ra},${h.dec}`;
  return null;
}
