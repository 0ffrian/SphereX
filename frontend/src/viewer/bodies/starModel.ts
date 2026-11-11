// Issue #42, R7.5.3 to R7.5.5, D-34: the CPU model of a star's active regions, flares and
// prominence loops. Pure: the state at time t is a function of (seed, rates, t) only, with no state
// between frames, so the same card, seed and t give the same picture (D-34). The star shader paints
// exactly this state (it reads it as uniforms), and the CPU twin of the rest of the star surface
// (differential rotation) is `viewer/shaders/sphere.ts`.
//
// What is data and what is art (D-32):
//   - the spin, differential rotation k, spot lifetime and flare rate come from `dynamics`
//     (viewer/motion/motion.ts); a missing one is refused there, never filled in here;
//   - the NUMBER of groups at once is a typical value for the kind of body, an analogue (the Sun),
//     tier 4, and still [verify] (R7.5.3: "typical coverage for class and activity: [verify]"),
//   - sizes, latitudes, tilt and how long a flare is drawn on screen are display choices, artistic.
// All angles are in radians, all times in simulation seconds of the process that owns them.

import { hash3, mulberry32 } from '../fields/noise';
import {
  AREA_SPLIT,
  discRadiusFromArea,
  type SpotGroup,
  type StellarModel,
} from '@/physics/stellar';
import { cappedFlareSpeedup, type Motion } from '../motion/motion';

export type V3 = [number, number, number];

export interface StarSurfaceConfig {
  /**
   * Active-region groups alive at once (tier 4, `inferred_from_analog`; analogue: the Sun shows a
   * few groups at a time). [verify] against a source and by class and activity (R7.5.3); until then
   * it is only this analogue and the layers carry tier 4, never 1 to 3.
   */
  regionCount: number;
  /** Latitude band the groups are born in, radians (artistic display choice). */
  latBand: readonly [number, number];
  /** Angular radius of a full-grown group, radians (artistic: larger than life so it can be seen). */
  groupRadius: number;
  /** Joy's-law-like tilt of the leader-follower axis per radian of latitude (artistic). */
  tiltPerLat: number;
  /** Fraction of the cycle spent growing, and the fraction at which decay begins (artistic). */
  growEnd: number;
  decayStart: number;
  /** Pores per group, and follower fragments per group (R7.5.3: leader, broken-up follower, pores). */
  pores: number;
  followerParts: number;
  /** Seconds of real time one flare is drawn for (artistic: the time-lapse is of the schedule, see R7.5.5). */
  flareOnScreenS: number;
  /** Most flares drawn at once. */
  maxFlares: number;
  /** A flare needs its region to be at least this grown (0..1), else it is skipped (artistic). */
  flareMinEnv: number;
  /**
   * Issue #71 stream C: the physical groups (`physics/stellar.ts`). When set, `regionCount` is their
   * count and slot i is `groups[i]` (area, latitude, Joy tilt and separation from the physics, not
   * from the artistic fields above). Absent: the placeholder look above (no mass on the card).
   */
  groups?: readonly SpotGroup[];
}

export const STAR_SURFACE: StarSurfaceConfig = {
  regionCount: 4,
  latBand: [(5 * Math.PI) / 180, (35 * Math.PI) / 180],
  groupRadius: 0.38,
  tiltPerLat: 0.3,
  growEnd: 0.18,
  decayStart: 0.62,
  pores: 3,
  followerParts: 2,
  flareOnScreenS: 4,
  maxFlares: 2,
  flareMinEnv: 0.35,
};

/**
 * Config for a star whose spots come from the physics: `regionCount` is the number of drawn groups
 * (replaces the fixed 4), each group is two follower parts and two pores around its leader.
 */
export function configFromModel(
  model: StellarModel,
  base: StarSurfaceConfig = STAR_SURFACE,
): StarSurfaceConfig {
  return {
    ...base,
    regionCount: model.groups.length,
    followerParts: 2,
    pores: 2,
    groups: model.groups,
  };
}

