// §11 levels: from physics to the speakers. Area sources (R1: each sample's sector integrated exactly with a cos²
// surface directivity), absorption filter and path pressure, world scaling, the one presentation offset, the §11.7 stage
// window, snow shelf and pan. Pure and deterministic. The whole ambience is `artistic` (§2 rule 2).
import type { Tag } from '@/contract';
import { absorption, airAt, bedWorldDb, earthRef, lowpassHz, meanPathAir } from './air';
import { bedMembership, caption } from './captions';
import {
  bakeWind,
  bandCenterHz,
  isGroundBed,
  isHarmonicBed,
  PRIORITY,
  surfDb,
  uSand,
  wavesPM,
  whitecapFraction,
} from './sources';
import type { AirModel, BedLevel, BedSpec, MixFrame, Place, PlaceSample, SourceId } from './types';
import {
  ABS_DEAD_DB,
  BROADBAND_F,
  CNV_RAIN_DB,
  FLOW_MIN_U,
  GAS_IU,
  PRESENCE_RANGE_DB,
  D_MIN_M,
  DB_PER_NP,
  EARTH_REF,
  G_PRESENT_MAX,
  IU_LAND,
  L_REF,
  L_TARGET,
  LP_F_MAX,
  PAN_MAX,
  REF_LISTENER_M,
  RIVER_S_REF,
  SILENT_DB,
  SNOW_DB,
  STAGE_HEADROOM_DB,
  STAGE_WINDOW_DB,
  STORM_RAIN_DB,
  U_E_REF,
  WATER_RHO,
  WHITECAP_MIN_U,
} from './tuning';

/** Provenance of everything the ambience plays (§2 rule 2). */
export const AMBIENCE_TAG: Tag = 'artistic';

/** Key of a baked bed in the `baked` set and the optional `specs` map. */
export function bedKey(id: SourceId, variant: number): string {
  return `${id}|${variant}`;
}

const RING_EDGES: readonly [number, number, number][] = [
  [0.25, 0.125, 0.375],
  [0.5, 0.375, 0.75],
  [1, 0.75, 1.25],
];

/** §6.2 reach R (km) at listener height z (km). */
export function reachKm(z_km: number): number {
  return Math.min(Math.max(4 * z_km + 2, 2), 400);
}

/**
 * R1: the exact intensity weight of one sample's sector for a surface source with cos² directivity,
 * w = (dTheta/4pi)(z²/2)[1/(z²+s1²) - 1/(z²+s2²)]. Annulus edges are re-derived from s_km and the §6.2 pattern.
 */
export function cellWeight(sample: Pick<PlaceSample, 's_km'>, z_km: number): number {
  const R = reachKm(z_km);
  const z = Math.max(z_km * 1000, D_MIN_M);
  let s1: number;
  let s2: number;
  let dTheta: number;
  if (sample.s_km < 1e-9) {
    s1 = 0;
    s2 = 0.125 * R * 1000;
    dTheta = 2 * Math.PI;
  } else {
    const x = sample.s_km / R;
    let best = RING_EDGES[0] as [number, number, number];
    for (const r of RING_EDGES) if (Math.abs(r[0] - x) < Math.abs(best[0] - x)) best = r;
    s1 = best[1] * R * 1000;
    s2 = best[2] * R * 1000;
    dTheta = (2 * Math.PI) / 12;
  }
  const z2 = z * z;
  return (dTheta / (4 * Math.PI)) * (z2 / 2) * (1 / (z2 + s1 * s1) - 1 / (z2 + s2 * s2));
}

/** The §6.2 sample pattern (centre + 3 rings x 12) at height z, for reference integrals and tests. */
export function patternSamples(
  z_km: number,
  head = 0,
): { s_km: number; bearing: number; d_m: number }[] {
  const R = reachKm(z_km);
  const z = Math.max(z_km * 1000, D_MIN_M);
  const out = [{ s_km: 0, bearing: head, d_m: z }];
  for (const [k] of RING_EDGES) {
    for (let j = 0; j < 12; j++) {
      const s = k * R;
      out.push({ s_km: s, bearing: head + (j * Math.PI) / 6, d_m: Math.hypot(z, s * 1000) });
    }
  }
  return out;
}

