// The area search service seam (Known objects and Discovery, the dock's two square tools).
//
// REAL DATA FIRST (issue #96, Q-205: precomputed results). The drawn square is snapped to a prepared
// area of `GET /v1/areas`; when one holds it, its stored replies are read and shown as they are
// (realArea.ts), tagged "Precomputed" and, for synthetic fixtures, "Test data".
//
// DEMO FALLBACK. When no prepared area holds the square (or there is no backend), the functions
// return the fixed, clearly marked demo answer (`demo: true`). The demo answers only when
// the drawn area overlaps the prepared Eros area (the sky image of public/demo/eros/eros.json);
// anywhere else it refuses with `area:not_prepared` (Q-414). Eros's frames and path are real
// SPHEREx demo data (extracted from mockup/chase-the-rock.html); where they sit in the drawn
// square, the dots, the counts and the two other movers are made up. The UI shows a "Demo data"
// tag wherever it uses them.
//
// Issue #130 (Q-455): a known object's "Track it" reads its `/frames` and `/path`
// (loadObjectTrack); the Eros card keeps the demo's cutouts, mask and brightness under the Demo tag.
import type { TrackWindow } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import type { Frame } from '@/app/api/types';
import { deltaRa, wrapRa } from '@/viewer/sky/skyMath';
import type { AreaBox } from '@/app/shell/areaStore';
import type { AreaKnownObject, AreaKnownPosition, AreaTrack, TrackPath } from '@/contract';
import { getSkyApi } from '@/state/store';
import { isoToMjd } from './erosModel';
import {
  findArea,
  loadDiscovery,
  loadKnown,
  matchName,
  RealAreaFailed,
  type RealDiscovery,
  type RealKnown,
} from './realArea';
import type { TrackSpectrum } from './spectraApi';
import { verdictCounts } from './spectrumWords';

/** One exposure of 433 Eros (the demo frames). Fields as in the demo file's `hops`. */
export interface ErosHop {
  frame_id: string;
  exposure: number;
  detector: string;
  mjd_avg: number;
  hw_flags: string[];
  nx: number;
  ny: number;
  x: number;
  y: number;
  wl_um: number;
  flux: number;
  flux_err?: number;
  /** [x, y, flux] of bright-peak masks in the cutout, in cutout pixels (artistic: not catalogue stars). */
  stars: [number, number, number][];
  /** The path across the cutout, in cutout pixels relative to its centre. */
  seg: [number, number][];
  north: [number, number];
  east: [number, number];
  /** Data URIs of the cutout and its flagged-pixel mask. */
  png: string;
  flags_png: string;
  /** Position on the demo sky image, in its pixels. */
  wide_px: [number, number];
  /** Set on a real frame that the demo file has no cutout for (issue #130): nothing is drawn for it. */
  no_cutout?: boolean;
}
export interface ErosTrackPoint {
  /** ISO time (UTC). */
  t: string;
  px: [number, number];
  /** First point of a new observing window of `/path` (A19): no line joins it to the point before. */
  gap?: true;
}
/** D-02 provenance of a field of the demo file. */
export interface ErosProvenance {
  tag: 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic';
  note: string;
}
export interface ErosDemo {
  object: { name: string };
  /** The prepared sky image: `center` (RA, Dec in degrees) and `deg_per_px`. */
  wide: { png: string; w: number; h: number; center?: [number, number]; deg_per_px?: number };
  provenance?: Record<string, ErosProvenance>;
  track: ErosTrackPoint[];
  hops: ErosHop[];
}

