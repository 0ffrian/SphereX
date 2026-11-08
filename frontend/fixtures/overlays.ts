// DEV/TEST FIXTURES ONLY. Synthetic replies for the M4 overlay endpoints (issue #12):
// `/overlays`, `/flags/{frame_id}.png` and `/combine.png`. Every number here is SYNTHETIC: the
// catalogue sources are the synthetic stars drawn in the synthetic cutouts (synthetic.ts), the
// aperture, footprints, magnitudes and flag names are invented. Not Gaia, WISE or SPHEREx data.
// Deterministic: the same target gives byte-identical JSON and PNGs.
import type {
  CatalogSource,
  CombineInfo,
  CombineOp,
  Contamination,
  FlagGroup,
  OverlayAperture,
  OverlayCatalog,
  OverlayCatalogName,
  OverlayFrame,
  OverlayMarker,
  OverlaysResponse,
  SkyPoint,
} from '../src/app/api/types';
import { encodePngGray, encodePngRgba } from './png';
import {
  backgroundStars,
  cutoutPixels,
  cutoutSize,
  FIXTURE_DATA_RELEASE,
  FIXTURE_FLUX_UNIT,
  FIXTURE_NEIGHBOURS,
  fixtureFrameId,
  geometry,
  makeFrames,
  mulberry32,
  PIXEL_SCALE_DEG,
  starPixel,
  type FixtureStar,
  type Geometry,
} from './synthetic';
import type { FixtureTarget } from './targets';

/** Synthetic photometry geometry of the fixture, cutout pixels. */
export const FIXTURE_APERTURE: OverlayAperture = {
  radius_px: 3,
  annulus_inner_px: 6,
  annulus_outer_px: 10,
};

/** Targets whose Gaia query is "unavailable" in the fixtures (exercises the refusal path). */
export const FIXTURE_GAIA_UNAVAILABLE: ReadonlySet<string> = new Set(['wise-0855']);
/** Frame index whose footprint is null in every target's fixture (`footprint:<frame_id>`). */
export const FIXTURE_NO_FOOTPRINT_INDEX = 2;
/** Side of the synthetic square detector footprint, degrees (made up, not the SPHEREx value). */
const FOOTPRINT_SIDE_DEG = 1.2;

export const FIXTURE_FLAG_GROUPS: readonly FlagGroup[] = [
  { group: 'saturation', rgba: [255, 64, 64, 170], names: ['SYNTHETIC_SATURATED'] },
  { group: 'bad_pixel', rgba: [255, 214, 0, 190], names: ['SYNTHETIC_DEAD', 'SYNTHETIC_HOT'] },
  { group: 'artefact', rgba: [196, 120, 255, 150], names: ['SYNTHETIC_GHOST'] },
  { group: 'source', rgba: [96, 230, 140, 90], names: ['SYNTHETIC_SOURCE'] },
];

const round = (v: number, dp: number) => Number(v.toFixed(dp));

/** Sky position of a north-up pixel offset from the target (x right = west, y down = south). */
function skyOf(t: FixtureTarget, dx: number, dy: number): SkyPoint {
  const cosDec = Math.cos((t.dec * Math.PI) / 180);
  const ra = (((t.ra - (dx * PIXEL_SCALE_DEG) / cosDec) % 360) + 360) % 360;
  return [round(ra, 6), round(t.dec - dy * PIXEL_SCALE_DEG, 6)];
}