/** Discs a group is made of: `1 + followerParts + pores`. The shader loops over this many per region. */
export const discsPerRegion = (c: StarSurfaceConfig = STAR_SURFACE): number =>
  1 + c.followerParts + c.pores;

export interface SpotDisc {
  center: V3;
  /** Angular radius, radians. 0 when the group has not appeared yet or has gone. */
  radius: number;
  kind: 'leader' | 'follower' | 'pore';
}

export interface RegionState {
  slot: number;
  /** Which life of this slot (a new one is born elsewhere each time the last one has gone). */
  cycle: number;
  center: V3;
  lat: number;
  lon: number;
  /** 0..1 life envelope: grows, holds, fades. */
  env: number;
  /** Angular radius of the whole group now. */
  size: number;
  /** Unit tangent from the leader to the follower, and the unit tangent along the polarity line. */
  axis: V3;
  north: V3;
  /** Half the leader-follower separation, radians. */
  sep: number;
  discs: SpotDisc[];
}

export interface StarRates {
  /** Sim seconds one region lives (`spot_lifetime_d` times 86400). */
  lifetimeS: number;
  /** Equatorial angular speed, rad per sim second, and k of Omega(phi) = Omega_eq (1 - k sin^2 phi). */
  omegaEq: number;
  k: number;
  /** Mean flares per sim second above the drawn threshold. 0 = none. */
  flareRatePerS: number;
  /** Shown time-lapse of the flares process (sets how long a flare lasts in sim time). */
  flareSpeedup: number;
  /** No spot clock: place mature groups once and leave them (no aging, no drift). */
  frozen?: boolean;
}

export const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Life envelope of a group at cycle fraction f: grows, holds, fades. Zero at both ends. */
export function lifeEnvelope(f: number, c: StarSurfaceConfig = STAR_SURFACE): number {
  return smooth01(f / c.growEnd) * (1 - smooth01((f - c.decayStart) / (1 - c.decayStart)));
}

const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const TWO_PI = Math.PI * 2;

/** Point on the unit sphere at latitude `lat` and longitude `lon` (lon = atan2(z, x), +y north). */
export function sphereDir(lat: number, lon: number): V3 {
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

/** East (increasing longitude) and north unit tangents at (lat, lon). */
export function tangents(lat: number, lon: number): { east: V3; north: V3 } {
  return {
    east: [-Math.sin(lon), 0, Math.cos(lon)],
    north: [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)],
  };
}

/** Stagger of a slot inside the lifetime cycle, 0..1, so the groups do not all appear together. */
function slotOffset(seed: number, slot: number, count: number): number {
  return (slot + hash3(slot, 7, 0, seed)) / count;
}

/**
 * The group in `slot` at spots-clock time `tSpots`. The birth place is re-rolled from the seed for
 * every cycle (so groups age, die and new ones appear), and the group is carried by differential
 * rotation relative to the body frame (which turns at the equatorial rate): its longitude grows by
 * k * Omega_eq * sin^2(lat) per sim second (the pole lags the equator), counted on the spin clock
 * `tSpin` when given, else from the group's age.
 */
