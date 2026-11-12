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
import { deltaRa, wrapRa } from '@/viewer/sky/skyMath';
import type { AreaBox } from '@/app/shell/areaStore';
import type { AreaTrack } from '@/contract';
import { getSkyApi } from '@/state/store';
import {
  findArea,
  loadDiscovery,
  loadKnown,
  matchName,
  RealAreaFailed,
  type RealDiscovery,
  type RealKnown,
} from './realArea';

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
}
export interface ErosTrackPoint {
  /** ISO time (UTC). */
  t: string;
  px: [number, number];
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
  id: string;
  name: string;
  kind: string;
  frames: number;
  visits: number;
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
}
export interface DiscoveryDot {
  p: [number, number];
  k: 'glitch' | 'star' | 'stray' | 'mover';
}
export interface DiscoveryStep {
  label: string;
  /** What the step reports once done (dummy numbers, labelled "(demo)"). */
  result: string;
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

/** The demo refuses an area it has no data for (Q-414). */
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

/** True when the drawn box overlaps the prepared Eros area (small-angle: RA scaled by cos Dec). */
export function boxOverlapsEros(box: AreaBox, d: ErosDemo): boolean {
  const e = erosArea(d);
  if (!e) return false;
  const cosD = Math.cos((e.dec * Math.PI) / 180);
  const bra = wrapRa(box.a.ra + deltaRa(box.b.ra, box.a.ra) / 2);
  const bdec = (box.a.dec + box.b.dec) / 2;
  const dx = Math.abs(deltaRa(bra, e.ra)) * cosD;
  const dy = Math.abs(bdec - e.dec);
  return dx < box.widthDeg / 2 + e.halfW && dy < box.heightDeg / 2 + e.halfH;
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
      {
        id: '433',
        name: 'Eros',
        kind: 'asteroid',
        frames: d?.hops.length ?? 16,
        visits: 2,
      },
    ],
  };
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
    { id: 'T1', known: '433 Eros', kind: 'known', pts: [a, z], visits: 2, track: null },
    { id: 'T2', known: null, kind: 'unexplained', pts: [[430, 540], [700, 330]], visits: 2, track: null },
    { id: 'T3', known: null, kind: 'once', pts: [[1010, 560]], visits: 1, track: null },
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
  ];
}

/** A prepared area's tracks as the card's movers (verdicts as stored, A16.5). */
export function realMovers(r: RealDiscovery): DiscoveryMover[] {
  return (r.tracks?.tracks ?? []).map((t) => ({
    id: t.track_id,
    known: t.verdict === 'found_blind' && t.match ? matchName(t.match) : null,
    kind: t.verdict === 'found_blind' ? 'known' : t.visits.length < 2 ? 'once' : 'unexplained',
    pts: [],
    visits: t.visits.length,
    track: t,
  }));
}

/** Known objects: a prepared area's stored reply, else the demo (which refuses outside Eros's area). */
export async function knownObjectsIn(box: AreaBox, signal?: AbortSignal): Promise<KnownObjectsResult> {
  const api = getSkyApi();
  const hit = await findArea(api, box, signal);
  if (!hit) return demoKnownIn(box);
  const real = await loadKnown(api, hit.entry, hit.fixture, signal).catch(refuse);
  return {
    demo: false,
    real,
    objects: real.known.known.map((o) => ({
      id: o.number !== null ? String(o.number) : o.designation,
      name: o.number !== null ? o.designation : '',
      kind: o.kind,
      frames: o.n_frames,
      visits: o.n_visits,
    })),
  };
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
