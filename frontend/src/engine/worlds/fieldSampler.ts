// D-37 / D-12: what the haptics feel on a world the engine draws. The engine keeps its terrain, climate and river
// arrays on the CPU (`WorldEngine.cpuFields()`); this reads them at a longitude and latitude, so touch matches the
// picture. The old path gave the haptics a `FieldSampler` (viewer/fields/fieldGenerator.ts) with `sampleUV` returning a
// `FieldSample`; this has the same `sampleUV(u, v)` and `sampleDirection(d)`, plus the physical values themselves.
// Nothing is invented: a channel the engine does not have is 0 (band, storm, lava) and is listed in `missing`.
import type { FieldSample } from '@/viewer/fields/fieldGenerator';
import type { CpuFields } from './WorldEngine';

export interface WorldSample {
  /** Ground height above the sea floor reference, km (terrain grid, bilinear). Null if the engine has no terrain. */
  elevationKm: number | null;
  /** Surface temperature, K (climate grid, nearest cell). Null while the climate is not ready. */
  temperatureK: number | null;
  /** Rain rate, in the engine's own units (climate grid). Null while the climate is not ready. */
  rain: number | null;
  /** True where the climate grid says land; false for open sea. Null while the climate is not ready. */
  land: boolean | null;
}

const TAU = Math.PI * 2;

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
    const px = (lon / TAU + 0.5) * t.W - 0.5;
    const py = (lat / Math.PI + 0.5) * t.H - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const at = (x: number, y: number) =>
      t.data[(Math.max(0, Math.min(t.H - 1, y)) * t.W + ((x % t.W) + t.W) % t.W) * 2]!;
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  }

  private climate(lon: number, lat: number): Pick<WorldSample, 'temperatureK' | 'rain' | 'land'> {
    const c = this.f.climate;
    if (!c) return { temperatureK: null, rain: null, land: null };
    const i = Math.max(0, Math.min(c.NX - 1, Math.floor((lon / TAU + 0.5) * c.NX)));
    const j = Math.max(0, Math.min(c.NY - 1, Math.floor((lat / Math.PI + 0.5) * c.NY)));
    const k = j * c.NX + i;
    return { temperatureK: c.T[k]!, rain: c.rain[k]!, land: !!c.land[k] };
  }

  /** `FieldSample` shape for the existing haptic sources: height 0..1 of the highest ground, sea as `ocean`. */
  sampleUV(u: number, v: number): FieldSample {
    // The viewer's UV (fieldGenerator.directionToUV: phi = atan2(z, -x), theta from the north pole) back to a direction.
    const phi = u * TAU;
    const theta = v * Math.PI;
    return this.sampleDirection([-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)]);
  }

  /** A body-frame direction (the engine's frame: lon = atan2(z, x), lat = asin(y)). */
  sampleDirection(d: [number, number, number]): FieldSample {
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const s = this.sampleLonLat(Math.atan2(d[2], d[0]), Math.asin(Math.max(-1, Math.min(1, d[1] / len))));
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
