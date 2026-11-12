// §6.5 planetary wind model (rocky worlds) and §6.6 jet wind (gas giants): the wind a hovering listener hears.
// Built only from engine values (m.U, phiH, the lock flags, the climate temperatures and the cyclones); pure.
// Local frame (contract amendment 3): the engine's flyCamera basis, bearings clockwise from north.
import type { Tag } from '@/contract';
import { compass8 } from './captions';
import type { AirModel, PlaceFeatures, WindResult } from './types';
import {
  A_L, A_P, A_T, A_W, COAST_FADE_KM, GAS_IU, CYCLONE_REACH, H_BL, H_EARTH_KM, I_U_MIN, K_BR, POLAR_EDGE_MAX, RELIEF_SAT_KM,
  SHELTER, SPEEDUP, U_MIN, Z0_LAND, Z0_SEA, Z_JET_EARTH,
} from './tuning';

export { compass8 };

export type Vec3 = [number, number, number];
type Kind = WindResult['parts'][number]['kind'];

/** Context for windAt (App. B, amendment 1). Temperatures in K, distances in km, jetU in m/s (gas giants only). */
export interface WindCtx {
  exposure: number;
  relief: number;
  z_km: number;
  cyclone: PlaceFeatures['cyclone'];
  landT: number | null;
  seaT: number | null;
  sCoast_km: number | null;
  overSea: boolean;
  jetU: number | null;
}

/** up, east, north at (lon, lat): east = normalize(cross(Y, up)), north = cross(up, east) (amendment 3). [verify] that the engine's east is the prograde spin direction (trades blow from it). */
export function localBasis(lon: number, lat: number): { up: Vec3; east: Vec3; north: Vec3 } {
  const cl = Math.cos(lat);
  const sl = Math.sin(lat);
  const up: Vec3 = [cl * Math.cos(lon), sl, cl * Math.sin(lon)];
  // cross([0,1,0], up) = [up.z, 0, -up.x]; its length is cos(lat), so the normalised vector is [sin lon, 0, -cos lon].
  const east: Vec3 = [Math.sin(lon), 0, -Math.cos(lon)];
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return { up, east, north };
}

/** The substellar direction exactly as ebStep computes it (core.js): L = normalize([-0.74, 0.34, 0.58]) rotated about x by 0.12. */
export function substellar(): Vec3 {
  const c = Math.cos(0.12);
  const s = Math.sin(0.12);
  const L = [-0.74, 0.34, 0.58] as const;
  const n = Math.hypot(L[0], L[1], L[2]);
  return [L[0] / n, (L[1] * c - L[2] * s) / n, (L[1] * s + L[2] * c) / n];
}

/** Modified Rankine vortex: V = Vmax d/Rm inside the core, Vmax (Rm/d)^0.5 outside; peak at Rm. */
export function rankineV(delta: number, Rm: number, Vmax: number): number {
  if (!(Rm > 0)) return 0;
  return delta < Rm ? (Vmax * delta) / Rm : Vmax * Math.sqrt(Rm / delta);
}

/** Bearing (deg, clockwise from north) a flow-to vector (east, north) comes FROM. */
export function fromDeg(ve: number, vn: number): number {
  if (ve === 0 && vn === 0) return 0;
  const to = (Math.atan2(ve, vn) * 180) / Math.PI;
  return (((to + 180) % 360) + 360) % 360;
}

interface Pattern { pat: number; ve: number; vn: number; kind: Kind }

/** §6.5 item 2: the planetary circulation pattern (0..~1.2) and its flow-to direction in the local frame. */
export function circulation(air: AirModel, lon: number, lat: number): Pattern {
  if (air.locked && !air.res32) {
    const { up, east, north } = localBasis(lon, lat);
    const S = substellar();
    const cosT = Math.max(-1, Math.min(1, up[0] * S[0] + up[1] * S[1] + up[2] * S[2]));
    const sinT = Math.sqrt(1 - cosT * cosT);
    if (sinT < 1e-6) return { pat: 0, ve: 0, vn: 0, kind: 'terminator' };
    const t: Vec3 = [S[0] - cosT * up[0], S[1] - cosT * up[1], S[2] - cosT * up[2]];
    const te = t[0] * east[0] + t[1] * east[1] + t[2] * east[2];
    const tn = t[0] * north[0] + t[1] * north[1] + t[2] * north[2];
    const n = Math.hypot(te, tn) || 1;
    return { pat: A_L * sinT, ve: te / n, vn: tn / n, kind: 'terminator' };
  }
  const phi = Math.abs(lat);
  const phiH = air.phiH > 0 ? air.phiH : 0.5;
  const hemi = lat >= 0 ? 1 : -1;
  const r2 = Math.SQRT1_2;
  // ASSUMPTION: one outer edge phi0 = min(2 phiH, 1.45) ends the westerlies and starts the polar cell (the spec's
  // pi/2 - 2 phiH is negative for phiH > pi/4). The westerlies may end at a non-zero value when phi0 = 1.45 (noted).
  const phi0 = Math.min(2 * phiH, POLAR_EDGE_MAX);
  if (phi < phiH) return { pat: A_T * Math.sin((Math.PI * phi) / phiH), ve: -r2, vn: -hemi * r2, kind: 'trade' };
  if (phi < phi0) return { pat: A_W * Math.sin((Math.PI * (phi - phiH)) / phiH), ve: r2, vn: hemi * r2, kind: 'westerly' };
  const span = Math.PI / 2 - phi0;
  const u = span > 1e-9 ? Math.max(0, Math.min(1, (phi - phi0) / span)) : 0;
  // ASSUMPTION: polar easterlies blow from the east and equatorward, like the trades (direction not given in §6.5).
  return { pat: A_P * Math.sin(Math.PI * u), ve: -r2, vn: -hemi * r2, kind: 'polar' };
}