export function regionAt(
  seed: number,
  slot: number,
  tSpots: number,
  rates: StarRates,
  c: StarSurfaceConfig = STAR_SURFACE,
  tSpin?: number,
): RegionState {
  let cycle = 0;
  let f: number;
  if (rates.frozen) {
    // Mature, at rest: the middle of the life, seeded per slot.
    f = c.growEnd + 0.3 + 0.15 * hash3(slot, 8, 0, seed);
  } else {
    const x = tSpots / rates.lifetimeS + slotOffset(seed, slot, c.regionCount);
    cycle = Math.floor(x);
    f = x - cycle;
  }
  const h = (i: number) => hash3(slot * 131 + i, cycle, i, seed);
  const phys = c.groups?.[slot];
  const hemi = phys ? phys.hemisphere : h(1) < 0.5 ? -1 : 1;
  const lat = phys ? phys.latRad : hemi * (c.latBand[0] + h(2) * (c.latBand[1] - c.latBand[0]));
  // Physical groups keep their place in the first life; a later life is born at a new longitude.
  const lon0 = phys ? phys.lonRad + (cycle > 0 ? h(3) * TWO_PI : 0) : h(3) * TWO_PI;
  const ageS = f * rates.lifetimeS;
  const sin = Math.sin(lat);
  // One clock for differential rotation: the spin clock when the caller has it (the granulation
  // shears on it too, so spots and cells shear together), else the group's own age.
  const lon = lon0 + rates.k * rates.omegaEq * sin * sin * (tSpin ?? ageS);
  const env = lifeEnvelope(f, c);
  // Physical: half the leader-follower separation is 0.55 size, so the loops (which use it) land on
  // the spots.
  const size = phys
    ? (phys.separationRad / 2 / 0.55) * Math.sqrt(env)
    : c.groupRadius * (0.7 + 0.3 * h(4)) * Math.sqrt(env);
  const center = sphereDir(lat, lon);
  const { east, north } = tangents(lat, lon);
  // The leader runs ahead in the direction of rotation, which is towards decreasing longitude, so
  // the axis (leader to follower) points east. Tilted towards the equator by Joy's law (artistic).
  // Physical: Joy's law, the follower poleward (+tilt turns east towards the hemisphere's pole).
  const tilt = phys ? phys.tiltRad : -hemi * c.tiltPerLat * Math.abs(lat);
  const axis = norm(add(scale(east, Math.cos(tilt)), scale(north, Math.sin(tilt))));
  const perp = cross(center, axis); // along the polarity line
  const sep = 0.55 * size;

  const place = (u: number, v: number): V3 =>
    norm(add(center, add(scale(axis, u), scale(perp, v))));
  if (phys) {
    // Radii from the group's area (the split of AREA_SPLIT), shrinking with the life envelope.
    const a = phys.areaFraction * env;
    const physDiscs: SpotDisc[] = [
      { center: place(-sep, 0), radius: discRadiusFromArea(a * AREA_SPLIT.leader), kind: 'leader' },
      {
        center: place(sep * (0.9 + 0.5 * h(10)), size * 0.1),
        radius: discRadiusFromArea(a * AREA_SPLIT.follower * (2 / 3)),
        kind: 'follower',
      },
      {
        center: place(sep * (0.9 + 0.5 * h(11)), -size * 0.1),
        radius: discRadiusFromArea(a * AREA_SPLIT.follower * (1 / 3)),
        kind: 'follower',
      },
    ];
    for (let i = 0; i < c.pores; i++) {
      const ang = h(20 + i) * TWO_PI;
      const r = size * (0.7 + 0.5 * h(25 + i));
      physDiscs.push({
        center: place(Math.cos(ang) * r, Math.sin(ang) * r),
        radius: discRadiusFromArea(a * AREA_SPLIT.pore),
        kind: 'pore',
      });
    }
    return { slot, cycle, center, lat, lon, env, size, axis, north: perp, sep, discs: physDiscs };
  }
  const discs: SpotDisc[] = [{ center: place(-sep, 0), radius: 0.52 * size, kind: 'leader' }];
  for (let i = 0; i < c.followerParts; i++) {
    const side = i === 0 ? 1 : -1;
    discs.push({
      center: place(sep * (0.9 + 0.5 * h(10 + i)), side * size * (0.12 + 0.12 * h(12 + i))),
      radius: size * (i === 0 ? 0.21 : 0.15),
      kind: 'follower',
    });
  }
  for (let i = 0; i < c.pores; i++) {
    const a = h(20 + i) * TWO_PI;
    const r = size * (0.7 + 0.5 * h(25 + i));
    discs.push({
      center: place(Math.cos(a) * r, Math.sin(a) * r),
      radius: size * (0.06 + 0.04 * h(30 + i)),
      kind: 'pore',
    });
  }
  return { slot, cycle, center, lat, lon, env, size, axis, north: perp, sep, discs };
}

