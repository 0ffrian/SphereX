// Issue #42, R7.5.5: prominence loops along dipole field lines between a region's leader and
// follower spots. The strands are built once per region in the region's LOCAL frame
// (`loopStrands`, bodies/starModel.ts) and bent onto the sphere in the vertex shader from four
// uniforms (the region's centre, its two tangents and its size), so a region that moves, grows or
// is replaced only changes uniforms: no geometry is rebuilt per frame. A flare lifts the arch
// (`rise`) and fades it. Alpha-blended (additive strands wash a bright disc to white); a flare
// raises the strand colour above 1 so a flaring loop still blooms. Colours are artistic.
import {
  BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  MeshBasicNodeMaterial,
  TubeGeometry,
  Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, mix, normalize, positionGeometry, smoothstep, uniform, vec3 } from 'three/tsl';
import { LOOP_RISE_GAIN, loopApexHeight, loopStrands, type V3 } from '../bodies/starModel';

/** Tube radius in local units (half the leader-follower separation = 1): thick enough to see. */
const STRAND_RADIUS = 0.05;
const PLAIN_RADIUS = 0.11;
/** Colour of hot plasma (artistic), above 1 so a flaring loop passes the bloom threshold. */
const LOOP_COLOUR = [1.0, 0.36, 0.12] as const;

/** The merged tube geometry of one region's loop bundle, in the local frame. Deterministic. */
export function buildLoopGeometry(seed: number, region: number, strands: number): BufferGeometry {
  const geos: BufferGeometry[] = [];
  const radius = strands === 1 ? PLAIN_RADIUS : STRAND_RADIUS;
  for (const s of loopStrands(seed, region, strands)) {
    const curve = new CatmullRomCurve3(s.points.map((p: V3) => new Vector3(p[0], p[1], p[2])));
    const tube = new TubeGeometry(curve, 36, radius, 4, false);
    // Merging needs the same attributes everywhere; only position is used.
    tube.deleteAttribute('uv');
    tube.deleteAttribute('normal');
    geos.push(tube);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

export interface LoopFrame {
  center: V3;
  axis: V3;
  north: V3;
  /** Angular radius of the group (the loop spans 1.1 times 0.55 of it each side). */
  size: number;
  /** 0..1: how far a flare has lifted the arch. */
  rise: number;
  /** 0..1: how visible the loop is (the group's life envelope; 0 hides it). */
  opacity: number;
  /** Sideways sway, small, from a slow phase (artistic). */
  sway: number;
  /** Brightness multiplier (1 quiet, above 1 while flaring). */
  glow: number;
}

export interface LoopMesh {
  mesh: Mesh;
  update(f: LoopFrame): void;
  dispose(): void;
}

export function buildLoopMesh(seed: number, region: number, strands: number): LoopMesh {
  const geometry = buildLoopGeometry(seed, region, strands);
  const uC = uniform(new Vector3(0, 1, 0));
  const uA = uniform(new Vector3(1, 0, 0));
  const uN = uniform(new Vector3(0, 0, 1));
  const uP = uniform(new Vector3(0.1, 0, 0)); // halfSepRad, rise, sway
  const uO = uniform(new Vector3(0, 1, 0)); // opacity, glow

  const lp = positionGeometry;
  const apex = loopApexHeight();
  const halfSep = uP.x;
  const sway = uP.z;
  const lift = float(1).add(uP.y.mul(LOOP_RISE_GAIN));
  const lx = lp.x;
  const ly = lp.y.add(sway.mul(lp.z.max(0)).mul(0.25));
  const dir = normalize(uC.add(uA.mul(lx.mul(halfSep))).add(uN.mul(ly.mul(halfSep))));
  const material = new MeshBasicNodeMaterial();
  material.positionNode = dir.mul(float(1).add(lp.z.mul(halfSep).mul(lift)));
  // Brighter towards the apex, where the strands are thickest in the picture.
  const height = smoothstep(0, apex, lp.z);
  material.colorNode = vec3(LOOP_COLOUR[0], LOOP_COLOUR[1], LOOP_COLOUR[2]).mul(
    mix(float(0.7), float(1.3), height).mul(uO.y),
  );
  // Many strands overlap and add up, so each is faint; one plain arch is stronger.
  material.opacityNode = uO.x.mul(strands === 1 ? 0.85 : 0.55);
  material.transparent = true;
  material.depthWrite = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false; // the vertex shader moves every vertex
  mesh.renderOrder = 3;

  return {
    mesh,
    update(f) {
      uC.value.set(f.center[0], f.center[1], f.center[2]);
      uA.value.set(f.axis[0], f.axis[1], f.axis[2]);
      uN.value.set(f.north[0], f.north[1], f.north[2]);
      uP.value.set(1.1 * 0.55 * f.size, f.rise, f.sway);
      uO.value.set(f.opacity, f.glow, 0);
      mesh.visible = f.opacity > 0.01;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
