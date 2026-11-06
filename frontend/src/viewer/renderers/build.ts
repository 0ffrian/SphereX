// Turns a RenderPlan into three.js objects (r187, three/webgpu). No data decisions are made here:
// everything that is drawn was already decided by the plan. Meshes and textures load
// asynchronously; the scene is complete (flat tint) before they arrive, and a failed load is
// reported through `hooks.onLoadFailed(layerId)` so the plan can refuse that layer (never blank).
import {
  AdditiveBlending,
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
  Points,
  PointsNodeMaterial,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Box3,
  Sphere,
  Vector3,
} from 'three/webgpu';
import { float, normalView, saturate, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { BodyPlan, DustPlan, RenderPlan, Rgb, ShellPlan, SpinPlan } from '../planTypes';
import { LIMB_DARKENING_U } from './Star';

export interface BuildHooks {
  /** A mesh or texture failed to load: refuse the layer with this id. */
  onLoadFailed(layerId: string): void;
  /** Something finished loading: draw again. */
  onChange(): void;
}

export interface BuiltScene {
  group: Group;
  /** Objects that auto-spin (asteroid_shape). */
  spinners: Object3D[];
  /** Spin rate in radians per second; 0 when nothing spins. */
  spinRate: number;
  dispose(): void;
}

/** Opacity of a gas shell at full Q (display level, artistic). Scaled by Q. */
const SHELL_MAX_OPACITY = 0.9;
const SHELL_POINT_SIZE = 2;
const DUST_OPACITY = 0.35;
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

export function buildScene(plan: RenderPlan, hooks: BuildHooks): BuiltScene {
  const group = new Group();
  const spinners: Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  let disposed = false;
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Bodies --------------------------------------------------------------------------------
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
    const loader = new TextureLoader();
    const load = (url: string | null, layerId: string, apply: (t: Texture) => void) => {
      if (!url) return;
      loader.loadAsync(url).then(
        (t) => {
          if (disposed) {
            t.dispose();
            return;
          }
          track(t);
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
    }

    // Real shape model (R7.1): replaces the placeholder sphere when it loads.
    if (body.meshUrl) {
      const url = body.meshUrl;
      const loadMesh = /\.obj(\?.*)?$/i.test(url)
        ? new OBJLoader().loadAsync(url)
        : new GLTFLoader().loadAsync(url).then((g) => g.scene);
      loadMesh.then(
        (root) => {
          if (disposed) return;
          // Scale to the measured size: the bounding sphere becomes the unit sphere (ASSUMPTION:
          // diameter_km is the diameter of the bounding sphere of the model).
          const box = new Box3().setFromObject(root);
          const sphere = box.getBoundingSphere(new Sphere());
          const holder = new Group();
          root.position.sub(sphere.center);
          holder.add(root);
          if (sphere.radius > 0) holder.scale.setScalar(1 / sphere.radius);
          const shared = track(
            new MeshStandardNodeMaterial({ color: srgb(body.tint), roughness: 0.95 }),
          );
          root.traverse((o) => {
            if (o instanceof Mesh) {
              track(o.geometry as BufferGeometry);
              o.material = shared;
            }
          });
          group.remove(mesh);
          group.add(holder);
          const i = spinners.indexOf(mesh);
          if (i >= 0) spinners[i] = holder;
          hooks.onChange();
        },
        () => {
          if (!disposed) hooks.onLoadFailed('mesh');
        },
      );
    }
  }

  // Gas shells and dust --------------------------------------------------------------------
  const addPoints = (positions: Float32Array, color: Color, opacity: number) => {
    const geometry = track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = track(
      new PointsNodeMaterial({
        color,
        size: SHELL_POINT_SIZE,
        sizeAttenuation: false,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(new Points(geometry, material));
  };
  for (const shell of plan.shells) {
    addPoints(shellPositions(shell), new Color(shell.css), SHELL_MAX_OPACITY * shell.brightness);
  }
  if (plan.dust) addPoints(dustPositions(plan.dust), srgb(plan.dust.tint), DUST_OPACITY);

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
    const half = 2.5;
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
    dispose() {
      disposed = true;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}
