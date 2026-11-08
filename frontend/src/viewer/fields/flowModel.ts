// Issue #42, A7.2, R7.7, D-12, D-34: the CPU twin of what moves on a gas giant or brown dwarf.
// Pure functions of (seed, field params, rates, t). The shader (renderers/jetSurface.ts) is given
// the storms this file computes, as uniforms, so the picture and the haptic field are the SAME
// numbers at the same time (D-34 "touch matches sight"); nothing about a storm is computed twice.
//
// What moves (all `artistic` in look; the RATES come from `dynamics` and carry their own tier):
//   - jets: the zonal wind has the band profile of `zonalWind` (counter-flowing: neighbouring bands
//     blow opposite ways), peak speed = `dynamics.jet_speed_ms`;
//   - storms sit where they were born and are carried along at the zonal wind of their latitude
//     (A7.2 "storm drift"), and each turns about its own centre at about U / L (L its size);
//   - the band structure itself is fixed in the body frame (the field's band index and profile do
//     not change); the turbulent edges are sub-field detail, seen and not felt (D-12).
import {
  stormIdAt,
  stormsFor,
  zonalWind,
  type FieldParams,
  type Storm,
  type Vec3,
} from './fieldGenerator';
import { wrap } from '../motion/phase';

export interface JetRates {
  /** Peak zonal wind, m/s (`dynamics.jet_speed_ms`). */
  windMs: number;
  /** Body radius, m (`RenderParams.scale_m`). */
  radiusM: number;
}

/** Peak angular rate of the jets, rad per sim second: U / R. */
export function peakAngularRate(j: JetRates): number {
  return j.windMs / j.radiusM;
}

/** Near the poles a fixed wind would mean an unbounded angular rate; the rate is capped there. */
export const MIN_COS_LAT = 0.25;

const TWO_PI = Math.PI * 2;

/**
 * 1 / cos(latitude), floored at `MIN_COS_LAT`: how much a wind of fixed speed turns a point about the
 * axis faster the nearer the pole it is. The CPU storm drift and the GPU streak shear
 * (`jetSurface.ts`) both multiply by this, so a storm and the streaks of its own band move together.
 */
export function invCosLat(d: Vec3): number {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return 1 / Math.max(Math.hypot(d[0], d[2]) / len, MIN_COS_LAT);
}

/** Eastward angular rate (rad per sim second, + = towards increasing longitude) of the flow at `d`. */
export function flowAngularRate(d: Vec3, p: FieldParams, j: JetRates): number {
  return zonalWind(d, p) * peakAngularRate(j) * invCosLat(d);
}

/** Samples of the longitude circle used to follow the wind a storm meets as it drifts. */
const TRACK_STEPS = 256;

interface Track {
  /** Longitude cell width, rad. */
  dLon: number;
  /** Time (sim s) to cross each cell going the storm's way, and the total until it stops or loops. */
  cellTime: Float64Array;
  total: number;
  /** True: it loops the whole circle (period = total); false: it stops at a calm point (the band's edge). */
  loops: boolean;
  /** +1 east, -1 west. */
  dir: 1 | -1;
}

const trackCache = new Map<string, Track>();

function rateAt(lat: number, lon: number, p: FieldParams, j: JetRates): number {
  const cl = Math.cos(lat);
  return flowAngularRate([cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)], p, j);
}

/**
 * How a storm at (lat, lon0) moves under the wind it meets: its rate is the wind at ITS CURRENT
 * position, not at its birth point (the warped bands bend, so the wind changes along a latitude).
 * Time to cross each longitude cell is `dLon / |rate|`. If the wind keeps one sign all round it loops
 * the circle; if it meets a calm point (the edge of its band, where the wind reverses) it stops there,
 * so a storm never drifts into a counter-flowing band. Pure in (seed, params, rates, lat, lon0).
 */
