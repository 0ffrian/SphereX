// Runtime checks for the M1 API replies (D-16). A reply that does not match the contract is
// refused with ApiError('bad_response'); nothing is defaulted or guessed. Unknown extra fields are
// ignored, so the backend can add optional fields without breaking the UI.
import { ApiError } from './errors';
import { TAGS } from '@/contract';
import type {
  ApiErrorBody,
  CatalogSource,
  CombineInfo,
  Contamination,
  FlagGroup,
  Frame,
  FramesResponse,
  LightCurvePoint,
  OverlayCatalog,
  OverlayFrame,
  OverlayMarker,
  OverlaysResponse,
  ProvenanceEntry,
  ResolveResponse,
  SkyPoint,
  SpectrumPoint,
  SpectrumResponse,
} from './types';

type Obj = Readonly<Record<string, unknown>>;

/** ISO-8601 date-time that states its zone: `Z` or `±hh:mm` / `±hhmm`. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function isIsoWithZone(value: string): boolean {
  return ISO_WITH_ZONE.test(value) && !Number.isNaN(Date.parse(value));
}

function fail(path: string, what: string): never {
  throw new ApiError('bad_response', `${path}: ${what}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'expected a string');
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'expected a number');
  return v;
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'expected true or false');
  return v;
}

function time(o: Obj, key: string, path: string): string {
  const v = str(o, key, path);
  if (!isIsoWithZone(v)) fail(`${path}.${key}`, 'expected ISO-8601 time with Z or an offset');
  return v;
}

function nullableTime(o: Obj, key: string, path: string): string | null {
  return o[key] === null ? null : time(o, key, path);
}

function arr(o: Obj, key: string, path: string): readonly unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${path}.${key}`, 'expected a list');
  return v;
}

function strList(o: Obj, key: string, path: string): string[] {
  return arr(o, key, path).map((v, i) => {
    if (typeof v !== 'string') fail(`${path}.${key}[${i}]`, 'expected a string');
    return v;
  });
}

/** Optional fields: absent or null means "not sent"; any other wrong type is refused. */
function optNum(o: Obj, key: string, path: string): number | undefined {
  return o[key] === undefined || o[key] === null ? undefined : num(o, key, path);
}

function optBool(o: Obj, key: string, path: string): boolean | undefined {
  return o[key] === undefined || o[key] === null ? undefined : bool(o, key, path);
}

const RESOLVERS = ['simbad', 'sbdb', 'coords'] as const;

export function parseResolve(raw: unknown): ResolveResponse {
  const p = 'resolve';
  const o = obj(raw, p);
  const resolver = str(o, 'resolver', p);
  if (!(RESOLVERS as readonly string[]).includes(resolver)) {
    fail(`${p}.resolver`, `expected one of ${RESOLVERS.join(', ')}`);
  }
  const name = o.name === null ? null : str(o, 'name', p);
  const ra = num(o, 'ra', p);
  const dec = num(o, 'dec', p);
  if (ra < 0 || ra >= 360) fail(`${p}.ra`, 'expected 0 ≤ RA < 360');
  if (dec < -90 || dec > 90) fail(`${p}.dec`, 'expected −90 ≤ Dec ≤ 90');
  return {
    id: str(o, 'id', p),
    name,
    ra,
    dec,
    moving: bool(o, 'moving', p),
    resolver: resolver as ResolveResponse['resolver'],
    cached_at: nullableTime(o, 'cached_at', p),
  };
}

function parseFrame(raw: unknown, path: string): Frame {
  const o = obj(raw, path);
  const frame: Frame = {
    frame_id: str(o, 'frame_id', path),
    time: time(o, 'time', path),
    wavelength_um: num(o, 'wavelength_um', path),
    x: num(o, 'x', path),
    y: num(o, 'y', path),
    cutout_url: str(o, 'cutout_url', path),
    flags: strList(o, 'flags', path),
  };
  const ra = optNum(o, 'ra', path);
  const dec = optNum(o, 'dec', path);
  const northAngle = optNum(o, 'north_angle_deg', path);
  const mirrored = optBool(o, 'mirrored', path);
  if (ra !== undefined) frame.ra = ra;
  if (dec !== undefined) frame.dec = dec;
  if (northAngle !== undefined) frame.north_angle_deg = northAngle;
  if (mirrored !== undefined) frame.mirrored = mirrored;
  return frame;
}

