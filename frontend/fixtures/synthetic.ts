// DEV/TEST FIXTURES ONLY. Every number made here is SYNTHETIC: frame times, wavelengths, pixel
// positions, fluxes, errors, flags and pixels are invented to exercise the UI. They do not imitate
// the real objects and must never be shown as SPHEREx data. The UI marks them through the
// `X-SX-Fixture: synthetic` header (FixtureBanner, "Fixture" badges, SYNTHETIC image label).
// Deterministic: the same target and seed give byte-identical JSON and PNGs.
import type {
  CompositeBand,
  CompositeResponse,
  Frame,
  FramesResponse,
  SpectrumPoint,
  SpectrumResponse,
} from '../src/app/api/types';
import { crc32, encodePngGray, encodePngRgb } from './png';
import type { FixtureTarget } from './targets';

/** Unique string used to prove no fixture code reaches a production build (scripts/check-dist.js). */
export const FIXTURE_MARKER = 'SX_FIXTURE_MARKER_c7e2';
export const FIXTURE_DATA_RELEASE = 'synthetic_fixture';
export const FIXTURE_FLAG = 'SYNTHETIC_FLAG';
export const FIXTURE_FLUX_UNIT = 'synthetic units (fixture)';
export const CUTOUT_SIZE = 64;

/** SPHEREx pixel scale, 6.15″ (A3.1). Used only to turn synthetic pixel offsets into degrees. */
const PIXEL_SCALE_DEG = 6.15 / 3600;
/** Synthetic window of 0.8 days (the A3.1 revisit span), starting at a made-up date. */
const T0_MS = Date.UTC(2025, 4, 3, 0, 0, 0);
const WINDOW_MS = 0.8 * 86_400_000;
const MIN_UM = 0.75;
const MAX_UM = 5.0;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));

export function fixtureFrameId(t: FixtureTarget, i: number): string {
  return `${t.id}-f${String(i).padStart(3, '0')}`;
}

export function cutoutPath(t: FixtureTarget, i: number): string {
  return `/v1/objects/${encodeURIComponent(t.id)}/cutouts/${encodeURIComponent(fixtureFrameId(t, i))}.png`;
}

/**
 * SYNTHETIC cutout sizes in native orientation, cycled per frame: like the real mix of
 * 58×58, 58×59, 59×58 and 59×59 px for one target, here around the 64 px fixture size. Frames
 * on a shared north-up grid are all CUTOUT_SIZE square.
 */
const NATIVE_SIZES: readonly (readonly [number, number])[] = [
  [64, 64],
  [63, 64],
  [64, 63],
  [63, 63],
];

/** Size of frame i's cutout PNG, and how many rows above the object an edge clipped. */
export function cutoutSize(t: FixtureTarget, i: number): { w: number; h: number; clipTop: number } {
  if (t.northUp) return { w: CUTOUT_SIZE, h: CUTOUT_SIZE, clipTop: 0 };
  const clip = t.clippedFrames?.[i];
  if (clip) return { w: clip.width, h: clip.height, clipTop: CUTOUT_SIZE - clip.height };
  const [w, h] = NATIVE_SIZES[i % NATIVE_SIZES.length]!;
  return { w, h, clipTop: 0 };
}

interface Geometry {
  w: number;
  h: number;
  /** Centre of the unclipped cutout in this PNG's pixels (the object is near it). */
  cx: number;
  cy: number;
  x: number;
  y: number;
  northAngle?: number;
  ra?: number;
  dec?: number;
}

