// Issue #43, R7.1: bakes per-vertex ambient occlusion into a model's geometry (`ao` attribute,
// 0..1) with a BVH ray test. Deterministic (fixed Fibonacci directions, no random numbers), runs
// in slices so the main thread keeps drawing (the body is lit without AO until it finishes).
// Tag: `derived` (formula: cosine-weighted hemisphere visibility of the measured shape).
import { BufferAttribute, DoubleSide, Ray, Vector3, type BufferGeometry } from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
import { aoVisibility, hemisphereDirections, type Vec3 } from './shapeModel';

export const AO_FORMULA =
  'AO = fraction of cosine-weighted hemisphere rays that leave the shape without a hit, within 0.25 of its radius';

/** Rays only count if they hit within this fraction of the bounding radius. */
const AO_REACH = 0.25;
/** Vertices per slice before yielding to the browser. */
const SLICE = 600;

const yieldToBrowser = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Adds `ao` to `geometry` (a Float32 attribute, one value per vertex). Returns false if the
 * geometry cannot be baked (no position) or `isCancelled()` turned true; the geometry is then left
 * without the attribute. Existing `ao` is kept (the model is cached and shared between scenes).
 */
export async function bakeVertexAo(
  geometry: BufferGeometry,
  rays: number,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  if (geometry.getAttribute('ao')) return true;
  const pos = geometry.getAttribute('position');
  if (!pos || rays <= 0) return false;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const nor = geometry.getAttribute('normal')!;
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 0;
  if (!(radius > 0)) return false;

  const bvh = new MeshBVH(geometry);
  const dirs = hemisphereDirections(rays);
  const far = radius * AO_REACH;
  const eps = radius * 1e-3;
  const ray = new Ray();
  const origin = new Vector3();
  const out = new Float32Array(pos.count);
  for (let start = 0; start < pos.count; start += SLICE) {
    const end = Math.min(pos.count, start + SLICE);
    for (let i = start; i < end; i++) {
      const n: Vec3 = [nor.getX(i), nor.getY(i), nor.getZ(i)];
      origin.set(pos.getX(i) + n[0] * eps, pos.getY(i) + n[1] * eps, pos.getZ(i) + n[2] * eps);
      out[i] = aoVisibility(n, dirs, (d) => {
        ray.origin.copy(origin);
        ray.direction.set(d[0], d[1], d[2]);
        return bvh.raycastFirst(ray, DoubleSide, 0, far) !== null;
      });
    }
    await yieldToBrowser();
    if (isCancelled()) return false;
  }
  geometry.setAttribute('ao', new BufferAttribute(out, 1));
  return true;
}
