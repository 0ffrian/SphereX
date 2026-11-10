// Turns a RenderPlan into three.js objects (r187, three/webgpu). No data decisions are made here:
// everything that is drawn was already decided by the plan. Meshes and textures load
// asynchronously; the scene is complete (flat tint) before they arrive, and a failed load is
// reported through `hooks.onLoadFailed(layerId)` so the plan can refuse that layer (never blank).
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Line,
  LineBasicNodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  RepeatWrapping,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Box3,
  Vector3,
} from 'three/webgpu';
import { dot, float, fract, normalView, saturate, texture, uv, vec2, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { BodyPlan, DustPlan, RenderPlan, Rgb, ShellPlan, SpinPlan } from '../planTypes';
import type { TierName } from '../render/quality';
import { displacementActive } from './AsteroidProcedural';
import { displayLift, rgbLinearLuma } from './asteroidLift';
import { ShapeMaterial } from '../shape/ShapeMaterial';
import {
  AO_RAYS,
  chooseLod,
  lodUrls,
  meanEdgeLength,
  needsShapeMaterial,
  regolithMinFrequency,
  bakedAoDrawn,
  type LodLevel,
} from '../shape/shapeModel';
import { bakeVertexAo } from '../shape/ShapeAo';
import { createVolume } from '../volume/VolumeBody';
import { TRAIL_HALF_LENGTH } from '../planCommon';
import { allowedTags } from '../honesty';
import { isGltfUrl } from '../scaleBar';
import type { BodyContext, BodyRenderer } from './bodyRenderer';
import { ShaderBody } from './ShaderBody';
import { StarBody } from './StarBody';
import { LIMB_DARKENING_U } from './Star';
import { buildJetSurface, makeJetRuntime } from './jetSurface';
import { floatTexture } from './fieldTexture';
import { requestField } from '../fields/fieldClient';
import type { FieldData, FieldParams } from '../fields/fieldGenerator';
import { spinRateRadPerSimS, type SimTimeFn } from '../motion/motion';
import { MouldRig } from '../mould/MouldRig';
import type { MouldPose } from '../mould/mouldSteps';
import { jetPalette } from './jetPalette';
import { srgbToLinear } from './linearColour';
import { meanLuma } from './textureMean';
import { buildTTauriDisc } from './ttauriDisc';

export interface BuildHooks {
  /** A mesh or texture failed to load: refuse the layer with this id. */
  onLoadFailed(layerId: string): void;
  /** Something finished loading: draw again. */
  onChange(): void;
  /** Quality level the scene is built for (volume steps, model LOD, AO rays). Default: medium. */
  tier?: TierName;
  /**
   * A shape model loaded: half of its longest axis-aligned box extent in metres (glTF units are metres, Q-61), the
   * measured size, so the scale bar can show the real size of the model (issue #43).
   */
  onMeshMeasured?(m: { radiusM: number }): void;
  /** Tests only: replaces the field and point workers, or sets slider overrides (D-27). */
  shader?: Pick<BodyContext, 'fieldSource' | 'worldSource' | 'overrides'>;
  /** Noise octaves of the quality level (R5.7); bodies built from noise read it. Default: the low level's. */
  octaves?: number;
}

/**
 * Textures and parsed meshes by URL, shared by the scenes built for one viewer: a new scene (after
 * an honesty, mode, epoch or scrub change) finds them already loaded, so the body does not flash
 * flat while they are fetched again. A failed load is forgotten so a later build may retry.
 */
export class AssetCache {
  private readonly textures = new Map<string, Promise<Texture>>();
  private readonly loadedTextures = new Map<string, Texture>();
  private readonly meshes = new Map<string, Promise<Object3D>>();
  private readonly loadedMeshes = new Map<string, Object3D>();

  /** The texture if it has finished loading, else undefined. */
  loadedTexture(url: string): Texture | undefined {
    return this.loadedTextures.get(url);
  }

  texture(url: string): Promise<Texture> {
    let p = this.textures.get(url);
    if (!p) {
      p = new TextureLoader().loadAsync(url).then(
        (t) => {
          this.loadedTextures.set(url, t);
          return t;
        },
        (err: unknown) => {
          this.textures.delete(url);
          throw err;
        },
      );
      this.textures.set(url, p);
    }
    return p;
  }

  /** The parsed model if it has finished loading, else undefined. */
  loadedMesh(url: string): Object3D | undefined {
    return this.loadedMeshes.get(url);
  }

  mesh(url: string): Promise<Object3D> {
    let p = this.meshes.get(url);
    if (!p) {
      const load = /\.obj(\?.*)?$/i.test(url)
        ? new OBJLoader().loadAsync(url)
        : new GLTFLoader().loadAsync(url).then((g) => g.scene);
      p = load.then(
        (root) => {
          this.loadedMeshes.set(url, root);
          return root;
        },
        (err: unknown) => {
          this.meshes.delete(url);
          throw err;
        },
      );
      this.meshes.set(url, p);
    }
    return p;
  }

  dispose(): void {
    for (const t of this.loadedTextures.values()) t.dispose();
    for (const root of this.loadedMeshes.values()) {
      root.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    }
    this.textures.clear();
    this.loadedTextures.clear();
    this.meshes.clear();
    this.loadedMeshes.clear();
  }
}

export interface BuiltScene {
  group: Group;
  /** Objects that auto-spin (asteroid_shape). */
  spinners: Object3D[];
  /** Spin rate in radians per second; 0 when nothing spins. */
  spinRate: number;
  /**
   * Poses everything that moves at the SimClock's times (issue #42, D-34): star spots and flares,
   * jets, storms, clouds, pulsation. `time(id)` is the sim time of one process in sim seconds. A
   * pure function of the time: the same time gives the same picture.
   */
  setTime(time: SimTimeFn): void;
  /** True when what was built depends on the quality level's octave count (rebuilt when it changes). */
  readonly usesQuality: boolean;
  /** The generated body of a shader kind (haptics read its field), else null. */
  body: BodyRenderer | null;
  /**
   * A new plan with the same `sceneKey` (honesty, light or mode changed): applies what changed to
   * the body in place, so a toggle never regenerates the field. A no-op for the baked kinds.
   */
  update(plan: RenderPlan): void;
  /** Half the largest axis of the shape-model body in scene units, or null without one. */
  readonly shapeRadius: number | null;
  /** The body's on-screen diameter in CSS pixels (the 160 px level-of-detail rule); null = unknown. */
  setScreenPx(px: number | null): void;
  /** The TAAU frame index of the next frame (see BodyRenderer.setJitterFrame). */
  setJitterFrame(index: number): void;
  /** The quality level changed: volume steps and octaves, model level of detail, displacement. */
  setTier(tier: TierName): void;
  /**
   * Issue #60 build animation: poses the scene (scale, scaffold, morph, growth, shader knobs).
   * Null restores exactly what was built.
   */
  setMould(pose: Readonly<MouldPose> | null): void;
  dispose(): void;
}

/** Seeded PRNG (mulberry32). The same seed always gives the same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points with density ~ 1/r^2 between the inner and outer radius (R7.3). Deterministic. */
export function shellPositions(shell: ShellPlan): Float32Array {
  const rnd = mulberry32(shell.seed);
  const out = new Float32Array(shell.count * 3);
  for (let i = 0; i < shell.count; i++) {
    // Density rho ~ 1/r^2 means the number of points in a shell of thickness dr is
    // rho * 4 pi r^2 dr = constant, so r is uniform between the inner and outer radius.
    const r = shell.innerRadius + rnd() * (shell.outerRadius - shell.innerRadius);
    const z = 2 * rnd() - 1;
    const phi = 2 * Math.PI * rnd();
    const s = Math.sqrt(1 - z * z);
    out[i * 3] = r * s * Math.cos(phi);
    out[i * 3 + 1] = r * s * Math.sin(phi);
    out[i * 3 + 2] = r * z;
  }
  return out;
}

/** Pear-shaped, Sun-pointing cloud (R7.3, December only). Shape constants are artistic. */
export function dustPositions(dust: DustPlan): Float32Array {
  const rnd = mulberry32(dust.seed);
  const out = new Float32Array(dust.count * 3);
  const axis = new Vector3(...dust.direction).normalize();
  const helper = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(axis, helper).normalize();
  const v = new Vector3().crossVectors(axis, u).normalize();
  for (let i = 0; i < dust.count; i++) {
    const t = rnd();
    const along = 0.9 * t;
    // Narrow near the nucleus, widest about 60% of the way out: a pear.
    const width = 0.1 + 0.3 * Math.sin(Math.PI * Math.pow(t, 0.7));
    const rad = width * Math.sqrt(rnd());
    const ang = 2 * Math.PI * rnd();
    const p = axis
      .clone()
      .multiplyScalar(along)
      .addScaledVector(u, rad * Math.cos(ang))
      .addScaledVector(v, rad * Math.sin(ang));
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

/** Radians per second of the sped-up spin (R7.1): 2 pi / period, times the shown factor. */
export function spinRateRadPerS(spin: SpinPlan | null): number {
  if (!spin || !(spin.periodH > 0)) return 0;
  return ((2 * Math.PI) / (spin.periodH * 3600)) * spin.speedup;
}

function srgb(rgb: Rgb): Color {
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

/** The layer that owns a body's texture, for failure reports. */
function albedoLayer(plan: RenderPlan): string {
  return plan.type === 'brown_dwarf' || plan.type === 'brown_dwarf_binary' ? 'bands' : 'albedo_map';
}

/** The limb-darkening law of a self-lit body, `1 - u (1 - mu)` (R7.5), or null when it has none. */
function limbOf(body: BodyPlan): number | null {
  return body.limbU ?? (body.limbDarkening ? LIMB_DARKENING_U : null);
}

/**
 * Colour of a self-lit body (R5.1: no external light): its tint times the glow, times the baked map
 * when there is one (the map in colour, or as brightness on the tint for `albedoLuma`, issue #62),
 * times the limb darkening. A custom `colorNode` replaces `material.map`, so the map goes in here.
 */
function selfLitColour(body: BodyPlan, map: Texture | null, mapMean: number | null) {
  const tint = srgb(body.tint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node graphs are untyped proxies
  let col: any = vec3(tint.r * body.emissive, tint.g * body.emissive, tint.b * body.emissive);
  if (map) {
    // A longitude offset of the shared map (body B of a binary, so the two are not clones): the
    // map is shared, so the offset is in the sampling, not on the texture.
    const off = body.albedoOffsetU ?? 0;
    // Wrap only u (PR #63 nit): fract on the whole vector also wrapped v and drew a 1-px seam at a pole.
    const t = off > 0 ? texture(map, vec2(fract(uv().x.add(off)), uv().y)) : texture(map);
    if (body.albedoLuma) {
      const y = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
      col = col.mul(y.div(mapMean ?? 1));
    } else {
      col = col.mul(t.rgb);
    }
  }
  const u = limbOf(body);
  if (u !== null) {
    // R7.5: I(mu) = 1 - u (1 - mu), mu = cos of the angle to the view direction.
    const mu = saturate(normalView.z);
    col = col.mul(float(1).sub(float(u).mul(float(1).sub(mu))));
  }
  return col;
}

/** The body's colour, with the capped display lift when the plan asks for it (asteroids). */
function liftedTint(body: BodyPlan): Color {
  const c = srgb(body.tint);
  return body.displayLift ? c.multiplyScalar(displayLift(rgbLinearLuma(body.tint))) : c;
}

function bodyMaterial(body: BodyPlan): MeshStandardNodeMaterial | MeshBasicNodeMaterial {
  const tint = liftedTint(body);
  if (body.emissive <= 0) {
    return new MeshStandardNodeMaterial({ color: tint, roughness: body.roughness });
  }
  // Self-luminous (R5.1): no external light, colour times the glow.
  const mat = new MeshBasicNodeMaterial();
  if (limbOf(body) !== null) {
    mat.colorNode = selfLitColour(body, null, null);
  } else {
    mat.color = new Color(tint.r * body.emissive, tint.g * body.emissive, tint.b * body.emissive);
  }
  return mat;
}

export function buildScene(
  plan: RenderPlan,
  hooks: BuildHooks,
  sharedCache?: AssetCache,
): BuiltScene {
  const cache = sharedCache ?? new AssetCache();
  const group = new Group();
  const spinners: Object3D[] = [];
  const animators: ((time: SimTimeFn) => void)[] = [];
  const octaves = hooks.octaves ?? 4;
  let usesQuality = false;
  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  let cover = plan.jets?.cover ?? 0;
  let spinPlan = plan.spin;
  let lastTime: SimTimeFn = () => 0;
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Bodies --------------------------------------------------------------------------------
  let tier: TierName = hooks.tier ?? 'medium';
  const tierListeners: ((t: TierName) => void)[] = [];
  // On-screen size of the shape model (the 160 px rule) and who re-chooses the level when it moves.
  let screenPx: number | null = null;
  const lodRefresh: (() => void)[] = [];
  let shapeRadius: number | null = null;
  const mouldSpheres: { mesh: Mesh; axes: [number, number, number] }[] = [];
  const mouldHolders: (() => Object3D | null)[] = [];
  for (const [bodyIndex, body] of plan.bodies.entries()) {
    // A star with a moving surface (R7.5.1): spots, flares, loops, granulation and glow.
    if (plan.star && body.id === 'body') {
      const star = track(
        new StarBody(plan.star, {
          tint: srgbToLinear(body.tint),
          emissive: body.emissive,
          limbU: body.limbDarkening ? LIMB_DARKENING_U : null,
          octaves,
          axes: body.axes,
          segments: [128, 64],
        }),
      );
      star.group.position.set(...body.position);
      group.add(star.group);
      usesQuality = true;
      // The star turns itself (StarBody rotates its own frame by the spin clock), so it is not a
      // `spinner`. A Mira has no star surface and is posed below.
      animators.push((time) => star.setTime(time));
      continue;
    }
    const geometry = track(new SphereGeometry(1, body.segments[0], body.segments[1]));
    const material = track(bodyMaterial(body));
    const mesh = new Mesh(geometry, material);
    mesh.name = body.id;
    mesh.scale.set(...body.axes);
    mesh.position.set(...body.position);
    group.add(mesh);
    // A pulsing Mira poses its own scale every frame, so it is not stretched by the build animation.
    if (!plan.pulsation) mouldSpheres.push({ mesh, axes: body.axes });
    if (plan.spin && !plan.jets) spinners.push(mesh);
    // A Mira that pulses with the clock (Q-65): a Mira has no star surface, so it is posed here.
    if (plan.pulsation) {
      const pulse = plan.pulsation;
      animators.push((time) => {
        const s =
          1 +
          pulse.amplitude *
            Math.sin((2 * Math.PI * time('pulsation')) / (pulse.periodD * 86400) + pulse.phase);
        mesh.scale.set(body.axes[0] * s, body.axes[1] * s, body.axes[2] * s);
      });
    }

    // A brown dwarf with moving jets (R7.4, A7.2): the flat body stays until the field is ready,
    // then the banded surface replaces it (never blank).
    if (plan.jets) {
      const jp = plan.jets;
      const motion = plan.motion;
      const fp: FieldParams = {
        kind: 'gas',
        seed: jp.seed + bodyIndex,
        freq: 0,
        seaLevel: 0,
        iceExtent: 0,
        heat: 0,
        bands: jp.bands,
        turbulence: jp.turbulence,
        storms: jp.storms,
      };
      const source = hooks.shader?.fieldSource ?? requestField;
      usesQuality = true;
      void source(fp).then(
        (field: FieldData) => {
          if (disposed) return;
          const tex = floatTexture(field.a, field.width, field.height);
          const surface = buildJetSurface({
            texA: tex,
            bands: jp.bands,
            seed: fp.seed,
            turbulence: jp.turbulence,
            palette: jetPalette(srgbToLinear(body.tint), jp.contrast),
            octaves,
            selfLit: true,
            emissive: body.emissive,
            clouds: jp.clouds,
            storms: jp.storms,
            limbU: jp.limbU ?? null,
          });
          surface.mesh.position.copy(mesh.position);
          surface.mesh.scale.set(body.axes[0], body.axes[1] * (1 - jp.flattening), body.axes[2]);
          track({
            dispose() {
              tex.dispose();
              surface.mesh.geometry.dispose();
              (surface.mesh.material as { dispose(): void }).dispose();
            },
          });
          mesh.visible = false;
          group.add(surface.mesh);
          const jets =
            jp.windMs !== null && jp.radiusM !== null
              ? { windMs: jp.windMs, radiusM: jp.radiusM }
              : null;
          const winds = motion.processes.find((p) => p.id === 'winds');
          const clouds = motion.processes.find((p) => p.id === 'clouds');
          const run = makeJetRuntime({
            surface,
            fp,
            jets,
            spinRate: spinRateRadPerSimS(motion),
            evolveRatio: winds && clouds ? clouds.speedup / winds.speedup : 0,
            sampler: null,
            cover: () => cover,
          });
          animators.push(run);
          run(lastTime);
          hooks.onChange();
        },
        () => {
          if (!disposed) hooks.onLoadFailed('jets');
        },
      );
    }

    // Textures (baked by the backend). A failed load leaves the flat tint and refuses the layer.
    // A texture the cache already holds is applied at once, so a rebuilt body never flashes flat.
    const load = (url: string | null, layerId: string, apply: (t: Texture) => void) => {
      if (!url) return;
      const ready = cache.loadedTexture(url);
      if (ready) {
        apply(ready);
        return;
      }
      cache.texture(url).then(
        (t) => {
          if (disposed) return;
          apply(t);
          material.needsUpdate = true;
          hooks.onChange();
        },
        () => {
          if (!disposed) hooks.onLoadFailed(layerId);
        },
      );
    };
    load(body.albedoUrl, albedoLayer(plan), (t) => {
      t.colorSpace = SRGBColorSpace;
      material.map = t;
      // Display lift (artistic), capped by the map's own mean brightness so a bright body does not clip.
      if (material instanceof MeshStandardNodeMaterial && body.displayLift)
        material.color.setScalar(displayLift(meanLuma(t.image)));
      if (material instanceof MeshBasicNodeMaterial && (limbOf(body) !== null || body.albedoLuma)) {
        // A self-lit body with limb darkening or a brightness-only map has a custom colour node.
        material.colorNode = selfLitColour(body, t, body.albedoLuma ? meanLuma(t.image) : null);
      }
    });
    if (material instanceof MeshStandardNodeMaterial) {
      load(body.normalUrl, 'relief', (t) => {
        material.normalMap = t;
      });
      // R7.2: displacement by the baked height map, desktop only (the one height field also
      // drives the normals above). The scale is relief_amp, a plan value ([verify]: R7.2).
      const scale = body.displacementScale;
      load(body.heightUrl, 'displacement', (t) => {
        // The sphere's u = 0 and u = 1 vertices sample the same column: repeat, or the seam cracks.
        if (t.wrapS !== RepeatWrapping) {
          t.wrapS = RepeatWrapping;
          t.needsUpdate = true;
        }
        material.displacementMap = t;
        material.displacementScale = displacementActive(tier, scale) ? (scale ?? 0) : 0;
      });
      tierListeners.push((t) => {
        if (material.displacementMap) {
          material.displacementScale = displacementActive(t, scale) ? (scale ?? 0) : 0;
        }
      });
    }

    // Real shape model (R7.1): replaces the placeholder sphere when it loads. Two levels of detail
    // (backend `<slug>.glb` and `<slug>.lod1.glb`); the quality level picks one.
    if (body.meshUrl) {
      shapeRadius = Math.max(shapeRadius ?? 0, ...body.axes);
      const lods = lodUrls(body.meshUrl);
      const shape = plan.shape;
      let holder: Group | null = null;
      mouldHolders.push(() => holder);
      let wanted: LodLevel = 0;
      let lod1Missing = false;
      let bakedFor: BufferGeometry[] = [];

      const makeMaterial = (hasAo: boolean, edge: number | null) => {
        if (!shape || !needsShapeMaterial(shape, hasAo)) {
          return track(new MeshStandardNodeMaterial({ color: liftedTint(body), roughness: 0.95 }));
        }
        const m = track(
          new ShapeMaterial({
            hasAo,
            // Model units: the noise runs on the model's own coordinates (metres for the backend
            // models), at the wavelength of two mean edges and finer (D-33, tier 5).
            regolithFrequency: shape.regolith ? regolithMinFrequency(edge) : null,
            lommelSeeliger: shape.lommelSeeliger,
          }),
        );
        m.color = liftedTint(body);
        return m;
      };

      const apply = (cached: Object3D, lvl: LodLevel) => {
        if (disposed || lvl !== wanted) return; // a newer level was asked for meanwhile
        // The cached model is shared between scenes: clone it, and leave its geometry to the cache.
        const root = cached.clone(true);
        // Scale to the measured size: the bounding sphere becomes the unit sphere times the body's
        // largest axis (1 for an asteroid, the nucleus radius for a comet).
        // ASSUMPTION (Q-43, [verify]): diameter_km is the diameter of the bounding sphere of the
        // model. Catalogue diameters are often volume-equivalent, which would make this too large.
        const box = new Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new Sphere());
        const next = new Group();
        root.position.sub(sphere.center);
        next.add(root);
        if (sphere.radius > 0) next.scale.setScalar(Math.max(...body.axes) / sphere.radius);
        next.position.set(...body.position);
        next.rotation.y = holder ? holder.rotation.y : mesh.rotation.y; // keep the spin angle
        const geoms: BufferGeometry[] = [];
        root.traverse((o) => {
          if (o instanceof Mesh) geoms.push(o.geometry as BufferGeometry);
        });
        const first = geoms[0]?.getAttribute('position');
        const edge =
          first && 'array' in first && !('isInterleavedBufferAttribute' in first)
            ? meanEdgeLength(first.array as ArrayLike<number>, geoms[0]!.index?.array ?? null)
            : null;
        // Honesty filter (D-21): the cached geometry may carry an AO baked while Estimated was on,
        // so whether it is drawn follows the plan (`shape.ao`), never the attribute alone.
        const hasAo = bakedAoDrawn(
          shape?.ao,
          geoms.map((g) => g.getAttribute('ao') !== undefined),
        );
        const shared = makeMaterial(hasAo, edge);
        root.traverse((o) => {
          if (o instanceof Mesh) {
            o.material = shared;
            o.castShadow = shape?.shadows === true;
            o.receiveShadow = shape?.shadows === true;
          }
        });
        if (holder) group.remove(holder);
        else group.remove(mesh);
        group.add(next);
        const i = spinners.indexOf(holder ?? mesh);
        if (i >= 0) spinners[i] = next;
        holder = next;
        // The measured size is the longest extent of the model, not the radius of the box's
        // bounding sphere (that overstates an elongated body such as Eros by about 20%).
        const longest = Math.max(
          box.max.x - box.min.x,
          box.max.y - box.min.y,
          box.max.z - box.min.z,
        );
        // Only a glTF model is in metres (Q-61); an OBJ has no stated unit, so it is not reported.
        if (longest > 0 && Number.isFinite(longest) && isGltfUrl(body.meshUrl))
          hooks.onMeshMeasured?.({ radiusM: longest / 2 });

        // Baked AO (derived): bake once per model in slices, then swap in the AO material.
        if (shape?.ao === true && !hasAo && geoms.some((g, k) => g !== bakedFor[k])) {
          bakedFor = geoms;
          // One ray count for every tier: the AO is cached on the shared geometry, so it must not
          // depend on which tier loaded the model first (determinism).
          Promise.all(geoms.map((g) => bakeVertexAo(g, AO_RAYS, () => disposed))).then(
            (done) => {
              if (disposed || holder !== next || !done.every(Boolean)) return;
              const withAo = makeMaterial(true, edge);
              next.traverse((o) => {
                if (o instanceof Mesh) o.material = withAo;
              });
              hooks.onChange();
            },
            () => undefined, // AO is optional: the model stays lit without it (never blank)
          );
        }
        hooks.onChange();
      };

      const show = (lvl: LodLevel) => {
        wanted = lvl;
        const url = lvl === 1 && lods.lod1 ? lods.lod1 : lods.lod0;
        const ready = cache.loadedMesh(url);
        if (ready) {
          apply(ready, lvl);
          return;
        }
        cache.mesh(url).then(
          (m) => apply(m, lvl),
          () => {
            if (disposed) return;
            // Remember a missing coarse file: the size can change every frame, and a failed load
            // is not cached, so it would be requested (and the full model rebuilt) again each time.
            if (lvl === 1) lod1Missing = true;
            // A stale failure (the wanted level has moved on) must not refuse the mesh.
            if (lvl !== wanted) return;
            // The coarse file may be missing: fall back to full detail before refusing the layer.
            if (lvl === 1) show(0);
            else if (!holder) hooks.onLoadFailed('mesh');
          },
        );
      };
      const refresh = () => {
        const want = chooseLod(tier, screenPx, lods.lod1 !== null && !lod1Missing, wanted);
        // Also while the first model is still loading: a later change must not be lost.
        if (want !== wanted) show(want);
      };
      show(chooseLod(tier, screenPx, lods.lod1 !== null && !lod1Missing));
      tierListeners.push(refresh); // `tier` is already the new level when listeners run
      lodRefresh.push(refresh);
    }
  }

  // Shader kinds (D-01) --------------------------------------------------------------------
  // The plan says what is shown; the body builds its surface from the shared CPU field and keeps
  // a plain sphere meanwhile (never blank). Honesty and light are applied by `update`.
  let shaderBody: ShaderBody | null = null;
  if (plan.shader) {
    shaderBody = ShaderBody.start(plan.shader.card, plan.shader.params, {
      visibleTags: allowedTags(plan.honesty),
      lightDir: plan.lighting.direction ?? undefined,
      lightColour: plan.lighting.colour ?? undefined,
      tier,
      onChange: () => {
        if (!disposed) hooks.onChange();
      },
      onFailed: (id) => {
        if (!disposed) hooks.onLoadFailed(id);
      },
      motion: plan.motion,
      octaves,
      gasLayers: plan.shader.gas ?? undefined,
      pattern: plan.shader.pattern,
      ...hooks.shader,
    });
    usesQuality = true;
    track(shaderBody);
    group.add(shaderBody.object);
  }

  // Emission volumes (issue #43): comet coma, dust and tails. They replace the point sprites, so
  // no dots are drawn; the plan's `shells` and `dust` stay as data for the haptics.
  const volumes = plan.volumes.map((v) => track(createVolume(v, tier)));
  for (const v of volumes) group.add(v.mesh);
  tierListeners.push((t) => volumes.forEach((v) => v.setTier(t)));
  const jitterFrame = (i: number) => volumes.forEach((v) => v.setJitterFrame(i));

  const first = plan.bodies[0];
  const rig = new MouldRig({
    group,
    spheres: mouldSpheres,
    holders: mouldHolders,
    volumes: volumes.map((v) => v.mesh),
    wireAt: first
      ? { position: first.position, radius: Math.max(...first.axes) }
      : plan.shader && plan.type !== 'nebula' && plan.type !== 'nova'
        ? { position: [0, 0, 0], radius: 1 }
        : null,
    shader: shaderBody,
  });

  // Disc, dust screen, trail ---------------------------------------------------------------
  for (const disc of plan.discs) {
    // Issue #62, R7.5: a flared, lit, depth-tested disc (ttauriDisc.ts), not a flat ring.
    const mesh = buildTTauriDisc(disc);
    track(mesh.geometry);
    track(mesh.material as { dispose(): void });
    for (const c of mesh.children) track((c as Mesh).material as { dispose(): void });
    group.add(mesh);
  }
  for (const screen of plan.screens) {
    const geometry = track(new CircleGeometry(screen.radius, 48));
    const material = track(
      new MeshBasicNodeMaterial({
        color: 0x000000,
        transparent: true,
        opacity: screen.opacity,
        depthWrite: false,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.z = screen.z;
    group.add(mesh);
  }
  for (const trail of plan.trails) {
    // Direction of motion only: the length is a display value, not to scale.
    const [dx, dy] = trail.pm;
    const n = Math.hypot(dx, dy) || 1;
    const half = TRAIL_HALF_LENGTH;
    const geometry = track(new BufferGeometry());
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          (-dx / n) * half,
          (-dy / n) * half,
          0,
          (dx / n) * half,
          (dy / n) * half,
          0,
        ]),
        3,
      ),
    );
    group.add(new Line(geometry, track(new LineBasicNodeMaterial({ color: 0xffffff }))));
  }

  return {
    group,
    spinners,
    // The spin plan of the latest plan: a generated body keeps its field across honesty changes,
    // and its spin (drawn only with the surface) follows the plan in place.
    get spinRate() {
      return spinRateRadPerS(spinPlan);
    },
    body: shaderBody,
    get usesQuality() {
      return usesQuality;
    },
    setTime(time) {
      if (disposed) return;
      lastTime = time;
      for (const a of animators) a(time);
      shaderBody?.setTime(time);
    },
    update(next) {
      // A brown dwarf's cloud cover follows the scrub (R7.4); applied in place, no rebuild.
      if (next.jets) cover = next.jets.cover;
      spinPlan = next.spin;
      if (!shaderBody || disposed) return;
      shaderBody.setSunColour(next.lighting.colour);
      if (next.lighting.direction) shaderBody.setSunDirection(next.lighting.direction);
      shaderBody.setVisibleTags(allowedTags(next.honesty));
      // The plan's switches carry the honesty level and the build step's holds (issue #62).
      shaderBody.setGasLayers(next.shader?.gas ?? null);
      shaderBody.setPatternSwitch(next.shader?.pattern ?? null);
    },
    shapeRadius,
    setScreenPx(px) {
      if (disposed || px === screenPx) return;
      screenPx = px;
      for (const r of lodRefresh) r();
    },
    setJitterFrame(index) {
      jitterFrame(index);
      shaderBody?.setJitterFrame(index);
    },
    setTier(next) {
      if (disposed || next === tier) return;
      tier = next;
      shaderBody?.setTier(next);
      for (const l of tierListeners) l(next);
      hooks.onChange();
    },
    setMould(pose) {
      if (disposed) return;
      rig.apply(pose);
      hooks.onChange();
    },
    dispose() {
      disposed = true;
      rig.restore();
      rig.dispose();
      if (!sharedCache) cache.dispose();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}
