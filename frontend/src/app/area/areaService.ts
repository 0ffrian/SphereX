// The area search service seam (Known objects and Discovery, the dock's two square tools).
//
// DUMMY DATA. The area search backend is not built, so every function here returns a fixed,
// clearly marked demo answer (`demo: true`) and never queries anything. The demo answers only when
// the drawn area overlaps the prepared Eros area (the sky image of public/demo/eros/eros.json);
// anywhere else it refuses with `area:not_prepared` (Q-414). Eros's frames and path are real
// SPHEREx demo data (extracted from mockup/chase-the-rock.html); where they sit in the drawn
// square, the dots, the counts and the two other movers are made up. The UI shows a "Demo data"
// tag wherever it uses them.
//
// Issue #130 (Q-455, Q-414): knownObjectsIn() is real. It picks the prepared area from
// GET /v1/areas, then reads /v1/areas/{id}/known. Only when the backend cannot be reached does it
// fall back to the demo answer below (never blank), flagged `demo: true`. discoverIn() is still the
// demo (Kevin's #109): unchanged.
import { ApiError } from '@/app/api/errors';
import { createApiClient, type ApiClient } from '@/app/api/client';
import type { AreaIndexEntry, AreaKnown, AreaKnownObject, AreaKnownPosition, TrackPath } from '@/contract';
import type { Frame } from '@/app/api/types';
import { deltaRa, wrapRa } from '@/viewer/sky/skyMath';
import type { AreaBox } from '@/app/shell/areaStore';
import { isoToMjd } from './erosModel';

let api: ApiClient = createApiClient();
/** Tests swap the client; pass null to restore the default. */
export function setAreaApi(client: ApiClient | null): void {
  api = client ?? createApiClient();
}

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
  /** Horizons positions at each frame time, seen from SPHEREx: `model_dependent` (A16.5). */
  positions?: AreaKnownPosition[];
  /** When SkyBoT last answered for this object's visits (ISO, UTC); null when none did. */
  skybotAt?: string | null;
}
export interface KnownObjectsResult {
  /** True only for the fixed Eros fallback; the real answer is false. */
  demo: boolean;
  objects: KnownObject[];
  /** Real answer only. */
  areaId?: string;
  /** The reply came from the dev fixture server (synthetic), not the real pack. */
  fixture?: boolean;
  /** The reply's `missing` codes (`skybot:<visit>`, `horizons:<designation>`). */
  missing?: string[];
  /** The reply's provenance: positions `model_dependent` (Horizons), SkyBoT answer dates. */
  provenance?: AreaKnown['provenance'];
}

export type MoverKind = 'known' | 'unexplained' | 'once';
export interface DiscoveryMover {
  id: string;
  /** Name when it matches a known object, else null. */
  known: string | null;
  kind: MoverKind;
  /** Detections on the demo sky image, in its pixels; one per visit. */
  pts: [number, number][];
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
  demo: true;
  steps: DiscoveryStep[];
  dots: DiscoveryDot[];
  movers: DiscoveryMover[];
}

export type AreaFlow = 'known' | 'discovery';
export type AreaSearchResult =
  | ({ flow: 'known' } & KnownObjectsResult)
  | ({ flow: 'discovery' } & DiscoveryResult);

export const NOT_PREPARED = 'No prepared data for this area yet.';

/** A refused area: not prepared (Q-414) or not found by id (A17.8 `area_not_found`). */
export type AreaRefusalCode = 'area:not_prepared' | 'area_not_found';
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

/**
 * The prepared area of `GET /v1/areas` that the drawn box overlaps; with several, the one whose
 * centre is nearest the box centre. Null when none overlaps (`area:not_prepared`).
 */