const irefCache = new Map<number, number>();
/** I_ref: a full plane of members, listener at 2 m, Earth air, at band centre f (Hz). About 1/4 at low f. */
export function iRef(fHz: number): number {
  const f = Math.round(fHz); // bounded cache: keyed on whole Hz (review nit)
  const hit = irefCache.get(f);
  if (hit !== undefined) return hit;
  const z_km = REF_LISTENER_M / 1000;
  const a = absorption(f, EARTH_REF.P, EARTH_REF.T, 'N2');
  let I = 0;
  for (const s of patternSamples(z_km)) I += cellWeight(s, z_km) * Math.exp(-2 * a * s.d_m);
  irefCache.set(f, I);
  return I;
}

interface Area {
  I: number;
  dEff: number;
  pan: number;
}

function areaIntegral(id: SourceId, place: Place, alpha: number): Area {
  const z = place.features.z_km;
  let I = 0;
  let dI = 0;
  let pI = 0;
  for (const s of place.samples) {
    const c = bedMembership(id, s, place.features.rainRate);
    if (!(c > 0)) continue;
    const d = Math.max(s.d_m, D_MIN_M);
    const Ii = cellWeight(s, z) * c * Math.exp(-2 * alpha * d);
    if (!(Ii > 0)) continue;
    I += Ii;
    dI += Ii * d;
    pI += Ii * Math.sin(s.bearing - place.head);
  }
  return {
    I,
    dEff: I > 0 ? dI / I : 0,
    pan: I > 0 ? Math.max(-PAN_MAX, Math.min(PAN_MAX, pI / I)) : 0,
  };
}