export interface KnownObject {
  /** The number ("433") or, for an unnumbered object, its designation. */
  id: string;
  /** The name without its number ("Eros"). */
  name: string;
  kind: string;
  frames: number;
  visits: number;
  /** Real rows only (issue #130, `/known`): the designation as SkyBoT gives it, e.g. "433 Eros". */
  designation?: string;
  /** The backend's object id (`sbdb-20000433`), null when it has none. */
  objectId?: string | null;
  /** True: the Track pane could open it offline (A17.5). The demo row is always true. */
  trackAvailable?: boolean;
  /**
   * Set when Track it computed this object's Track for a window (Q-468): the Track view reads
   * that window's frames and path. Absent: the base windows (a prepared object).
   */
  trackWindow?: TrackWindow;
  /** Horizons positions at each frame time, seen from SPHEREx: `model_dependent` (A16.5). */
  positions?: AreaKnownPosition[];
  /** Real rows: the number, null for an unnumbered object. */
  number?: number | null;
  /** Real rows: SkyBoT's V magnitude, null when it gave none. */
  vMag?: number | null;
  /**
   * Q-466: the Discovery track that found this object blind (`found_blind`, matched to it), with
   * its median distance from the predicted position; null when Discovery did not detect it, and
   * undefined when that is not known (the tracks did not load, or the demo).
   */
  detection?: { trackId: string; sepPx: number | null; points?: { ra: number; dec: number }[] } | null;
}
export interface KnownObjectsResult {
  /** True for the made-up demo answer; false for a prepared area's stored reply. */
  demo: boolean;
  objects: KnownObject[];
  /** The prepared area's reply (null for the demo). */
  real: RealKnown | null;
}

export type MoverKind = 'known' | 'unexplained' | 'once';
export interface DiscoveryMover {
  id: string;
  /** Name when it matches a known object, else null. */
  known: string | null;
  kind: MoverKind;
  /** Detections on the demo sky image, in its pixels; one per visit (empty for real tracks). */
  pts: [number, number][];
  /** Number of visits the mover is seen in. */
  visits: number;
  /** The prepared area's track (null for the demo). */
  track: AreaTrack | null;
  /** The track's spectrum check (A17.13); null for the demo, or when the check was not run. */
  spectrum: TrackSpectrum | null;
}
export interface DiscoveryDot {
  p: [number, number];
  k: 'glitch' | 'star' | 'stray' | 'mover';
}
export interface DiscoveryStep {
  label: string;
  /** What the step reports once done (dummy numbers, labelled "(demo)"). */
  result: string;
  /**
   * The result under Measured only (D-21), when `result` carries a model_dependent verdict: the
   * spectrum check's "3 rock-like, ..." becomes "9 tracks checked". Absent: `result` shows as it is.
   */
  measuredResult?: string;
}
export interface DiscoveryResult {
  /** True for the made-up demo answer; false for a prepared area's stored replies. */
  demo: boolean;
  /** The prepared area's replies (null for the demo). */
  real: RealDiscovery | null;
  steps: DiscoveryStep[];
  dots: DiscoveryDot[];
  movers: DiscoveryMover[];
}

export type AreaFlow = 'known' | 'discovery';
export type AreaSearchResult =
  | ({ flow: 'known' } & KnownObjectsResult)
  | ({ flow: 'discovery' } & DiscoveryResult);

export const NOT_PREPARED = 'No prepared data for this area yet.';

/** The demo refuses an area it has no data for (Q-414); a prepared area that fails to load. */
export type AreaRefusalCode = 'area:not_prepared' | 'area:failed';
export class AreaRefused extends Error {
  readonly code: AreaRefusalCode;
  constructor(code: AreaRefusalCode = 'area:not_prepared', message = NOT_PREPARED) {
    super(message);
    this.name = 'AreaRefused';
    this.code = code;
  }
}

/** The prepared Eros area on the sky: centre, and half sides in degrees (null when the file lacks them). */
export function erosArea(d: ErosDemo): { ra: number; dec: number; halfW: number; halfH: number } | null {
  const c = d.wide.center;
  const k = d.wide.deg_per_px;
  if (!c || !k || !(d.wide.w > 0) || !(d.wide.h > 0)) return null;
  return { ra: c[0], dec: c[1], halfW: (d.wide.w * k) / 2, halfH: (d.wide.h * k) / 2 };
}

/** A prepared area on the sky: centre and half sides in degrees. */
export interface AreaSpan {
  ra: number;
  dec: number;
  halfW: number;
  halfH: number;
}

