// Issue #71 stream E, D-36, R7.7, A7.2: the gas giant as a solved flow, not a painted pattern.
//
// What happens, in order:
//   1. the card is turned into a `GasInput` (`gasWorldInput`); a missing value refuses the whole
//      world and the plain ShaderBody path draws instead (never blank);
//   2. the solver (`physics/gasDynamics.ts`, in a worker: `fields/gasClient.ts`) settles the flow for
//      `GAS_SETTLE_STEPS` steps while the planet is HIDDEN with a status message, so the planet is
//      already formed when it appears;
//   3. a velocity field from the solver carries colour tracers on the GPU (a render target, TSL, so
//      WebGPU and the WebGL2 fallback behave the same). Bands come from the observed table for
//      Jupiter and Saturn, from the Rhines count for others;
//   4. the clock's `winds` process (default 5 minutes of planet time per real second, optional one
//      day per second) sets how many solver steps have been taken: the state is a function of the
//      card, the seed and the step count (D-36), never of the frame rate. The solver is advanced in
//      fixed groups of `GROUP_STEPS`, so the tracer too;
//   5. Saturn's rings use measured radii, with shadows both ways.
//
// One shared description feeds the picture and the haptics: the band index, storm list and wind the
// FieldSampler answers are computed from the same profile and the same placed storms (D-12, D-34).
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  QuadMesh,
  RGBAFormat,
  RenderTarget,
  RendererUtils,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  Quaternion,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  abs,
  asin,
  atan,
  cameraPosition,
  clamp,
  cross,
  dot,
  float,
  floor,
  log,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  select,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import {
  GAS_NX,
  GAS_NY,
  GAS_SETTLE_STEPS,
  GLOW_ABOVE_K,
  RING_TEX_INNER,
  RING_TEX_OUTER,
  RING_TEX_SIZE,
  SATURN_RADIUS_KM,
  gasLayerTags,
  gasModel,
  gasProfile,
  ringAt,
  secondsPerStep,
  ringTexture,
  spinAngle,
  stepsFor,
  type GasInput,
  type GasModel,
  type GasProfile,
  type GasRegime,
  type PlacedStorm,
  type ReferenceGasId,
} from '@/physics/gasDynamics';
import { R_JUP_M } from '@/physics/constants';
import { gasPacing, gasWorldInput } from './gasWorldInput';
import { ESTIMATED_TAGS } from './bodyRenderer';
import type { BodyRenderer, BodyContext, BodyStatus } from './bodyRenderer';
import {
  FieldSampler,
  type FieldData,
  type Storm,
  type Vec3,
} from '../fields/fieldGenerator';
import { fbm } from '../fields/noise';
import { startGasSolver, type GasFrame, type GasSolver } from '../fields/gasClient';
import { GAS_LAYER_IDS, resolveShaderSpec, shaderDistance, type GasSwitches, type ShaderSpec } from './shaderSpec';
import { resolveMotion, type Motion, type SimTimeFn } from '../motion/motion';
import type { Overrides } from '../sliders';
import type { TierName } from '../render/quality';
import { srgbToLinear } from './linearColour';
import { teffToRgbMax1 } from '@/physics/starlight';
import type { PointSet } from './pointClouds';

// ---- what the card gives -----------------------------------------------------------------------

const REFERENCE: Record<ReferenceGasId, { tilt: number; roll: number; light: Vec3; palette: Palette }> = {
  jup: {
    tilt: 0.054,
    roll: 0,
    light: [-0.2, 0.12, 0.97],
    palette: { z: [0.93, 0.89, 0.76], b: [0.56, 0.29, 0.12], s: [0.78, 0.3, 0.13], d: [0.3, 0.2, 0.15], p: [0.45, 0.5, 0.53] },
  },
  sat: {
    tilt: -0.36,
    roll: -0.55,
    light: [-0.42, 0.34, 0.84],
    palette: { z: [0.93, 0.8, 0.5], b: [0.72, 0.54, 0.27], s: [0.9, 0.86, 0.72], d: [0.5, 0.4, 0.25], p: [0.62, 0.56, 0.42] },
  },
};
/** View pose and palette are display values (`artistic`): the prototype's. */

type Rgb = readonly [number, number, number];
interface Palette {
  z: Rgb;
  b: Rgb;
  s: Rgb;
  d: Rgb;
  p: Rgb;
}

/** Colour families by regime (prototype `worldModel`; artistic display values). */
const REGIME_PALETTE: Record<GasRegime, Palette> = {
  'Methane-rich air, blue': { z: [0.5, 0.64, 0.84], b: [0.3, 0.44, 0.68], s: [0.94, 0.96, 0.98], d: [0.24, 0.32, 0.47], p: [0.5, 0.58, 0.7] },
  'Ammonia clouds': { z: [0.9, 0.85, 0.75], b: [0.62, 0.45, 0.3], s: [0.84, 0.38, 0.13], d: [0.3, 0.22, 0.18], p: [0.42, 0.44, 0.48] },
  'Water clouds': { z: [0.93, 0.93, 0.95], b: [0.66, 0.72, 0.83], s: [0.98, 0.98, 1], d: [0.45, 0.5, 0.6], p: [0.7, 0.74, 0.8] },
  'Cloudless, deep blue': { z: [0.33, 0.52, 0.88], b: [0.18, 0.33, 0.7], s: [0.55, 0.72, 0.96], d: [0.08, 0.14, 0.34], p: [0.2, 0.3, 0.55] },
  'Silicate haze, dark blue': { z: [0.2, 0.34, 0.72], b: [0.08, 0.15, 0.42], s: [0.78, 0.86, 1], d: [0.04, 0.08, 0.22], p: [0.12, 0.18, 0.36] },
  'Silicate clouds, glowing': { z: [0.92, 0.72, 0.55], b: [0.56, 0.28, 0.16], s: [1, 0.86, 0.66], d: [0.3, 0.14, 0.08], p: [0.45, 0.3, 0.22] },
};