function geometry(t: FixtureTarget, i: number): Geometry {
  const rng = mulberry32(t.seed * 1000 + i);
  const c = (CUTOUT_SIZE - 1) / 2;
  const { w, h, clipTop } = cutoutSize(t, i);
  const cx = (w - 1) / 2;
  const cy = clipTop > 0 ? c - clipTop : (h - 1) / 2;
  if (t.moving && t.northUp) {
    // Synthetic straight path across a shared north-up grid (east left, y down = south).
    const p = t.frameCount > 1 ? i / (t.frameCount - 1) : 0;
    const x = round(12 + 40 * p, 2);
    const y = round(44 - 22 * p, 2);
    const cosDec = Math.cos((t.dec * Math.PI) / 180);
    return {
      w,
      h,
      cx,
      cy,
      x,
      y,
      ra: round(t.ra - ((x - c) * PIXEL_SCALE_DEG) / cosDec, 6),
      dec: round(t.dec - (y - c) * PIXEL_SCALE_DEG, 6),
    };
  }
  const x = round(cx + (rng() - 0.5) * 0.6, 2);
  const y = round(cy + (rng() - 0.5) * 0.6, 2);
  if (t.northUp) return { w, h, cx, cy, x, y };
  return { w, h, cx, cy, x, y, northAngle: round((i * 37 + rng() * 5) % 360, 1) };
}

/**
 * The frames reply. `listed`: how many frames this reply has (progressive targets); the rest are
 * `cutouts:deferred:<n>`, as a live backend lists the cutouts it has not downloaded yet. Unset:
 * the complete list. Times and wavelengths do not depend on `listed`, so the parts merge.
 */
export function makeFrames(t: FixtureTarget, listed?: number): FramesResponse {
  const n = t.refuseFrames ? 0 : t.frameCount;
  const shown = Math.min(n, Math.max(0, listed ?? n));
  const frames: Frame[] = [];
  for (let i = 0; i < shown; i++) {
    const rng = mulberry32(t.seed * 7919 + i);
    const g = geometry(t, i);
    const base = n > 1 ? MIN_UM + ((MAX_UM - MIN_UM) * i) / (n - 1) : MIN_UM;
    const wl = Math.min(MAX_UM, Math.max(MIN_UM, base + (rng() - 0.5) * 0.02));
    const frame: Frame = {
      frame_id: fixtureFrameId(t, i),
      time: new Date(T0_MS + Math.round((WINDOW_MS * i) / Math.max(n, 1))).toISOString(),
      wavelength_um: round(wl, 4),
      x: g.x,
      y: g.y,
      cutout_url: cutoutPath(t, i),
      flags: i % 7 === 3 ? [FIXTURE_FLAG] : [],
      width: g.w,
      height: g.h,
    };
    if (g.ra !== undefined) frame.ra = g.ra;
    if (g.dec !== undefined) frame.dec = g.dec;
    if (g.northAngle !== undefined) {
      frame.north_angle_deg = g.northAngle;
      frame.mirrored = false;
    }
    frames.push(frame);
  }
  const missing = t.refuseFrames
    ? [t.refuseFrames]
    : [
        ...(t.brokenCutouts ?? []).map((i) => `cutout:${fixtureFrameId(t, i)}`),
        ...Object.entries(t.unlistedRefusals ?? {}).map(
          ([i, reason]) => `${reason}:${fixtureFrameId(t, Number(i))}`,
        ),
        ...(shown < n ? [`cutouts:deferred:${n - shown}`] : []),
      ];
  return {
    id: t.id,
    frames,
    north_up: t.northUp,
    stretch: { kind: 'asinh', params: {} },
    data_release: FIXTURE_DATA_RELEASE,
    cached_at: null,
    missing,
    provenance: { fixture: 'synthetic: not SPHEREx data' },
  };
}

