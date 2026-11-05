// TEMPORARY (D-18): hand-written copies of the M1 API response shapes (D-16, A4.1, A4.2 and the
// M1 brief's pixel convention). Replace with the types generated from shared/schemas/ once they
// exist. Optional fields are extras that the backend may send; unknown fields are ignored.

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