/** True when the drawn box overlaps the area (small-angle: RA scaled by cos Dec). */
export function boxOverlaps(box: AreaBox, e: AreaSpan): boolean {
  const cosD = Math.cos((e.dec * Math.PI) / 180);
  const bra = wrapRa(box.a.ra + deltaRa(box.b.ra, box.a.ra) / 2);
  const bdec = (box.a.dec + box.b.dec) / 2;
  const dx = Math.abs(deltaRa(bra, e.ra)) * cosD;
  const dy = Math.abs(bdec - e.dec);
  return dx < box.widthDeg / 2 + e.halfW && dy < box.heightDeg / 2 + e.halfH;
}

/** True when the drawn box overlaps the prepared Eros area of the demo file. */
export function boxOverlapsEros(box: AreaBox, d: ErosDemo): boolean {
  const e = erosArea(d);
  return e ? boxOverlaps(box, e) : false;
}

/** The demo file when the box overlaps the prepared area; else refuses with `area:not_prepared`. */
async function preparedFor(box: AreaBox): Promise<ErosDemo> {
  const d = await erosDemo();
  if (!d || !boxOverlapsEros(box, d)) throw new AreaRefused();
  return d;
}

let erosPromise: Promise<ErosDemo | null> | null = null;

/** The demo frames and path of 433 Eros (null when the file cannot be loaded; asked again later). */
export function erosDemo(): Promise<ErosDemo | null> {
  if (erosPromise) return erosPromise;
  const url = `${import.meta.env.BASE_URL}demo/eros/eros.json`;
  erosPromise = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<ErosDemo>) : null))
    .then((d) => {
      if (!d) return null;
      d.hops = d.hops.slice().sort((a, b) => a.mjd_avg - b.mjd_avg || a.detector.localeCompare(b.detector));
      return d;
    })
    .catch(() => null)
    .then((d) => {
      if (!d) erosPromise = null;
      return d;
    });
  return erosPromise;
}

/** Dummy: the one known object, only for a box that overlaps the prepared Eros area. */
async function demoKnownIn(box: AreaBox): Promise<KnownObjectsResult> {
  const d = await preparedFor(box);
  return {
    demo: true,
    real: null,
    objects: [
      { id: '433', name: 'Eros', kind: 'asteroid', frames: d?.hops.length ?? 16, visits: 2, trackAvailable: true },
    ],
  };
}

/** "433 Eros" with number 433 -> { id: "433", name: "Eros" }; unnumbered: the designation is the id. */
export function splitDesignation(designation: string, number: number | null): { id: string; name: string } {
  if (number !== null && designation.startsWith(`${number} `)) {
    return { id: String(number), name: designation.slice(String(number).length + 1) };
  }
  return { id: number !== null ? String(number) : designation, name: number !== null ? designation : '' };
}

/** The latest SkyBoT answer date of the area's visits (ISO), null when none answered. */
export function latestSkybot(known: Pick<RealKnown['known'], 'skybot'>): string | null {
  let best: string | null = null;
  for (const s of known.skybot) {
    if (s.fetched_at && (!best || isoToMjd(s.fetched_at) > isoToMjd(best))) best = s.fetched_at;
  }
  return best;
}

/** True when a track's match names this known object: same object id, else number, else designation. */
export function matchesKnown(
  m: { designation: string; number: number | null; object_id: string | null },
  k: Pick<AreaKnownObject, 'designation' | 'number' | 'object_id'>,
): boolean {
  if (m.object_id !== null && k.object_id !== null) return m.object_id === k.object_id;
  if (m.number !== null && k.number !== null) return m.number === k.number;
  return m.designation === k.designation;
}

/**
 * One `/known` row as the card's row (A18.5): the reply's fields, nothing computed. With the area's
 * tracks, a row is Detected when a `found_blind` track matched it (Q-466). Pure.
 */
