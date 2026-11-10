// Issue #71 stream D (D-36, Q-240 to Q-243): the surface of a rocky or water exoplanet drawn from
// the plate-tectonics terrain and the heat / ice / water budget (physics/terrain.ts,
// physics/climateBudget.ts), in TSL so it runs on WebGPU and on the WebGL2 fallback. It is the
// rock branch of the prototype's world shader (`WORLD_FS`).
//
// The two grids come from the world worker (fields/worldGenerator.ts) as Float32 DataTextures read
// with `textureLoad` and filtered by hand (no float32 filtering needed, see fieldTexture.ts):
//   terrain  RGBA: R height (model km, sea level 0), G boundary signal (-1 divergent .. +1 convergent)
//   climate  RGBA: R temperature K, G sea-ice thickness, B frost amount, A relative humidity
// Both use the world UV: u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 (row 0 = south).
//
// The haptics read the shared field built from the SAME terrain (D-01): `worldGenerator` writes it,
// `ShaderBody` samples it, so the finger feels the relief and coast that are drawn.
//
// Honesty: the terrain and every colour is `artistic` (shown at + Artistic, with the surface layer);
// the ice and open water of the budget are `model_dependent` and are shown alone, without any
// terrain, by the pattern mode (a smooth sphere, coloured by temperature against the fluid's
// freezing point). No step function: ice, frost and cloud edges are smoothsteps of continuous fields.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  AdditiveBlending,
  DataTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import {
  abs,
  asin,
  atan,
  cameraPosition,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  normalView,
  normalWorld,
  normalize,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  sign,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl';
import type { Object3D } from 'three/webgpu';
import { SUBSTELLAR_DIRECTION } from '../fields/fieldGenerator';
import { peakAngularRate, MIN_COS_LAT, type JetRates } from '../fields/flowModel';
import { shaderSeedOffsets } from '../fields/noise';
import type { WorldData } from '../fields/worldGenerator';
import { phasePair } from '../motion/phase';
import { processOf, spinRateRadPerSimS, type Motion, type SimTimeFn } from '../motion/motion';
import { bilinear, floatTexture, vnoise3 } from './fieldTexture';
import { EVOLVE_PER_RAD } from './jetSurface';
import { LAVA_COLOUR } from './shaderPalette';
import { PATTERN_GROUND, PATTERN_ICE, PATTERN_WATER } from './shaderSpec';

const TAU = Math.PI * 2;
const rgb3 = (c: readonly number[]) => vec3(c[0]!, c[1]!, c[2]!);

/** Model heights are in km; the bump and the colour ramps scale by this (about the tallest range, artistic). */
export const RELIEF_KM = 6;
/** Cloud shell scale and atmosphere shell scale (artistic; the values of the older planet look). */
const CLOUD_SHELL = 1.012;
const ATMO_SHELL = 1.04;
const ATMO_SCALE_HEIGHT = 0.03;
/** Largest cloud shear before the flow-map resets, radians (artistic). */
const MAX_CLOUD_SHEAR = 0.9;

const rotY = (p: any, a: any) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.x.negate().mul(s).add(p.z.mul(c)));
};

/** World UV of a body-frame direction (row 0 = south). */
function worldUV(dir: any) {
  const u = atan(dir.z, dir.x).div(TAU).add(0.5);
  const v = asin(clamp(dir.y, -1, 1)).div(Math.PI).add(0.5);
  return { u, v };
}

/** The knobs of the issue #60 build animation (ShaderBody's PlanetMouldUniforms); 1 = the normal surface. */
export interface RockyMould {
  terrain: any;
  sea: any;
  colour: any;
  clouds: any;
}

