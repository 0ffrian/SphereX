// R7.7, D-01, D-12, D-26: browser-shader renderer for planet_rocky, planet_water, gas_giant,
// nebula and nova (three r187, `three/webgpu` node materials / TSL).
//
// Field first: planets and gas giants read their height, bands, storm ids and masks from the shared
// CPU field (fields/fieldGenerator.ts) through two Float32 DataTextures, fetched with `textureLoad`
// (no sampler, so it does not matter whether float32 is filterable) and filtered by hand. The
// shader adds only visual noise below the field's resolution. Nebula and nova are emission volumes
// (issue #43, volume/VolumeBody.ts); they have no field, no point sets and no haptics (Q-103).
//
// Motion (issue #42, R5.7, D-34): when the card's `dynamics` gives rates and stated speed-ups
// (motion/motion.ts), the body moves with the SimClock through `setTime`: it spins, the jets of a
// gas giant slide past each other and its storms drift and turn, and the clouds of a planet are
// carried by latitude winds. Every frame is a pure function of (card, seed, t). The storms the
// shader draws are the ones the haptic sampler is given at the same t (`fields/flowModel.ts`).
//
// Honesty: every layer here is `artistic` (R7.7). When `artistic` is not in the visible tags the
// layer is hidden (planets and gas giants fall back to a plain sphere; nebula and nova draw
// nothing, because nothing about them is measured). A layer refused for missing data is not drawn
// and is listed in `missing`. `status` says which of these applies in plain words (R5.3).
//
// Plug-in shape (review B5): this class owns no lighting policy and no honesty model. The viewer
// passes the light direction (`ctx.lightDir`), the visible tags (`ctx.visibleTags`) and an
// `ctx.onChange` callback that requests a render.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3,
  Matrix4,
} from 'three/webgpu';
import {
  abs,
  asin,
  clamp,
  cos,
  exp,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  normalView,
  normalWorld,
  positionLocal,
  positionView,
  positionWorld,
  cameraPosition,
  pow,
  sign,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import {
  FieldSampler,
  RING_GAP_EDGES,
  RING_INNER,
  RING_OUTER,
  type FieldData,
  type Vec3,
} from '../fields/fieldGenerator';
import { requestField } from '../fields/fieldClient';
import { peakAngularRate, MIN_COS_LAT, type JetRates } from '../fields/flowModel';
import { shaderSeedOffsets } from '../fields/noise';
import { phasePair } from '../motion/phase';
import {
  processOf,
  resolveMotion,
  spinRateRadPerSimS,
  type Motion,
  type SimTimeFn,
} from '../motion/motion';
import { sliderValue, type Overrides } from '../sliders';
import {
  ESTIMATED_TAGS,
  type BodyContext,
  type BodyRenderer,
  type BodyStatus,
} from './bodyRenderer';
import {
  ICE_COLOUR,
  LAND_HIGH,
  LAND_HIGH_GREY,
  LAND_LOW,
  LAND_LOW_GREEN,
  LAVA_COLOUR,
  OCEAN_DEEP,
  OCEAN_SHALLOW,
  type Rgb,
} from './shaderPalette';
import type { PointSet, PointSets } from './pointClouds';
import type { TierName } from '../render/quality';
import { createVolume, type VolumeHandle } from '../volume/VolumeBody';
import { nebulaVolume, remnantShell, remnantVolume } from '../volume/volumeSpecs';
import {
  kindHasPlainSphere,
  resolveShaderSpec,
  shaderDistance,
  sizeFieldFor,
  type ShaderSpec,
} from './shaderSpec';
import { bilinear, fieldUV, floatTexture, vnoise3 } from './fieldTexture';
import { buildJetSurface, EVOLVE_PER_RAD, makeJetRuntime } from './jetSurface';

const rgb3 = (c: Rgb) => vec3(c[0], c[1], c[2]);

/** Neutral grey used for the plain sphere when no layer may be shown. Not a measured colour. */
const PLAIN_COLOUR = 0x8a8a8a;
/**
 * Light direction until the viewer gives one. A body is lit from the plan's light (`planLighting`,
 * R5.1), which falls back to this head-on direction when the card has no phase angle or sun_dir.
 */
const HEAD_ON: Vec3 = [0, 0, 1];
// Mock-up final-state group scales (artistic).
const NEBULA_SCALE = 1.35;
const NOVA_SCALE = 0.925;

/** Largest cloud shear before the flow-map resets, radians (artistic). */
const MAX_CLOUD_SHEAR = 0.9;
/** Cloud shell scale (artistic) and the height that sets how far a cloud's shadow falls. */
const CLOUD_SHELL = 1.012;
const CLOUD_HEIGHT = CLOUD_SHELL - 1;
/** Atmosphere shell scale and scale height, in planet radii (artistic). */
const ATMO_SHELL = 1.04;
const ATMO_SCALE_HEIGHT = 0.03;

const rotY = (p: any, a: any) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.x.negate().mul(s).add(p.z.mul(c)));
};

