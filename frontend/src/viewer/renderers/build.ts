// Turns a RenderPlan into three.js objects (r187, three/webgpu). No data decisions are made here:
// everything that is drawn was already decided by the plan. Meshes and textures load
// asynchronously; the scene is complete (flat tint) before they arrive, and a failed load is
// reported through `hooks.onLoadFailed(layerId)` so the plan can refuse that layer (never blank).
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicNodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  RepeatWrapping,
  RingGeometry,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Box3,
  Vector3,
} from 'three/webgpu';
import { float, normalView, saturate, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { BodyPlan, DustPlan, RenderPlan, Rgb, ShellPlan, SpinPlan } from '../planTypes';
import type { TierName } from '../render/quality';
import { displacementActive } from './AsteroidProcedural';
import { ShapeMaterial } from '../shape/ShapeMaterial';
import {
  aoRayCount,
  chooseLod,
  lodUrls,
  meanEdgeLength,
  regolithMinFrequency,
  type LodLevel,
} from '../shape/shapeModel';
import { bakeVertexAo } from '../shape/ShapeAo';
import { createVolume } from '../volume/VolumeBody';
import { TRAIL_HALF_LENGTH } from '../planCommon';
import { allowedTags } from '../honesty';
import { isGltfUrl } from '../scaleBar';
import type { BodyContext, BodyRenderer } from './bodyRenderer';
import { ShaderBody } from './ShaderBody';
import { LIMB_DARKENING_U } from './Star';

export interface BuildHooks {
  /** A mesh or texture failed to load: refuse the layer with this id. */
  onLoadFailed(layerId: string): void;
  /** Something finished loading: draw again. */
  onChange(): void;
  /** Quality level the scene is built for (volume steps, model LOD, AO rays). Default: medium. */
  tier?: TierName;
  /**
   * A shape model loaded: its bounding-sphere radius in metres (glTF units are metres, Q-61), the
   * measured size, so the scale bar can show the real size of the model (issue #43).
   */
  onMeshMeasured?(m: { radiusM: number }): void;
  /** Tests only: replaces the field and point workers, or sets slider overrides (D-27). */
  shader?: Pick<BodyContext, 'fieldSource' | 'pointSource' | 'overrides'>;
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
  /** The generated body of a shader kind (haptics read its field), else null. */
  body: BodyRenderer | null;
  /**
   * A new plan with the same `sceneKey` (honesty, light or mode changed): applies what changed to
   * the body in place, so a toggle never regenerates the field. A no-op for the baked kinds.
   */
  update(plan: RenderPlan): void;
  /** The quality level changed: volume steps and octaves, model level of detail, displacement. */
  setTier(tier: TierName): void;
  dispose(): void;
}

const DISC_COLOR = 0x8a7a6a; // artistic

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

function bodyMaterial(body: BodyPlan): MeshStandardNodeMaterial | MeshBasicNodeMaterial {
  const tint = srgb(body.tint);
  if (body.emissive <= 0) {
    return new MeshStandardNodeMaterial({ color: tint, roughness: body.roughness });
  }
  // Self-luminous (R5.1): no external light, colour times the glow.
  const mat = new MeshBasicNodeMaterial();
  const glow = vec3(tint.r * body.emissive, tint.g * body.emissive, tint.b * body.emissive);
  if (body.limbDarkening) {
    // R7.5: I(mu) = 1 - u (1 - mu), mu = cos of the angle to the view direction.
    const mu = saturate(normalView.z);
    mat.colorNode = glow.mul(float(1).sub(float(LIMB_DARKENING_U).mul(float(1).sub(mu))));
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
  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Bodies --------------------------------------------------------------------------------
  let tier: TierName = hooks.tier ?? 'medium';
  const tierListeners: ((t: TierName) => void)[] = [];
  for (const body of plan.bodies) {
    const geometry = track(new SphereGeometry(1, body.segments[0], body.segments[1]));
    const material = track(bodyMaterial(body));
    const mesh = new Mesh(geometry, material);
    mesh.name = body.id;
    mesh.scale.set(...body.axes);
    mesh.position.set(...body.position);
    group.add(mesh);
    if (plan.spin) spinners.push(mesh);

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
      const lods = lodUrls(body.meshUrl);
      const shape = plan.shape;
      let holder: Group | null = null;
      let level: LodLevel | null = null;
      let wanted: LodLevel = 0;
      let bakedFor: BufferGeometry[] = [];

      const makeMaterial = (hasAo: boolean, edge: number | null) => {
        if (!shape || (!shape.lommelSeeliger && !shape.regolith && !hasAo)) {
          return track(new MeshStandardNodeMaterial({ color: srgb(body.tint), roughness: 0.95 }));
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
        m.color = srgb(body.tint);
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
        const hasAo = geoms.length > 0 && geoms.every((g) => g.getAttribute('ao'));
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
        level = lvl;
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
        if (shape?.ao && !hasAo && geoms.some((g, k) => g !== bakedFor[k])) {
          bakedFor = geoms;
          const rays = aoRayCount(tier);
          Promise.all(geoms.map((g) => bakeVertexAo(g, rays, () => disposed))).then(
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
            // The coarse file may be missing: fall back to full detail before refusing the layer.
            if (lvl === 1) show(0);
            else if (!holder) hooks.onLoadFailed('mesh');
          },
        );
      };
      show(chooseLod(tier, null, lods.lod1 !== null));
      tierListeners.push((t) => {
        const want = chooseLod(t, null, lods.lod1 !== null);
        if (holder && want !== level) show(want);
      });
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
      tier,
      onChange: () => {
        if (!disposed) hooks.onChange();
      },
      onFailed: (id) => {
        if (!disposed) hooks.onLoadFailed(id);
      },
      ...hooks.shader,
    });
    track(shaderBody);
    group.add(shaderBody.object);
  }

  // Emission volumes (issue #43): comet coma, dust and tails. They replace the point sprites, so
  // no dots are drawn; the plan's `shells` and `dust` stay as data for the haptics.
  const volumes = plan.volumes.map((v) => track(createVolume(v, tier)));
  for (const v of volumes) group.add(v.mesh);
  tierListeners.push((t) => volumes.forEach((v) => v.setTier(t)));

  // Disc, dust screen, trail ---------------------------------------------------------------
  for (const disc of plan.discs) {
    const geometry = track(new RingGeometry(disc.innerRadius, disc.outerRadius, 96));
    const material = track(
      new MeshBasicNodeMaterial({
        color: DISC_COLOR,
        side: DoubleSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = (disc.inclinationDeg * Math.PI) / 180;
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
    spinRate: spinRateRadPerS(plan.spin),
    body: shaderBody,
    update(next) {
      if (!shaderBody || disposed) return;
      if (next.lighting.direction) shaderBody.setSunDirection(next.lighting.direction);
      shaderBody.setVisibleTags(allowedTags(next.honesty));
    },
    setTier(next) {
      if (disposed || next === tier) return;
      tier = next;
      shaderBody?.setTier(next);
      for (const l of tierListeners) l(next);
      hooks.onChange();
    },
    dispose() {
      disposed = true;
      if (!sharedCache) cache.dispose();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}
