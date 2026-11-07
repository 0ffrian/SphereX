// Runtime checks for the M1 API replies (D-16). A reply that does not match the contract is
// refused with ApiError('bad_response'); nothing is defaulted or guessed. Unknown extra fields are
// ignored, so the backend can add optional fields without breaking the UI.
import { ApiError } from './errors';
import type {
  ApiErrorBody,
  CompositeBand,
  CompositeChannel,
  CompositeResponse,
  Frame,
  FramesResponse,
  LightCurvePoint,
  ResolveResponse,
  SkyCachedObject,
  SkyCachedResponse,
  SkyEquirect,
  SkyHips,
  SkyIndexResponse,
  SkySurvey,
  SpectrumPoint,
  SpectrumResponse,
} from './types';
import { TAGS, type Tag } from '@/contract';

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
  const width = optNum(o, 'width', path);
  const height = optNum(o, 'height', path);
  for (const [k, v] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v <= 0)) {
      fail(`${path}.${k}`, 'expected a positive whole number of pixels');
    }
  }
  if ((width === undefined) !== (height === undefined)) {
    fail(path, 'expected both width and height, or neither');
  }
  if (width !== undefined) frame.width = width;
  if (height !== undefined) frame.height = height;
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

/** Error bodies are best effort: a missing or odd body gives null, never a made-up message. */
export function parseApiError(raw: unknown): ApiErrorBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Obj;
  if (typeof o.error !== 'string') return null;
  return { error: o.error, detail: typeof o.detail === 'string' ? o.detail : '' };
}

// ---- Sky index (prototype; see types.ts) --------------------------------------------------------

function optStr(o: Obj, key: string, path: string): string | null {
  return o[key] === undefined || o[key] === null ? null : str(o, key, path);
}

function parseEquirect(raw: unknown, path: string): SkyEquirect {
  const o = obj(raw, path);
  const width = num(o, 'width', path);
  const height = num(o, 'height', path);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail(path, 'expected positive integer width and height');
  }
  return { url: str(o, 'url', path), width, height };
}

function parseHips(raw: unknown, path: string): SkyHips {
  const o = obj(raw, path);
  return {
    url: str(o, 'url', path),
    max_order_local: num(o, 'max_order_local', path),
    tile_width: num(o, 'tile_width', path),
    format: str(o, 'format', path),
  };
}

function parseSurvey(raw: unknown, path: string): SkySurvey {
  const o = obj(raw, path);
  const tag = str(o, 'tag', path);
  if (!(TAGS as readonly string[]).includes(tag)) fail(`${path}.tag`, 'expected a provenance tag');
  const formula = optStr(o, 'formula', path);
  const assumption = optStr(o, 'assumption', path);
  // R3.1 / D-02: `derived` needs a formula and `model_dependent` an assumption.
  if (tag === 'derived' && !formula) fail(`${path}.formula`, 'a derived image needs a formula');
  if (tag === 'model_dependent' && !assumption) {
    fail(`${path}.assumption`, 'a model-dependent image needs an assumption');
  }
  return {
    id: str(o, 'id', path),
    title: str(o, 'title', path),
    credit: str(o, 'credit', path),
    tag: tag as Tag,
    formula,
    assumption,
    frame: str(o, 'frame', path),
    convention: optStr(o, 'convention', path),
    equirect: arr(o, 'equirect', path).map((e, i) => parseEquirect(e, `${path}.equirect[${i}]`)),
    hips: o.hips === undefined || o.hips === null ? null : parseHips(o.hips, `${path}.hips`),
  };
}

function parseValueProvenance(raw: unknown, path: string): SkyCachedObject['provenance'][string] {
  const o = obj(raw, path);
  const tag = str(o, 'tag', path);
  if (!(TAGS as readonly string[]).includes(tag)) fail(`${path}.tag`, 'expected a provenance tag');
  const formula = optStr(o, 'formula', path);
  const assumption = optStr(o, 'assumption', path);
  const source = optStr(o, 'source', path);
  if (tag === 'derived' && !formula) fail(`${path}.formula`, 'a derived value needs a formula');
  if (tag === 'model_dependent' && !assumption) {
    fail(`${path}.assumption`, 'a model-dependent value needs an assumption');
  }
  return {
    tag: tag as Tag,
    ...(formula ? { formula } : {}),
    ...(assumption ? { assumption } : {}),
    ...(source ? { source } : {}),
  };
}

