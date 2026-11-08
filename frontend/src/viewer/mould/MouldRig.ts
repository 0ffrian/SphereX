// Issue #60: applies a MouldPose (mouldSteps.ts) to one built scene, and undoes it exactly.
// Everything here is presentation of what the plan already built:
//   - the whole scene scales (mock-up `.55 + .45 * P[0]`);
//   - a wireframe scaffold (mock-up `wireMesh`: icosahedron detail 5, radius 1.004, colour
//     0.45/0.82/1.0, opacity `.9 * P[0] * (1 - P[k])`) sits over the body and is removed at the end;
//   - sphere bodies stretch from a sphere to their ellipsoid axes;
//   - shape-model meshes morph on the CPU from a sphere to the real vertices, on a private copy of
//     the geometry (the cached model is never touched), and get their own geometry back at the end;
//   - volumes grow from their centre;
//   - generated worlds get their shader knobs (ShaderBody.setMould).
// `apply(null)` (or any pose equal to NORMAL_POSE) restores every object to the values the build
// gave it, so the frame after a build is the normal render of the plan.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Line2NodeMaterial,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three/webgpu';
import { Wireframe } from 'three/addons/lines/webgpu/Wireframe.js';
import { WireframeGeometry2 } from 'three/addons/lines/WireframeGeometry2.js';
import type { Vec3 } from '../planTypes';
import type { MouldPose } from './mouldSteps';

/** Mock-up WIRE_FS colour (artistic, presentation only). */
const WIRE_RGB: [number, number, number] = [0.45, 0.82, 1.0];
/** Mock-up wire radius and icosahedron detail. */
const WIRE_RADIUS = 1.004;
const WIRE_DETAIL = 5;
/**
 * Line width in CSS pixels. WebGPU draws plain lines 1 px wide, and the temporal anti-aliasing
 * thins them to dots between the vertices; wide lines (Line2NodeMaterial) keep the mock-up's
 * continuous mesh. Presentation value.
 */
const WIRE_WIDTH_PX = 1.25;

export interface MouldTargets {
  group: Group;
  /** Sphere bodies with the axes the build scaled them to. */
  spheres: { mesh: Mesh; axes: Vec3 }[];
  /** Shape-model holders (their current one; a level-of-detail swap replaces it). */
  holders: (() => Object3D | null)[];
  /** Emission volume meshes. */
  volumes: Mesh[];
  /** Where the scaffold sits and how big it is (the first body), or null for none. */
  wireAt: { position: Vec3; radius: number } | null;
  /** Generated world knobs, or null. */
  shader: {
    setMould(k: Partial<Record<'terrain' | 'sea' | 'colour' | 'clouds', number>> | null): void;
  } | null;
}

interface Morph {
  original: BufferGeometry;
  copy: BufferGeometry;
  sphere: Float32Array;
  real: Float32Array;
  last: number;
  /** When the normals and bounding sphere were last recomputed (ms). */
  shadedAt: number;
}

/**
 * Normals and the bounding sphere are recomputed at most this often while morphing (about 20 Hz);
 * the positions still move every frame. Presentation pacing: the lit shading of a morphing body
 * does not need more, and the full recompute of a large mesh is the expensive part.
 */
export const MORPH_SHADE_INTERVAL_MS = 50;

export class MouldRig {
  private wire: Wireframe | null = null;
  private readonly morphs = new Map<Mesh, Morph>();
  private readonly volumeRest = new Map<Mesh, { scale: Vector3; position: Vector3 }>();
  private active = false;

  constructor(private readonly t: MouldTargets) {}

  apply(pose: Readonly<MouldPose> | null): void {
    if (!pose) {
      if (this.active) this.restore();
      return;
    }
    this.active = true;
    const { group } = this.t;
    group.scale.setScalar(pose.scale);
    this.setWire(pose.wire);
    for (const { mesh, axes } of this.t.spheres) {
      if (pose.shape >= 1) mesh.scale.set(...axes);
      else {
        const m = Math.max(...axes);
        mesh.scale.set(
          m + (axes[0] - m) * pose.shape,
          m + (axes[1] - m) * pose.shape,
          m + (axes[2] - m) * pose.shape,
        );
      }
    }
    for (const get of this.t.holders) {
      const holder = get();
      if (!holder) continue;
      holder.traverse((o) => {
        if (o instanceof Mesh) this.morph(o, pose.shape);
      });
    }
    for (const v of this.t.volumes) {
      let rest = this.volumeRest.get(v);
      if (!rest) {
        rest = { scale: v.scale.clone(), position: v.position.clone() };
        this.volumeRest.set(v, rest);
      }
      if (pose.grow >= 1) {
        v.scale.copy(rest.scale);
        v.position.copy(rest.position);
      } else {
        const g = Math.max(0.02, pose.grow);
        v.scale.copy(rest.scale).multiplyScalar(g);
        v.position.copy(rest.position).multiplyScalar(g);
      }
    }
    this.t.shader?.setMould({
      terrain: pose.terrain,
      sea: pose.sea,
      colour: pose.colour,
      clouds: pose.clouds,
    });
  }

