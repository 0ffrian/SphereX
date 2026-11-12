// D-37 / D-12: what the haptics feel on a world the engine draws. The engine keeps its terrain, climate and river
// arrays on the CPU (`WorldEngine.cpuFields()`); this reads them at a longitude and latitude, so touch matches the
// picture. The old path gave the haptics a `FieldSampler` (viewer/fields/fieldGenerator.ts) with `sampleUV` returning a
// `FieldSample`; this has the same `sampleUV(u, v)` and `sampleDirection(d)`, plus the physical values themselves.
// Nothing is invented: a channel the engine does not have is 0 (band, storm, lava) and is listed in `missing`.
import type { FieldSample } from '@/viewer/fields/fieldGenerator';
import type { CpuFields } from './WorldEngine';

export interface WorldSample {
  /** Ground height above the sea floor reference, km (terrain grid, Catmull-Rom cubic as the fly view). Null if no terrain. */
  elevationKm: number | null;
  /** Surface temperature, K (climate grid, cubic B-spline as the fly view). Null while the climate is not ready. */
  temperatureK: number | null;
  /** Rain rate, in the engine's own units (climate grid). Null while the climate is not ready. */
  rain: number | null;
  /** True where the climate grid says land; false for open sea. Null while the climate is not ready. */
  land: boolean | null;
}

const TAU = Math.PI * 2;

/** Uniform cubic B-spline weights for the 4 texels around a sample, fraction f in [0, 1). */
function bw(f: number): [number, number, number, number] {
  const f2 = f * f;
  const f3 = f2 * f;
  return [
    (1 - 3 * f + 3 * f2 - f3) / 6,
    (4 - 6 * f2 + 3 * f3) / 6,
    (1 + 3 * f + 3 * f2 - 3 * f3) / 6,
    f3 / 6,
  ];
}

/** Catmull-Rom weights (the interpolating cubic) for the 4 texels around a sample, fraction f in [0, 1). */
function cw(f: number): [number, number, number, number] {
  return [
    f * (-0.5 + f * (1 - 0.5 * f)),
    1 + f * f * (-2.5 + 1.5 * f),
    f * (0.5 + f * (2 - 1.5 * f)),
    f * f * (-0.5 + 0.5 * f),
  ];
}

/**
 * Issue #93 2.7: a lon-lat grid read with the cubic B-spline the fly view uses for the climate grids (shaders.js bsp():
 * Sigg and Hadwiger 2005), wrapping in longitude and clamping at the poles, so what the haptics and sound read matches
 * the picture. The GPU builds the same weights from 4 bilinear taps; this sums the 16 texels directly (equal up to the
 * GPU's filtering precision). `stride` is the number of channels per cell (channel 0 is read).
 */
export function bspline(
  data: ArrayLike<number>,
  stride: number,
  W: number,
  H: number,
  lon: number,
  lat: number,
): number {
  return cubic(bw, data, stride, W, H, lon, lat);
}

/**
 * The Catmull-Rom cubic the fly view uses for the height grid (shaders.js crs(), #93 regression fix): it passes through
 * every texel value, so a peak keeps its height (the B-spline read a one-texel peak at a third of it). Same wrapping,
 * clamping and `stride` as `bspline`; the GPU merges the middle taps into 9 bilinear reads, this sums the 16 texels.
 */
export function catmullRom(
  data: ArrayLike<number>,
  stride: number,
  W: number,
  H: number,
  lon: number,
  lat: number,
): number {
  return cubic(cw, data, stride, W, H, lon, lat);
}

function cubic(
  weights: (f: number) => [number, number, number, number],
  data: ArrayLike<number>,
  stride: number,
  W: number,
  H: number,
  lon: number,
  lat: number,
): number {
  const px = (lon / TAU + 0.5) * W - 0.5;
  const py = (lat / Math.PI + 0.5) * H - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const wx = weights(px - x0);
  const wy = weights(py - y0);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const y = Math.max(0, Math.min(H - 1, y0 - 1 + b));
    let r = 0;
    for (let a = 0; a < 4; a++) {
      const x = (((x0 - 1 + a) % W) + W) % W;
      r += wx[a]! * data[(y * W + x) * stride]!;
    }
    s += wy[b]! * r;
  }
  return s;
}

export class WorldFieldSampler {
  /** Channels of `FieldSample` this sampler cannot fill from the engine; they read 0. */
  readonly missing = ['band', 'storm', 'lava'] as const;
  private readonly maxElev: number;

  constructor(private readonly f: CpuFields) {
    let mx = 0;
    const t = f.terrain;
    if (t) for (let i = 0; i < t.W * t.H; i++) mx = Math.max(mx, t.data[i * 2]!);
    this.maxElev = mx > 0 ? mx : 1;
  }

  /** Longitude -pi..pi (east positive), latitude -pi/2..pi/2, the engine's own convention. */
  sampleLonLat(lon: number, lat: number): WorldSample {
    return {
      elevationKm: this.elevation(lon, lat),
      ...this.climate(lon, lat),
    };
  }

  private elevation(lon: number, lat: number): number | null {
    const t = this.f.terrain;
    if (!t) return null;
    return catmullRom(t.data, 2, t.W, t.H, lon, lat);
  }

  private climate(lon: number, lat: number): Pick<WorldSample, 'temperatureK' | 'rain' | 'land'> {
    const c = this.f.climate;
    if (!c) return { temperatureK: null, rain: null, land: null };
    const i = Math.max(0, Math.min(c.NX - 1, Math.floor((lon / TAU + 0.5) * c.NX)));
    const j = Math.max(0, Math.min(c.NY - 1, Math.floor((lat / Math.PI + 0.5) * c.NY)));
    const k = j * c.NX + i;
    // Temperature and rain as the fly view reads them (#93 2.7: the same cubic B-spline); land stays the cell's own.
    return {
      temperatureK: bspline(c.T, 1, c.NX, c.NY, lon, lat),
      rain: bspline(c.rain, 1, c.NX, c.NY, lon, lat),
      land: !!c.land[k],
    };
  }

  /** `FieldSample` shape for the existing haptic sources: height 0..1 of the highest ground, sea as `ocean`. */
  sampleUV(u: number, v: number): FieldSample {
    // The viewer's UV (fieldGenerator.directionToUV: phi = atan2(z, -x), theta from the north pole) back to a direction.
    const phi = u * TAU;
    const theta = v * Math.PI;
    return this.sampleDirection([
      -Math.cos(phi) * Math.sin(theta),
      Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
    ]);
  }

  /** A body-frame direction (the engine's frame: lon = atan2(z, x), lat = asin(y)). */
  sampleDirection(d: [number, number, number]): FieldSample {
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const s = this.sampleLonLat(
      Math.atan2(d[2], d[0]),
      Math.asin(Math.max(-1, Math.min(1, d[1] / len))),
    );
    const e = s.elevationKm ?? 0;
    return {
      height: Math.max(0, Math.min(1, e / this.maxElev)),
      band: 0,
      storm: 0,
      ocean: s.land === false || e < 0 ? 1 : 0,
      ice: 0,
      lava: 0,
    };
  }
}