export function regionsAt(
  seed: number,
  tSpots: number,
  rates: StarRates,
  c: StarSurfaceConfig = STAR_SURFACE,
  tSpin?: number,
): RegionState[] {
  const out: RegionState[] = [];
  for (let s = 0; s < c.regionCount; s++) out.push(regionAt(seed, s, tSpots, rates, c, tSpin));
  return out;
}

export interface FlareState {
  slot: number;
  /** Sim seconds since it started, and how long it is drawn (sim seconds). */
  age: number;
  duration: number;
  /** 0..1 brightness profile now: fast rise, slow decay. */
  intensity: number;
  /** 0..1 how far the arch has been lifted: grows and settles. */
  rise: number;
  center: V3;
  axis: V3;
  north: V3;
  /** Size of the flare area (radians): the region's own size. */
  size: number;
}

/** Share of a flare's drawn time spent rising: 15% of 4 s is 0.6 s, slower than a flash (WCAG 2.3.1). */
export const FLARE_RISE_FRACTION = 0.15;

/** Brightness profile of one flare at age a of duration D: a soft rise, then an exponential decay. */
export function flareProfile(a: number, duration: number): number {
  if (!(a >= 0) || !(a < duration)) return 0;
  const rise = FLARE_RISE_FRACTION * duration;
  if (a < rise) return a / rise;
  return Math.exp(-(a - rise) / (0.28 * duration));
}

/** The onset of flare m is placed in this share of its interval, so two onsets are >= half an interval apart. */
const FLARE_JITTER: readonly [number, number] = [0.25, 0.75];

/**
 * The flares being drawn at flares-clock time `tFlares`. A seeded jittered schedule: one event in
 * every interval of 1/rate seconds, in the middle half of it (so the mean rate is the rate and two
 * onsets are never closer than half an interval). The same seed, rate and t give the same list. The
 * place is a seeded slot; a flare whose region has not grown enough, or has been replaced since the
 * event, is not drawn (flares happen at active regions). A new flare that starts while the one
 * before it is still showing is skipped, never drawn over it (WCAG 2.3.1: no new sharp onsets while
 * one is on screen); of the flares that overlap anyway the oldest are kept.
 */