function db(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

/** Live driver level (dB) of a ground bed at the Earth reference, before area and world terms; -Infinity = silent. */
function groundDriverDb(id: SourceId, air: AirModel, place: Place): number {
  const f = place.features;
  const U = f.wind.U10;
  const ice = Math.max(0, Math.min(1, f.iceCover));
  switch (id) {
    case 'S4':
      return surfDb(wavesPM(U, air.gv).Hs) + db(1 - ice);
    case 'S5': {
      // ASSUMPTION: the whitecap share is floored at its 3.5 m/s value so a calm open sea keeps its swell.
      const W = whitecapFraction(Math.max(U, WHITECAP_MIN_U));
      return L_REF.sea + db(W / whitecapFraction(U_E_REF)) + db(1 - ice);
    }
    case 'S6': {
      if (f.precipPhase !== 'rain' || f.cyclone?.inEye) return -Infinity;
      const storm = f.cyclone && f.cyclone.delta < 2 * f.cyclone.r ? STORM_RAIN_DB : 0;
      return L_REF.rain + 10 * Math.log10(Math.max(f.rainRate, 1e-3)) + CNV_RAIN_DB * f.cnv + storm;
    }
    case 'S7': {
      const l = air.liquid;
      if (!l) return -Infinity;
      // Dissipated power ∝ rho_l g Q S [SS §9]: Q is in the membership; rho g and the slope here (S_ref ASSUMPTION).
      return (
        L_REF.river +
        10 * Math.log10((l.rho * air.gv) / (WATER_RHO * EARTH_REF.g)) +
        10 * Math.log10(Math.max(f.slope, 1e-4) / RIVER_S_REF)
      );
    }
    case 'S8':
      return L_REF.lava;
    case 'S10': {
      const ex = U - uSand(air);
      if (!(ex > 0) || f.snowCover > 0.5) return -Infinity; // ASSUMPTION: snow-covered above half cover
      return L_REF.sand + 3 * db(ex / 5);
    }
    default:
      return -Infinity;
  }
}

/** The wind (m/s) driving a flow bed: S1/S9/S12 at the listener (Uz), S2/S3 at the ground (U10) (ASSUMPTION, Q-). */
/** The wind at the listener without the cyclone: the strongest non-hurricane part, scaled to the listener height. */
function backgroundWind(place: Place): number {
  const w = place.features.wind;
  const bg = w.parts.filter((p) => p.kind !== 'hurricane').reduce((m, p) => Math.max(m, p.U), 0);
  return w.U10 > 0 ? (bg * w.Uz) / w.U10 : 0;
}

function flowWind(id: SourceId, place: Place): number {
  const w = place.features.wind;
  if (id === 'S2' || id === 'S3') return w.U10;
  if (id === 'S9') {
    const h = w.parts.find((p) => p.kind === 'hurricane')?.U ?? 0;
    return w.U10 > 0 ? (h * w.Uz) / w.U10 : 0;
  }
  return w.Uz;
}

/** One presentation offset per world (§11.4): -10 log10(Z0/Z_E), clamped to ±30 dB. Used for ground beds. */
export function presentOffsetDb(air: AirModel): number {
  if (!air.airOK || !(air.Z0 > 0)) return 0;
  return clampG(-10 * Math.log10(air.Z0 / earthRef().Z));
}

/** R10: flow-noise beds (S1-S3, S9, S12) are raised by the impedance at the listener's height, Z(z) against Earth's surface. */
export function flowOffsetDb(air: AirModel, z_km: number): number {
  if (!air.airOK) return 0;
  const Z = airAt(air, z_km).Z;
  return Z > 0 ? clampG(-10 * Math.log10(Z / earthRef().Z)) : 0;
}

function clampG(g: number): number {
  return Math.max(-G_PRESENT_MAX, Math.min(G_PRESENT_MAX, g));
}

/** §11.7 stage window: L_pres = L_TARGET + clamp(L_true + G - L_TARGET, -24, +6); returns the gain in dB. Only for present beds (R8). */
export function stageGainDb(trueDb: number, G: number): number {
  if (!Number.isFinite(trueDb)) return SILENT_DB;
  return Math.max(-STAGE_WINDOW_DB, Math.min(STAGE_HEADROOM_DB, trueDb + G - L_TARGET));
}

/** A bed that is not present: gain SILENT_DB, which the mixer treats as linear 0 (R8: never lifted, never captioned). */
function silentBed(id: SourceId, variant: number): BedLevel {
  return {
    id,
    variant,
    trueDb: SILENT_DB,
    gainDb: SILENT_DB,
    lowpassHz: LP_F_MAX,
    shelfDb: 0,
    pan: 0,
    playbackRate: 1,
    harmonic: isHarmonicBed(id),
  };
}

interface Cand {
  bed: BedLevel;
  G: number;
}

/**
 * §10/§11 one mixer tick. `baked` holds bedKey(id, variant) of the beds ready to play; thunder is an event and is not
 * mixed here (its true level is thunderParams().level_dB; the mixer applies presentOffsetDb and stageGainDb to it).
 * `specs` (optional, same keys) supplies each bed's band centre; Uref is bakeWind(air, id) either way.
 *
 * R8 presence before presentation: a bed is present only if its source class is around the listener, its driver is
 * non-zero (flow beds: wind >= 1 m/s), it is not absorption-dead (ground: area + broadband loss < 60 dB) and its true
 * level is within 40 dB of the loudest present bed. Only present beds go through the stage window.
 */
export function mixFrame(
  air: AirModel,
  place: Place,
  baked: ReadonlySet<string>,
  prev?: MixFrame,
  specs?: ReadonlyMap<string, BedSpec>,
): MixFrame {
  const f = place.features;
  const at = airAt(air, f.z_km);
  const silent = !air.airOK || at.silent;
  const Gground = presentOffsetDb(air);
  const Gflow = flowOffsetDb(air, f.z_km);
  const { P: Pm, T: Tm } = meanPathAir(air, f.z_km);
  const snowFalling = f.precipPhase === 'snow' ? Math.max(0, Math.min(1, f.rainRate / 1.5)) : 0; // ASSUMPTION
  const shelf = -SNOW_DB * Math.max(f.snowCover, snowFalling);

  const keys = [...baked].map((k) => {
    const [id, v] = k.split('|');
    return { id: id as SourceId, variant: Number(v), key: k };
  });
  keys.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id) || a.variant - b.variant);
  const hasLand = keys.some((k) => k.id === 'S1_land');
  const hasSea = keys.some((k) => k.id === 'S1_sea');
  const hasHurricane =
    keys.some((k) => k.id === 'S9') &&
    (f.wind.parts.find((p) => p.kind === 'hurricane')?.U ?? 0) > 0;

  // Land/sea share of the area around the listener splits the two wind rumble variants (ASSUMPTION); when only one
  // variant is baked it takes the whole share (blue F4c).
  let landW = 0;
  let seaW = 0;
  for (const s of place.samples) {
    const w = cellWeight(s, f.z_km);
    if (s.cls === 'sea' || s.cls === 'ice' || s.cls === 'lake') seaW += w;
    else landW += w;
  }
  const tot = landW + seaW || 1;
  const landShare = hasSea ? landW / tot : 1;
  const seaShare = hasLand ? seaW / tot : 1;

  const cands: (Cand | BedLevel)[] = [];
  for (const { id, variant, key } of keys) {
    if (!PRIORITY.includes(id) || id === 'thunder' || !Number.isFinite(variant)) continue;
    if (silent) {
      cands.push(silentBed(id, variant));
      continue;
    }
    const spec = specs?.get(key);
    const Uref = spec?.Uref ?? bakeWind(air, id);
    let trueDb: number;
    let lp = LP_F_MAX;
    let pan = 0;
    let playbackRate = 1;
    let shelfDb = 0;
    let G = Gflow;
    if (isGroundBed(id)) {
      const fb = spec?.bandCenterHz ?? bandCenterHz(id, air, Uref);
      const alpha = absorption(fb, Pm, Tm, air.cls);
      const area = areaIntegral(id, place, Number.isFinite(alpha) ? alpha : 1e9);
      const drive = groundDriverDb(id, air, place);
      if (!(area.I > 0) || !Number.isFinite(drive)) {
        cands.push(silentBed(id, variant));
        continue;
      }
      const Lrel = 10 * Math.log10(area.I / iRef(fb));
      // Blue F5a (Q- proposal): the broadband loss is evaluated at min(band centre, 250 Hz), so a low bed is not
      // charged a 250 Hz loss on top of its own absorption.
      const broadband =
        -DB_PER_NP * absorption(Math.min(fb, BROADBAND_F), Pm, Tm, air.cls) * area.dEff;
      if (!(Lrel + broadband > -ABS_DEAD_DB)) {
        cands.push(silentBed(id, variant));
        continue;
      }
      const world = bedWorldDb(air, f.z_km, id); // ΔL_world + the listener-height term, combined (§11.3)
      trueDb = drive + Lrel + broadband + world;
      lp = lowpassHz((fr) => absorption(fr, Pm, Tm, air.cls), area.dEff);
      pan = area.pan;
      shelfDb = shelf;
      G = Gground;
    } else {
      // Review L5: with the hurricane bed playing, the rumble carries only the background (non-cyclone) wind.
      const U =
        (id === 'S1_land' || id === 'S1_sea') && hasHurricane
          ? backgroundWind(place)
          : flowWind(id, place);
      const share = id === 'S1_land' ? landShare : id === 'S1_sea' ? seaShare : 1;
      if (!(U >= FLOW_MIN_U) || !(share > 0)) {
        cands.push(silentBed(id, variant));
        continue;
      }
      if (id === 'S2' || id === 'S3') {
        trueDb = L_REF.wind + L_REF.hissRel + 3 * db(U / U_E_REF) + bedWorldDb(air, f.z_km, id);
        if (id === 'S3') trueDb += db(Math.max(f.exposure, 0));
        playbackRate = Math.max(0.7, Math.min(1.4, U / Math.max(Uref, 1e-6)));
      } else if (id === 'S12') {
        // §11.3 flow noise against Earth at the same reference wind (blue F6); I_u as baked (GAS_IU).
        const Iu = spec?.params.Iu ?? GAS_IU;
        trueDb = L_REF.gas + 2 * db(U / U_E_REF) + bedWorldDb(air, f.z_km, id) + db(Iu / IU_LAND);
      } else {
        trueDb =
          L_REF.wind +
          2 * db(U / U_E_REF) +
          bedWorldDb(air, f.z_km, id) +
          db(f.wind.Iu / IU_LAND) +
          10 * Math.log10(share);
      }
    }
    if (!Number.isFinite(trueDb)) {
      cands.push(silentBed(id, variant));
      continue;
    }
    cands.push({
      bed: {
        id,
        variant,
        trueDb,
        gainDb: SILENT_DB,
        lowpassHz: lp,
        shelfDb,
        pan,
        playbackRate,
        harmonic: isHarmonicBed(id),
      },
      G,
    });
  }

  const live = cands.filter((c): c is Cand => 'bed' in c);
  const loudest = live.reduce((m, c) => Math.max(m, c.bed.trueDb), -Infinity);
  const beds = cands.map((c) => {
    if (!('bed' in c)) return c;
    if (c.bed.trueDb < loudest - PRESENCE_RANGE_DB) return silentBed(c.bed.id, c.bed.variant);
    return { ...c.bed, gainDb: stageGainDb(c.bed.trueDb, c.G) };
  });

  // The caption's true-level note follows the offset of the loudest present bed (ground or flow, R10).
  const top = live.find((c) => c.bed.trueDb === loudest);
  const frame: MixFrame = {
    beds,
    presentOffsetDb: top ? top.G : Gground,
    silent,
    caption: { line: '', heard: [], levelNote: null, silentReason: null },
  };
  const cap = caption(air, place, frame);
  frame.caption =
    prev &&
    prev.caption.line === cap.line &&
    prev.caption.levelNote === cap.levelNote &&
    prev.caption.silentReason === cap.silentReason
      ? prev.caption
      : cap;
  return frame;
}