export function knownRow(
  k: AreaKnownObject,
  tracks: readonly AreaTrack[] | null = null,
  dots: ReadonlyMap<string, { ra: number; dec: number }> | null = null,
): KnownObject {
  let detection: KnownObject['detection'];
  if (tracks) {
    const t = tracks.find((x) => x.verdict === 'found_blind' && x.match !== null && matchesKnown(x.match, k));
    detection = t ? { trackId: t.track_id, sepPx: t.match?.median_sep_px ?? null } : null;
    if (t && dots) {
      const points = t.tracklets.flatMap((tl) => tl.dot_ids.map((id) => dots.get(id)).filter((p) => p !== undefined));
      detection = { ...detection!, points };
    }
  }
  return {
    ...splitDesignation(k.designation, k.number),
    kind: k.kind,
    frames: k.n_frames,
    visits: k.n_visits,
    designation: k.designation,
    objectId: k.object_id,
    trackAvailable: k.track_available,
    positions: k.positions,
    number: k.number,
    vMag: k.v_mag,
    ...(detection !== undefined ? { detection } : {}),
  };
}

/**
 * The Known list's order (Q-466): detected first, then by brightness (smaller V first; no V last),
 * then by designation, so the same reply always lists the same way. Pure; returns a new array.
 */
export function sortKnown(objects: readonly KnownObject[]): KnownObject[] {
  const v = (o: KnownObject) => (o.vMag ?? null) === null ? Infinity : (o.vMag as number);
  return objects.slice().sort(
    (a, b) =>
      Number(!a.detection) - Number(!b.detection) ||
      v(a) - v(b) ||
      (a.designation ?? a.id).localeCompare(b.designation ?? b.id),
  );
}

/**
 * The Eros card's data for an object (issue #130): `/frames` and `/path` of `objectId` replace the
 * demo's frame list, counts and sky path. Where a real frame has a demo cutout (same frame id, the
 * same exposure) the demo's cutout, mask and brightness are kept (still demo); a real frame the demo
 * has no cutout for is listed with `no_cutout`. The path is projected onto the demo sky image.
 */
export function mergeReal(demo: ErosDemo | null, frames: readonly Frame[], path: TrackPath | null): ErosDemo {
  const byId = new Map((demo?.hops ?? []).map((h) => [h.frame_id, h]));
  const hops: ErosHop[] = frames.map((f) => {
    const d = byId.get(f.frame_id);
    const det = /_(D\d)$/.exec(f.frame_id)?.[1] ?? 'D?';
    const exp = Number(/_(\d+)_D\d$/.exec(f.frame_id)?.[1] ?? 0);
    if (d) return { ...d, mjd_avg: isoToMjd(f.time), wl_um: f.wavelength_um };
    return {
      frame_id: f.frame_id,
      exposure: exp,
      detector: det,
      mjd_avg: isoToMjd(f.time),
      hw_flags: f.flags,
      nx: 0,
      ny: 0,
      x: 0,
      y: 0,
      wl_um: f.wavelength_um,
      flux: Number.NaN,
      stars: [],
      seg: [],
      north: [0, 1],
      east: [1, 0],
      png: '',
      flags_png: '',
      wide_px: [0, 0],
      no_cutout: true,
    };
  });
  hops.sort((a, b) => a.mjd_avg - b.mjd_avg || a.detector.localeCompare(b.detector));
  const base: ErosDemo = demo ?? {
    object: { name: '' },
    wide: { png: '', w: 0, h: 0 },
    provenance: undefined,
    track: [],
    hops: [],
  };
  const track: ErosTrackPoint[] = [];
  if (path && demo) {
    // A19: the path is never joined across a gap between windows (or a point the plane cannot show).
    const windowOf = (iso: string): number => {
      const t = Date.parse(iso);
      return path.windows.findIndex((w) => Date.parse(w.start) <= t && t <= Date.parse(w.end));
    };
    let prevWindow: number | null = null;
    let broken = false;
    for (const p of path.points) {
      const px = skyToPx(demo, p.ra, p.dec);
      if (!px) {
        broken = true;
        continue;
      }
      const w = windowOf(p.time);
      const gap = track.length > 0 && (broken || (prevWindow !== null && w !== prevWindow));
      track.push(gap ? { t: p.time, px, gap: true } : { t: p.time, px });
      prevWindow = w;
      broken = false;
    }
  }
  return { ...base, hops, track };
}