function trackFor(lat: number, lon0: number, p: FieldParams, j: JetRates): Track {
  const key = [p.seed, p.bands, p.turbulence, j.windMs, j.radiusM, lat, lon0].join('|');
  const hit = trackCache.get(key);
  if (hit) return hit;
  const dLon = TWO_PI / TRACK_STEPS;
  const r0 = rateAt(lat, lon0, p, j);
  const dir: 1 | -1 = r0 >= 0 ? 1 : -1;
  const cellTime = new Float64Array(TRACK_STEPS);
  let total = 0;
  let loops = true;
  for (let k = 0; k < TRACK_STEPS; k++) {
    // Rate at the middle of the cell the storm is about to cross.
    const r = rateAt(lat, lon0 + dir * (k + 0.5) * dLon, p, j) * dir;
    if (!(r > 1e-12)) {
      loops = false;
      // Stop one cell short of the first reversed cell: the calm point lies inside it, so the storm
      // never ends up on the counter-flowing side.
      if (k > 0) {
        total -= cellTime[k - 1]!;
        cellTime[k - 1] = 0;
      }
      break;
    }
    cellTime[k] = dLon / r;
    total += cellTime[k]!;
  }
  const track: Track = { dLon, cellTime, total, loops, dir };
  if (trackCache.size > 32) trackCache.clear();
  trackCache.set(key, track);
  return track;
}

/** Longitude offset (signed, rad) a storm has moved by sim time `t` along `track`. */
function trackOffset(track: Track, t: number): number {
  if (!(track.total > 0)) return 0;
  const tt = track.loops ? wrap(t, track.total) : Math.min(Math.max(t, 0), track.total);
  let rest = Math.abs(tt);
  let lon = 0;
  for (let k = 0; k < TRACK_STEPS; k++) {
    const ct = track.cellTime[k]!;
    if (!(ct > 0)) break;
    if (rest <= ct) return track.dir * (lon + (rest / ct) * track.dLon);
    rest -= ct;
    lon += track.dLon;
  }
  return track.dir * lon;
}

export interface MovingStorm extends Storm {
  /** Longitude it was born at (rad) and the angular rate it is carried at when born (rad per sim second). */
  lon0: number;
  driftRate: number;
  /** Own turning, rad per sim second (anticyclonic in the north, the other way in the south). */
  spinRate: number;
  /** Own turning angle now, wrapped to 0..2pi. */
  swirl: number;
}

/**
 * The storms at winds-clock time `tWinds` (sim seconds). With no jet rates the storms stand where
 * the field put them (`stormsFor`), so a still body is exactly the t = 0 field.
 */
export function stormsAt(p: FieldParams, jets: JetRates | null, tWinds: number): MovingStorm[] {
  return stormsFor(p.seed, p.kind === 'gas' ? p.storms : 0).map((s) => {
    const lat = Math.asin(Math.max(-1, Math.min(1, s.center[1])));
    const lon0 = Math.atan2(s.center[2], s.center[0]);
    const driftRate = jets ? flowAngularRate(s.center, p, jets) : 0;
    const spinRate = jets ? ((lat >= 0 ? -1 : 1) * jets.windMs) / (s.size * jets.radiusM) : 0;
    // Follows the wind at its current longitude, and stops at the edge of its band (see `trackFor`).
    const lon = jets ? lon0 + trackOffset(trackFor(lat, lon0, p, jets), tWinds) : lon0;
    const cl = Math.cos(lat);
    return {
      ...s,
      center: [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)] as Vec3,
      lon0,
      driftRate,
      spinRate,
      swirl: wrap(spinRate * tWinds, TWO_PI),
    };
  });
}

/** Storm id at direction `d` for the storms at one time (0 = none). The haptic twin of the shader. */
export function stormIdAtTime(d: Vec3, storms: readonly Storm[]): number {
  return stormIdAt(d, storms);
}

// ---- planets: clouds on latitude winds ----------------------------------------------------------

/**
 * Zonal wind of a planet's cloud layer as a fraction of the peak, by latitude: a three-cell
 * circulation, u ~ cos(3 lat), which gives westerlies and easterlies in bands (artistic shape; the
 * peak speed is `dynamics.jet_speed_ms`, R5.7: "physics rule for the rate; art for cloud shapes").
 */
export function cloudWindProfile(lat: number): number {
  return Math.cos(3 * lat);
}

/** Eastward angular rate of the clouds at latitude `lat`, rad per sim second. */
export function cloudAngularRate(lat: number, j: JetRates): number {
  return (cloudWindProfile(lat) * peakAngularRate(j)) / Math.max(Math.cos(lat), MIN_COS_LAT);
}
