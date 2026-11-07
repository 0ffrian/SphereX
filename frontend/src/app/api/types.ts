// TEMPORARY (D-18): hand-written copies of the M1 API response shapes (D-16, A4.1, A4.2 and the
// M1 brief's pixel convention). Replace with the types generated from shared/schemas/ once they
// exist. Optional fields are extras that the backend may send; unknown fields are ignored.
import type { Tag } from '../../contract/tags';

/** `GET /v1/resolve?q=<name | "ra,dec" in degrees>` */
export interface ResolveResponse {
  id: string;
  name: string | null;
  /** Degrees (J2000). */
  ra: number;
  /** Degrees (J2000). */
  dec: number;
  moving: boolean;
  resolver: 'simbad' | 'sbdb' | 'coords';
  /** ISO-8601 with `Z` or an offset; set when the reply came from the backend cache (D-25). */
  cached_at: string | null;
}

/** One SPHEREx frame of the object. */
export interface Frame {
  frame_id: string;
  /** ISO-8601 UTC with `Z` (or an explicit offset). */
  time: string;
  wavelength_um: number;
  /** 0-based pixel x of the object's centre in the cutout PNG as served, origin top-left. */
  x: number;
  /** 0-based pixel y of the object's centre in the cutout PNG as served, y increasing downwards. */
  y: number;
  cutout_url: string;
  flags: string[];
  /** Optional: size of the cutout PNG as served, pixels (cutouts differ, and edge ones are clipped). */
  width?: number;
  height?: number;
  /** Optional: object position at this frame's time, degrees. */
  ra?: number;
  dec?: number;
  /** Optional: angle of north in this cutout, degrees (not used in M1). */
  north_angle_deg?: number;
  /** Optional: true when the cutout is mirrored (not used in M1). */
  mirrored?: boolean;
}

export interface Stretch {
  kind: string;
  params: Readonly<Record<string, unknown>>;
}

/** `GET /v1/objects/{id}/frames` */
export interface FramesResponse {
  id: string;
  frames: Frame[];
  /**
   * true: every cutout is resampled to one north-up, east-left grid.
   * false: native frame orientation, so the picture may rotate between frames.
   */
  north_up: boolean;
  stretch: Stretch;
  data_release: string;
  cached_at: string | null;
  /** Refused layers or items, e.g. `frames:moving_object_search`. */
  missing: string[];
  provenance?: Readonly<Record<string, unknown>>;
}

export interface SpectrumPoint {
  wavelength_um: number;
  flux: number;
  /** 1-sigma error, same unit as flux. */
  error: number;
  flagged: boolean;
  frame_id: string;
  /** Optional (#2): why the point is flagged. */
  flag_reasons?: string[];
  /** Optional (#2): fraction of the aperture weight dropped for bad pixels, 0–1. */
  dropped_weight_fraction?: number;
}

export interface LightCurvePoint {
  time: string;
  flux: number;
  error: number;
  frame_id: string;
}

/** `GET /v1/objects/{id}/spectrum` */
export interface SpectrumResponse {
  id: string;
  spectrum: SpectrumPoint[];
  light_curve: LightCurvePoint[];
  flux_unit: string;
  tag: 'measured';
  cached_at: string | null;
  missing: string[];
}

/** Error body: `{ "error": "code", "detail": "human sentence" }` with a 4xx/5xx status. */
export interface ApiErrorBody {
  error: string;
  detail: string;
}

// ---- Sky background (feasibility prototype; not in D-16) ----------------------------------------
// ASSUMPTION: shapes from the sky prototype brief (GET /v1/sky/index.json), built in parallel by the
// backend. Not in D-16 or shared/schemas yet; see Q-87, Q-92 and Q-98.

/** One equirectangular all-sky image: column x → RA = 360·(x+0.5)/W, row y → Dec = 90 − 180·(y+0.5)/H. */
export interface SkyEquirect {
  url: string;
  width: number;
  height: number;
}