export function makeSpectrum(t: FixtureTarget): SpectrumResponse {
  if (t.refuseSpectrum) {
    return {
      id: t.id,
      spectrum: [],
      light_curve: [],
      flux_unit: FIXTURE_FLUX_UNIT,
      tag: 'measured',
      cached_at: null,
      missing: [t.refuseSpectrum],
    };
  }
  const framesReply = makeFrames(t);
  const frames = framesReply.frames;
  const rng = mulberry32(t.seed + 1);
  const level = 2 + rng() * 8;
  const peak = 1 + rng() * 3;
  // Every frame's values first (same RNG order whatever the shape), then the refusals.
  const all = frames.map((f, i) => {
    const shape = 0.5 + 0.5 * Math.exp(-((f.wavelength_um - peak) ** 2) / 1.5);
    const flux = level * shape * (1 + (rng() - 0.5) * 0.06);
    const error = flux * (0.03 + 0.07 * rng());
    const flagged = i % 9 === 4;
    const point: SpectrumPoint = {
      wavelength_um: f.wavelength_um,
      flux: round(flux, 4),
      error: round(error, 4),
      flagged,
      frame_id: f.frame_id,
    };
    if (flagged) point.flag_reasons = [FIXTURE_FLAG];
    return point;
  });
  const refusals = new Map<number, string>();
  const shape = t.spectrumShape;
  const broken = new Set(t.brokenCutouts ?? []);
  for (let i = 0; i < frames.length; i++) {
    const reason =
      shape?.refusals?.[i] ??
      (broken.has(i)
        ? 'cutout'
        : !shape || shape.measured === 'all' || shape.measured.includes(i)
          ? undefined
          : 'saturated');
    if (reason !== undefined) refusals.set(i, reason);
  }
  const kept = frames.flatMap((f, i) => (refusals.has(i) ? [] : [{ f, p: all[i]! }]));
  const missing = new Set(framesReply.missing);
  for (const [i, reason] of refusals) missing.add(`${reason}:${frames[i]!.frame_id}`);
  // Backend rule (spectrum.py): every listed frame refused, all as saturated.
  if (
    frames.length > 0 &&
    refusals.size === frames.length &&
    [...refusals.values()].every((r) => r === 'saturated')
  ) {
    missing.add('spectrum:saturated');
  }
  return {
    id: t.id,
    spectrum: kept.map((k) => k.p),
    light_curve: kept.map(({ f, p }) => ({
      time: f.time,
      flux: p.flux,
      error: p.error,
      frame_id: f.frame_id,
    })),
    flux_unit: FIXTURE_FLUX_UNIT,
    tag: 'measured',
    cached_at: null,
    missing: [...missing].sort(),
  };
}