  /** Back to exactly what the build made. */
  restore(): void {
    this.active = false;
    this.t.group.scale.setScalar(1);
    this.setWire(0);
    for (const { mesh, axes } of this.t.spheres) mesh.scale.set(...axes);
    for (const [mesh, m] of this.morphs) {
      if (mesh.geometry === m.copy) mesh.geometry = m.original;
      m.copy.dispose();
    }
    this.morphs.clear();
    for (const [v, rest] of this.volumeRest) {
      v.scale.copy(rest.scale);
      v.position.copy(rest.position);
    }
    this.volumeRest.clear();
    this.t.shader?.setMould(null);
  }

  dispose(): void {
    for (const m of this.morphs.values()) m.copy.dispose();
    this.morphs.clear();
    if (this.wire) {
      this.wire.geometry.dispose();
      (this.wire.material as Line2NodeMaterial).dispose();
      this.wire.removeFromParent();
      this.wire = null;
    }
  }

  private setWire(opacity: number): void {
    const at = this.t.wireAt;
    if (opacity <= 0.001 || !at) {
      if (this.wire) this.wire.visible = false;
      return;
    }
    if (!this.wire) {
      // Every triangle edge as a line (WireframeGeometry): the mock-up's `wireframe: true` mesh.
      const mat = new Line2NodeMaterial({
        color: new Color().setRGB(...WIRE_RGB, SRGBColorSpace),
        linewidth: WIRE_WIDTH_PX,
        transparent: true,
        depthWrite: false,
      });
      const ico = new IcosahedronGeometry(WIRE_RADIUS, WIRE_DETAIL);
      this.wire = new Wireframe(new WireframeGeometry2(ico), mat);
      ico.dispose();
      this.wire.name = 'mould-wire';
      this.t.group.add(this.wire);
    }
    this.wire.visible = true;
    this.wire.position.set(...at.position);
    this.wire.scale.setScalar(at.radius);
    (this.wire.material as Line2NodeMaterial).opacity = opacity;
  }

  /** CPU morph of one shape-model mesh: sphere (mean radius about the centre) to real, by `p`. */
  private morph(mesh: Mesh, p: number): void {
    const geom = mesh.geometry as BufferGeometry;
    let m = this.morphs.get(mesh);
    if (p >= 1) {
      if (m) {
        if (mesh.geometry === m.copy) mesh.geometry = m.original;
        m.copy.dispose();
        this.morphs.delete(mesh);
      }
      return;
    }
    if (!m) {
      const pos = geom.getAttribute('position');
      if (!pos || !(pos instanceof BufferAttribute)) return;
      const real = Float32Array.from(pos.array as ArrayLike<number>);
      geom.computeBoundingSphere();
      const c = geom.boundingSphere?.center ?? new Vector3();
      const n = real.length / 3;
      let mean = 0;
      for (let i = 0; i < n; i++)
        mean += Math.hypot(real[i * 3]! - c.x, real[i * 3 + 1]! - c.y, real[i * 3 + 2]! - c.z);
      mean = n > 0 ? mean / n : 1;
      const sphere = new Float32Array(real.length);
      for (let i = 0; i < n; i++) {
        const x = real[i * 3]! - c.x;
        const y = real[i * 3 + 1]! - c.y;
        const z = real[i * 3 + 2]! - c.z;
        const l = Math.hypot(x, y, z) || 1;
        sphere[i * 3] = c.x + (x / l) * mean;
        sphere[i * 3 + 1] = c.y + (y / l) * mean;
        sphere[i * 3 + 2] = c.z + (z / l) * mean;
      }
      const copy = geom.clone();
      m = { original: geom, copy, sphere, real, last: -1, shadedAt: -Infinity };
      this.morphs.set(mesh, m);
      mesh.geometry = copy;
    }
    if (m.last === p) return;
    m.last = p;
    const attr = m.copy.getAttribute('position') as BufferAttribute;
    const out = attr.array as Float32Array;
    for (let i = 0; i < out.length; i++) out[i] = m.sphere[i]! + (m.real[i]! - m.sphere[i]!) * p;
    attr.needsUpdate = true;
    const now = performance.now();
    if (now - m.shadedAt >= MORPH_SHADE_INTERVAL_MS) {
      m.shadedAt = now;
      m.copy.computeVertexNormals();
      m.copy.computeBoundingSphere();
    }
  }
}