export function parseFrames(raw: unknown): FramesResponse {
  const p = 'frames';
  const o = obj(raw, p);
  const stretchObj = obj(o.stretch, `${p}.stretch`);
  const params = obj(stretchObj.params, `${p}.stretch.params`);
  const out: FramesResponse = {
    id: str(o, 'id', p),
    frames: arr(o, 'frames', p).map((f, i) => parseFrame(f, `${p}.frames[${i}]`)),
    north_up: bool(o, 'north_up', p),
    stretch: { kind: str(stretchObj, 'kind', `${p}.stretch`), params },
    data_release: str(o, 'data_release', p),
    cached_at: nullableTime(o, 'cached_at', p),
    missing: strList(o, 'missing', p),
  };
  if (o.provenance !== undefined && o.provenance !== null) {
    out.provenance = obj(o.provenance, `${p}.provenance`);
  }
  return out;
}

function parsePoint(raw: unknown, path: string): SpectrumPoint {
  const o = obj(raw, path);
  const error = num(o, 'error', path);
  if (error < 0) fail(`${path}.error`, 'expected a non-negative error');
  const point: SpectrumPoint = {
    wavelength_um: num(o, 'wavelength_um', path),
    flux: num(o, 'flux', path),
    error,
    flagged: bool(o, 'flagged', path),
    frame_id: str(o, 'frame_id', path),
  };
  if (o.flag_reasons !== undefined && o.flag_reasons !== null) {
    point.flag_reasons = strList(o, 'flag_reasons', path);
  }
  const dropped = optNum(o, 'dropped_weight_fraction', path);
  if (dropped !== undefined) {
    if (dropped < 0 || dropped > 1) fail(`${path}.dropped_weight_fraction`, 'expected 0–1');
    point.dropped_weight_fraction = dropped;
  }
  return point;
}

function parseLightCurvePoint(raw: unknown, path: string): LightCurvePoint {
  const o = obj(raw, path);
  return {
    time: time(o, 'time', path),
    flux: num(o, 'flux', path),
    error: num(o, 'error', path),
    frame_id: str(o, 'frame_id', path),
  };
}

export function parseSpectrum(raw: unknown): SpectrumResponse {
  const p = 'spectrum';
  const o = obj(raw, p);
  if (o.tag !== 'measured') fail(`${p}.tag`, "expected 'measured'");
  return {
    id: str(o, 'id', p),
    spectrum: arr(o, 'spectrum', p).map((v, i) => parsePoint(v, `${p}.spectrum[${i}]`)),
    light_curve: arr(o, 'light_curve', p).map((v, i) =>
      parseLightCurvePoint(v, `${p}.light_curve[${i}]`),
    ),
    flux_unit: str(o, 'flux_unit', p),
    tag: 'measured',
    cached_at: nullableTime(o, 'cached_at', p),
    missing: strList(o, 'missing', p),
  };
}

// ---- M4 overlays (issue #12) ------------------------------------------------------------------

function nullableNum(o: Obj, key: string, path: string): number | null {
  if (!(key in o)) fail(`${path}.${key}`, 'expected a number or null');
  return o[key] === null ? null : num(o, key, path);
}

function nullableStr(o: Obj, key: string, path: string): string | null {
  if (!(key in o)) fail(`${path}.${key}`, 'expected a string or null');
  return o[key] === null ? null : str(o, key, path);
}