/** Sky position to a pixel of the demo sky image (tangent plane; reproduces the demo track to 0.5 px). */
export function skyToPx(d: ErosDemo, ra: number, dec: number): [number, number] | null {
  const c = d.wide.center;
  const k = d.wide.deg_per_px;
  if (!c || !k || !(d.wide.w > 0)) return null;
  const r = Math.PI / 180;
  const a0 = c[0] * r;
  const d0 = c[1] * r;
  const a = ra * r;
  const dd = dec * r;
  const cs = Math.sin(d0) * Math.sin(dd) + Math.cos(d0) * Math.cos(dd) * Math.cos(a - a0);
  if (!(cs > 0)) return null;
  const xi = (Math.cos(dd) * Math.sin(a - a0)) / cs;
  const eta = (Math.cos(d0) * Math.sin(dd) - Math.sin(d0) * Math.cos(dd) * Math.cos(a - a0)) / cs;
  const kr = k * r;
  return [d.wide.w / 2 - xi / kr, d.wide.h / 2 - eta / kr];
}

/** What the Eros card reads for an object: its frames and path from the API. Throws on failure. */
export async function loadObjectTrack(
  objectId: string,
  signal?: AbortSignal,
  window?: TrackWindow | null,
): Promise<{ frames: Frame[]; path: TrackPath | null }> {
  const api = getSkyApi();
  const [frames, path] = await Promise.all([
    api.frames(objectId, signal, window),
    api.path(objectId, signal, window).then(
      (p) => p.data,
      (e: unknown) => {
        if (e instanceof ApiError && e.kind === 'aborted') throw e;
        return null; // no path: the sky path is simply not drawn
      },
    ),
  ]);
  return { frames: frames.data.frames, path };
}

/** Mulberry32, the mock-up's `rng`, so the dummy dots land where the mock-up puts them. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dummy: the mock-up's 212 dots and three movers (T1 is Eros, T2 and T3 are made up), only for a
 * box that overlaps the prepared Eros area. The counts are demo counts, not catalogue results.
 */
async function demoDiscoverIn(box: AreaBox): Promise<DiscoveryResult> {
  const d = await preparedFor(box);
  const hs = d?.hops ?? [];
  const a: [number, number] = hs[0]?.wide_px ?? [867, 291];
  const z: [number, number] = hs[hs.length - 1]?.wide_px ?? [1080, 235];
  const r = rng(77);
  const X = () => 30 + r() * 1220;
  const Y = () => 30 + r() * 660;
  const movers: DiscoveryMover[] = [
    { id: 'T1', known: '433 Eros', kind: 'known', pts: [a, z], visits: 2, track: null, spectrum: null },
    { id: 'T2', known: null, kind: 'unexplained', pts: [[430, 540], [700, 330]], visits: 2, track: null, spectrum: null },
    { id: 'T3', known: null, kind: 'once', pts: [[1010, 560]], visits: 1, track: null, spectrum: null },
  ];
  const dots: DiscoveryDot[] = [];
  for (let i = 0; i < 58; i++) dots.push({ p: [X(), Y()], k: 'glitch' });
  for (let i = 0; i < 141; i++) dots.push({ p: [X(), Y()], k: 'star' });
  for (let i = 0; i < 8; i++) dots.push({ p: [X(), Y()], k: 'stray' });
  for (const m of movers) for (const p of m.pts) dots.push({ p, k: 'mover' });
  return {
    demo: true,
    real: null,
    steps: [
      { label: 'Find dots', result: '212 in 16 frames (demo)' },
      { label: 'Drop one-exposure glitches', result: '−58 (demo)' },
      { label: 'Drop stars (Gaia DR3, CatWISE)', result: '−141 (demo)' },
      { label: 'Join what moves across visits', result: '3 groups (demo)' },
      { label: 'Check known objects (SkyBoT)', result: '1 known (demo)' },
    ],
    dots,
    movers,
  };
}

/** A refusal of the real path, in the demo's refusal type (the cards read only that). */
function refuse(e: unknown): never {
  if (e instanceof RealAreaFailed) throw new AreaRefused('area:failed', e.message);
  throw e;
}