/** HiPS tiles of the same survey (tile LOD on zoom is not built yet). */
export interface SkyHips {
  url: string;
  max_order_local: number;
  tile_width: number;
  format: string;
}

export interface SkySurvey {
  id: string;
  title: string;
  credit: string;
  /** Provenance of the picture (D-02): a colour composite is `derived`, with its `formula`. */
  tag: Tag;
  formula: string | null;
  assumption: string | null;
  /** Only `icrs` is drawn. */
  frame: string;
  convention: string | null;
  equirect: SkyEquirect[];
  hips: SkyHips | null;
}

/** `GET /v1/sky/index.json`. An empty list means no sky image is installed. */
export interface SkyIndexResponse {
  surveys: SkySurvey[];
}

/** Provenance of one value (D-02): `derived` carries a formula, `model_dependent` an assumption. */
export interface ValueProvenance {
  tag: Tag;
  formula?: string;
  assumption?: string;
  source?: string;
}

/**
 * One position whose frame list is complete in the backend cache, so it loads at once.
 * ASSUMPTION: shape of `GET /v1/sky/cached` (backend/app/api/sky.py, sky-view prototype, not in
 * D-16 or shared/schemas; Q-92).
 */
export interface SkyCachedObject {
  id: string;
  /** The resolved name; null for a picked or typed position. */
  name: string | null;
  /** The text the resolver was given; searching it again is a cache hit. Null for positions. */
  query: string | null;
  /** Degrees (J2000, ICRS): the resolved position, or the one the coordinate id encodes. */
  ra: number;
  dec: number;
  resolver: 'simbad' | 'sbdb' | 'coords';
  /** Frames in the stored list. */
  frames: number;
  /** Tags of `ra` and `dec`, when the backend has them. */
  provenance: Readonly<Record<string, ValueProvenance>>;
}

/** `GET /v1/sky/cached`. */
export interface SkyCachedResponse {
  objects: SkyCachedObject[];
  data_release: string;
}

// ---- SPHEREx colour composite (not in D-16) -----------------------------------------------------
// ASSUMPTION: shapes from the colour-view brief (7 Nov 2026), built in parallel by the backend:
// `GET /v1/objects/{id}/composite` and the PNG at `image_url` (`…/composite.png`, may carry `?v=`).
// Not in D-16 or shared/schemas yet (D-18); hand-written like the sky index. When `image_url` is
// null the composite is refused and `missing` says why; the image fields may then be null.

export type CompositeChannel = 'blue' | 'green' | 'red';

/** One of the three frames in the composite. */
export interface CompositeBand {
  channel: CompositeChannel;
  frame_id: string;
  wavelength_um: number;
  /** ISO-8601 UTC with `Z` (or an explicit offset). */
  time: string;
  /** Optional: width of the band, µm. */
  bandwidth_um?: number;
}

/** `GET /v1/objects/{id}/composite` */
export interface CompositeResponse {
  id: string;
  data_release: string;
  /** 8-bit RGB PNG; null when the composite is refused (see `missing`). */
  image_url: string | null;
  width: number | null;
  height: number | null;
  /** Arcseconds per PNG pixel. */
  scale_arcsec_px: number | null;
  /** The picture is north up, east left. Always true for a composite that has an image. */
  north_up: boolean;
  /** 0-based PNG pixel of the object, origin top-left, y down; an integer is a pixel centre. */
  x: number | null;
  y: number | null;
  /** Blue, green and red, each once, when there is an image; fewer (or none) when refused. */
  bands: CompositeBand[];
  /** A false-colour composite is `derived` (D-02, Q-27); its formula says how it is built. */
  tag: 'derived';
  /** Required when there is an image; may be null for a refused composite. */
  formula: string | null;
  /** Refusal reasons and notes, e.g. `composite:too_few_bands`. */
  missing: string[];
  cached_at: string | null;
}