function nonNeg(o: Obj, key: string, path: string): number {
  const v = num(o, key, path);
  if (v < 0) fail(`${path}.${key}`, 'expected a non-negative number');
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T {
  const v = str(o, key, path);
  if (!(allowed as readonly string[]).includes(v)) {
    fail(`${path}.${key}`, `expected one of ${allowed.join(', ')}`);
  }
  return v as T;
}

const CATALOGS = ['gaia', 'wise'] as const;
const FLAG_GROUPS = ['saturation', 'bad_pixel', 'artefact', 'source'] as const;
const ZONES = ['aperture', 'annulus'] as const;

function skyPoint(raw: unknown, path: string): SkyPoint {
  if (!Array.isArray(raw) || raw.length !== 2) fail(path, 'expected [ra, dec]');
  const [ra, dec] = raw as unknown[];
  if (typeof ra !== 'number' || !Number.isFinite(ra) || ra < 0 || ra >= 360) {
    fail(`${path}[0]`, 'expected 0 ≤ RA < 360');
  }
  if (typeof dec !== 'number' || !Number.isFinite(dec) || dec < -90 || dec > 90) {
    fail(`${path}[1]`, 'expected −90 ≤ Dec ≤ 90');
  }
  return [ra, dec];
}

function parseSource(raw: unknown, path: string): CatalogSource {
  const o = obj(raw, path);
  const [ra, dec] = skyPoint([o.ra, o.dec], `${path}.(ra, dec)`);
  return {
    id: str(o, 'id', path),
    ra,
    dec,
    mag: nullableNum(o, 'mag', path),
    pmra_mas_yr: nullableNum(o, 'pmra_mas_yr', path),
    pmdec_mas_yr: nullableNum(o, 'pmdec_mas_yr', path),
  };
}

function parseCatalog(raw: unknown, path: string): OverlayCatalog {
  const o = obj(raw, path);
  return {
    catalog: oneOf(o, 'catalog', path, CATALOGS),
    available: bool(o, 'available', path),
    table: str(o, 'table', path),
    epoch: nullableStr(o, 'epoch', path),
    mag_band: str(o, 'mag_band', path),
    mag_limit: nullableNum(o, 'mag_limit', path),
    sources: arr(o, 'sources', path).map((v, i) => parseSource(v, `${path}.sources[${i}]`)),
  };
}

function parseFlagGroup(raw: unknown, path: string): FlagGroup {
  const o = obj(raw, path);
  const rgba = arr(o, 'rgba', path);
  if (
    rgba.length !== 4 ||
    !rgba.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 255)
  ) {
    fail(`${path}.rgba`, 'expected four integers 0–255');
  }
  return {
    group: oneOf(o, 'group', path, FLAG_GROUPS),
    rgba: [...rgba] as FlagGroup['rgba'],
    names: strList(o, 'names', path),
  };
}

function parseMarker(raw: unknown, path: string): OverlayMarker {
  const o = obj(raw, path);
  return {
    catalog: oneOf(o, 'catalog', path, CATALOGS),
    id: str(o, 'id', path),
    x: num(o, 'x', path),
    y: num(o, 'y', path),
  };
}

function parseContamination(raw: unknown, path: string): Contamination {
  const o = obj(raw, path);
  return {
    catalog: oneOf(o, 'catalog', path, CATALOGS),
    id: str(o, 'id', path),
    mag: nullableNum(o, 'mag', path),
    zone: oneOf(o, 'zone', path, ZONES),
    sep_px: nonNeg(o, 'sep_px', path),
  };
}

function parseOverlayFrame(raw: unknown, path: string): OverlayFrame {
  const o = obj(raw, path);
  if (!('footprint' in o)) fail(`${path}.footprint`, 'expected a list of [ra, dec] or null');
  let footprint: SkyPoint[] | null = null;
  if (o.footprint !== null) {
    footprint = arr(o, 'footprint', path).map((v, i) => skyPoint(v, `${path}.footprint[${i}]`));
    if (footprint.length < 3) fail(`${path}.footprint`, 'expected at least 3 corners');
  }
  const box = arr(o, 'cutout_box', path).map((v, i) => skyPoint(v, `${path}.cutout_box[${i}]`));
  if (box.length !== 4) fail(`${path}.cutout_box`, 'expected 4 corners');
  return {
    frame_id: str(o, 'frame_id', path),
    flags_url: str(o, 'flags_url', path),
    markers: arr(o, 'markers', path).map((v, i) => parseMarker(v, `${path}.markers[${i}]`)),
    contamination: arr(o, 'contamination', path).map((v, i) =>
      parseContamination(v, `${path}.contamination[${i}]`),
    ),
    footprint,
    cutout_box: box as OverlayFrame['cutout_box'],
  };
}