/** What a built surface needs each frame, from the clock (set by `ShaderBody.setTime`). */
interface Runtime {
  /** The object the spin rotates (carries the surface frame for haptics). */
  frame: Object3D;
  update(time: SimTimeFn): void;
}

// ---- planets -----------------------------------------------------------------------------------

/**
 * Issue #60 build animation knobs of a generated world, each 0..1. At 1 (the default, and the end
 * of every build) each knob gives exactly the normal surface: the values are switched with
 * `select`, never mixed, so no rounding changes the final frame.
 */
type FloatUniform = ReturnType<typeof makeFloatUniform>;
function makeFloatUniform(v: number) {
  return uniform(v);
}
export interface PlanetMouldUniforms {
  terrain: FloatUniform;
  sea: FloatUniform;
  colour: FloatUniform;
  clouds: FloatUniform;
}

/** Mock-up TERRA_FS: the land colour before the Colour step (a plain light grey; artistic). */
const MOULD_GREY: Rgb = [0.66, 0.68, 0.72];
/** Mock-up `uSea = .03 + (seaL - .03) * P`: the sea starts this low and rises to the real level. */
const MOULD_SEA_START = 0.03;

function buildPlanet(
  spec: ShaderSpec,
  field: FieldData,
  sunWorld: any,
  textures: DataTexture[],
  motion: Motion,
  sunValue: Vector3,
  mould: PlanetMouldUniforms,
): { group: Group; runtime: Runtime } {
  const fp = spec.field!;
  const style = spec.planet!;
  const texA = floatTexture(field.a, field.width, field.height);
  const texB = floatTexture(field.b, field.width, field.height);
  textures.push(texA, texB);
  const group = new Group();
  const geo = new SphereGeometry(1, 128, 96);

  const winds = processOf(motion, 'winds');
  const jetRate = motion.rates.jet_speed_ms;
  const jets: JetRates | null =
    winds && jetRate && spec.scaleM ? { windMs: jetRate.value, radiusM: spec.scaleM } : null;
  const peak = jets ? Math.abs(peakAngularRate(jets)) : 0;
  const animatedClouds = jets !== null && peak > 0;

  // Uniforms the runtime writes: cloud flow-map (shearA, shearB, evoA, evoB), its weight, and the
  // light direction in the surface frame (for cloud shadows).
  const cloudPhase = uniform(new Vector3(0, 0, 0)); // shear A, shear B, weight of A
  const cloudEvo = uniform(new Vector3(0, 0, 0)); // evolve A, evolve B
  const sunLocal = uniform(new Vector3(0, 0, 1));

  const dir = normalize(positionLocal);
  const { u, v } = fieldUV(dir);
  const A = bilinear(texA, u, v);
  const B = bilinear(texB, u, v);
  const h = A.x;
  const crack = B.z;
  // Build animation (issue #60): the sea rises from a low level to the real one, then the field's
  // own ocean mask takes over (knob = 1). A world without a sea keeps the field's mask throughout.
  const hasSea = fp.seaLevel > 0;
  const seaFull = mould.sea.greaterThanEqual(1);
  const seaRising = float(MOULD_SEA_START).add(
    float(Math.max(fp.seaLevel, 0) - MOULD_SEA_START).mul(mould.sea),
  );
  const seaOn = mould.sea.greaterThan(0.01);
  const ocean: any = hasSea
    ? seaFull.select(
        B.x,
        seaOn.select(
          float(1).sub(smoothstep(seaRising.sub(0.006), seaRising.add(0.006), h)),
          float(0),
        ),
      )
    : B.x;
  const seaL: any = hasSea
    ? seaFull.select(float(fp.seaLevel), seaOn.select(seaRising, float(0)))
    : float(0);
  const colourFull = mould.colour.greaterThanEqual(1);
  // The mock-up scales ice and heat with its colour knob.
  const ice: any = colourFull.select(B.y, B.y.mul(mould.colour));
  const heat: any = colourFull.select(float(fp.heat), float(fp.heat).mul(mould.colour));

  // Clouds: density at a direction, carried by the latitude winds and slowly re-forming. Two
  // flow-map copies (motion/phase.ts) so the shear is bounded. A pure function of the uniforms.
  const seedOff = vec3(0, 0, shaderSeedOffsets(spec.seed).cloud);
  const density = (d: any, evo: any) => {
    // B1/NF-3: a bounded seed offset, not the raw seed (float32 would drown the direction term).
    const p = d
      .mul(3)
      .add(seedOff)
      .add(vec3(0, 0, evo));
    const q = vec3(vnoise3(p.add(3.3), 3), vnoise3(p.add(7.7), 3), vnoise3(p.add(1.1), 3));
    return vnoise3(p.mul(1.2).add(q.mul(1.6)), 4);
  };
  const cloudAt = (d: any) => {
    if (!animatedClouds) return density(d, 0);
    const pl = cos(asin(clamp(d.y, -1, 1)).mul(3)).div(
      max(cos(asin(clamp(d.y, -1, 1))), MIN_COS_LAT),
    );
    const a = density(rotY(d, cloudPhase.x.mul(pl)), cloudEvo.x);
    const b = density(rotY(d, cloudPhase.y.mul(pl)), cloudEvo.y);
    return mix(b, a, cloudPhase.z);
  };
  // Over an ocean the reference (water_world.jpg) shows clouds as a minority, so the same cover
  // slider draws fewer and softer-edged clouds there (Q-107; a drawing choice, the cover is unchanged).
  const wetWorld = fp.seaLevel > 0;
  const cloudThr = float(
    wetWorld ? 0.9 - 0.34 * style.cloudCover : 0.88 - (0.88 - 0.36) * style.cloudCover,
  );
  // Build animation: the cover grows from none (threshold above every density) to the real one.
  const cloudsFull = mould.clouds.greaterThanEqual(1);
  const thr: any = cloudsFull.select(cloudThr, mix(float(1.05), cloudThr, mould.clouds));
  const cloudMask = (c: any) => smoothstep(thr, thr.add(wetWorld ? 0.12 : 0.16), c);

  const hh = clamp(h.sub(seaL).div(float(1).sub(seaL)), 0, 1);
  const depth = hasSea
    ? seaL.greaterThan(0).select(clamp(seaL.sub(h).div(max(seaL, 1e-6)).mul(3), 0, 1), float(0))
    : float(0);
  const lowC = mix(rgb3(LAND_LOW), rgb3(LAND_LOW_GREEN), style.hue);
  const highC = mix(rgb3(LAND_HIGH), rgb3(LAND_HIGH_GREY), style.hue);
  // Sub-resolution colour variation (visual only).
  const vr = vnoise3(dir.mul(fp.freq * 3 * 4).add(5));
  const landReal = mix(lowC, highC, clamp(hh.mul(1.5).add(vr.sub(0.5).mul(0.6)), 0, 1));
  const landC = colourFull.select(landReal, mix(rgb3(MOULD_GREY), landReal, mould.colour));
  const oceanC = mix(rgb3(OCEAN_SHALLOW), rgb3(OCEAN_DEEP), depth);
  let col: any = mix(landC, oceanC, ocean);
  col = mix(col, rgb3(ICE_COLOUR), ice);
  col = col.mul(float(1).sub(heat.mul(0.5)));

  // Cloud shadows: the cloud that shades this ground point lies towards the Sun along the surface,
  // displaced by the cloud height over the Sun's elevation (A7 look; artistic).
  let shadow: any = float(1);
  if (style.cloudCover > 0.001) {
    const sunTan = sunLocal.sub(dir.mul(dot(sunLocal, dir)));
    const elev = max(dot(sunLocal, dir), 0.15);
    const shift = sunTan.mul(float(CLOUD_HEIGHT * 2.2).div(elev));
    const shaded = cloudMask(cloudAt(normalize(dir.add(shift))));
    shadow = float(1).sub(shaded.mul(0.55).mul(smoothstep(-0.05, 0.25, dot(sunLocal, dir))));
  }
  col = col.mul(shadow);

  // Bump from the field's height (ocean flattened), per the mock-up's screen-derivative method.
  const hv = mix(h, seaL, ocean);
  const sx = dFdx(positionView);
  const sy = dFdy(positionView);
  const dx = dFdx(hv);
  const dy = dFdy(hv);
  const n0 = normalView;
  const r1 = cross(sy, n0);
  const r2 = cross(n0, sx);
  const det = dot(sx, r1);
  const grad = sign(det).mul(r1.mul(dx).add(r2.mul(dy)));
  let pv: any = grad
    .mul(style.relief)
    .mul(mould.terrain)
    .div(max(abs(det), 1e-6));
  pv = pv.mul(min(float(1), float(0.85).div(max(length(pv), 1e-5))));
  const bumped = normalize(n0.sub(pv));

  const lowH = float(1).sub(smoothstep(0, 0.5, hh));
  const lava = crack
    .mul(lowH.mul(0.5).add(0.5))
    .mul(1.7)
    .add(lowH.mul(0.12).mul(float(1).sub(ocean)));

  // Ocean: Fresnel reflection of the sky on the lit side (Schlick, F0 = 0.02) over the standard
  // material's own specular, which gives the Sun glint (low roughness).
  const wet = ocean.mul(float(1).sub(ice));
  const mu = clamp(normalView.z, 0, 1);
  const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(mu), 5)));
  const sunlitWorld = smoothstep(-0.1, 0.3, dot(normalWorld, sunWorld));
  const skyRefl =
    style.atmosphere > 0.001
      ? rgb3(style.atmosphereColour).mul(fres).mul(wet).mul(sunlitWorld).mul(0.9)
      : vec3(0, 0, 0);

  const mat = new MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.normalNode = bumped;
  mat.roughnessNode = mix(float(0.9), float(0.2), wet);
  mat.metalness = 0;
  mat.emissiveNode = (fp.heat > 0 ? rgb3(LAVA_COLOUR).mul(lava).mul(heat) : vec3(0, 0, 0)).add(
    skyRefl,
  );
  group.add(new Mesh(geo, mat));

  if (style.cloudCover > 0.001) {
    const cm = new MeshStandardNodeMaterial();
    cm.colorNode = vec3(0.97, 0.97, 0.97);
    cm.opacityNode = cloudsFull.select(
      cloudMask(cloudAt(dir)).mul(wetWorld ? 0.85 : 0.92),
      cloudMask(cloudAt(dir))
        .mul(wetWorld ? 0.85 : 0.92)
        .mul(mould.clouds),
    );
    cm.transparent = true;
    cm.depthWrite = false;
    cm.roughness = 1;
    const clouds = new Mesh(geo, cm);
    clouds.scale.setScalar(CLOUD_SHELL);
    group.add(clouds);
  }

  if (style.atmosphere > 0.001) {
    // Single scattering along the view ray through a thin shell: the density seen at impact
    // parameter b (in planet radii) falls off as exp(-(b - 1) / H) past the limb, and a thin haze
    // lies over the disc; the Rayleigh phase function (1 + cos^2) makes the lit rim brightest.
    const am = new MeshBasicNodeMaterial();
    const view = normalize(cameraPosition.sub(positionWorld));
    const nv = abs(dot(normalWorld, view));
    const b = float(ATMO_SHELL).mul(sqrt(max(float(1).sub(nv.mul(nv)), 0)));
    const rim = float(0.9).mul(exp(b.sub(1).max(0).negate().div(ATMO_SCALE_HEIGHT)));
    // A faint haze over the disc that thickens toward the limb (it must not grey the surface or
    // light the night side).
    const haze = float(0.03).mul(pow(float(1).sub(nv), 3));
    const dens = mix(haze, rim, smoothstep(0.97, 1.0, b));
    const cosG = dot(sunWorld, view).negate();
    const phase = float(0.75).mul(float(1).add(cosG.mul(cosG)));
    const sunlit = smoothstep(-0.05, 0.45, dot(normalWorld, sunWorld));
    am.colorNode = rgb3(style.atmosphereColour);
    am.opacityNode = clamp(
      dens.mul(phase).mul(sunlit).mul(style.atmosphere).mul(mould.clouds),
      0,
      1,
    );
    am.transparent = true;
    am.depthWrite = false;
    am.blending = AdditiveBlending;
    const atm = new Mesh(geo, am);
    atm.scale.setScalar(ATMO_SHELL);
    group.add(atm);
  }

  const inv = new Matrix4();
  const tmp = new Vector3();
  const spinRate = spinRateRadPerSimS(motion);
  const runtime: Runtime = {
    frame: group,
    update(time) {
      group.rotation.y = spinRate * time('spin');
      if (animatedClouds && jets) {
        const t = time('winds');
        const pair = phasePair(t, MAX_CLOUD_SHEAR / peak);
        const rate = peakAngularRate(jets); // signed: a negative wind flows the other way
        cloudPhase.value.set(rate * pair.a, rate * pair.b, pair.w);
        cloudEvo.value.set(EVOLVE_PER_RAD * peak * pair.a, EVOLVE_PER_RAD * peak * pair.b, 0);
      }
      // Light in the surface frame, for the cloud shadows.
      group.updateWorldMatrix(true, false);
      inv.copy(group.matrixWorld).invert();
      tmp.copy(sunValue).transformDirection(inv);
      sunLocal.value.copy(tmp);
    },
  };
  return { group, runtime };
}

