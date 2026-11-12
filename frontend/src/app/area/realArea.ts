// The real Area search data (A17.8; issue #96, Q-205: precomputed results). The dock's square is
// snapped to a prepared area of `GET /v1/areas` (one gnomonic box definition, sky/area/geometry.ts),
// then that area's stored replies are read through the validated client. Nothing is computed here:
// the counts, dots, tracks and verdicts are the backend's, shown as they are.
//
// Refuse rather than invent: a part that does not load is not drawn, and its reason goes to
// `missing` with the replies' own `missing` codes, which the cards list (missingText).
import type { ApiClient } from '@/app/api/client';
import { isApiError } from '@/app/api/errors';
import type {
  AreaDots,
  AreaIndexEntry,
  AreaKnown,
  AreaSummary,
  AreaTrack,
  AreaTracks,
} from '@/contract';
import { snapToArea } from '@/app/sky/area/snap';
import type { SkySquare } from '@/app/sky/area/geometry';
import { formatUtc } from '@/app/format';
import { deltaRa, wrapRa } from '@/viewer/sky/skyMath';

/** The drawn rectangle as the snap reads it: its centre and its larger side. */
export interface DrawnBox {
  a: { ra: number; dec: number };
  b: { ra: number; dec: number };
  widthDeg: number;
  heightDeg: number;
}

export function squareOf(box: DrawnBox): SkySquare {
  return {
    ra: wrapRa(box.a.ra + deltaRa(box.b.ra, box.a.ra) / 2),
    dec: (box.a.dec + box.b.dec) / 2,
    sideDeg: Math.max(box.widthDeg, box.heightDeg),
  };
}

/** One prepared area's Discovery replies. `dots` / `tracks` are null when they did not load. */
export interface RealDiscovery {
  entry: AreaIndexEntry;
  summary: AreaSummary;
  dots: AreaDots | null;
  tracks: AreaTracks | null;
  /** Codes of what is not there: the replies' `missing`, parts that failed, unmatched dot ids. */
  missing: string[];
  /** Synthetic test data (the fixture server, or a synthetic data release). */
  synthetic: boolean;
}

export interface RealKnown {
  entry: AreaIndexEntry;
  known: AreaKnown;
  missing: string[];
  synthetic: boolean;
}

export class RealAreaFailed extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RealAreaFailed';
    this.code = code;
  }
}

// A synthetic data release (the shared fixtures) is named "synthetic_…"; matched by prefix so the
// fixture marker itself never ships in the build (scripts/check-dist.js).
const isSynthetic = (fixture: string | null, release: string) =>
  fixture === 'synthetic' || release.startsWith('synthetic');

/**
 * The prepared area that holds the drawn box, or null: no area holds it, or the index cannot be
 * read (no backend). The caller then keeps the demo, which refuses outside its own area (Q-414).
 */
export async function findArea(
  api: ApiClient,
  box: DrawnBox,
  signal?: AbortSignal,
): Promise<{ entry: AreaIndexEntry; fixture: string | null } | null> {
  let index;
  try {
    index = await api.areaIndex(signal);
  } catch (e) {
    if (isApiError(e) && e.kind === 'aborted') throw e;
    return null;
  }
  const entry = snapToArea(squareOf(box), index.data.areas);
  return entry ? { entry, fixture: index.fixture } : null;
}

/** Dot ids that tracks name but `/dots` does not hold (drawn short, so listed as missing). */
export function unmatchedDotIds(dots: AreaDots | null, tracks: AreaTracks | null): string[] {
  if (!dots || !tracks) return [];
  const have = new Set<string>();
  for (const v of dots.visits) for (const d of v.dots) have.add(d.dot_id);
  const out: string[] = [];
  for (const t of tracks.tracks)
    for (const tl of t.tracklets) for (const id of tl.dot_ids) if (!have.has(id)) out.push(id);
  return out;
}

async function part<T>(
  load: () => Promise<{ data: T }>,
  code: string,
  missing: string[],
): Promise<T | null> {
  try {
    return (await load()).data;
  } catch (e) {
    if (isApiError(e) && e.kind === 'aborted') throw e;
    missing.push(code);
    return null;
  }
}

