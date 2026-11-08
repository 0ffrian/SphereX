// R7.7, D-01, D-12, D-26: browser-shader renderer for planet_rocky, planet_water, gas_giant,
// nebula and nova (three r187, `three/webgpu` node materials / TSL).
//
// Field first: planets and gas giants read their height, bands, storm ids and masks from the shared
// CPU field (fields/fieldGenerator.ts) through two Float32 DataTextures, fetched with `textureLoad`
// (no sampler, so it does not matter whether float32 is filterable) and filtered by hand. The
// shader adds only visual noise below the field's resolution. Nebula and nova are emission volumes
// (issue #43, volume/VolumeBody.ts); they have no field, no point sets and no haptics (Q-103).
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
  FloatType,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  NearestFilter,
  Object3D,
  RGBAFormat,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import {
  abs,
  acos,
  atan,
  clamp,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  ivec2,
  length,
  max,
  min,
  mix,
  mx_fractal_noise_float,
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
  step,
  textureLoad,
  uniform,
  vec3,
  mod,
} from 'three/tsl';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import {
  FieldSampler,
  RING_GAP_EDGES,
  RING_INNER,
  RING_OUTER,
  STORM_RING_CENTRE,
  STORM_RING_WIDTH,
  stormsFor,
  type FieldData,
  type Vec3,
} from '../fields/fieldGenerator';
import { requestField } from '../fields/fieldClient';
import { shaderSeedOffsets } from '../fields/noise';
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

const rgb3 = (c: Rgb) => vec3(c[0], c[1], c[2]);
const TWO_PI = Math.PI * 2;

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

// ---- field textures ----------------------------------------------------------------------------

function floatTexture(data: Float32Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, FloatType);
  // Nearest + no mipmaps: the shader uses textureLoad and filters by hand, so float32 filtering
  // support does not matter (WebGPU needs 'float32-filterable' for linear filtering of f32).
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** R6.1 direction -> texel space, in the shader. Row 0 is the north pole. */
function fieldUV(dir: any) {
  const u = fract(atan(dir.z, dir.x.negate()).div(TWO_PI));
  const v = acos(clamp(dir.y, -1, 1)).div(Math.PI);
  return { u, v };
}

function bilinear(tex: DataTexture, u: any, v: any) {
  const W = tex.image.width;
  const H = tex.image.height;
  const px = u.mul(W).sub(0.5);
  const py = v.mul(H).sub(0.5);
  const x0 = floor(px);
  const y0 = floor(py);
  const fx = fract(px);
  const fy = fract(py);
  const tap = (dx: number, dy: number) =>
    textureLoad(tex, ivec2(mod(x0.add(dx + W), W).toInt(), clamp(y0.add(dy), 0, H - 1).toInt()));
  return mix(mix(tap(0, 0), tap(1, 0), fx), mix(tap(0, 1), tap(1, 1), fx), fy);
}

/** Visual-only noise, 0..1 centred on 0.5 (finer than the field; seen, not felt). */
const vnoise3 = (p: any, octaves = 3) =>
  mx_fractal_noise_float(p, octaves, 2.0, 0.5).mul(0.5).add(0.5);

// ---- planets -----------------------------------------------------------------------------------