// ---- gas giants --------------------------------------------------------------------------------

function buildGas(
  spec: ShaderSpec,
  field: FieldData,
  textures: DataTexture[],
  motion: Motion,
  octaves: number,
  sampler: FieldSampler,
  sunWorld: any,
): { group: Group; frame: Object3D; runtime: Runtime } {
  const fp = spec.field!;
  const gas = spec.gas!;
  const texA = floatTexture(field.a, field.width, field.height);
  textures.push(texA);
  const group = new Group();
  const tilt = new Group();
  tilt.rotation.z = 0.35;
  group.add(tilt);

  const surface = buildJetSurface({
    texA,
    bands: fp.bands,
    seed: spec.seed,
    turbulence: fp.turbulence,
    palette: gas.palette,
    octaves,
    selfLit: false,
    emissive: gas.glow,
    clouds: false,
    storms: fp.storms,
    sunWorld,
  });
  const mesh = surface.mesh;
  // Flattening from the spin (A7.2): the polar axis is shorter, so the silhouette is an ellipse.
  mesh.scale.y = 1 - gas.flattening;
  tilt.add(mesh);

  if (gas.rings > 0.01) {
    const c1 = gas.palette[1];
    const tint = vec3(
      Math.min(1, c1[0] * 1.05 + 0.1),
      Math.min(1, c1[1] + 0.08),
      Math.min(1, c1[2] * 0.9),
    );
    const rm = new MeshBasicNodeMaterial();
    const r = length(positionLocal.xy);
    const t = r.sub(RING_INNER).div(RING_OUTER - RING_INNER);
    const n = mx_noise_float(vec3(r.mul(35), 0.5, shaderSeedOffsets(spec.seed).ringGrain))
      .mul(0.5)
      .add(0.5);
    const bands = sin(r.mul(70))
      .mul(sin(r.mul(23).add(1)))
      .mul(0.45)
      .add(0.55);
    let dens: any = clamp(n.mul(0.65).add(0.35), 0, 1).mul(bands);
    // Same gap edges as the field's ring-gap function (N2).
    const [ga, gb, gc, gd] = RING_GAP_EDGES;
    const gap = smoothstep(ga, gb, t).mul(float(1).sub(smoothstep(gc, gd, t)));
    dens = dens.mul(float(1).sub(gap.mul(0.9)));
    const edge = smoothstep(0, 0.04, t).mul(float(1).sub(smoothstep(0.96, 1, t)));
    rm.colorNode = tint.mul(n.mul(0.5).add(0.7));
    rm.opacityNode = dens.mul(edge).mul(gas.rings).mul(0.92);
    rm.transparent = true;
    rm.depthWrite = false;
    rm.side = DoubleSide;
    const ring = new Mesh(new RingGeometry(RING_INNER, RING_OUTER, 160, 1), rm);
    ring.rotation.x = Math.PI / 2;
    tilt.add(ring);
  }

  const winds = processOf(motion, 'winds');
  const clouds = processOf(motion, 'clouds');
  const wind = motion.rates.jet_speed_ms;
  const jets: JetRates | null =
    winds && wind && spec.scaleM ? { windMs: wind.value, radiusM: spec.scaleM } : null;
  const evolveRatio = winds && clouds ? clouds.speedup / winds.speedup : 0;
  const update = makeJetRuntime({
    surface,
    fp,
    jets,
    spinRate: spinRateRadPerSimS(motion),
    evolveRatio,
    sampler,
  });
  const runtime: Runtime = {
    // The surface frame: tilt, spin and flattening, so a world point maps to the unit sphere the
    // field is defined on (haptics, `worldToBody`).
    frame: mesh,
    update,
  };
  return { group, frame: mesh, runtime };
}