// ---- sizes and constants -----------------------------------------------------------------------

/** Solver steps per tracer pass. Fixed, so the tracer is a function of the step count too. */
export const GROUP_STEPS = 4;
/** At most this many groups a frame catches up; further behind, the clock simply jumps ahead. */
const MAX_BACKLOG_GROUPS = 24;
const TRACER_SIZE: Record<TierName, [number, number]> = { high: [1536, 768], medium: [1536, 768], low: [768, 384] };
const NOISE_W = 512;
const NOISE_H = 256;
const TAU = Math.PI * 2;

const SETTLE_MESSAGE = 'Letting the winds settle, so the planet appears already formed.';

/** The glow colour table spans these temperatures (log scale), K. */
const GLOW_LUT_MIN_K = 600;
const GLOW_LUT_MAX_K = 6000;

/** Blackbody colour (linear, brightest channel 1) by log temperature, for the glow of a hot giant. */
function buildGlowTexture(): DataTexture {
  const n = 128;
  const src = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = Math.exp(Math.log(GLOW_LUT_MIN_K) + (i / (n - 1)) * (Math.log(GLOW_LUT_MAX_K) - Math.log(GLOW_LUT_MIN_K)));
    const c = teffToRgbMax1(t) ?? [1, 0.3, 0.1];
    src.set([c[0], c[1], c[2], 1], i * 4);
  }
  const tex = new DataTexture(new Uint16Array(n * 4), n, 1, RGBAFormat, HalfFloatType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  fillHalf(tex, src);
  return tex;
}

// ---- GPU pieces --------------------------------------------------------------------------------

/** A texture with several taps that must follow one `.value` (the render target is swapped each pass). */
class TapSet {
  private readonly nodes: any[] = [];
  constructor(private tex: Texture) {}
  tap(uvExpr: any): any {
    const n = texture(this.tex, uvExpr);
    this.nodes.push(n);
    return n;
  }
  set(tex: Texture): void {
    this.tex = tex;
    for (const n of this.nodes) n.value = tex;
  }
}

function makeTracerTarget(w: number, h: number): RenderTarget {
  const rt = new RenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
  });
  rt.texture.wrapS = RepeatWrapping;
  rt.texture.wrapT = ClampToEdgeWrapping;
  return rt;
}

