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

// ---- M4 overlays (issue #12) -------------------------------------------------------------------
// TEMPORARY (D-18), like the M1 shapes above: hand-written from the issue #12 backend contract.

export type OverlayCatalogName = 'gaia' | 'wise';

/** One catalogue source near the object. Positions and magnitudes are `measured` (catalogue). */
export interface CatalogSource {
  id: string;
  /** Degrees, at the catalogue's `epoch`. */
  ra: number;
  dec: number;
  /** In the catalogue's `mag_band`; null when the catalogue has none for this source. */
  mag: number | null;
  pmra_mas_yr: number | null;
  pmdec_mas_yr: number | null;
}

export interface OverlayCatalog {
  catalog: OverlayCatalogName;
  /** false: the catalogue could not be queried; `overlay:<catalog>` is then in `missing`. */
  available: boolean;
  /** Archive table queried, e.g. a Gaia DR3 table name. */
  table: string;
  /** Epoch of the positions as the backend states it; null when not stated. */
  epoch: string | null;
  mag_band: string;
  /** Faintest magnitude queried; null when no limit was applied. */
  mag_limit: number | null;
  sources: CatalogSource[];
}

/** Photometry aperture and background annulus, in cutout pixels (A4.2). */
export interface OverlayAperture {
  radius_px: number;
  annulus_inner_px: number;
  annulus_outer_px: number;
}

export type FlagGroupName = 'saturation' | 'bad_pixel' | 'artefact' | 'source';

/** One colour of the flag mask PNG and the SPHEREx flag names it covers. */
export interface FlagGroup {
  group: FlagGroupName;
  /** 0–255 each, as drawn in the mask PNG. */
  rgba: [number, number, number, number];
  names: string[];
}

/** A catalogue source drawn on one frame's cutout, same pixel convention as `Frame.x`/`Frame.y`. */
export interface OverlayMarker {
  catalog: OverlayCatalogName;
  id: string;
  x: number;
  y: number;
}

export interface Contamination {
  catalog: OverlayCatalogName;
  id: string;
  mag: number | null;
  zone: 'aperture' | 'annulus';
  /** Distance from the object's centre, cutout pixels. */
  sep_px: number;
}

/** `[ra, dec]` in degrees. */
export type SkyPoint = [number, number];

export interface OverlayFrame {
  frame_id: string;
  /** RGBA flag mask PNG, same size and orientation as the cutout PNG. */
  flags_url: string;
  markers: OverlayMarker[];
  contamination: Contamination[];
  /** Detector footprint on the sky; null when unknown (`footprint:<frame_id>` in `missing`). */
  footprint: SkyPoint[] | null;
  /** The four sky corners of the cutout. */
  cutout_box: [SkyPoint, SkyPoint, SkyPoint, SkyPoint];
}

/** One provenance entry (D-02). `derived` carries a formula, `model_dependent` an assumption. */
export interface ProvenanceEntry {
  tag: Tag;
  source?: string;
  formula?: string;
  assumption?: string;
}

/** `GET /v1/objects/{id}/overlays` */
export interface OverlaysResponse {
  id: string;
  data_release: string;
  cached_at: string | null;
  /** Both catalogues, Gaia then WISE. */
  catalogs: OverlayCatalog[];
  aperture: OverlayAperture;
  flag_groups: FlagGroup[];
  frames: OverlayFrame[];
  /** e.g. `overlay:gaia`, `footprint:<frame_id>`, `flags_mask:<frame_id>`. */
  missing: string[];
  /**
   * Keys: catalog_positions, catalog_mags, markers, contamination, footprint, cutout_box,
   * flags_mask.
   */
  provenance: Readonly<Record<string, ProvenanceEntry>>;
}

export type CombineOp = 'add' | 'sub';

/** The `X-SX-Combine` header of `GET /v1/objects/{id}/combine.png`. */
export interface CombineInfo {
  op: CombineOp;
  a: string;
  b: string;
  wavelength_a_um: number;
  wavelength_b_um: number;
  unit: string;
  stretch: Stretch;
  tag: 'derived';
  formula: string;
}