/** The steps of a prepared area, from its stored counts (A18.3); nothing is computed here. */
export function realSteps(r: RealDiscovery): DiscoveryStep[] {
  const n = r.summary.steps;
  const checked = `${n.n_found_blind} found blind, ${n.n_unexplained} unexplained` +
    (n.n_unchecked > 0 ? `, ${n.n_unchecked} not checked` : '');
  return [
    { label: 'Find dots', result: `${n.n_dots} in ${r.summary.n_frames} frames` },
    { label: 'Drop one-exposure glitches', result: `−${n.n_glitches}` },
    { label: 'Drop stars (Gaia DR3, CatWISE)', result: `−${n.n_stars} stars, −${n.n_fixed} fixed` },
    {
      label: 'Join what moves across visits',
      result: `${n.n_tracks} tracks` + (n.n_possible > 0 ? `, ${n.n_possible} possible` : ''),
    },
    { label: 'Check known objects (SkyBoT)', result: checked },
    // A17.13: only when the area has a stored spectrum check (else "Spectrum check not run" is
    // listed under Not shown).
    ...(r.spectra
      ? [
          {
            label: SPECTRUM_STEP,
            result: verdictCounts(r.spectra.tracks),
            measuredResult: tracksChecked(r.spectra.tracks.length),
          },
        ]
      : []),
  ];
}

/** The spectrum step's neutral result under Measured only (the verdicts are model_dependent, D-21). */
const tracksChecked = (n: number) => `${n} track${n === 1 ? '' : 's'} checked`;

/** The step of the spectrum check (A18.7); the row verdicts show once it is done. */
export const SPECTRUM_STEP = 'Check the spectrum';

/** A prepared area's tracks as the card's movers (verdicts as stored, A16.5). */
export function realMovers(r: RealDiscovery): DiscoveryMover[] {
  const spectra = new Map((r.spectra?.tracks ?? []).map((s) => [s.track_id, s]));
  return (r.tracks?.tracks ?? []).map((t) => ({
    id: t.track_id,
    known: t.verdict === 'found_blind' && t.match ? matchName(t.match) : null,
    kind: t.verdict === 'found_blind' ? 'known' : t.visits.length < 2 ? 'once' : 'unexplained',
    pts: [],
    visits: t.visits.length,
    track: t,
    spectrum: spectra.get(t.track_id) ?? null,
  }));
}

/**
 * Known objects (A18.5): a prepared area's stored `/known` reply, else the demo (which refuses
 * outside Eros's area). The demo also stands in when the index cannot be read (no backend); a
 * prepared area whose `/known` fails, or breaks the contract, refuses with `area:failed`.
 */
export async function knownObjectsIn(box: AreaBox, signal?: AbortSignal): Promise<KnownObjectsResult> {
  const api = getSkyApi();
  const hit = await findArea(api, box, signal);
  if (!hit) return demoKnownIn(box);
  const real = await loadKnown(api, hit.entry, hit.fixture, signal).catch(refuse);
  const tracks = real.tracks?.tracks ?? null;
  const dots = real.dots ? new Map(real.dots.visits.flatMap((v) => v.dots.map((d) => [d.dot_id, { ra: d.ra, dec: d.dec }] as const))) : null;
  return { demo: false, real, objects: sortKnown(real.known.known.map((k) => knownRow(k, tracks, dots))) };
}

/** Discovery: a prepared area's stored replies, else the demo (which refuses outside Eros's area). */
export async function discoverIn(box: AreaBox, signal?: AbortSignal): Promise<DiscoveryResult> {
  const api = getSkyApi();
  const hit = await findArea(api, box, signal);
  if (!hit) return demoDiscoverIn(box);
  const real = await loadDiscovery(api, hit.entry, hit.fixture, signal).catch(refuse);
  return { demo: false, real, steps: realSteps(real), dots: [], movers: realMovers(real) };
}

/** One entry point: the flow chosen in the dock decides what is asked. */
export async function areaSearch(box: AreaBox, flow: AreaFlow): Promise<AreaSearchResult> {
  return flow === 'known'
    ? { flow, ...(await knownObjectsIn(box)) }
    : { flow, ...(await discoverIn(box)) };
}