function parseCachedObject(raw: unknown, path: string): SkyCachedObject {
  const o = obj(raw, path);
  const resolver = str(o, 'resolver', path);
  if (!(RESOLVERS as readonly string[]).includes(resolver)) {
    fail(`${path}.resolver`, `expected one of ${RESOLVERS.join(', ')}`);
  }
  const ra = num(o, 'ra', path);
  const dec = num(o, 'dec', path);
  if (ra < 0 || ra >= 360) fail(`${path}.ra`, 'expected 0 ≤ RA < 360');
  if (dec < -90 || dec > 90) fail(`${path}.dec`, 'expected −90 ≤ Dec ≤ 90');
  const frames = num(o, 'frames', path);
  if (!Number.isInteger(frames) || frames < 1) fail(`${path}.frames`, 'expected a count ≥ 1');
  const provenance: Record<string, SkyCachedObject['provenance'][string]> = {};
  if (o.provenance !== undefined && o.provenance !== null) {
    const prov = obj(o.provenance, `${path}.provenance`);
    for (const [k, v] of Object.entries(prov)) {
      provenance[k] = parseValueProvenance(v, `${path}.provenance.${k}`);
    }
  }
  return {
    id: str(o, 'id', path),
    name: optStr(o, 'name', path),
    query: optStr(o, 'query', path),
    ra,
    dec,
    resolver: resolver as SkyCachedObject['resolver'],
    frames,
    provenance,
  };
}

export function parseSkyCached(raw: unknown): SkyCachedResponse {
  const p = 'skyCached';
  const o = obj(raw, p);
  return {
    objects: arr(o, 'objects', p).map((x, i) => parseCachedObject(x, `${p}.objects[${i}]`)),
    data_release: str(o, 'data_release', p),
  };
}

export function parseSkyIndex(raw: unknown): SkyIndexResponse {
  const p = 'sky';
  const o = obj(raw, p);
  return { surveys: arr(o, 'surveys', p).map((s, i) => parseSurvey(s, `${p}.surveys[${i}]`)) };
}

// ---- SPHEREx colour composite (see types.ts) ------------------------------------------------------

const CHANNELS: readonly CompositeChannel[] = ['blue', 'green', 'red'];

function nullableNum(o: Obj, key: string, path: string): number | null {
  return o[key] === undefined || o[key] === null ? null : num(o, key, path);
}

function parseBand(raw: unknown, path: string): CompositeBand {
  const o = obj(raw, path);
  const channel = str(o, 'channel', path);
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    fail(`${path}.channel`, `expected one of ${CHANNELS.join(', ')}`);
  }
  const band: CompositeBand = {
    channel: channel as CompositeChannel,
    frame_id: str(o, 'frame_id', path),
    wavelength_um: num(o, 'wavelength_um', path),
    time: time(o, 'time', path),
  };
  const width = optNum(o, 'bandwidth_um', path);
  if (width !== undefined) {
    if (width <= 0) fail(`${path}.bandwidth_um`, 'expected a positive width');
    band.bandwidth_um = width;
  }
  return band;
}

/**
 * A composite with an image must be complete: its size, scale, the object's pixel, north up, one
 * band per channel and (D-02: `derived` needs a formula) a formula. A refused composite
 * (`image_url: null`) needs only its id, tag and `missing`; whatever image fields it sends must
 * still have the right type.
 */
export function parseComposite(raw: unknown): CompositeResponse {
  const p = 'composite';
  const o = obj(raw, p);
  if (o.tag !== 'derived') fail(`${p}.tag`, "expected 'derived'");
  const imageUrl = o.image_url === null ? null : str(o, 'image_url', p);
  const formulaRaw = o.formula === undefined || o.formula === null ? null : str(o, 'formula', p);
  const formula = formulaRaw !== null && formulaRaw.trim() !== '' ? formulaRaw : null;
  const bands = arr(o, 'bands', p).map((b, i) => parseBand(b, `${p}.bands[${i}]`));
  const seen = new Set<string>();
  for (const [i, b] of bands.entries()) {
    if (seen.has(b.channel)) fail(`${p}.bands[${i}].channel`, `${b.channel} is listed twice`);
    seen.add(b.channel);
  }
  const northUp = o.north_up === undefined || o.north_up === null ? null : bool(o, 'north_up', p);
  const out: CompositeResponse = {
    id: str(o, 'id', p),
    data_release: str(o, 'data_release', p),
    image_url: imageUrl,
    width: nullableNum(o, 'width', p),
    height: nullableNum(o, 'height', p),
    scale_arcsec_px: nullableNum(o, 'scale_arcsec_px', p),
    north_up: northUp ?? false,
    x: nullableNum(o, 'x', p),
    y: nullableNum(o, 'y', p),
    bands,
    tag: 'derived',
    formula,
    missing: strList(o, 'missing', p),
    cached_at: nullableTime(o, 'cached_at', p),
  };
  if (imageUrl === null) return out;

  if (imageUrl.trim() === '') fail(`${p}.image_url`, 'expected a URL');
  if (!formula) fail(`${p}.formula`, 'a derived composite needs a formula');
  const { width, height } = out;
  if (
    width === null ||
    height === null ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    fail(p, 'expected positive integer width and height');
  }
  if (out.scale_arcsec_px === null || out.scale_arcsec_px <= 0) {
    fail(`${p}.scale_arcsec_px`, 'expected a positive scale');
  }
  if (out.x === null || out.y === null) fail(p, 'expected the object pixel x and y');
  if (northUp !== true) fail(`${p}.north_up`, 'a composite must be north up');
  if (bands.length !== CHANNELS.length) fail(`${p}.bands`, 'expected one band per channel');
  return out;
}
