// Issue #71 stream H (D-36, Q-270): every number the orbit pass reads, computed on the CPU as a
// pure function of (sources, camera state, light, time, size). The same inputs give the same
// numbers: nothing here reads a clock, `Math.random` or the frame rate (the cloud drift comes from
// the viewer's sim clock, passed in as `timeSec`).
import {
  GAS_TAU,
  HOT_ROCK_COLOUR,
  HOT_ROCK_K,
  airOpticalDepth,
  type OrbitSources,
  type Rgb,
} from './orbitSources';
import {
  FOV,
  HEIGHT_EXAGGERATION,
  cross3,
  flyCamera,
  groundKmFromGrid,
  nrm3,
  type FlyState,
  type Vec3,
} from './orbitMath';

export interface OrbitLight {
  /** Unit direction to the star in the body frame. */
  sunDir: Vec3;
  /** Star colour, peak 1 (linear). */
  starColour: Rgb;
  /** Sim-clock seconds of the clouds, for the drift. */
  timeSec: number;
  /** The clouds toggle. */
  cloudsOn: boolean;
}

export interface OrbitUniformValues {
  size: [number, number];
  cam: Vec3;
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  light: Vec3;
  star: Vec3;
  /** Local frame at the camera, for the flat-ground maths (prototype C0, CA, CB). */
  c0: Vec3;
  ca: Vec3;
  cb: Vec3;
  liq: Vec3;
  ice: Vec3;
  land: Vec3;
  cld: Vec3;
  aw: Vec3;
  z: Vec3;
  b: Vec3;
  s: Vec3;
  p: Vec3;
  hazeC: Vec3;
  scr: Vec3;
  scm: Vec3;
  ext: Vec3;
  fov: number;
  ex: number;
  rkm: number;
  ocean: number;
  tt: number;
  tb: number;
  cov: number;
  tau: number;
  hz: number;
  time: number;
  seed: number;
  gam: number;
  clouds: number;
  /** Scale height used for the air, km (already exaggerated, at least 0.3). */
  hv: number;
  /** Largest air mass, the grazing value sqrt(pi R / 2 H). */
  mx: number;
}

const v3 = (c: Rgb | null | undefined): Vec3 => (c ? [c[0], c[1], c[2]] : [0, 0, 0]);
/** Rayleigh-like relative scattering by colour (prototype constants, artistic). */
export const RAYLEIGH_RGB: Vec3 = [0.061, 0.142, 0.349];
/** The seed is reduced so the hash keeps its precision in 32-bit floats. */
export const SEED_MOD = 997;

export function orbitUniformValues(
  src: OrbitSources,
  s: FlyState,
  light: OrbitLight,
  size: { w: number; h: number },
): OrbitUniformValues {
  const gas = src.kind === 'gas';
  const ex = HEIGHT_EXAGGERATION[src.kind];
  const ground = gas ? () => 0 : groundKmFromGrid(src.heightGrid, src.hasOcean);
  const cam = flyCamera(s, { radiusKm: src.radiusKm, exaggeration: ex, groundKm: ground });
  const c0 = nrm3(cam.cam);
  const ca = nrm3(cross3(Math.abs(c0[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], c0));
  const cb = cross3(c0, ca);

  const airDrawn = src.scaleHeightKm !== null && (gas || src.pressureBar !== null);
  const tau = !airDrawn ? 0 : gas ? GAS_TAU : airOpticalDepth(src.pressureBar ?? 0);
  const hz = airDrawn ? src.haze : 0;
  const hv = Math.max((src.scaleHeightKm ?? 0) * ex, 0.3);
  const mx = Math.sqrt((Math.PI * src.radiusKm) / (2 * hv));
  const scr: Vec3 = [RAYLEIGH_RGB[0] * tau / hv, RAYLEIGH_RGB[1] * tau / hv, RAYLEIGH_RGB[2] * tau / hv];
  const scmV = (hz * 0.5) / hv;
  const scm: Vec3 = [scmV, scmV, scmV];
  const hc = v3(src.hazeColour);
  const ext: Vec3 = [
    scr[0] + scm[0] * Math.max(1.35 - hc[0], 0.05),
    scr[1] + scm[1] * Math.max(1.35 - hc[1], 0.05),
    scr[2] + scm[2] * Math.max(1.35 - hc[2], 0.05),
  ];

  const look = src.look;
  const hot = src.surfaceTempK !== null && src.surfaceTempK > HOT_ROCK_K;
  const gp = src.gasPalette;
  const cloudsPresent = !gas && src.cloudCover !== null && (src.cloudBase !== null || src.climate !== null);
  return {
    size: [size.w, size.h],
    cam: cam.cam,
    fwd: cam.fwd,
    right: cam.right,
    up: cam.up,
    light: nrm3(light.sunDir),
    star: v3(light.starColour),
    c0,
    ca,
    cb,
    liq: v3(look?.liq),
    ice: v3(look?.ice),
    land: hot ? v3(HOT_ROCK_COLOUR) : v3(look?.land),
    cld: v3(look?.cld),
    aw: v3(look?.aw),
    z: v3(gp?.z),
    b: v3(gp?.b),
    s: v3(gp?.s),
    p: v3(gp?.p),
    hazeC: hc,
    scr,
    scm,
    ext,
    fov: FOV,
    ex,
    rkm: src.radiusKm,
    ocean: src.hasOcean ? 1 : 0,
    tt: src.fluid?.tripleK ?? 0,
    tb: src.fluid?.boilK ?? 0,
    cov: src.cloudCover ?? 0,
    tau,
    hz,
    time: light.timeSec,
    seed: ((src.seed % SEED_MOD) + SEED_MOD) % SEED_MOD,
    gam: src.lapseKPerKm ?? 0,
    clouds: light.cloudsOn && cloudsPresent ? 1 : 0,
    hv,
    mx,
  };
}