/** Inverse of starPixel: the north-up offset of a pixel in frame `g`. */
function offsetOf(g: Geometry, px: number, py: number): { dx: number; dy: number } {
  const angle = ((g.northAngle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ox = px - g.cx;
  const oy = py - g.cy;
  return { dx: ox * cos + oy * sin, dy: -ox * sin + oy * cos };
}

interface FixtureSource {
  star: FixtureStar;
  gaia?: CatalogSource;
  wise?: CatalogSource;
}

/** Synthetic magnitude from the synthetic amplitude (brighter star → smaller magnitude). */
const magOf = (amp: number, zero: number) => round(zero - 2.5 * Math.log10(amp), 2);

function fixtureSources(t: FixtureTarget): FixtureSource[] {
  const rng = mulberry32(t.seed + 3);
  const stars = [...FIXTURE_NEIGHBOURS, ...backgroundStars(t)];
  return stars.map((star, k) => {
    const [ra, dec] = skyOf(t, star.dx, star.dy);
    const id = String(k).padStart(3, '0');
    const out: FixtureSource = { star };
    out.gaia = {
      id: `synthetic-gaia-${t.id}-${id}`,
      ra,
      dec,
      mag: magOf(star.amp, 20),
      pmra_mas_yr: k % 4 === 0 ? null : round((rng() - 0.5) * 40, 3),
      pmdec_mas_yr: k % 4 === 0 ? null : round((rng() - 0.5) * 40, 3),
    };
    // Every second star and the second neighbour are also "WISE" sources; one has no magnitude.
    if (k === 1 || k % 2 === 0) {
      out.wise = {
        id: `synthetic-wise-${t.id}-${id}`,
        ra,
        dec,
        mag: k === 4 ? null : magOf(star.amp, 17),
        pmra_mas_yr: null,
        pmdec_mas_yr: null,
      };
    }
    return out;
  });
}

function catalog(
  name: OverlayCatalogName,
  available: boolean,
  sources: CatalogSource[],
): OverlayCatalog {
  return {
    catalog: name,
    available,
    table: `${FIXTURE_DATA_RELEASE}.${name}_sources`,
    epoch: 'synthetic epoch',
    mag_band: name === 'gaia' ? 'G' : 'W1',
    mag_limit: name === 'gaia' ? 19 : 16,
    sources: available ? sources : [],
  };
}

export function flagsPath(t: FixtureTarget, i: number): string {
  return `/v1/objects/${encodeURIComponent(t.id)}/flags/${encodeURIComponent(fixtureFrameId(t, i))}.png`;
}

function footprint(t: FixtureTarget, g: Geometry): SkyPoint[] {
  // Synthetic square detector, the target off its centre, rotated with the frame.
  const half = FOOTPRINT_SIDE_DEG / 2 / PIXEL_SCALE_DEG;
  const off = { x: 0.25 * half, y: -0.15 * half };
  const corners: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  const angle = ((g.northAngle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return corners.map(([x, y]) => {
    const px = x + off.x;
    const py = y + off.y;
    // Pixel offsets in the frame → north-up offsets.
    return skyOf(t, px * cos + py * sin, -px * sin + py * cos);
  });
}

export function makeOverlays(t: FixtureTarget): OverlaysResponse {
  const framesReply = makeFrames(t);
  const gaiaOk = !FIXTURE_GAIA_UNAVAILABLE.has(t.id);
  const sources = fixtureSources(t);
  const gaiaSources = sources.flatMap((s) => (s.gaia ? [s.gaia] : []));
  const wiseSources = sources.flatMap((s) => (s.wise ? [s.wise] : []));
  const missing: string[] = [];
  if (!gaiaOk) missing.push('overlay:gaia');
  const ap = FIXTURE_APERTURE;
  const broken = new Set(t.brokenCutouts ?? []);

  const frames: OverlayFrame[] = framesReply.frames.map((f, i) => {
    const g = geometry(t, i);
    const markers: OverlayMarker[] = [];
    const contamination: Contamination[] = [];
    for (const s of sources) {
      const p = starPixel(g, s.star);
      // On this frame's own pixels (cutouts differ in size and some are clipped, synthetic.ts).
      const inside = p.x >= -0.5 && p.x < g.w - 0.5 && p.y >= -0.5 && p.y < g.h - 0.5;
      const sep = Math.hypot(p.x - f.x, p.y - f.y);
      const zone =
        sep <= ap.radius_px
          ? 'aperture'
          : sep >= ap.annulus_inner_px && sep <= ap.annulus_outer_px
            ? 'annulus'
            : null;
      const entries: [OverlayCatalogName, CatalogSource | undefined][] = [
        ['gaia', gaiaOk ? s.gaia : undefined],
        ['wise', s.wise],
      ];
      for (const [name, src] of entries) {
        if (!src) continue;
        if (inside) markers.push({ catalog: name, id: src.id, x: round(p.x, 2), y: round(p.y, 2) });
        if (zone) {
          contamination.push({
            catalog: name,
            id: src.id,
            mag: src.mag,
            zone,
            sep_px: round(sep, 2),
          });
        }
      }
    }
    const box = [
      [-0.5, -0.5],
      [g.w - 0.5, -0.5],
      [g.w - 0.5, g.h - 0.5],
      [-0.5, g.h - 0.5],
    ].map(([px, py]) => {
      const o = offsetOf(g, px!, py!);
      return skyOf(t, o.dx, o.dy);
    }) as OverlayFrame['cutout_box'];
    const noFootprint = i === FIXTURE_NO_FOOTPRINT_INDEX;
    if (noFootprint) missing.push(`footprint:${f.frame_id}`);
    if (broken.has(i)) missing.push(`flags_mask:${f.frame_id}`);
    return {
      frame_id: f.frame_id,
      flags_url: flagsPath(t, i),
      markers,
      contamination,
      footprint: noFootprint ? null : footprint(t, g),
      cutout_box: box,
    };
  });

  return {
    id: t.id,
    data_release: FIXTURE_DATA_RELEASE,
    cached_at: null,
    catalogs: [catalog('gaia', gaiaOk, gaiaSources), catalog('wise', true, wiseSources)],
    aperture: { ...ap },
    flag_groups: FIXTURE_FLAG_GROUPS.map((g) => ({ ...g, rgba: [...g.rgba], names: [...g.names] })),
    frames,
    missing,
    provenance: {
      catalog_positions: { tag: 'measured', source: 'synthetic fixture catalogue' },
      catalog_mags: { tag: 'measured', source: 'synthetic fixture catalogue' },
      markers: {
        tag: 'derived',
        formula: 'synthetic fixture: sky position to cutout pixel through the frame geometry',
      },
      contamination: {
        tag: 'derived',
        formula:
          'synthetic fixture: distance from the object centre against the aperture radius and annulus',
      },
      footprint: { tag: 'measured', source: 'synthetic fixture footprint' },
      cutout_box: {
        tag: 'derived',
        formula: 'synthetic fixture: cutout pixel corners to sky through the frame geometry',
      },
      flags_mask: { tag: 'measured', source: 'synthetic fixture flags' },
    },
  };
}

/** Synthetic RGBA flag mask of frame `i`, same size as the cutout (w × h, cutoutSize). */
export function renderFlags(t: FixtureTarget, i: number): Uint8Array {
  const { w, h } = cutoutSize(t, i);
  const grey = cutoutPixels(t, i);
  const rgba = new Uint8Array(w * h * 4);
  const colour = (name: FlagGroup['group']) => FIXTURE_FLAG_GROUPS.find((g) => g.group === name)!;
  // Synthetic rules: very bright pixels "saturated", bright ones "source"; a few fixed "bad"
  // pixels; a short "artefact" streak in every fifth frame.
  const bad = mulberry32(t.seed + 4);
  const badPixels = new Set(
    Array.from({ length: 4 }, () => Math.floor(bad() * h) * w + Math.floor(bad() * w)),
  );
  for (let k = 0; k < w * h; k++) {
    const x = k % w;
    const y = Math.floor(k / w);
    const v = grey[k]!;
    let group: FlagGroup['group'] | null = null;
    if (v > 200) group = 'saturation';
    else if (badPixels.has(k)) group = 'bad_pixel';
    else if (i % 5 === 1 && x === 50 && y >= 8 && y < 20) group = 'artefact';
    else if (v > 90) group = 'source';
    if (group) rgba.set(colour(group).rgba, k * 4);
  }
  return encodePngRgba(w, h, rgba);
}

export function combineInfo(t: FixtureTarget, op: CombineOp, a: number, b: number): CombineInfo {
  const frames = makeFrames(t).frames;
  return {
    op,
    a: frames[a]!.frame_id,
    b: frames[b]!.frame_id,
    wavelength_a_um: frames[a]!.wavelength_um,
    wavelength_b_um: frames[b]!.wavelength_um,
    unit: FIXTURE_FLUX_UNIT,
    stretch: { kind: 'linear', params: { offset: op === 'sub' ? 128 : 0, scale: 0.5 } },
    tag: 'derived',
    formula:
      op === 'add'
        ? 'synthetic fixture: (A + B) / 2, with B drawn on frame A grid'
        : 'synthetic fixture: (A - B) / 2 + 128, with B drawn on frame A grid',
  };
}

/** Grey PNG on frame A's grid: B's star field is drawn in A's orientation first. */
export function renderCombine(t: FixtureTarget, op: CombineOp, a: number, b: number): Uint8Array {
  const pa = cutoutPixels(t, a);
  const pb = cutoutPixels(t, b, a);
  const out = new Uint8Array(pa.length);
  for (let k = 0; k < out.length; k++) {
    const v = op === 'add' ? (pa[k]! + pb[k]!) / 2 : (pa[k]! - pb[k]!) / 2 + 128;
    out[k] = Math.max(0, Math.min(255, Math.round(v)));
  }
  const { w, h } = cutoutSize(t, a);
  return encodePngGray(w, h, out);
}