function buildPlanet(
  spec: ShaderSpec,
  field: FieldData,
  sunWorld: any,
  textures: DataTexture[],
): Group {
  const fp = spec.field!;
  const style = spec.planet!;
  const texA = floatTexture(field.a, field.width, field.height);
  const texB = floatTexture(field.b, field.width, field.height);
  textures.push(texA, texB);
  const group = new Group();
  const geo = new SphereGeometry(1, 128, 96);

  const dir = normalize(positionLocal);
  const { u, v } = fieldUV(dir);
  const A = bilinear(texA, u, v);
  const B = bilinear(texB, u, v);
  const h = A.x;
  const ocean = B.x;
  const ice = B.y;
  const crack = B.z;
  const seaL = float(Math.max(fp.seaLevel, 0));
  const heat = float(fp.heat);

  const hh = clamp(h.sub(seaL).div(float(1).sub(seaL)), 0, 1);
  const depth = fp.seaLevel > 0 ? clamp(seaL.sub(h).div(seaL).mul(3), 0, 1) : float(0);
  const lowC = mix(rgb3(LAND_LOW), rgb3(LAND_LOW_GREEN), style.hue);
  const highC = mix(rgb3(LAND_HIGH), rgb3(LAND_HIGH_GREY), style.hue);
  // Sub-resolution colour variation (visual only).
  const vr = vnoise3(dir.mul(fp.freq * 3 * 4).add(5));
  const landC = mix(lowC, highC, clamp(hh.mul(1.5).add(vr.sub(0.5).mul(0.6)), 0, 1));
  const oceanC = mix(rgb3(OCEAN_SHALLOW), rgb3(OCEAN_DEEP), depth);
  let col: any = mix(landC, oceanC, ocean);
  col = mix(col, rgb3(ICE_COLOUR), ice);
  col = col.mul(float(1).sub(heat.mul(0.5)));

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
  let pv: any = grad.mul(style.relief).div(max(abs(det), 1e-6));
  pv = pv.mul(min(float(1), float(0.85).div(max(length(pv), 1e-5))));
  const bumped = normalize(n0.sub(pv));

  const lowH = float(1).sub(smoothstep(0, 0.5, hh));
  const lava = crack
    .mul(lowH.mul(0.5).add(0.5))
    .mul(1.7)
    .add(lowH.mul(0.12).mul(float(1).sub(ocean)));
  const mat = new MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.normalNode = bumped;
  mat.roughnessNode = mix(float(0.9), float(0.25), ocean.mul(float(1).sub(ice)));
  mat.metalness = 0;
  mat.emissiveNode = fp.heat > 0 ? rgb3(LAVA_COLOUR).mul(lava).mul(heat) : vec3(0, 0, 0);
  group.add(new Mesh(geo, mat));

  if (style.cloudCover > 0.001) {
    const cm = new MeshStandardNodeMaterial();
    // B1/NF-3: a bounded seed offset, not the raw seed (float32 would drown the direction term).
    const seedOff = vec3(0, 0, shaderSeedOffsets(spec.seed).cloud);
    const p = dir.mul(3).add(seedOff);
    const q = vec3(vnoise3(p.add(3.3), 3), vnoise3(p.add(7.7), 3), vnoise3(p.add(1.1), 3));
    const c = vnoise3(p.mul(1.2).add(q.mul(1.6)), 4);
    const thr = float(0.88 - (0.88 - 0.36) * style.cloudCover);
    cm.colorNode = vec3(0.97, 0.97, 0.97);
    cm.opacityNode = smoothstep(thr, thr.add(0.16), c).mul(0.92);
    cm.transparent = true;
    cm.depthWrite = false;
    cm.roughness = 1;
    const clouds = new Mesh(geo, cm);
    clouds.scale.setScalar(1.012);
    group.add(clouds);
  }

  if (style.atmosphere > 0.001) {
    const am = new MeshBasicNodeMaterial();
    const view = normalize(cameraPosition.sub(positionWorld));
    const f = pow(float(1).sub(max(dot(normalWorld, view), 0)), 2.6);
    const sunlit = smoothstep(-0.25, 0.45, dot(normalWorld, sunWorld));
    am.colorNode = rgb3(style.atmosphereColour).mul(1.6);
    am.opacityNode = f.mul(sunlit).mul(style.atmosphere);
    am.transparent = true;
    am.depthWrite = false;
    am.blending = AdditiveBlending;
    const atm = new Mesh(geo, am);
    atm.scale.setScalar(1.07);
    group.add(atm);
  }
  return group;
}

// ---- gas giants --------------------------------------------------------------------------------