function windTag(air: AirModel): Tag {
  const w = air.inputs.find((i) => i.label === 'Wind scale');
  return air.gas && w?.tag === 'measured' ? 'measured' : 'model_dependent';
}

function heightProfile(air: AirModel, U10: number, z_km: number, overSea: boolean): { Uz: number; Iu: number } {
  const z0 = overSea ? Z0_SEA : Z0_LAND;
  const zm = Math.max(z_km * 1000, 1);
  const logU = (h: number) => (U10 * Math.log(Math.max(h, z0 * 1.0001) / z0)) / Math.log(10 / z0);
  let Uz: number;
  if (zm <= 1000) Uz = logU(zm);
  else {
    const U1 = logU(1000);
    const zJet = Z_JET_EARTH * (air.H_km / H_EARTH_KM);
    const f = zJet > 0 ? Math.max(0, Math.min(1, (z_km - 1) / zJet)) : 1;
    Uz = U1 + (air.Uscale - U1) * f;
  }
  // ASSUMPTION: turbulence intensity from the log law capped at 1 km height.
  const Iu = Math.max(1 / Math.log(Math.min(zm, 1000) / z0), I_U_MIN);
  return { Uz: Math.max(0, Uz), Iu };
}

/** §6.5 / §6.6 wind at the listener. */
export function windAt(air: AirModel, lon: number, lat: number, ctx: WindCtx): WindResult {
  const tag = windTag(air);
  if (!air.airOK) return { U10: 0, Uz: 0, Iu: I_U_MIN, dirDeg: 0, parts: [], tag };

  if (air.gas) {
    // §6.6: jetU is already m/s (m.U x the normalised profile), filled by place.ts. Missing -> no wind (never guessed).
    if (ctx.jetU === null || !Number.isFinite(ctx.jetU)) return { U10: 0, Uz: 0, Iu: I_U_MIN, dirDeg: 0, parts: [], tag };
    const U = Math.abs(ctx.jetU);
    return { U10: U, Uz: U, Iu: GAS_IU, dirDeg: ctx.jetU >= 0 ? 270 : 90, parts: [{ kind: 'jet', U }], tag };
  }

  const p = circulation(air, lon, lat);
  const Upat = air.Us * p.pat;
  const parts: { kind: Kind; U: number }[] = [{ kind: p.kind, U: Upat }];
  let ve = Upat * p.ve;
  let vn = Upat * p.vn;

  // Item 3: sea/land breeze, a gravity current (Simpson 1994 [verify]).
  let Ubr = 0;
  if (ctx.landT !== null && ctx.seaT !== null && Number.isFinite(ctx.landT) && Number.isFinite(ctx.seaT)) {
    const Tm = (ctx.landT + ctx.seaT) / 2; // ASSUMPTION: the spec's Tloc is not in ctx; the mean of the two sides.
    const dT = Math.abs(ctx.landT - ctx.seaT);
    const fade = Math.exp(-Math.max(ctx.sCoast_km ?? 0, 0) / COAST_FADE_KM);
    Ubr = Tm > 0 ? K_BR * Math.sqrt((air.gv * H_BL * dT) / Tm) * fade : 0;
    if (Ubr > 0) parts.push({ kind: 'breeze', U: Ubr });
  }
  // ASSUMPTION: the breeze direction is not in ctx, so it is combined in quadrature with the pattern.
  let U10 = Math.max(Math.sqrt(ve * ve + vn * vn + Ubr * Ubr), U_MIN);

  // Item 5: terrain speed-up and shelter.
  U10 *= 1 + SPEEDUP * Math.max(ctx.exposure, 0) * Math.min(ctx.relief / RELIEF_SAT_KM, 1) - SHELTER * Math.max(-ctx.exposure, 0);
  U10 = Math.max(U10, U_MIN);

  // Item 7: cyclone (modified Rankine); the eye is calm.
  const cy = ctx.cyclone;
  if (cy && air.Vmax !== null && cy.delta < CYCLONE_REACH * cy.r) {
    if (cy.inEye) {
      U10 = U_MIN;
      ve = 0;
      vn = 0;
      parts.length = 0;
      parts.push({ kind: 'hurricane', U: 0 });
    } else {
      const V = rankineV(cy.delta, cy.Rm, air.Vmax);
      parts.push({ kind: 'hurricane', U: V });
      U10 = Math.max(U10, V);
    }
  }

  const { Uz, Iu } = heightProfile(air, U10, ctx.z_km, ctx.overSea);
  parts.sort((a, b) => b.U - a.U);
  return { U10, Uz, Iu, dirDeg: fromDeg(ve, vn), parts, tag };
}