function stampGaussian(
  acc: Float32Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
  amp: number,
  sigma: number,
): void {
  const r = Math.ceil(sigma * 4);
  for (
    let py = Math.max(0, Math.floor(sy - r));
    py <= Math.min(height - 1, Math.ceil(sy + r));
    py++
  ) {
    for (
      let px = Math.max(0, Math.floor(sx - r));
      px <= Math.min(width - 1, Math.ceil(sx + r));
      px++
    ) {
      const d2 = (px - sx) ** 2 + (py - sy) ** 2;
      acc[py * width + px]! += amp * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

/** Synthetic star field with the target at the frame's (x, y). */
export function renderCutout(t: FixtureTarget, i: number): Uint8Array {
  const g = geometry(t, i);
  const { w, h } = g;
  const acc = new Float32Array(w * h);

  const noise = mulberry32(t.seed * 1000 + i + 500_000);
  for (let k = 0; k < acc.length; k++) acc[k] = 20 + (noise() - 0.5) * 12;

  const stamp = (sx: number, sy: number, amp: number, sigma: number) =>
    stampGaussian(acc, w, h, sx, sy, amp, sigma);

  // Background stars fixed on the (synthetic) sky; rotated with the frame when not north-up.
  const stars = mulberry32(t.seed + 2);
  const angle = ((g.northAngle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let s = 0; s < 25; s++) {
    const dx = (stars() - 0.5) * 80;
    const dy = (stars() - 0.5) * 80;
    const amp = 30 + stars() * 170;
    const sx = g.cx + dx * cos - dy * sin;
    const sy = g.cy + dx * sin + dy * cos;
    stamp(sx, sy, amp, 1.2);
  }
  if (!t.refuseFrames) stamp(g.x, g.y, 220, 1.3);

  const px = new Uint8Array(w * h);
  for (let k = 0; k < px.length; k++) px[k] = Math.max(0, Math.min(255, Math.round(acc[k]!)));
  return encodePngGray(w, h, px);
}

// ---- Colour composite (SYNTHETIC) ---------------------------------------------------------------

export const COMPOSITE_CHANNELS = ['blue', 'green', 'red'] as const;
/** Where in the frame list each channel's frame sits (0 = first, 1 = last): short λ is blue. */
const COMPOSITE_PICK: Readonly<Record<(typeof COMPOSITE_CHANNELS)[number], number>> = {
  blue: 0.1,
  green: 0.45,
  red: 0.85,
};
/** Synthetic object pixel in the composite: an integer is a pixel centre (contract). */
export const COMPOSITE_OBJECT_PX = { x: 32, y: 31 } as const;

export function compositePath(t: FixtureTarget): string {
  return `/v1/objects/${encodeURIComponent(t.id)}/composite.png`;
}

/**
 * A synthetic three-band composite on a north-up, east-left grid (CUTOUT_SIZE square) with the
 * target at COMPOSITE_OBJECT_PX. The colours are invented: each star gets a made-up brightness
 * per channel, so the picture is visibly coloured. Not SPHEREx data.
 */
export function renderComposite(t: FixtureTarget): Uint8Array {
  const size = CUTOUT_SIZE;
  const c = (size - 1) / 2;
  const planes = COMPOSITE_CHANNELS.map(() => new Float32Array(size * size));
  const noise = mulberry32(t.seed * 31 + 900_000);
  for (const plane of planes) for (let k = 0; k < plane.length; k++) plane[k] = 14 + noise() * 10;
  const stars = mulberry32(t.seed + 2);
  const tints = mulberry32(t.seed + 3);
  for (let s = 0; s < 25; s++) {
    const sx = c + (stars() - 0.5) * 80;
    const sy = c + (stars() - 0.5) * 80;
    const amp = 30 + stars() * 170;
    for (const plane of planes)
      stampGaussian(plane, size, size, sx, sy, amp * (0.2 + 0.8 * tints()), 1.2);
  }
  const { x, y } = COMPOSITE_OBJECT_PX;
  for (const plane of planes)
    stampGaussian(plane, size, size, x, y, 220 * (0.3 + 0.7 * tints()), 1.3);
  const rgb = new Uint8Array(size * size * 3);
  // PNG channel order is R, G, B; the planes are blue, green, red.
  for (let k = 0; k < size * size; k++) {
    for (let ch = 0; ch < 3; ch++) {
      const v = planes[2 - ch]![k]!;
      rgb[k * 3 + ch] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return encodePngRgb(size, size, rgb);
}

export function makeComposite(t: FixtureTarget): CompositeResponse {
  const frames = makeFrames(t).frames;
  if (t.refuseComposite || frames.length < COMPOSITE_CHANNELS.length) {
    return {
      id: t.id,
      data_release: FIXTURE_DATA_RELEASE,
      image_url: null,
      width: null,
      height: null,
      scale_arcsec_px: null,
      north_up: true,
      x: null,
      y: null,
      bands: [],
      tag: 'derived',
      formula: 'SYNTHETIC fixture, not SPHEREx data: refused, see missing',
      missing: [...(t.refuseComposite ?? ['composite:too_few_bands'])],
      cached_at: null,
    };
  }
  const bands: CompositeBand[] = COMPOSITE_CHANNELS.map((channel) => {
    const f = frames[Math.round(COMPOSITE_PICK[channel] * (frames.length - 1))]!;
    return {
      channel,
      frame_id: f.frame_id,
      wavelength_um: f.wavelength_um,
      time: f.time,
      bandwidth_um: 0.05,
    };
  });
  const png = renderComposite(t);
  const version = crc32(png).toString(16).padStart(8, '0');
  const at = (ch: string) => bands.find((b) => b.channel === ch)!.wavelength_um;
  return {
    id: t.id,
    data_release: FIXTURE_DATA_RELEASE,
    image_url: `${compositePath(t)}?v=${version}`,
    width: CUTOUT_SIZE,
    height: CUTOUT_SIZE,
    scale_arcsec_px: 6.15,
    north_up: true,
    x: COMPOSITE_OBJECT_PX.x,
    y: COMPOSITE_OBJECT_PX.y,
    bands,
    tag: 'derived',
    formula:
      `SYNTHETIC fixture, not SPHEREx data: B, G, R = synthetic frames at ${at('blue')}, ` +
      `${at('green')} and ${at('red')} µm, made-up colours on a north-up grid`,
    missing: [],
    cached_at: null,
  };
}