export interface RockyOptions {
  world: WorldData;
  kind: 'planet_rocky' | 'planet_water';
  seed: number;
  motion: Motion;
  /** Physical radius, m, for the cloud drift. */
  scaleM: number | null;
  sunWorld: any;
  sunValue: Vector3;
  sunColour: any;
  mould: RockyMould;
  /** Slider values (artistic, D-27): bump height, cloud cover 0..1 and atmosphere strength 0..1, or undefined for the model's own. */
  relief: number;
  cloudCover: number | undefined;
  atmosphere: number | undefined;
  showPlates: boolean;
  /** Reduced phone tier: fewer noise octaves and no fine detail (the viewer's `low` level). */
  low: boolean;
  textures: DataTexture[];
}

export interface RockyBuilt {
  group: Group;
  runtime: { frame: Object3D; update(time: SimTimeFn): void };
  setPattern(on: boolean): void;
}

/** Interleaves the worker's two-channel terrain into RGBA for a texture (G = boundary signal). */
export function terrainRGBA(data: Float32Array): Float32Array {
  const n = data.length / 2;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = data[i * 2]!;
    out[i * 4 + 1] = data[i * 2 + 1]!;
  }
  return out;
}

export function buildRockyWorld(o: RockyOptions): RockyBuilt {
  const { world, mould } = o;
  const m = world.model;
  const F = m.fluid;
  const terrTex = floatTexture(terrainRGBA(world.terrain.data), world.terrain.W, world.terrain.H);
  const climTex = floatTexture(world.climate.out, world.climate.nx, world.climate.ny);
  o.textures.push(terrTex, climTex);
  const group = new Group();
  const geo = new SphereGeometry(1, o.low ? 96 : 128, o.low ? 72 : 96);
  const overlays: Mesh[] = [];
  const octs = o.low ? 3 : 4;

  const sunLocal = uniform(new Vector3(0, 0, 1));
  const pattern = uniform(0);
  const notPattern = float(1).sub(pattern);
  const plates = uniform(o.showPlates ? 1 : 0);
  const cloudPhase = uniform(new Vector3(0, 0, 0));
  const cloudEvo = uniform(new Vector3(0, 0, 0));
  const seedOff = vec3(0, 0, shaderSeedOffsets(o.seed).cloud);
  const noiseOff = vec3(0, 0, shaderSeedOffsets(o.seed).cloud + 0.5);

  const dir = normalize(positionLocal);
  const { u, v } = worldUV(dir);
  const C = bilinear(climTex, u, v); // T, ice thickness, frost, humidity
  const T0 = C.x;
  const hi = max(C.y, 0);
  const sn = max(C.z, 0);
  const rh = C.w;

  // The one height field with fine detail added below the grid's resolution (seen, not felt).
  const T = bilinear(terrTex, u, v);
  const e0 = T.x;
  const mtn = smoothstep(0.15, 2.2, e0);
  const ridge = (p: any) => float(1).sub(abs(vnoise3(p, octs).mul(2).sub(1)));
  let el: any = e0.add(
    ridge(dir.mul(26).add(noiseOff)).sub(0.55).mul(float(0.2).add(mtn.mul(1.5))),
  );
  if (!o.low) el = el.add(vnoise3(dir.mul(80).add(noiseOff), 3).sub(0.5).mul(0.1));
  const sig = T.y;

  // Fluid and temperature -> what is on the ground ------------------------------------------
  const Tl = T0.sub(el.max(0).mul(m.gamK));
  const fn = vnoise3(dir.mul(38).add(noiseOff), octs);
  const landBase = m.Ts > 700 ? ([0.15, 0.12, 0.11] as const) : F.land;
  const landLow = vnoise3(dir.mul(15).add(noiseOff), 3);
  let ld: any = mix(rgb3(landBase), rgb3(landBase).mul(vec3(0.72, 0.7, 0.7)).add(0.06), smoothstep(0.5, 2.6, el))
    .mul(landLow.mul(0.62).add(0.7));
  ld = mix(ld, ld.mul(1.18).add(vec3(0.03, 0.025, 0.015)), float(1).sub(smoothstep(0, 0.35, el)));
  // Frost in soft patches set by the frost budget and local temperature; ice on high cold ground.
  const fs = float(1).sub(exp(sn.negate().div(0.08)));
  const cold = float(1).sub(smoothstep(F.Tt - 5, F.Tt + 9, Tl));
  let fa: any = clamp(
    fs.mul(float(0.35).add(cold.mul(0.65))).add(cold.mul(smoothstep(1.6, 3.4, el)).mul(0.75)),
    0,
    1,
  );
  fa = smoothstep(0, 1, fa.mul(fn.mul(0.7).add(0.7)));
  ld = mix(ld, rgb3(F.ice).mul(fn.mul(0.2).add(0.92)), fa);

  // Ocean: open water to pack ice through floes; thickness sets how much of the cell is ice.
  const tb = m.Tb ?? 0;
  const seaOn = world.hasOcean ? 1 : 0;
  const ocean0: any = float(seaOn).mul(
    tb > 0 ? float(1).sub(smoothstep(tb - 2, tb + 6, T0)) : float(1),
  );
  const ocean: any = mould.sea.greaterThanEqual(1).select(ocean0, ocean0.mul(mould.sea));
  const deep = clamp(el.negate().div(3.5), 0, 1);
  const water = mix(rgb3(F.liq).mul(2.6).add(vec3(0.004, 0.012, 0.014)), rgb3(F.liq), smoothstep(0, 0.32, deep));
  const ic = float(1).sub(exp(hi.negate().div(0.55)));
  const fl = vnoise3(dir.mul(30).add(noiseOff), 5);
  const th = mix(float(0.86), float(0.14), ic);
  const ice = smoothstep(th.sub(0.1), th.add(0.1), fl);
  const iceC = rgb3(F.ice).mul(vnoise3(dir.mul(70), 3).mul(0.28).add(0.82));
  const seabed = rgb3(landBase).mul(0.55).mul(fn.mul(0.6).add(0.7));
  const oc = mix(mix(seabed, water, ocean), iceC, ice.mul(ocean));
  // The coast is a smoothstep of the height, never a step; a world with no basin is all land.
  const landW: any = seaOn ? smoothstep(-0.07, 0.07, el) : float(1);
  let col: any = mix(oc, ld, landW);
  // Optional plate boundaries overlay (artistic): red convergent, blue divergent.
  col = mix(
    col,
    mix(vec3(0.2, 0.6, 1), vec3(1, 0.28, 0.12), smoothstep(0, 0.2, sig.add(0.1))),
    clamp(abs(sig).mul(1.6), 0, 0.95).mul(plates).mul(notPattern),
  );
  const colourFull = mould.colour.greaterThanEqual(1);
  col = colourFull.select(col, mix(rgb3([0.66, 0.68, 0.72]), col, mould.colour));

  // Clouds: humidity from the budget (rh) thresholded with fractal noise, carried by latitude winds.
  const cov = o.cloudCover ?? m.cov;
  const animated = (() => {
    const winds = processOf(o.motion, 'winds');
    const rate = o.motion.rates.jet_speed_ms;
    return winds && rate && o.scaleM ? { windMs: rate.value, radiusM: o.scaleM } : null;
  })();
  const jets: JetRates | null = animated;
  const peak = jets ? Math.abs(peakAngularRate(jets)) : 0;
  const animatedClouds = jets !== null && peak > 0;
  const tracer = (d: any, evo: any) => {
    const p = d.mul(4.5).add(seedOff).add(vec3(0, 0, evo));
    return clamp(
      smoothstep(0.55, 1.05, rh).mul(0.85).add(vnoise3(p, 4).sub(0.5).mul(1.3)),
      0,
      1,
    );
  };
  const cloudAt = (d: any) => {
    if (!animatedClouds) return tracer(d, 0);
    const lat = asin(clamp(d.y, -1, 1));
    const pl = cos(lat.mul(3)).div(max(cos(lat), MIN_COS_LAT));
    return mix(
      tracer(rotY(d, cloudPhase.y.mul(pl)), cloudEvo.y),
      tracer(rotY(d, cloudPhase.x.mul(pl)), cloudEvo.x),
      cloudPhase.z,
    );
  };
  const cth = float(1 - Math.min(1, Math.max(0, cov)));
  const cloudMask = (c: any) => smoothstep(cth, cth.add(0.26), c);
  // Cloud shadow on the ground: the cloud that shades this point lies towards the Sun.
  const sunTan = sunLocal.sub(dir.mul(dot(sunLocal, dir)));
  const elev = max(dot(sunLocal, dir), 0.15);
  const shaded = cloudMask(cloudAt(normalize(dir.add(sunTan.mul(float((CLOUD_SHELL - 1) * 2.2).div(elev))))));
  col = col.mul(
    float(1).sub(
      shaded.mul(0.42).mul(min(float(cov * 2), 1)).mul(smoothstep(-0.05, 0.25, dot(sunLocal, dir))),
    ),
  );

  // Bump from the height, ocean flattened (screen derivatives, as the older planet look).
  const hv = el.div(RELIEF_KM).mul(landW);
  const sx = dFdx(positionView);
  const sy = dFdy(positionView);
  const dxh = dFdx(hv);
  const dyh = dFdy(hv);
  const n0 = normalView;
  const r1 = cross(sy, n0);
  const r2 = cross(n0, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(r1.mul(dxh).add(r2.mul(dyh)));
  let pv: any = grad.mul(o.relief).mul(mould.terrain).div(max(abs(det), 1e-6));
  pv = pv.mul(min(float(1), float(0.85).div(max(length(pv), 1e-5)))).mul(notPattern);
  const bumped = normalize(n0.sub(pv));

  // Air: haze hides the surface (methane smog, steam), seen along a longer path near the limb.
  const z = clamp(normalView.z, 0.07, 1);
  const am = float(1).div(z).min(9);
  const tauOpt = Math.min(3, m.airless ? 0 : 0.55 + 0.7 * Math.log10(o.world.model.Pa / 1e5 + 1));
  col = col.mul(exp(am.mul(-tauOpt * 0.11)));
  if (m.haze > 0.001) {
    const hzt = float(1).sub(exp(am.mul(-m.haze * 0.8)));
    col = mix(col, rgb3(m.hazeC).mul(0.8), hzt);
  }

  // Lava on a hot dayside: glowing cracks where the local temperature passes the rock's melting range.
  const crack = pow(ridge(dir.mul(7).add(noiseOff)), 3);
  const molten = smoothstep(1000, 1500, Tl);
  const lava = rgb3(LAVA_COLOUR).mul(molten.mul(crack.mul(2.4).add(0.55))).mul(notPattern);

  // Pattern mode (model_dependent only): water or ground, ice where it is colder than the fluid freezes.
  const patternBase = o.kind === 'planet_water' && seaOn ? rgb3(PATTERN_WATER) : rgb3(PATTERN_GROUND);
  const frozen = float(1).sub(smoothstep(F.Tt - 4, F.Tt + 4, T0));
  const patternCol = mix(patternBase, rgb3(PATTERN_ICE), frozen);

  const wet = ocean.mul(float(1).sub(ice)).mul(float(1).sub(landW));
  const mat = new MeshStandardNodeMaterial();
  mat.colorNode = mix(col, patternCol, pattern);
  mat.normalNode = bumped;
  mat.roughnessNode = mix(float(0.9), float(0.2), wet.mul(notPattern));
  mat.metalness = 0;
  // Sky reflection on open water: Schlick Fresnel (F0 = 0.02) of the sky colour on the lit side.
  const mu = clamp(normalView.z, 0, 1);
  const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(mu), 5)));
  const sunlit = smoothstep(-0.1, 0.3, dot(normalWorld, o.sunWorld));
  const skyRefl = rgb3(m.sky).mul(o.sunColour).mul(fres).mul(wet).mul(sunlit).mul(0.9).mul(notPattern);
  mat.emissiveNode = lava.add(skyRefl);
  group.add(new Mesh(geo, mat));

  if (cov > 0.001) {
    const cm = new MeshStandardNodeMaterial();
    cm.colorNode = rgb3(F.cld);
    cm.opacityNode = cloudMask(cloudAt(dir)).mul(0.92).mul(mould.clouds);
    cm.transparent = true;
    cm.depthWrite = false;
    cm.roughness = 1;
    const clouds = new Mesh(geo, cm);
    clouds.scale.setScalar(CLOUD_SHELL);
    overlays.push(clouds);
    group.add(clouds);
  }

  const atmoStrength = o.atmosphere ?? (m.airless ? 0 : Math.min(1, 0.4 + m.tau * 0.5));
  if (atmoStrength > 0.001) {
    // Single scattering along the view ray through a thin shell, in the colour the star's light
    // scatters to (derived from Teff, physics/fluids.ts `skyColours`).
    const am2 = new MeshBasicNodeMaterial();
    const view = normalize(cameraPosition.sub(positionWorld));
    const nv = abs(dot(normalWorld, view));
    const b = float(ATMO_SHELL).mul(sqrt(max(float(1).sub(nv.mul(nv)), 0)));
    const rim = float(0.9).mul(exp(b.sub(1).max(0).negate().div(ATMO_SCALE_HEIGHT)));
    const haze = float(0.03).mul(pow(float(1).sub(nv), 3));
    const dens = mix(haze, rim, smoothstep(0.97, 1.0, b));
    const cosG = dot(o.sunWorld, view).negate();
    const phase = float(0.75).mul(float(1).add(cosG.mul(cosG)));
    const lit = smoothstep(-0.05, 0.45, dot(normalWorld, o.sunWorld));
    am2.colorNode = rgb3(m.sky).mul(o.sunColour);
    am2.opacityNode = clamp(dens.mul(phase).mul(lit).mul(atmoStrength).mul(mould.clouds), 0, 1);
    am2.transparent = true;
    am2.depthWrite = false;
    am2.blending = AdditiveBlending;
    const atm = new Mesh(geo, am2);
    atm.scale.setScalar(ATMO_SHELL);
    overlays.push(atm);
    group.add(atm);
  }

  const inv = new Matrix4();
  const tmp = new Vector3();
  const spinRate = spinRateRadPerSimS(o.motion);
  const locked = m.locked;
  const axis = new Vector3(...SUBSTELLAR_DIRECTION);
  const facing = new Quaternion();
  const runtime = {
    frame: group as Object3D,
    update(time: SimTimeFn) {
      if (locked) {
        // The star-facing point (+X) points at the light and keeps facing it as the light moves.
        facing.setFromUnitVectors(axis, tmp.copy(o.sunValue).normalize());
        group.quaternion.copy(facing);
      } else {
        group.rotation.y = spinRate * time('spin');
      }
      if (animatedClouds && jets) {
        const pair = phasePair(time('winds'), MAX_CLOUD_SHEAR / peak);
        const rate = peakAngularRate(jets);
        cloudPhase.value.set(rate * pair.a, rate * pair.b, pair.w);
        cloudEvo.value.set(EVOLVE_PER_RAD * peak * pair.a, EVOLVE_PER_RAD * peak * pair.b, 0);
      }
      group.updateWorldMatrix(true, false);
      inv.copy(group.matrixWorld).invert();
      tmp.copy(o.sunValue).transformDirection(inv);
      sunLocal.value.copy(tmp);
    },
  };
  const setPattern = (on: boolean) => {
    pattern.value = on ? 1 : 0;
    for (const mesh of overlays) mesh.visible = !on;
  };
  return { group, runtime, setPattern };
}