/** R3.1: a `derived` entry has a formula, a `model_dependent` one an assumption. */
function parseProvenanceEntry(raw: unknown, path: string): ProvenanceEntry {
  const o = obj(raw, path);
  const entry: ProvenanceEntry = { tag: oneOf(o, 'tag', path, TAGS) };
  for (const key of ['source', 'formula', 'assumption'] as const) {
    if (o[key] !== undefined && o[key] !== null) entry[key] = str(o, key, path);
  }
  if (entry.tag === 'derived' && !entry.formula?.trim()) {
    fail(`${path}.formula`, 'a derived value needs a formula');
  }
  if (entry.tag === 'model_dependent' && !entry.assumption?.trim()) {
    fail(`${path}.assumption`, 'a model_dependent value needs an assumption');
  }
  return entry;
}

export function parseOverlays(raw: unknown): OverlaysResponse {
  const p = 'overlays';
  const o = obj(raw, p);
  const catalogs = arr(o, 'catalogs', p).map((v, i) => parseCatalog(v, `${p}.catalogs[${i}]`));
  const names = catalogs.map((c) => c.catalog);
  if (new Set(names).size !== names.length) fail(`${p}.catalogs`, 'a catalogue is listed twice');
  const ap = obj(o.aperture, `${p}.aperture`);
  const apPath = `${p}.aperture`;
  const provRaw = obj(o.provenance, `${p}.provenance`);
  const provenance: Record<string, ProvenanceEntry> = {};
  for (const [key, value] of Object.entries(provRaw)) {
    provenance[key] = parseProvenanceEntry(value, `${p}.provenance.${key}`);
  }
  return {
    id: str(o, 'id', p),
    data_release: str(o, 'data_release', p),
    cached_at: nullableTime(o, 'cached_at', p),
    catalogs,
    aperture: {
      radius_px: nonNeg(ap, 'radius_px', apPath),
      annulus_inner_px: nonNeg(ap, 'annulus_inner_px', apPath),
      annulus_outer_px: nonNeg(ap, 'annulus_outer_px', apPath),
    },
    flag_groups: arr(o, 'flag_groups', p).map((v, i) =>
      parseFlagGroup(v, `${p}.flag_groups[${i}]`),
    ),
    frames: arr(o, 'frames', p).map((v, i) => parseOverlayFrame(v, `${p}.frames[${i}]`)),
    missing: strList(o, 'missing', p),
    provenance,
  };
}

const COMBINE_OPS = ['add', 'sub'] as const;

/** The `X-SX-Combine` header (JSON text). A missing or unreadable header refuses the image. */
export function parseCombineInfo(header: string | null): CombineInfo {
  const p = 'X-SX-Combine';
  if (header === null) fail(p, 'header missing');
  let raw: unknown;
  try {
    raw = JSON.parse(header);
  } catch {
    fail(p, 'not JSON');
  }
  const o = obj(raw, p);
  if (o.tag !== 'derived') fail(`${p}.tag`, "expected 'derived'");
  const formula = str(o, 'formula', p);
  if (formula.trim() === '') fail(`${p}.formula`, 'a derived value needs a formula');
  const stretchObj = obj(o.stretch, `${p}.stretch`);
  return {
    op: oneOf(o, 'op', p, COMBINE_OPS),
    a: str(o, 'a', p),
    b: str(o, 'b', p),
    wavelength_a_um: num(o, 'wavelength_a_um', p),
    wavelength_b_um: num(o, 'wavelength_b_um', p),
    unit: str(o, 'unit', p),
    stretch: {
      kind: str(stretchObj, 'kind', `${p}.stretch`),
      params: obj(stretchObj.params, `${p}.stretch.params`),
    },
    tag: 'derived',
    formula,
  };
}

/** Error bodies are best effort: a missing or odd body gives null, never a made-up message. */
export function parseApiError(raw: unknown): ApiErrorBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Obj;
  if (typeof o.error !== 'string') return null;
  return { error: o.error, detail: typeof o.detail === 'string' ? o.detail : '' };
}
