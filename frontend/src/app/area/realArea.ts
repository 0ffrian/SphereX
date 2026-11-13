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
import { getSpectraApi, SPECTRA_NOT_RUN, SPECTRA_UNAVAILABLE, type AreaSpectra, type SpectraAnswer, type SpectraApi } from './spectraApi';

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
  /**
   * The spectrum check (A17.13, issue #162); null when it was not run (404, `spectra:not_run`) or
   * did not load (`spectra:unavailable`). The demo never has one.
   */
  spectra: AreaSpectra | null;
  /** Codes of what is not there: the replies' `missing`, parts that failed, unmatched dot ids. */
  missing: string[];
  /** Synthetic test data (the fixture server, or a synthetic data release). */
  synthetic: boolean;
}

export interface RealKnown {
  entry: AreaIndexEntry;
  known: AreaKnown;
  /**
   * The area's summary (its frames and visit times, for the provenance lines) and Discovery's
   * tracks (which known objects Discovery detected, Q-466); null when that reply did not load.
   */
  summary: AreaSummary | null;
  tracks: AreaTracks | null;
  /** The dots, read only when a track found a known object (its measured dots on the sky). */
  dots: AreaDots | null;
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
  const out = new Set<string>();
  for (const t of tracks.tracks)
    for (const tl of t.tracklets) for (const id of tl.dot_ids) if (!have.has(id)) out.add(id);
  return [...out];
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

/**
 * Summary, dots, tracks and the spectrum check of one area. The summary is needed; the rest may be
 * missing. The spectrum check is read with the tracks (A18.7) and never fails the area.
 */
export async function loadDiscovery(
  api: ApiClient,
  entry: AreaIndexEntry,
  fixture: string | null,
  signal?: AbortSignal,
  spectraApi: SpectraApi = getSpectraApi(),
): Promise<RealDiscovery> {
  const missing: string[] = [];
  const [summary, dots, tracks, sp] = await Promise.all([
    api.area(entry.area_id, signal).catch(areaFailed),
    part(() => api.areaDots(entry.area_id, signal), 'area:dots_unavailable', missing),
    part(() => api.areaTracks(entry.area_id, signal), 'area:tracks_unavailable', missing),
    spectraApi.areaSpectra(entry.area_id, signal).catch((e: unknown): SpectraAnswer => {
      if (signal?.aborted) throw e;
      return { kind: 'unavailable' };
    }),
  ]);
  // Verdicts only for the tracks the card shows: with no tracks there is nothing to put them on.
  const spectra = sp.kind === 'ok' && tracks ? sp.data : null;
  if (sp.kind === 'not_run') missing.push(SPECTRA_NOT_RUN);
  if (sp.kind === 'unavailable') missing.push(SPECTRA_UNAVAILABLE);
  missing.push(...summary.data.missing, ...(dots?.missing ?? []), ...(tracks?.missing ?? []), ...(spectra?.missing ?? []));
  const unmatched = unmatchedDotIds(dots, tracks);
  if (unmatched.length > 0) missing.push(`area:unmatched_dots:${unmatched.length}`);
  return {
    entry,
    summary: summary.data,
    dots,
    tracks,
    spectra,
    missing: [...new Set(missing)],
    synthetic: isSynthetic(summary.fixture ?? fixture, summary.data.data_release),
  };
}

/**
 * `/known`, with the summary and the tracks beside it (Q-466): `/known` is needed; without the
 * tracks no row is marked Detected (`area:detections_unavailable`), without the summary the visit
 * times are not given (`area:summary_unavailable`), and without the dots a detected object's
 * measured dots are not drawn (`area:dots_unavailable`).
 */
export async function loadKnown(
  api: ApiClient,
  entry: AreaIndexEntry,
  fixture: string | null,
  signal?: AbortSignal,
): Promise<RealKnown> {
  const missing: string[] = [];
  const [r, summary, tracks] = await Promise.all([
    api.areaKnown(entry.area_id, signal).catch(areaFailed),
    part(() => api.area(entry.area_id, signal), 'area:summary_unavailable', missing),
    part(() => api.areaTracks(entry.area_id, signal), 'area:detections_unavailable', missing),
  ]);
  // The measured dots of the detected objects: only when there is one (a busy area has many dots).
  const found = (tracks?.tracks ?? []).some((t) => t.verdict === 'found_blind' && t.match !== null);
  const dots = found ? await part(() => api.areaDots(entry.area_id, signal), 'area:dots_unavailable', missing) : null;
  return {
    entry,
    known: r.data,
    summary,
    tracks,
    dots,
    missing: [...new Set([...r.data.missing, ...missing])],
    synthetic: isSynthetic(r.fixture ?? fixture, entry.data_release),
  };
}

/** True for an area computed live (#141: its id is `live-<hash>`), false for a prepared one. */
export const isLiveArea = (areaId: string): boolean => areaId.startsWith('live-');

/** The first frame time of each visit of the area, in visit order (ISO). */
export function visitStarts(summary: Pick<AreaSummary, 'frames'>): string[] {
  const first = new Map<number, string>();
  for (const f of summary.frames) {
    const t = first.get(f.visit);
    if (t === undefined || Date.parse(f.time) < Date.parse(t)) first.set(f.visit, f.time);
  }
  return [...first.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

// ---- Words -------------------------------------------------------------------------------------

/** "Precomputed · run 10 Nov 2026 12:00 UTC" (Q-205: the card says the result is precomputed). */
export function precomputedNote(computedAt: string): string {
  return `Precomputed · run ${formatUtc(computedAt)}`;
}

/**
 * "433 Eros" from a match. SkyBoT's designation of a numbered object already starts with its number
 * ("433 Eros"), so the number is put in front only when it is not there yet: never "433 433 Eros".
 */
export function matchName(m: { designation: string; number: number | null }): string {
  if (m.number === null) return m.designation;
  const n = String(m.number);
  return m.designation === n || m.designation.startsWith(`${n} `) ? m.designation : `${n} ${m.designation}`;
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
      if (rest === 'detections_unavailable')
        return "Discovery's tracks could not be loaded, so no object is marked Detected.";
      if (rest === 'summary_unavailable') return 'The visits of the area could not be loaded.';
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
    case 'spectra':
      if (rest === 'not_run') return 'Spectrum check not run.';
      if (rest === 'unavailable') return 'The spectrum check could not be loaded, so no colour verdicts are shown.';
      if (rest === 'calibration_default')
        return 'Too few stars to measure the scatter in one visit and detector, so the spectrum check used the default.';
      return code;
    default:
      return code;
  }
}