function halfTexture(w: number, h: number, wrapS: number, wrapT: number): DataTexture {
  const t = new DataTexture(new Uint16Array(w * h * 4), w, h, RGBAFormat, HalfFloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = wrapS as typeof RepeatWrapping;
  t.wrapT = wrapT as typeof ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function fillHalf(t: DataTexture, src: Float32Array): void {
  const dst = t.image.data as unknown as Uint16Array;
  for (let i = 0; i < src.length; i++) dst[i] = DataUtils.toHalfFloat(src[i]!);
  t.needsUpdate = true;
}

/** Deterministic noise for the tracer: a torus of fractal value noise, R channel. */
function noiseTexture(seed: number): DataTexture {
  const data = new Uint8Array(NOISE_W * NOISE_H * 4);
  for (let j = 0; j < NOISE_H; j++) {
    const b1 = (j / NOISE_H) * TAU;
    for (let i = 0; i < NOISE_W; i++) {
      const a1 = (i / NOISE_W) * TAU;
      const v = fbm(Math.cos(a1) * 6 + Math.cos(b1) * 3, Math.sin(a1) * 6, Math.sin(b1) * 18, 4, seed);
      const k = (j * NOISE_W + i) * 4;
      data[k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      data[k + 3] = 255;
    }
  }
  const t = new DataTexture(data, NOISE_W, NOISE_H, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Catmull-Rom filtered read (5 bilinear taps) of a tracer texture; `res` is its size as a vec2 node. */
function catmullRom(taps: TapSet, uvIn: any, res: any): any {
  const p = uvIn.mul(res);
  const ip: any = floor(p.sub(0.5)).toVar();
  const f: any = p.sub(0.5).sub(ip).toVar();
  const w0: any = f.mul(float(-0.5).add(f.mul(float(1).sub(f.mul(0.5)))));
  const w1: any = float(1).add(f.mul(f).mul(float(-2.5).add(f.mul(1.5))));
  const w2: any = f.mul(float(0.5).add(f.mul(float(2).sub(f.mul(1.5)))));
  const w3: any = f.mul(f).mul(float(-0.5).add(f.mul(0.5)));
  const w12: any = w1.add(w2).toVar();
  const o: any = w2.div(w12);
  const t0: any = ip.sub(0.5).div(res);
  const t3: any = ip.add(2.5).div(res);
  const t12: any = ip.add(o).add(0.5).div(res);
  const c = taps
    .tap(vec2(t12.x, t0.y))
    .mul(w12.x.mul(w0.y))
    .add(taps.tap(vec2(t0.x, t12.y)).mul(w0.x.mul(w12.y)))
    .add(taps.tap(t12).mul(w12.x.mul(w12.y)))
    .add(taps.tap(vec2(t3.x, t12.y)).mul(w3.x.mul(w12.y)))
    .add(taps.tap(vec2(t12.x, t3.y)).mul(w12.x.mul(w3.y)));
  const wsum = w12.x.mul(w0.y).add(w0.x.mul(w12.y)).add(w12.x.mul(w12.y)).add(w3.x.mul(w12.y)).add(w12.x.mul(w3.y));
  return c.div(wsum);
}

interface Tracer {
  rt: [RenderTarget, RenderTarget];
  /** Index of the target holding the latest tracer. */
  cur: 0 | 1;
  size: [number, number];
}

// ---- the body ----------------------------------------------------------------------------------

export interface GasOrbitSources {
  velocity: Texture;
  /** Null before the first pass. */
  tracer: Texture | null;
  bands: Texture;
  noise: Texture;
  radiusKm: number;
  scaleHeightKm: number;
  seed: number;
  /** Linear-light-ready sRGB colours: zone, belt, storm, dark, polar. */
  palette: Readonly<{ z: readonly number[]; b: readonly number[]; s: readonly number[]; d: readonly number[]; p: readonly number[] }>;
  /** The planet has settled and the tracer works. */
  ready: boolean;
}

export interface GasWorldDeps {
  /** Replaces the worker-backed solver (tests). */
  solver?: (input: GasInput) => Promise<GasSolver & { first: GasFrame }>;
}

export class GasWorld implements BodyRenderer {
  readonly object = new Group();
  readonly input: GasInput;
  readonly model: GasModel;
  readonly profile: GasProfile;
  private readonly tilt = new Group();
  private readonly spinMesh: Mesh;
  private readonly ringMesh: Mesh | null;
  private readonly spec: ShaderSpec;
  private readonly palette: Palette;
  private readonly sampler: FieldSampler;
  private readonly onChange: (() => void) | undefined;
  private readonly onFailed: ((layerId: string) => void) | undefined;
  private readonly deps: GasWorldDeps;
  private visibleTags: readonly Tag[];
  private gasOverride: GasSwitches | null;
  private tier: TierName;
  private overrides: Overrides;
  private disposed = false;
  private motion: Motion;

  // state of the solved world
  private solver: (GasSolver & { first: GasFrame }) | null = null;
  private phase: 'starting' | 'settling' | 'ready' | 'failed' = 'starting';
  private failedReason = '';
  /** Steps the solver has been asked for and has returned (always a multiple of GROUP_STEPS). */
  private stepsDone = 0;
  private pumping = false;
  /** Clock time of the winds process when the planet was revealed; later times are measured from it. */
  private t0: number | null = null;
  private time: SimTimeFn = () => 0;
  private lastField: Float32Array | null = null;
  private placed: PlacedStorm[] = [];

  // GPU state, created at the first `prepareFrame` (it needs the renderer)
  private renderer: WebGPURenderer | null = null;
  private rendererWaiters: (() => void)[] = [];
  private tracer: Tracer | null = null;
  private advectMaterial: NodeMaterial | null = null;
  private quad: QuadMesh | null = null;
  private tracerFailed = false;
  private rendererState: unknown;
  private readonly velTex = halfTexture(GAS_NX, GAS_NY, RepeatWrapping, ClampToEdgeWrapping);
  private readonly bandTex = halfTexture(1, 512, ClampToEdgeWrapping, ClampToEdgeWrapping);
  private readonly noiseTex: DataTexture;
  private readonly ringTex: DataTexture | null;
  private readonly glowTex: DataTexture | null;
  private readonly prevTaps: TapSet;
  private readonly displayTaps: TapSet;

  // uniforms
  private readonly uDt = uniform(0);
  private readonly uInit = uniform(0);
  private readonly uStormsOn = uniform(1);
  private readonly uTracerOn = uniform(0);
  private readonly uBands = uniform(1);
  private readonly uTurb = uniform(1);
  private readonly uColour = uniform(1);
  private readonly uStorms = uniform(1);
  private readonly uRings = uniform(1);
  private readonly uLight = uniform(new Vector3(0, 0, 1)); // body frame
  private readonly uLightTilt = uniform(new Vector3(0, 0, 1)); // ring frame
  private readonly uStarColour = uniform(new Vector3(1, 1, 1));
  private readonly sun = new Vector3(0, 0, 1);

  private constructor(
    card: ObjectCard,
    private readonly params: RenderParams,
    input: GasInput,
    ctx: BodyContext,
    deps: GasWorldDeps,
  ) {
    this.input = input;
    this.model = gasModel(input)!;
    this.profile = gasProfile(this.model, input);
    this.deps = deps;
    this.visibleTags = ctx.visibleTags ?? ESTIMATED_TAGS;
    this.overrides = ctx.overrides ?? {};
    this.gasOverride = ctx.gasLayers ?? null;
    this.tier = ctx.tier ?? 'medium';
    this.onChange = ctx.onChange;
    this.onFailed = ctx.onFailed;
    this.motion = ctx.motion ?? resolveMotion(card, params);
    this.spec = resolveShaderSpec(card, params, this.overrides, this.motion);
    const ref = input.reference ? REFERENCE[input.reference] : null;
    this.palette = ref?.palette ?? REGIME_PALETTE[this.model.regime];
    this.sampler = this.buildSampler();

    this.noiseTex = noiseTexture(input.seed);
    fillHalf(this.bandTex, this.profile.tex);
    // The taps start on render-target textures (their shader code differs from a data texture's).
    const t0 = makeTracerTarget(...TRACER_SIZE[this.tier]);
    this.prevTaps = new TapSet(t0.texture);
    this.displayTaps = new TapSet(t0.texture);
    this.tracer = { rt: [t0, makeTracerTarget(...TRACER_SIZE[this.tier])], cur: 0, size: TRACER_SIZE[this.tier] };
    this.ringTex = input.reference === 'sat' ? this.buildRingTexture() : null;
    this.glowTex = this.model.tDayK > GLOW_ABOVE_K ? buildGlowTexture() : null;

    this.tilt.rotation.x = ref?.tilt ?? 0.12;
    this.tilt.rotation.z = ref?.roll ?? 0;
    const sphere = new SphereGeometry(1, 128, 96);
    const material = new MeshBasicNodeMaterial();
    material.colorNode = this.surfaceNode();
    this.spinMesh = new Mesh(sphere, material);
    this.spinMesh.scale.y = 1 - this.model.flattening;
    this.spinMesh.visible = false; // hidden until the flow has settled (D-36: already formed)
    this.tilt.add(this.spinMesh);
    this.ringMesh = this.ringTex ? this.buildRings() : null;
    if (this.ringMesh) {
      this.ringMesh.visible = false;
      this.tilt.add(this.ringMesh);
    }
    this.object.add(this.tilt);
    this.applySwitches();
    if (ctx.lightColour) this.setSunColour(ctx.lightColour);
    this.setSunDirection(ctx.lightDir ?? ref?.light ?? [0, 0, 1]);
  }

  /**
   * Starts the world: the plain sphere path is the caller's fallback. The solver starts at once; the
   * planet stays hidden (status "hidden", with a message) until it has settled.
   */
  static start(
    card: ObjectCard,
    params: RenderParams,
    ctx: BodyContext = {},
    deps: GasWorldDeps = {},
  ): GasWorld | null {
    const input = gasWorldInput(card, params);
    if (!input) return null;
    const world = new GasWorld(card, params, input, ctx, deps);
    world.run().catch((err: unknown) => world.fail(err));
    return world;
  }

  // ---- contract ------------------------------------------------------------------------------

  private switches(): GasSwitches {
    if (this.gasOverride) return this.gasOverride;
    const g = this.spec.gasLayers;
    const on = (id: (typeof GAS_LAYER_IDS)[number]) => {
      const tag = g?.[id];
      return tag !== undefined && this.visibleTags.includes(tag);
    };
    return {
      bands: on('bands'),
      flattening: on('flattening'),
      colour: on('colour'),
      storms: on('storms'),
      turbulence: on('turbulence'),
    };
  }

  private shown(): boolean {
    const sw = this.switches();
    return this.spec.drawable && GAS_LAYER_IDS.some((id) => sw[id]);
  }

  get drawn(): readonly string[] {
    if (this.phase !== 'ready' || !this.spinMesh.visible) return [];
    const sw = this.switches();
    return GAS_LAYER_IDS.filter((id) => sw[id]);
  }
  get missing(): readonly string[] {
    return this.spec.missing;
  }
  get hidden(): readonly string[] {
    if (!this.spec.drawable) return [];
    const sw = this.switches();
    return GAS_LAYER_IDS.filter((id) => this.spec.gasLayers?.[id] !== undefined && !sw[id]);
  }
  get suggestedDistance(): number {
    return shaderDistance({
      kind: 'gas_giant',
      gas: this.spec.gas ? { ...this.spec.gas, rings: this.ringMesh ? 1 : 0 } : null,
    });
  }

  get status(): BodyStatus {
    if (!this.spec.drawable) {
      return {
        state: 'refused',
        message: 'Not drawn: the size or radius this view needs is missing, so nothing is guessed.',
        tags: [],
      };
    }
    if (this.phase === 'failed') {
      return {
        state: 'hidden',
        message: `The planet could not be simulated (${this.failedReason}). Nothing is drawn rather than a guess.`,
        tags: [],
      };
    }
    if (this.phase !== 'ready') return { state: 'hidden', message: SETTLE_MESSAGE, tags: [] };
    if (!this.shown()) {
      return {
        state: 'hidden',
        message:
          'The simulated planet is hidden at this honesty level. Choose + Estimated to see the parts rest on data and rules, or + Artistic for all of them.',
        tags: [],
      };
    }
    const sw = this.switches();
    const tagOf = new Map(gasLayerTags(this.input.reference).map((l) => [l.id, l.tag] as const));
    const shownTags = new Set<Tag>();
    for (const id of GAS_LAYER_IDS) if (sw[id]) shownTags.add(this.spec.gasLayers?.[id] ?? 'artistic');
    for (const t of tagOf.values()) if (this.visibleTags.includes(t)) shownTags.add(t);
    return {
      state: 'drawn',
      message: this.input.reference
        ? 'Belts, zones and named storms sit where they are observed; the weather over them is a computer simulation of the real winds, not a photograph. Each part says what it rests on.'
        : 'Generated from rules and typical values for a giant planet, then run as a simulation of its winds. It is not a measured image. Each part says what it rests on.',
      tags: [...shownTags],
    };
  }

  get altText(): string {
    const s = this.status;
    return s.state === 'drawn'
      ? `${this.params.alt_text} The surface is a simulation, not a measured image.`
      : s.message;
  }

  get field(): FieldSampler | null {
    return this.sampler;
  }
  get pointSets(): Readonly<Record<string, PointSet>> | null {
    return null;
  }

  worldToBody(p: Vec3): Vec3 {
    const v = new Vector3(p[0], p[1], p[2]);
    this.spinMesh.updateWorldMatrix(true, false);
    this.spinMesh.worldToLocal(v);
    return [v.x, v.y, v.z];
  }

  /** The plan's gas layer switches changed (honesty or a build step): no rebuild. */
  setGasLayers(sw: GasSwitches | null): void {
    if (this.disposed) return;
    this.gasOverride = sw;
    this.applySwitches();
    this.onChange?.();
  }
  /** Not used by a gas giant. */
  setPatternSwitch(): void {}
  setMould(): void {
    this.onChange?.();
  }
  setJitterFrame(): void {}

  setVisibleTags(tags: readonly Tag[]): void {
    if (this.disposed) return;
    this.visibleTags = tags;
    this.applySwitches();
    this.onChange?.();
  }

  setSunColour(colour: Vec3 | null): void {
    const [r, g, b] = colour ?? [1, 1, 1];
    this.uStarColour.value.set(r, g, b);
  }

  setSunDirection(dir: Vec3): void {
    const d = new Vector3(dir[0], dir[1], dir[2]);
    if (d.lengthSq() > 0) this.sun.copy(d.normalize());
    this.syncLight();
  }

  setTier(tier: TierName): void {
    if (this.disposed || tier === this.tier) return;
    const sizeChanged = TRACER_SIZE[tier][0] !== TRACER_SIZE[this.tier][0];
    this.tier = tier;
    // A different tracer size means a new tracer: it is re-seeded from the latest field.
    if (sizeChanged && this.tracer) {
      this.disposeTracer();
      if (this.lastField && this.renderer) this.initTracer(this.lastField);
    }
    this.onChange?.();
  }

  async setOverrides(overrides: Overrides): Promise<void> {
    this.overrides = overrides;
    this.onChange?.();
  }

  /**
   * Poses the world at the clock's time. `winds` is the planet time in seconds (a pure function of
   * the clock): it decides how many solver steps have been taken and, while the pacing is slow, how
   * far the view has turned. Paused or under reduced motion the clock does not advance, so neither
   * does anything here.
   */
  setTime(time: SimTimeFn): void {
    this.time = time;
    if (this.phase !== 'ready') return;
    const t = time('winds');
    if (this.t0 === null) this.t0 = t;
    const elapsed = Math.max(0, t - this.t0);
    this.spinMesh.rotation.y = spinAngle(this.model, elapsed, this.pacing());
    this.syncLight();
    this.pump(elapsed);
    this.updatePlaced();
  }

  /**
   * Before each draw: lets the world use the renderer for its tracer pass. The viewer calls it with
   * the renderer; the first call also wakes the settle loop.
   */
  prepareFrame(renderer: WebGPURenderer): void {
    if (this.disposed) return;
    if (!this.renderer) {
      this.renderer = renderer;
      const waiters = this.rendererWaiters;
      this.rendererWaiters = [];
      for (const w of waiters) w();
    }
    this.syncLight();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.solver?.dispose();
    this.solver = null;
    this.disposeTracer();
    this.advectMaterial?.dispose();
    this.quad?.geometry.dispose();
    this.velTex.dispose();
    this.bandTex.dispose();
    this.noiseTex.dispose();
    this.ringTex?.dispose();
    this.glowTex?.dispose();
    for (const m of [this.spinMesh, this.ringMesh]) {
      if (!m) continue;
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    this.object.clear();
  }

  /**
   * What an orbit camera (stream H) reads to draw the same planet from close: the textures are live
   * (the tracer swaps after every pass, so read this getter each frame, do not keep the object).
   * `velocity` is the solver's field (RGBA half float, GAS_NX x GAS_NY: R and G winds, B vorticity,
   * A storm code), `tracer` the colour tracer (R brightness, G chromophore, B noise, A storm), `bands`
   * the 1 x 512 band profile (R brightness, G chromophore, B turbulence, A polar).
   */
  get orbitSources(): GasOrbitSources {
    return {
      velocity: this.velTex,
      tracer: this.tracer ? this.tracer.rt[this.tracer.cur].texture : null,
      bands: this.bandTex,
      noise: this.noiseTex,
      radiusKm: this.model.radiusM / 1000,
      scaleHeightKm: this.model.scaleHeightM / 1000,
      seed: this.input.seed,
      palette: this.palette,
      ready: this.phase === 'ready' && !this.tracerFailed,
    };
  }

  // ---- pacing --------------------------------------------------------------------------------

  /** Planet seconds per real second: the clock's winds speed-up, else the default. */
  pacing(): number {
    return gasPacing(this.overrides);
  }

  /** Steps taken so far (a multiple of GROUP_STEPS), for tests and the panel. */
  get steps(): number {
    return this.stepsDone;
  }
  get ready(): boolean {
    return this.phase === 'ready';
  }

  // ---- the settle and play loops -------------------------------------------------------------

  private async run(): Promise<void> {
    const make = this.deps.solver ?? startGasSolver;
    const solver = await make(this.input);
    if (this.disposed) {
      solver.dispose();
      return;
    }
    this.solver = solver;
    this.phase = 'settling';
    this.onChange?.(); // wakes a draw, which hands us the renderer
    await this.needRenderer();
    if (this.disposed) return;
    this.lastField = solver.first.field;
    this.placed = solver.first.storms;
    this.initTracer(solver.first.field);
    while (this.stepsDone < GAS_SETTLE_STEPS && !this.disposed) {
      const frame = await solver.advance(GROUP_STEPS);
      if (this.disposed) return;
      this.stepsDone = frame.steps;
      this.placed = frame.storms;
      this.feed(frame.field);
    }
    if (this.disposed) return;
    this.phase = 'ready';
    this.applySwitches();
    this.updatePlaced();
    this.setTime(this.time);
    this.onChange?.();
  }

  private needRenderer(): Promise<void> {
    if (this.renderer) return Promise.resolve();
    return new Promise((resolve) => this.rendererWaiters.push(resolve));
  }

  private fail(err: unknown): void {
    if (this.disposed) return;
    this.phase = 'failed';
    this.failedReason = err instanceof Error ? err.message : String(err);
    console.warn('[viewer] gas world could not run', err);
    for (const id of GAS_LAYER_IDS) this.onFailed?.(id);
    this.onChange?.();
  }

  /** Takes more steps up to `elapsed` planet seconds. One request at a time; far behind, it skips ahead. */
  private pump(elapsed: number): void {
    const solver = this.solver;
    if (!solver || this.pumping || this.disposed) return;
    const target = GAS_SETTLE_STEPS + Math.floor(stepsFor(this.model, elapsed) / GROUP_STEPS) * GROUP_STEPS;
    if (target <= this.stepsDone) return;
    this.pumping = true;
    let behind = (target - this.stepsDone) / GROUP_STEPS;
    if (behind > MAX_BACKLOG_GROUPS) {
      // Far behind (a slow frame, a hidden tab): drop the excess by moving the time origin, so a
      // later pause really stops the world instead of paying the backlog off.
      this.t0 = (this.t0 ?? 0) + (behind - MAX_BACKLOG_GROUPS) * GROUP_STEPS * secondsPerStep(this.model);
      behind = MAX_BACKLOG_GROUPS;
    }
    const groups = Math.min(behind, MAX_BACKLOG_GROUPS);
    (async () => {
      for (let g = 0; g < groups && !this.disposed; g++) {
        const frame = await solver.advance(GROUP_STEPS);
        if (this.disposed) return;
        this.stepsDone = frame.steps;
        this.placed = frame.storms;
        this.feed(frame.field);
      }
    })()
      .catch((err: unknown) => this.fail(err))
      .finally(() => {
        this.pumping = false;
        this.updatePlaced();
        this.onChange?.();
      });
  }

  // ---- the tracer ----------------------------------------------------------------------------

  private ensureAdvect(): void {
    if (this.advectMaterial) return;
    const [w, h] = TRACER_SIZE[this.tier];
    const res = vec2(w, h);
    const uvN = uv();
    const vel = (e: any) => texture(this.velTex, e);
    const v = vel(uvN);
    const m = vec2(uvN.x.sub(v.x.div(TAU).mul(this.uDt).mul(0.5)), clamp(uvN.y.sub(v.y.div(Math.PI).mul(this.uDt).mul(0.5)), 0.001, 0.999));
    const v2 = vel(m).toVar();
    const b = vec2(uvN.x.sub(v2.x.div(TAU).mul(this.uDt)), clamp(uvN.y.sub(v2.y.div(Math.PI).mul(this.uDt)), 0.002, 0.998));
    const bd = texture(this.bandTex, vec2(0.5, uvN.y));
    const nz = texture(this.noiseTex, uvN.mul(vec2(4, 3))).r;
    const rm = clamp(v2.a.sub(2), 0, 1).mul(this.uStormsOn);
    const mask = select(v2.a.greaterThan(1.5), float(0), clamp(v2.a, -1, 1)).mul(this.uStormsOn);
    const tr = clamp(bd.r.sub(v2.z.mul(0.08)), 0, 1).add(max(mask, 0).mul(0.42)).sub(max(mask.negate(), 0).mul(0.3));
    const tg = mix(mix(bd.g, 0.05, max(mask, 0).mul(0.95)), 0.95, max(mask.negate(), 0).mul(0.8));
    const first = vec4(tr, tg, nz, clamp(v.a.sub(2), 0, 1).mul(this.uStormsOn));
    const s: any = clamp(catmullRom(this.prevTaps, b, res), 0, 1.2);
    const rate = clamp(this.uDt.mul(1.4), 0, 1);
    const next = vec4(
      mix(s.r, tr, rate),
      mix(s.g, tg, rate),
      mix(s.b, nz, clamp(this.uDt.mul(0.15), 0, 1)),
      max(s.a.mul(float(1).sub(this.uDt.mul(1.2))), rm),
    );
    const material = new NodeMaterial();
    material.name = 'GasTracerAdvect';
    material.fragmentNode = select(this.uInit.greaterThan(0.5), first, next);
    this.advectMaterial = material;
    this.quad = new QuadMesh(material);
  }

  private ensureTracer(): Tracer {
    if (this.tracer) return this.tracer;
    const [w, h] = TRACER_SIZE[this.tier];
    const t: Tracer = { rt: [makeTracerTarget(w, h), makeTracerTarget(w, h)], cur: 0, size: [w, h] };
    this.tracer = t;
    this.prevTaps.set(t.rt[0].texture);
    this.displayTaps.set(t.rt[0].texture);
    return t;
  }

  private disposeTracer(): void {
    if (!this.tracer) return;
    this.tracer.rt[0].dispose();
    this.tracer.rt[1].dispose();
    this.tracer = null;
    this.advectMaterial?.dispose();
    this.advectMaterial = null;
    this.quad = null;
    this.uTracerOn.value = 0;
  }

  private pass(dt: number, init: boolean): void {
    const renderer = this.renderer;
    if (!renderer || this.tracerFailed) return;
    try {
      this.ensureAdvect();
      const t = this.ensureTracer();
      const next: 0 | 1 = t.cur === 0 ? 1 : 0;
      this.prevTaps.set(t.rt[t.cur].texture);
      this.uDt.value = dt;
      this.uInit.value = init ? 1 : 0;
      this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState as any);
      renderer.setRenderTarget(t.rt[next]);
      this.quad!.render(renderer);
      RendererUtils.restoreRendererState(renderer, this.rendererState as any);
      t.cur = next;
      this.displayTaps.set(t.rt[next].texture);
      this.uTracerOn.value = 1;
    } catch (err) {
      // Never blank: without the tracer the planet is drawn from the band table alone.
      this.tracerFailed = true;
      this.uTracerOn.value = 0;
      try {
        if (this.rendererState) RendererUtils.restoreRendererState(renderer, this.rendererState as any);
      } catch {
        /* nothing more to restore */
      }
      console.warn('[viewer] gas tracer pass failed; drawing the bands without flow', err);
    }
  }

  private initTracer(field: Float32Array): void {
    this.uploadField(field);
    this.pass(0, true);
  }

  private feed(field: Float32Array): void {
    this.lastField = field;
    this.uploadField(field);
    this.pass(GROUP_STEPS * 0.0032, false);
  }

  private uploadField(field: Float32Array): void {
    fillHalf(this.velTex, field);
  }

  // ---- shading -------------------------------------------------------------------------------

  private applySwitches(): void {
    const sw = this.switches();
    const was = this.uStormsOn.value;
    this.uBands.value = sw.bands ? 1 : 0;
    this.uTurb.value = sw.turbulence ? 1 : 0;
    this.uColour.value = sw.colour ? 1 : 0;
    this.uStorms.value = sw.storms ? 1 : 0;
    this.uStormsOn.value = sw.storms ? 1 : 0;
    this.spinMesh.scale.y = sw.flattening ? 1 - this.model.flattening : 1;
    this.spinMesh.visible = this.phase === 'ready' && this.spec.drawable && GAS_LAYER_IDS.some((id) => sw[id]);
    if (this.ringMesh) this.ringMesh.visible = this.spinMesh.visible;
    // Storms live inside the tracer colours, so switching them re-seeds the tracer from the field.
    if (was !== this.uStormsOn.value && this.tracer && this.lastField) this.initTracer(this.lastField);
  }

  private syncLight(): void {
    this.object.updateWorldMatrix(true, true);
    const q = new Quaternion();
    this.spinMesh.getWorldQuaternion(q);
    this.uLight.value.copy(this.sun).applyQuaternion(q.invert());
    this.tilt.getWorldQuaternion(q);
    this.uLightTilt.value.copy(this.sun).applyQuaternion(q.invert());
  }

  private surfaceNode(): any {
    const P = this.palette;
    const lin = (c: Rgb) => {
      const l = srgbToLinear([c[0], c[1], c[2]]);
      return vec3(l[0], l[1], l[2]);
    };
    const [tw, th] = TRACER_SIZE[this.tier];
    const b = normalize(positionLocal);
    const u = atan(b.z, b.x).div(TAU).add(0.5);
    const v = asin(clamp(b.y, -1, 1)).div(Math.PI).add(0.5);
    const uvB = vec2(u, v);
    const tap = (e: any) => this.displayTaps.tap(e);
    const bd = texture(this.bandTex, vec2(0.5, v));
    const seed = this.input.seed % 997;
    const nz = (p: any, oct: number) => mx_fractal_noise_float(p, oct, 2.0, 0.5).mul(0.5);
    const w1 = nz(b.mul(vec3(5, 16, 5)).add(seed), 4);
    const mott = nz(b.mul(vec3(14, 46, 14)).add(vec3(w1.mul(3))).add(seed), 5);
    const uvWarp = vec2(u, v.add(w1.mul(float(0.01).add(bd.b.mul(0.02))).mul(this.uTurb)));
    const t = tap(uvWarp);
    const streak = t.b.sub(0.5).mul(float(0.08).add(bd.b.mul(0.55))).add(mott.mul(float(0.12).add(bd.b.mul(0.8)))).mul(this.uTurb);
    // Without the tracer (a failed pass, or before the first) the bands come straight from the table.
    const trR = mix(bd.r, t.r, this.uTracerOn);
    const trG = mix(bd.g, t.g, this.uTracerOn);
    const trA = t.a.mul(this.uTracerOn).mul(this.uStorms);
    const br0 = mix(float(0.66), trR, this.uBands);
    const br = br0.add(streak.mul(0.5));
    const chrom = mix(float(0.4), trG, this.uBands);
    // Tracer gradient bends the lit normal a little (cloud relief; artistic).
    const ex = 2 / tw;
    const ey = 2 / th;
    const dx = tap(uvB.add(vec2(ex, 0))).r.sub(tap(uvB.sub(vec2(ex, 0))).r);
    const dy = tap(uvB.add(vec2(0, ey))).r.sub(tap(uvB.sub(vec2(0, ey))).r);
    const east = normalize(cross(vec3(0, 1, 0), b));
    const north = cross(b, east);
    const nv = normalize(b.add(east.mul(dx).add(north.mul(dy)).mul(-0.35).mul(this.uTracerOn)));
    const ns = dot(b, this.uLight);
    const nl = max(dot(nv, this.uLight), 0);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const mu = clamp(dot(normalize(normalWorld), viewDir), 0, 1);
    let c: any = mix(lin(P.z), lin(P.b), clamp(chrom.add(streak.mul(0.9)), 0, 1));
    c = mix(c, lin(P.s), clamp(trA.mul(1.15), 0, 0.92));
    c = c.mul(float(0.38).add(br.mul(0.78)));
    c = mix(c, lin(P.p).mul(float(0.74).add(br.mul(0.5))), bd.a.mul(0.85).mul(this.uBands));
    // Chromophore colours are not identified, so with the colour layer off the planet is grey.
    const grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(grey), c, this.uColour);
    let col: any = c
      .mul(this.uStarColour)
      .mul(smoothstep(-0.04, 0.16, ns))
      .mul(float(0.26).add(pow(nl, 0.8).mul(0.74)))
      .mul(float(0.3).add(pow(mu, 0.7).mul(0.7)))
      .mul(0.76);
    if (this.glowTex) {
      // A hot giant glows by its own heat, strongest on the night side where the sky is dark. The
      // day-night temperature follows the light smoothly (no step at the terminator).
      const Tg = mix(float(this.model.tNightK), float(this.model.tDayK), smoothstep(-0.2, 0.25, ns));
      const lutU = log(clamp(Tg, GLOW_LUT_MIN_K, GLOW_LUT_MAX_K)).sub(Math.log(GLOW_LUT_MIN_K)).div(Math.log(GLOW_LUT_MAX_K) - Math.log(GLOW_LUT_MIN_K));
      const lutC = (texture as any)(this.glowTex, vec2(lutU, 0.5)).rgb;
      const nt = smoothstep(0.25, -0.2, ns);
      col = col.add(lutC.mul(pow(Tg.div(1900), 6)).mul(smoothstep(GLOW_ABOVE_K, GLOW_ABOVE_K + 50, Tg)).mul(mix(float(0.35), float(1), nt)));
    }
    if (this.input.reference === 'sat') {
      // Rings cast a shadow on the planet: follow the light from this point to the ring plane (y = 0).
      const ly = this.uLight.y;
      const t2 = b.y.negate().div(select(abs(ly).lessThan(0.001), float(0.001), ly));
      const hit = vec3(b.x.add(this.uLight.x.mul(t2)), 0, b.z.add(this.uLight.z.mul(t2)));
      const rh = length(hit.xz);
      const inRing = step(0.0, t2).mul(step(RING_TEX_INNER, rh)).mul(step(rh, RING_TEX_OUTER));
      const ro = this.ringTexNode(float(rh)).r;
      col = col.mul(float(1).sub(inRing.mul(ro).mul(0.82).mul(this.uRings)));
    }
    return col;
  }

  /** Ring lookup: (radius in planet radii) -> RG (opacity, brightness). */
  private ringTexNode(r: any): any {
    return (texture as any)(this.ringTex!, vec2(r.sub(RING_TEX_INNER).div(RING_TEX_OUTER - RING_TEX_INNER), 0.5));
  }

  private buildRingTexture(): DataTexture {
    const t = new DataTexture(new Uint16Array(RING_TEX_SIZE * 4), RING_TEX_SIZE, 1, RGBAFormat, HalfFloatType);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    fillHalf(t, ringTexture(9));
    return t;
  }

  private buildRings(): Mesh {
    const material = new MeshBasicNodeMaterial();
    const x = positionLocal.x;
    const y = positionLocal.y;
    const rho = sqrt(x.mul(x).add(y.mul(y)));
    const rt = this.ringTexNode(rho);
    const P3 = vec3(x, 0, y.negate());
    const L = this.uLightTilt;
    const bL = dot(P3, L);
    const pp = P3.sub(L.mul(bL));
    const d = length(pp);
    const shadowed = step(bL, 0).mul(float(1).sub(smoothstep(0.97, 1.0, d)));
    const sh = mix(float(1), float(0.04), shadowed);
    material.colorNode = vec3(0.9, 0.8, 0.62).mul(rt.g).mul(sh).mul(this.uStarColour).mul(1.05);
    material.opacityNode = rt.r.mul(this.uRings);
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    const ring = new Mesh(new RingGeometry(RING_TEX_INNER, RING_TEX_OUTER, 256, 1), material);
    ring.rotation.x = -Math.PI / 2;
    return ring;
  }

  // ---- the shared description for haptics ----------------------------------------------------

  private bandProfile(): { value: (lat: number) => number; index: (lat: number) => number } {
    const tex = this.profile.tex;
    const at = (lat: number) => {
      const x = Math.min(511, Math.max(0, ((lat + Math.PI / 2) / Math.PI) * 511));
      const i = Math.floor(x);
      const f = x - i;
      return tex[i * 4]! * (1 - f) + tex[Math.min(511, i + 1) * 4]! * f;
    };
    // Band index: the number of belt and zone boundaries (brightness crossing its mean) south of `lat`.
    let mean = 0;
    for (let i = 0; i < 512; i++) mean += tex[i * 4]!;
    mean /= 512;
    const idx = new Int32Array(512);
    let k = 0;
    let prev = tex[0]! > mean;
    for (let i = 0; i < 512; i++) {
      const now = tex[i * 4]! > mean;
      if (now !== prev) k++;
      prev = now;
      idx[i] = k;
    }
    return {
      value: at,
      index: (lat) => idx[Math.min(511, Math.max(0, Math.round(((lat + Math.PI / 2) / Math.PI) * 511)))]!,
    };
  }

  private storms(): Storm[] {
    return this.placed.map((s, i) => {
      const cl = Math.cos(s.lat);
      return {
        id: i + 1,
        center: [cl * Math.cos(s.lon), Math.sin(s.lat), cl * Math.sin(s.lon)] as Vec3,
        size: s.r,
      };
    });
  }

  private updatePlaced(): void {
    this.sampler.setStorms(this.storms());
  }

  private buildSampler(): FieldSampler {
    const W = 512;
    const H = 256;
    const a = new Float32Array(W * H * 4);
    const b = new Float32Array(W * H * 4);
    const band = this.bandProfile();
    for (let r = 0; r < H; r++) {
      const lat = Math.PI / 2 - ((r + 0.5) / H) * Math.PI; // row 0 is the north pole (R6.1)
      const v = band.value(lat);
      const idx = band.index(lat);
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        a[i] = v;
        a[i + 1] = idx;
      }
    }
    const data: FieldData = { width: W, height: H, a, b };
    const sampler = new FieldSampler(data);
    const ring = this.input.reference === 'sat' ? { classify: (r: number) => classifyRing(r) } : null;
    sampler.flow = {
      wind: (d: Vec3) => this.profile.u(Math.asin(Math.max(-1, Math.min(1, d[1] / (Math.hypot(d[0], d[1], d[2]) || 1))))),
      ring,
    };
    return sampler;
  }
}

/** Haptic classification of a ring radius (in planet radii): a ring, a gap, or nothing. */
export function classifyRing(r: number): 'none' | 'ring' | 'gap' {
  if (!(r >= RING_TEX_INNER && r <= RING_TEX_OUTER)) return 'none';
  return ringAt(r).opacity < 0.15 ? 'gap' : 'ring';
}

export { SATURN_RADIUS_KM, R_JUP_M, gasWorldInput };
