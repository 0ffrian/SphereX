// DEV/TEST FIXTURES ONLY. Every number made here is SYNTHETIC: frame times, wavelengths, pixel
// positions, fluxes, errors, flags and pixels are invented to exercise the UI. They do not imitate
// the real objects and must never be shown as SPHEREx data. The UI marks them through the
// `X-SX-Fixture: synthetic` header (FixtureBanner, "Fixture" badges, SYNTHETIC image label).
// Deterministic: the same target and seed give byte-identical JSON and PNGs.
import type { Frame, FramesResponse, SpectrumPoint, SpectrumResponse } from '../src/app/api/types';
import { encodePngGray } from './png';
import type { FixtureTarget } from './targets';

/** Unique string used to prove no fixture code reaches a production build (scripts/check-dist.js). */
export const FIXTURE_MARKER = 'SX_FIXTURE_MARKER_c7e2';
export const FIXTURE_DATA_RELEASE = 'synthetic_fixture';
export const FIXTURE_FLAG = 'SYNTHETIC_FLAG';
export const FIXTURE_FLUX_UNIT = 'synthetic units (fixture)';
export const CUTOUT_SIZE = 64;

/** SPHEREx pixel scale, 6.15″ (A3.1). Used only to turn synthetic pixel offsets into degrees. */
export const PIXEL_SCALE_DEG = 6.15 / 3600;
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

export interface Geometry {
  x: number;
  y: number;
  northAngle?: number;
  ra?: number;
  dec?: number;
}

export function geometry(t: FixtureTarget, i: number): Geometry {
  const rng = mulberry32(t.seed * 1000 + i);
  const c = (CUTOUT_SIZE - 1) / 2;
  if (t.moving && t.northUp) {
    // Synthetic straight path across a shared north-up grid (east left, y down = south).
    const p = t.frameCount > 1 ? i / (t.frameCount - 1) : 0;
    const x = round(12 + 40 * p, 2);
    const y = round(44 - 22 * p, 2);
    const cosDec = Math.cos((t.dec * Math.PI) / 180);
    return {
      x,
      y,
      ra: round(t.ra - ((x - c) * PIXEL_SCALE_DEG) / cosDec, 6),
      dec: round(t.dec - (y - c) * PIXEL_SCALE_DEG, 6),
    };
  }
  const x = round(c + (rng() - 0.5) * 0.6, 2);
  const y = round(c + (rng() - 0.5) * 0.6, 2);
  if (t.northUp) return { x, y };
  return { x, y, northAngle: round((i * 37 + rng() * 5) % 360, 1) };
}

export function makeFrames(t: FixtureTarget): FramesResponse {
  const n = t.refuseFrames ? 0 : t.frameCount;
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
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

/** A synthetic star fixed on the (synthetic) sky: its offset from the target in north-up pixels. */
export interface FixtureStar {
  /** Offset in pixels on a north-up, east-left grid (x right = west, y down = south). */
  dx: number;
  dy: number;
  amp: number;
}

/** The 25 background stars of a target, fixed on the sky. */
export function backgroundStars(t: FixtureTarget): FixtureStar[] {
  const stars = mulberry32(t.seed + 2);
  return Array.from({ length: 25 }, () => {
    const dx = (stars() - 0.5) * 80;
    const dy = (stars() - 0.5) * 80;
    return { dx, dy, amp: 30 + stars() * 170 };
  });
}

/**
 * Two synthetic neighbours close to the target, so the overlay fixtures have contamination: one
 * inside a 3 px aperture and one in a 6–10 px annulus (the fixture's own synthetic aperture).
 */
export const FIXTURE_NEIGHBOURS: readonly FixtureStar[] = [
  { dx: 1.8, dy: 0.4, amp: 60 },
  { dx: -5.5, dy: 4.5, amp: 90 },
];

/** Pixel position of a sky offset in frame `i` (rotated with the frame when not north-up). */
export function starPixel(g: Geometry, star: { dx: number; dy: number }): { x: number; y: number } {
  const c = (CUTOUT_SIZE - 1) / 2;
  const angle = ((g.northAngle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: c + star.dx * cos - star.dy * sin, y: c + star.dx * sin + star.dy * cos };
}

/**
 * Grey pixels of frame `i`, row-major, with the target at the frame's (x, y). `gridOf` draws the
 * star field in another frame's orientation (the combine fixture's "B on A's grid").
 */
export function cutoutPixels(t: FixtureTarget, i: number, gridOf: number = i): Uint8Array {
  const size = CUTOUT_SIZE;
  const g = geometry(t, i);
  const grid = geometry(t, gridOf);
  const acc = new Float32Array(size * size);

  const noise = mulberry32(t.seed * 1000 + i + 500_000);
  for (let k = 0; k < acc.length; k++) acc[k] = 20 + (noise() - 0.5) * 12;

  const stamp = (sx: number, sy: number, amp: number, sigma: number) => {
    const r = Math.ceil(sigma * 4);
    for (
      let py = Math.max(0, Math.floor(sy - r));
      py <= Math.min(size - 1, Math.ceil(sy + r));
      py++
    ) {
      for (
        let px = Math.max(0, Math.floor(sx - r));
        px <= Math.min(size - 1, Math.ceil(sx + r));
        px++
      ) {
        const d2 = (px - sx) ** 2 + (py - sy) ** 2;
        acc[py * size + px]! += amp * Math.exp(-d2 / (2 * sigma * sigma));
      }
    }
  };

  // Background stars fixed on the (synthetic) sky; rotated with the frame when not north-up.
  for (const star of backgroundStars(t)) {
    const p = starPixel(grid, star);
    stamp(p.x, p.y, star.amp, 1.2);
  }
  if (!t.refuseFrames) {
    for (const star of FIXTURE_NEIGHBOURS) {
      const p = starPixel(grid, star);
      stamp(p.x, p.y, star.amp, 1.2);
    }
    stamp(g.x, g.y, 220, 1.3);
  }

  const px = new Uint8Array(size * size);
  for (let k = 0; k < px.length; k++) px[k] = Math.max(0, Math.min(255, Math.round(acc[k]!)));
  return px;
}

/** Synthetic star field with the target at the frame's (x, y). */
export function renderCutout(t: FixtureTarget, i: number): Uint8Array {
  return encodePngGray(CUTOUT_SIZE, CUTOUT_SIZE, cutoutPixels(t, i));
}