export function flaresAt(
  seed: number,
  tFlares: number,
  tSpots: number,
  rates: StarRates,
  c: StarSurfaceConfig = STAR_SURFACE,
  tSpin?: number,
): FlareState[] {
  if (!(rates.flareRatePerS > 0) || !(rates.flareSpeedup > 0) || c.regionCount < 1) return [];
  const spacing = 1 / rates.flareRatePerS;
  const duration = c.flareOnScreenS * rates.flareSpeedup;
  const startOf = (i: number) =>
    (i + FLARE_JITTER[0] + (FLARE_JITTER[1] - FLARE_JITTER[0]) * hash3(i, 91, 0, seed)) * spacing;
  // Onsets are at least `FLARE_JITTER` span apart, so a flare older than `back` onsets has ended.
  const back = Math.ceil(duration / ((FLARE_JITTER[1] - FLARE_JITTER[0]) * spacing)) + 1;
  // Flare m is skipped when `maxFlares` earlier ones are still showing at its start. Decided from
  // the `back` onsets before it only, so it is the same answer at every t (no flicker).
  const accepted = (m: number): boolean => {
    const shown: number[] = [];
    for (let j = Math.max(0, m - back); j <= m; j++) {
      const sj = startOf(j);
      const live = shown.filter((k) => sj - startOf(k) < duration).length;
      if (live >= c.maxFlares) {
        if (j === m) return false;
        continue;
      }
      if (j === m) return true;
      shown.push(j);
    }
    return false;
  };
  const first = Math.floor((tFlares - duration) / spacing) - 1;
  const last = Math.floor(tFlares / spacing);
  const out: FlareState[] = [];
  for (let m = Math.max(first, 0); m <= last; m++) {
    const start = startOf(m);
    const age = tFlares - start;
    if (age < 0 || age >= duration) continue;
    if (!accepted(m)) continue;
    const slot = Math.floor(hash3(m, 92, 0, seed) * c.regionCount) % c.regionCount;
    const r = regionAt(seed, slot, tSpots, rates, c, tSpin);
    if (r.env < c.flareMinEnv) continue;
    const intensity = flareProfile(age, duration);
    const u = age / duration;
    out.push({
      slot,
      age,
      duration,
      intensity,
      rise: smooth01(u * 1.6) * (1 - 0.35 * smooth01((u - 0.5) / 0.5)),
      center: r.center,
      axis: r.axis,
      north: r.north,
      size: r.size,
    });
  }
  // The oldest flares stay when more than `maxFlares` overlap: a showing flare is never replaced.
  out.sort((a, b) => b.age - a.age);
  return out.slice(0, c.maxFlares);
}

// ---- prominence loops (R7.5.5) ------------------------------------------------------------------

/**
 * One strand of a prominence loop, in the region's local frame: x along the leader-follower axis
 * (the footpoints are at x = -1 and x = +1), y along the polarity line, z the height above the
 * surface. All lengths are in units of half the leader-follower separation. The strand follows a
 * dipole field line, r = L sin^2(theta), of a dipole buried under the region with its axis along x
 * (the field of a bipolar group: it leaves the leader, arches up and comes down at the follower).
 */
export interface LoopStrand {
  points: V3[];
  /** Seeded phase of this strand's own sway, radians (strands do not move as one). */
  phase: number;
}

/** Colatitude (from the dipole axis) of the footpoints: sets how tall the loop is for its width. */
export const LOOP_FOOT_THETA = 0.9;

/**
 * Local-frame points of one dipole field line that touches the surface (z = 0) at x = -1 and x = +1
 * after the scaling below. `stretch` multiplies the height (1 = the nominal loop).
 */
export function dipoleLoopPoints(n: number, stretch = 1, theta0 = LOOP_FOOT_THETA): V3[] {
  // r = L sin^2(theta); the point is (r cos theta, r sin theta) from the dipole centre, which sits
  // at depth d below the surface plane so that z = r sin theta - d is 0 at theta0.
  const s0 = Math.sin(theta0);
  const L = 1 / (s0 * s0 * Math.cos(theta0)); // so x = L sin^2 cos = 1 at the footpoint
  const d = L * s0 * s0 * s0;
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const th = theta0 + ((Math.PI - 2 * theta0) * i) / (n - 1);
    const r = L * Math.sin(th) * Math.sin(th);
    // x runs from +1 (theta0) to -1 (pi - theta0): the leader is at -x, so flip.
    out.push([-r * Math.cos(th), 0, (r * Math.sin(th) - d) * stretch]);
  }
  return out;
}

/** Height of the nominal loop at its apex, in the same units (for tests and framing). */
export function loopApexHeight(theta0 = LOOP_FOOT_THETA): number {
  const s0 = Math.sin(theta0);
  const L = 1 / (s0 * s0 * Math.cos(theta0));
  return L - L * s0 * s0 * s0;
}

/**
 * A bundle of strands: nested dipole lines of slightly different height with seeded sideways
 * offsets, a seeded twist and uneven footpoints, so it reads as strands and not as one smooth arch
 * (reference checklist: "prominences made of uneven strands"). `count` 1 gives one plain arch (the
 * placement, tier 4); more strands are the strand look, which is tier 5.
 */