// ---- body --------------------------------------------------------------------------------------

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    const mat = (m as { material?: unknown }).material as
      { dispose(): void } | { dispose(): void }[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

interface Built {
  group: Group;
  /** Node the body frame is measured in: the spinning surface (tilt, spin, flattening), else the group. */
  frame: Object3D;
  textures: DataTexture[];
  field: FieldData | null;
  points: PointSets | null;
  /** Per-frame motion (spin, jets, storms, clouds); null for the point clouds. */
  runtime: Runtime | null;
  sampler: FieldSampler | null;
  volumes?: VolumeHandle[];
}

export class ShaderBody implements BodyRenderer {
  readonly object = new Group();
  private surface: Group | null = null;
  private frame: Object3D | null = null;
  private plain: Mesh | null = null;
  private textures: DataTexture[] = [];
  private sampler: FieldSampler | null = null;
  private points: PointSets | null = null;
  private volumes: VolumeHandle[] = [];
  private tier: TierName;
  private spec: ShaderSpec;
  private visibleTags: readonly Tag[];
  private overrides: Overrides;
  private disposed = false;
  private runtime: Runtime | null = null;
  private time: SimTimeFn = () => 0;
  private motion: Motion;
  private readonly octaves: number;
  private readonly sun = uniform(new Vector3(...HEAD_ON));
  /** Issue #60 build knobs (1 = the normal surface); shared by every rebuild of this body. */
  private readonly mould: PlanetMouldUniforms = {
    terrain: makeFloatUniform(1),
    sea: makeFloatUniform(1),
    colour: makeFloatUniform(1),
    clouds: makeFloatUniform(1),
  };
  private readonly fieldSource: NonNullable<BodyContext['fieldSource']>;
  private readonly onChange: (() => void) | undefined;
  private readonly onFailed: ((layerId: string) => void) | undefined;

  private constructor(
    private readonly card: ObjectCard,
    private readonly params: RenderParams,
    ctx: BodyContext,
  ) {
    // B2 / D-21: the default is the "+ Estimated" start state, which hides artistic layers.
    this.visibleTags = ctx.visibleTags ?? ESTIMATED_TAGS;
    this.overrides = ctx.overrides ?? {};
    this.fieldSource = ctx.fieldSource ?? requestField;
    this.onChange = ctx.onChange;
    this.onFailed = ctx.onFailed;
    this.octaves = ctx.octaves ?? 4;
    this.tier = ctx.tier ?? 'medium';
    this.motion = ctx.motion ?? resolveMotion(card, params);
    this.spec = resolveShaderSpec(card, params, this.overrides, this.motion);
    if (ctx.lightDir) this.setSunDirection(ctx.lightDir);
  }

  static async create(
    card: ObjectCard,
    params: RenderParams,
    ctx: BodyContext = {},
  ): Promise<ShaderBody> {
    const body = new ShaderBody(card, params, ctx);
    await body.rebuild();
    return body;
  }

  /**
   * Starts the body without waiting: the plain sphere is there at once and the generated surface
   * swaps in when the field is ready (never blank). A failed field is reported through
   * `ctx.onFailed(layerId)` and logged; the body stays as it is.
   */
  static start(card: ObjectCard, params: RenderParams, ctx: BodyContext = {}): ShaderBody {
    const body = new ShaderBody(card, params, ctx);
    body.ensurePlain();
    body.rebuild().catch((err: unknown) => {
      if (body.disposed) return;
      console.warn('[viewer] could not build the generated surface', err);
      body.onFailed?.(body.spec.layerId);
      body.onChange?.();
    });
    return body;
  }

  get drawn(): readonly string[] {
    return this.surface?.visible ? [this.spec.layerId] : [];
  }
  get missing(): readonly string[] {
    return this.spec.missing;
  }
  get hidden(): readonly string[] {
    if (!this.spec.drawable) return [];
    return this.visibleTags.includes(this.spec.tag) ? [] : [this.spec.layerId];
  }
  get suggestedDistance(): number {
    return shaderDistance(this.spec);
  }

  get status(): BodyStatus {
    const { drawable, tag } = this.spec;
    if (!drawable) {
      return {
        state: 'refused',
        message: 'Not drawn: the size or radius this view needs is missing, so nothing is guessed.',
        tags: [],
      };
    }
    if (!this.visibleTags.includes(tag)) {
      return {
        state: 'hidden',
        message: this.plainShown()
          ? "Showing a plain grey sphere at the size on the card. The surface is an artist's impression and is hidden at this honesty level; choose + Artistic to see it."
          : this.spec.kind === 'nebula' || this.spec.kind === 'nova'
            ? `Nothing is shown. This ${this.spec.kind === 'nova' ? 'explosion' : 'cloud'} is an artist's impression and is hidden at this honesty level; choose + Artistic to see it.`
            : "Nothing is shown. The surface is an artist's impression and the size is only an estimate, so both are hidden at this honesty level.",
        // NF-5: what is on screen. The plain grey sphere is a placeholder, not a layer.
        tags: [],
      };
    }
    return {
      state: 'drawn',
      message:
        "Artist's impression: this view is generated from a procedural model, not a measured image.",
      tags: [tag],
    };
  }

  get altText(): string {
    const s = this.status;
    return s.state === 'drawn'
      ? `${this.params.alt_text} This is an artist's impression, not a measured image.`
      : s.message;
  }

  get field(): FieldSampler | null {
    return this.sampler;
  }

  get pointSets(): Readonly<Record<string, PointSet>> | null {
    return this.points as unknown as Readonly<Record<string, PointSet>> | null;
  }

  worldToBody(p: Vec3): Vec3 {
    const v = new Vector3(p[0], p[1], p[2]);
    const frame = this.frame ?? this.object;
    frame.updateWorldMatrix(true, false);
    frame.worldToLocal(v);
    return [v.x, v.y, v.z];
  }

  /**
   * Issue #60: build-animation knobs of a generated world (0..1 each; omitted = 1). Uniform writes
   * only: nothing is rebuilt. All 1 is the normal surface.
   */
  setMould(k: Partial<Record<keyof PlanetMouldUniforms, number>> | null): void {
    if (this.disposed) return;
    for (const key of Object.keys(this.mould) as (keyof PlanetMouldUniforms)[]) {
      const v = k?.[key];
      this.mould[key].value = v === undefined ? 1 : Math.max(0, Math.min(1, v));
    }
    this.onChange?.();
  }

  setSunDirection(dir: Vec3): void {
    const d = new Vector3(dir[0], dir[1], dir[2]);
    if (d.lengthSq() > 0) this.sun.value.copy(d.normalize());
    this.runtime?.update(this.time);
  }

  /**
   * Poses the body for the SimClock (issue #42, D-34). `time(id)` is the simulation time of one
   * process in sim seconds (`spin`, `winds`, `clouds`). A pure function of the time: the same time
   * gives the same picture, and the haptic sampler gets the same storms.
   */
  setTime(time: SimTimeFn): void {
    this.time = time;
    this.runtime?.update(time);
  }

  setTier(tier: TierName): void {
    if (this.disposed || tier === this.tier) return;
    this.tier = tier;
    for (const v of this.volumes) v.setTier(tier);
    this.onChange?.();
  }

  setJitterFrame(index: number): void {
    for (const v of this.volumes) v.setJitterFrame(index);
  }

  setVisibleTags(tags: readonly Tag[]): void {
    if (this.disposed) return;
    this.visibleTags = tags;
    this.applyVisibility();
    this.onChange?.();
  }

  async setOverrides(overrides: Overrides): Promise<void> {
    const changed = (Object.keys({ ...this.overrides, ...overrides }) as (keyof Overrides)[]).some(
      (k) => this.overrides[k] !== overrides[k],
    );
    const onlyAge = (Object.keys({ ...this.overrides, ...overrides }) as (keyof Overrides)[])
      .filter((k) => this.overrides[k] !== overrides[k])
      .every((k) => k === 'age_yr');
    this.overrides = overrides;
    if (!changed) return;
    if (onlyAge && this.spec.kind === 'nova' && this.volumes.length > 0) {
      // The age slider only moves the shell: no rebuild, no shader recompile (issue #43, A7.5).
      for (const v of this.volumes)
        v.setShell(remnantShell(sliderValue(overrides, 'age_yr', 'nova') ?? null));
      this.onChange?.();
      return;
    }
    // Field sliders re-run the generator; shader-only sliders just rebuild the materials. Both
    // rebuild for simplicity (no UI drives this yet).
    this.spec = resolveShaderSpec(this.card, this.params, overrides, this.motion);
    await this.rebuild();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release(this.surface, this.textures, this.volumes);
    this.surface = null;
    this.textures = [];
    this.sampler = null;
    this.points = null;
    this.volumes = [];
    this.frame = null;
    this.runtime = null;
    if (this.plain) {
      disposeTree(this.plain);
      this.plain = null;
    }
  }

  private release(
    group: Group | null,
    textures: DataTexture[],
    volumes: readonly VolumeHandle[] = [],
  ): void {
    if (group) {
      this.object.remove(group);
      disposeTree(group);
    }
    for (const t of textures) t.dispose();
    // The baked noise cube (a Data3DTexture) belongs to the volume, not to the mesh tree.
    for (const v of volumes) v.dispose();
  }

  private applyVisibility(): void {
    const show = this.spec.drawable && this.visibleTags.includes(this.spec.tag);
    if (this.surface) this.surface.visible = show;
    if (this.plain) this.plain.visible = this.plainShown();
  }

  /**
   * Q-45 (R5.3): planets and gas giants keep a plain sphere when their surface layer is hidden,
   * but only while the size on the card is shown at this honesty level (Measured only: only when
   * it is `measured`). A refused body draws nothing, and nebula / nova have no plain sphere. The
   * plan (`shaderPlan.ts`) applies the same rule, so the two agree.
   */
  private plainShown(): boolean {
    const { kind, drawable, tag } = this.spec;
    if (!kindHasPlainSphere(kind) || !drawable) return false;
    if (this.visibleTags.includes(tag)) {
      // The surface is allowed: the plain sphere only stands in while it is being built (never
      // blank) or if building it failed.
      return this.surface === null;
    }
    const size = this.card[sizeFieldFor(kind)];
    return size !== undefined && this.visibleTags.includes(size.tag);
  }

  private ensurePlain(): void {
    if (this.plain || !kindHasPlainSphere(this.spec.kind)) return;
    this.plain = new Mesh(
      new SphereGeometry(1, 64, 32),
      new MeshStandardNodeMaterial({ color: PLAIN_COLOUR, roughness: 0.9 }),
    );
    this.object.add(this.plain);
    this.applyVisibility();
  }

  /** Builds everything for `spec` without touching the scene (async work happens here). */
  private async build(spec: ShaderSpec): Promise<Built | null> {
    const textures: DataTexture[] = [];
    if (spec.kind === 'nebula' || spec.kind === 'nova') {
      // Issue #43: drawn as an emission volume, not as dots. Neither kind has haptics (Q-103):
      // no point sets are made, so nothing felt can disagree with what is drawn (D-34).
      const plan =
        spec.kind === 'nebula'
          ? nebulaVolume(spec.seed)
          : remnantVolume({
              seed: spec.seed,
              ageYr: sliderValue(this.overrides, 'age_yr', 'nova') ?? null,
              axisRatio: null, // ASSUMPTION: no card field holds the measured axis ratio yet
            });
      const volume = createVolume(plan, this.tier);
      const group = new Group();
      group.add(volume.mesh);
      group.scale.setScalar(spec.kind === 'nebula' ? NEBULA_SCALE : NOVA_SCALE);
      return {
        group,
        frame: group,
        textures,
        field: null,
        points: null,
        runtime: null,
        sampler: null,
        volumes: [volume],
      };
    }
    const field = await this.fieldSource(spec.field!);
    if (this.disposed || spec !== this.spec) return null;
    const sampler = new FieldSampler(field);
    if (spec.kind === 'gas_giant') {
      const { group, frame, runtime } = buildGas(
        spec,
        field,
        textures,
        this.motion,
        this.octaves,
        sampler,
        this.sun,
      );
      return { group, frame, textures, field, points: null, runtime, sampler };
    }
    const { group, runtime } = buildPlanet(
      spec,
      field,
      this.sun,
      textures,
      this.motion,
      this.sun.value,
      this.mould,
    );
    return { group, frame: runtime.frame, textures, field, points: null, runtime, sampler };
  }

  /**
   * B3: builds the new surface first, then swaps it in and frees the old one, so the viewer never
   * shows an empty body while the field is being generated. A superseded rebuild changes nothing.
   */
  private async rebuild(): Promise<void> {
    const spec = this.spec;
    const built = spec.drawable ? await this.build(spec) : null;
    if (this.disposed || spec !== this.spec) {
      // NF-1: disposed or superseded after build() resolved; free what it made, it was never added.
      if (built) this.release(built.group, built.textures, built.volumes);
      return;
    }
    const oldGroup = this.surface;
    const oldTextures = this.textures;
    const oldVolumes = this.volumes;
    this.surface = built?.group ?? null;
    this.frame = built?.frame ?? null;
    this.textures = built?.textures ?? [];
    this.sampler = built?.sampler ?? null;
    this.points = built?.points ?? null;
    this.runtime = built?.runtime ?? null;
    // A body built while the clock is running is posed at the current time at once.
    this.runtime?.update(this.time);
    this.volumes = built?.volumes ?? [];
    if (built) this.object.add(built.group);
    this.release(oldGroup, oldTextures, oldVolumes);
    this.ensurePlain();
    this.applyVisibility();
    this.onChange?.();
  }
}