function areaFailed(e: unknown): never {
  if (isApiError(e) && e.kind === 'aborted') throw e;
  throw new RealAreaFailed(
    'area:failed',
    'The prepared area could not be loaded. Draw the area again.',
  );
}

/** Summary, dots and tracks of one area. The summary is needed; dots and tracks may be missing. */
export async function loadDiscovery(
  api: ApiClient,
  entry: AreaIndexEntry,
  fixture: string | null,
  signal?: AbortSignal,
): Promise<RealDiscovery> {
  const missing: string[] = [];
  const [summary, dots, tracks] = await Promise.all([
    api.area(entry.area_id, signal).catch(areaFailed),
    part(() => api.areaDots(entry.area_id, signal), 'area:dots_unavailable', missing),
    part(() => api.areaTracks(entry.area_id, signal), 'area:tracks_unavailable', missing),
  ]);
  missing.push(...summary.data.missing, ...(dots?.missing ?? []), ...(tracks?.missing ?? []));
  const unmatched = unmatchedDotIds(dots, tracks);
  if (unmatched.length > 0) missing.push(`area:unmatched_dots:${unmatched.length}`);
  return {
    entry,
    summary: summary.data,
    dots,
    tracks,
    missing: [...new Set(missing)],
    synthetic: isSynthetic(summary.fixture ?? fixture, summary.data.data_release),
  };
}

export async function loadKnown(
  api: ApiClient,
  entry: AreaIndexEntry,
  fixture: string | null,
  signal?: AbortSignal,
): Promise<RealKnown> {
  const r = await api.areaKnown(entry.area_id, signal).catch(areaFailed);
  return {
    entry,
    known: r.data,
    missing: [...new Set(r.data.missing)],
    synthetic: isSynthetic(r.fixture ?? fixture, entry.data_release),
  };
}

// ---- Words -------------------------------------------------------------------------------------

/** "Precomputed · run 10 Nov 2026 12:00 UTC" (Q-205: the card says the result is precomputed). */
export function precomputedNote(computedAt: string): string {
  return `Precomputed · run ${formatUtc(computedAt)}`;
}

export function matchName(m: { designation: string; number: number | null }): string {
  return m.number !== null ? `${m.number} ${m.designation}` : m.designation;
}

/** The on-sky label of a track (A18.2). Never "asteroid", "new" or "discover" (Q-205). */
export function areaTrackLabel(
  t: Pick<AreaTrack, 'track_id' | 'verdict' | 'reason' | 'visits'> & {
    match: { designation: string; number: number | null } | null;
  },
): string {
  switch (t.verdict) {
    case 'found_blind':
      return `${t.track_id} · found blind = ${t.match ? matchName(t.match) : 'a known object'}`;
    case 'unexplained':
      return `${t.track_id} · unexplained track`;
    case 'unchecked':
      return `${t.track_id} · not checked`;
    case 'possible':
      if (t.reason === 'ambiguous') return `${t.track_id} · possible · ambiguous pair`;
      return t.visits.length === 1
        ? `${t.track_id} · possible · 1 visit`
        : `${t.track_id} · possible`;
  }
}

/** One `missing` code in plain words (A17.8 namespaces); an unworded code is shown as it is. */
export function missingText(code: string): string {
  const colon = code.indexOf(':');
  const ns = colon > 0 ? code.slice(0, colon) : code;
  const rest = colon > 0 ? code.slice(colon + 1) : '';
  switch (ns) {
    case 'area':
      if (rest === 'dots_unavailable') return 'The dots could not be loaded, so none are drawn.';
      if (rest === 'tracks_unavailable')
        return 'The tracks could not be loaded, so none are drawn.';
      if (rest.startsWith('unmatched_dots:')) {
        const n = rest.slice('unmatched_dots:'.length);
        return `${n} track ${n === '1' ? 'point is' : 'points are'} not in the dots reply, so some tracks are drawn short.`;
      }
      return code;
    case 'skybot':
      return `The known-object check (SkyBoT) has no answer for visit ${rest}.`;
    case 'horizons':
      return `No predicted path for ${rest}.`;
    case 'stamp':
      return `No cutout for dot ${rest}.`;
    case 'rate_grid':
      return 'The rate grid needs more visits.';
    case 'checks':
      return 'The checks were not run for this area.';
    default:
      return code;
  }
}