export function loopStrands(
  seed: number,
  region: number,
  count: number,
  points = 40,
): LoopStrand[] {
  const rnd = mulberry32(
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(region + 1, 0x85ebca6b)) >>> 0,
  );
  const out: LoopStrand[] = [];
  for (let j = 0; j < count; j++) {
    const stretch = count === 1 ? 1 : 0.5 + 0.9 * rnd();
    const base = dipoleLoopPoints(points, stretch);
    const yOff = count === 1 ? 0 : (rnd() - 0.5) * 0.7;
    const xJit = count === 1 ? 0 : (rnd() - 0.5) * 0.16;
    const twistAmp = count === 1 ? 0 : 0.03 + 0.05 * rnd();
    const twistTurns = 1.5 + 2 * rnd();
    const phase = rnd() * TWO_PI;
    out.push({
      phase,
      points: base.map(([x, , z], i): V3 => {
        const u = i / (points - 1);
        const env = Math.sin(Math.PI * u); // the twist vanishes at the footpoints
        const a = phase + twistTurns * TWO_PI * u;
        return [
          x * (1 + xJit),
          yOff + twistAmp * env * Math.cos(a),
          z + twistAmp * env * Math.sin(a),
        ];
      }),
    });
  }
  return out;
}

/**
 * CPU twin of the loop vertex shader (shaders/loops.ts): a local point (x, y, z) of a strand on
 * the sphere for a region at `center` with tangents `axis` and `north`, half separation `halfSep`
 * (radians) and a flare lift `rise` (0..1). Footpoints (z = 0) are exactly on the unit sphere.
 */
export const LOOP_RISE_GAIN = 1.4;
export function bendLoopPoint(
  center: V3,
  axis: V3,
  north: V3,
  halfSep: number,
  rise: number,
  p: V3,
): V3 {
  const dir = norm(add(center, add(scale(axis, p[0] * halfSep), scale(north, p[1] * halfSep))));
  return scale(dir, 1 + p[2] * halfSep * (1 + rise * LOOP_RISE_GAIN));
}

// ---- rates from the plan -----------------------------------------------------------------------

const DAY_S = 86400;
const HOUR_S = 3600;

/** Rates for a star whose spots do not move: groups are placed once, mature, and stay. */
export const STILL_STAR_RATES: StarRates = {
  lifetimeS: 1,
  omegaEq: 0,
  k: 0,
  flareRatePerS: 0,
  flareSpeedup: 0,
  frozen: true,
};

/**
 * StarRates from the resolved motion. The spots process must be animated (a stated speed-up and a
 * lifetime) for the groups to age and drift; otherwise they are placed once and stay (still).
 */
export function starRatesFrom(m: Motion): StarRates {
  const life = m.rates.spot_lifetime_d;
  const spin = m.rates.spin_period_h;
  const spinOn = spin !== undefined && m.processes.some((p) => p.id === 'spin');
  const spotsOn = life !== undefined && m.processes.some((p) => p.id === 'spots');
  const flare = m.rates.flare_rate_per_d;
  const flareProc = m.processes.find((p) => p.id === 'flares');
  // The three processes are independent (a T Tauri star spins and flares with no spot lifetime): the
  // groups stay put (frozen) only when the spots process itself is not animated.
  return {
    lifetimeS: spotsOn ? life.value * DAY_S : STILL_STAR_RATES.lifetimeS,
    omegaEq: spinOn ? TWO_PI / (spin.value * HOUR_S) : 0,
    k: spinOn ? (m.rates.diff_rotation?.value ?? 0) : 0,
    flareRatePerS: flare && flareProc ? flare.value / DAY_S : 0,
    flareSpeedup: flare && flareProc ? cappedFlareSpeedup(flareProc.speedup, flare.value) : 0,
    ...(spotsOn ? {} : { frozen: true }),
  };
}