function buildGas(spec: ShaderSpec, field: FieldData, textures: DataTexture[]): Group {
  const fp = spec.field!;
  const gas = spec.gas!;
  const texA = floatTexture(field.a, field.width, field.height);
  textures.push(texA);
  const group = new Group();
  const tilt = new Group();
  tilt.rotation.z = 0.35;
  group.add(tilt);

  const dir = normalize(positionLocal);
  const { u, v: vv } = fieldUV(dir);
  const A = bilinear(texA, u, vv);
  // R = band profile from the field. 0.5 is a band edge and maps to 0.5 here, so the drawn edges
  // are the field's edges; the noise only breaks up the colour inside a band.
  const fine = vnoise3(
    vec3(dir.x.mul(7), dir.y.mul(28), dir.z.mul(7)).add(shaderSeedOffsets(spec.seed).gasFine),
    3,
  );
  const val = clamp(
    A.x
      .mul(0.7)
      .add(0.15)
      .add(fine.sub(0.5).mul(0.2 * (0.3 + fp.turbulence))),
    0,
    1,
  );
  const [c0, c1, c2, c3] = gas.palette.map(rgb3) as [any, any, any, any];
  let col: any = mix(mix(c0, c1, val.mul(2)), mix(c1, c2, val.mul(2).sub(1)), step(0.5, val));
  for (const s of stormsFor(spec.seed, fp.storms)) {
    const dist = acos(clamp(dot(dir, vec3(s.center[0], s.center[1], s.center[2])), -1, 1));
    const spot = exp(pow(dist.div(s.size), 2).negate());
    // Same ring constants as the field's storm edge (N3).
    const ring = exp(
      pow(dist.div(s.size).sub(STORM_RING_CENTRE).div(STORM_RING_WIDTH), 2).negate(),
    );
    col = mix(col, c3, spot.mul(0.85));
    col = mix(col, c2, ring.mul(0.35));
  }
  // N5 / R5.1: lit by the scene's DirectionalLight (terminator, ambient floor 0.03), like the
  // planets. Hot bodies add a self-glow term (mock-up uGlow) through the emissive channel.
  const mat = new MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.roughness = 1;
  mat.metalness = 0;
  mat.emissiveNode = gas.glow > 0 ? col.mul(gas.glow * 0.6) : vec3(0, 0, 0);
  const mesh = new Mesh(new SphereGeometry(1, 96, 64), mat);
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
  return group;
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
  /** Node the body frame is measured in: the tilt group for gas giants, else the group. */
  frame: Object3D;
  textures: DataTexture[];
  field: FieldData | null;
  points: PointSets | null;
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
  private readonly sun = uniform(new Vector3(...HEAD_ON));
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
    this.tier = ctx.tier ?? 'medium';
    this.spec = resolveShaderSpec(card, params, this.overrides);
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

  setSunDirection(dir: Vec3): void {
    const d = new Vector3(dir[0], dir[1], dir[2]);
    if (d.lengthSq() > 0) this.sun.value.copy(d.normalize());
  }

  setTier(tier: TierName): void {
    if (this.disposed || tier === this.tier) return;
    this.tier = tier;
    for (const v of this.volumes) v.setTier(tier);
    this.onChange?.();
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
    this.spec = resolveShaderSpec(this.card, this.params, overrides);
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
      return { group, frame: group, textures, field: null, points: null, volumes: [volume] };
    }
    const field = await this.fieldSource(spec.field!);
    if (this.disposed || spec !== this.spec) return null;
    if (spec.kind === 'gas_giant') {
      const group = buildGas(spec, field, textures);
      return { group, frame: group.children[0]!, textures, field, points: null };
    }
    const group = buildPlanet(spec, field, this.sun, textures);
    return { group, frame: group, textures, field, points: null };
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
    this.sampler = built?.field ? new FieldSampler(built.field) : null;
    this.points = built?.points ?? null;
    this.volumes = built?.volumes ?? [];
    if (built) this.object.add(built.group);
    this.release(oldGroup, oldTextures, oldVolumes);
    this.ensurePlain();
    this.applyVisibility();
    this.onChange?.();
  }
}