export function pickArea(box: AreaBox, areas: readonly AreaIndexEntry[]): AreaIndexEntry | null {
  const cosD = Math.cos((((box.a.dec + box.b.dec) / 2) * Math.PI) / 180);
  const bra = wrapRa(box.a.ra + deltaRa(box.b.ra, box.a.ra) / 2);
  const bdec = (box.a.dec + box.b.dec) / 2;
  let best: AreaIndexEntry | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    const span: AreaSpan = { ra: a.ra, dec: a.dec, halfW: a.width_deg / 2, halfH: a.height_deg / 2 };
    if (!boxOverlaps(box, span)) continue;
    const d = Math.hypot(deltaRa(bra, a.ra) * cosD, bdec - a.dec);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
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

/** The demo's Eros row: used only when the backend cannot be reached (never blank). */
async function knownDemoIn(box: AreaBox): Promise<KnownObjectsResult> {
  const d = await preparedFor(box);
  return {
    demo: true,
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

/** The latest SkyBoT answer date of the visits (ISO), null when none answered. */
export function latestSkybot(known: Pick<AreaKnown, 'skybot'>): string | null {
  let best: string | null = null;
  for (const s of known.skybot) if (s.fetched_at && (!best || isoToMjd(s.fetched_at) > isoToMjd(best))) best = s.fetched_at;
  return best;
}

/** Turns the `/known` reply into rows (A18.5). Pure. */
export function mapKnown(areaId: string, reply: AreaKnown, fixture: boolean): KnownObjectsResult {
  const skybotAt = latestSkybot(reply);
  const objects = reply.known.map((k: AreaKnownObject): KnownObject => ({
    ...splitDesignation(k.designation, k.number),
    kind: k.kind,
    frames: k.n_frames,
    visits: k.n_visits,
    designation: k.designation,
    objectId: k.object_id,
    trackAvailable: k.track_available,
    positions: k.positions,
    skybotAt,
  }));
  return { demo: false, objects, areaId, fixture, missing: reply.missing, provenance: reply.provenance };
}

/** An error from the API that means "the backend cannot answer now" (the demo may stand in). */
const isOutage = (e: unknown): boolean =>
  e instanceof ApiError && e.kind !== 'aborted' && e.kind !== 'not_found' && e.kind !== 'bad_request';

/**
 * Known objects in the drawn area (A18.5, issue #130): the prepared area from `GET /v1/areas`, then
 * its `/known` reply. No overlapping area -> `area:not_prepared`; an unknown id -> `area_not_found`.
 * ASSUMPTION: if the backend is unreachable, a box over the Eros demo area still answers with the
 * demo row (flagged `demo: true`, so the Demo tag stays); elsewhere the error propagates.
 */
export async function knownObjectsIn(box: AreaBox, signal?: AbortSignal): Promise<KnownObjectsResult> {
  try {
    const index = await api.areas(signal);
    const area = pickArea(box, index.data.areas);
    if (!area) throw new AreaRefused();
    const known = await api.areaKnown(area.area_id, signal);
    return mapKnown(area.area_id, known.data, index.fixture !== null || known.fixture !== null);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'area_not_found') {
      throw new AreaRefused('area_not_found', 'This area is no longer in the prepared set.');
    }
    if (isOutage(e)) {
      try {
        return await knownDemoIn(box);
      } catch {
        /* not over the demo area either: say what failed */
      }
    }
    throw e;
  }
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
    for (const p of path.points) {
      const px = skyToPx(demo, p.ra, p.dec);
      if (px) track.push({ t: p.time, px });
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
export async function loadObjectTrack(objectId: string, signal?: AbortSignal): Promise<{ frames: Frame[]; path: TrackPath | null }> {
  const [frames, path] = await Promise.all([
    api.frames(objectId, signal),
    api.path(objectId, signal).then(
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
export async function discoverIn(box: AreaBox): Promise<DiscoveryResult> {
  const d = await preparedFor(box);
  const hs = d?.hops ?? [];
  const a: [number, number] = hs[0]?.wide_px ?? [867, 291];
  const z: [number, number] = hs[hs.length - 1]?.wide_px ?? [1080, 235];
  const r = rng(77);
  const X = () => 30 + r() * 1220;
  const Y = () => 30 + r() * 660;
  const movers: DiscoveryMover[] = [
    { id: 'T1', known: '433 Eros', kind: 'known', pts: [a, z] },
    { id: 'T2', known: null, kind: 'unexplained', pts: [[430, 540], [700, 330]] },
    { id: 'T3', known: null, kind: 'once', pts: [[1010, 560]] },
  ];
  const dots: DiscoveryDot[] = [];
  for (let i = 0; i < 58; i++) dots.push({ p: [X(), Y()], k: 'glitch' });
  for (let i = 0; i < 141; i++) dots.push({ p: [X(), Y()], k: 'star' });
  for (let i = 0; i < 8; i++) dots.push({ p: [X(), Y()], k: 'stray' });
  for (const m of movers) for (const p of m.pts) dots.push({ p, k: 'mover' });
  return {
    demo: true,
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

/** One entry point: the flow chosen in the dock decides what is asked. */
export async function areaSearch(box: AreaBox, flow: AreaFlow): Promise<AreaSearchResult> {
  return flow === 'known'
    ? { flow, ...(await knownObjectsIn(box)) }
    : { flow, ...(await discoverIn(box)) };
}
