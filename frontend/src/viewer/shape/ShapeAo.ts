// Issue #43, R7.1: bakes per-vertex ambient occlusion into a model's geometry (`ao` attribute,
// 0..1) with a BVH ray test. Deterministic (fixed Fibonacci directions, no random numbers), runs
// in slices, with the BVH built in a worker, so the main thread keeps drawing (the body is lit without AO until it finishes).
// Tag: `derived` (formula: cosine-weighted hemisphere visibility of the measured shape).
import {
  BufferAttribute,
  BufferGeometry as Geometry,
  DoubleSide,
  Ray,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { MeshBVH } from 'three-mesh-bvh';
import { aoVisibility, hemisphereDirections, type Vec3 } from './shapeModel';

export const AO_FORMULA =
  'AO = fraction of cosine-weighted hemisphere rays that leave the shape without a hit, within 0.25 of its radius';

/** Rays only count if they hit within this fraction of the bounding radius. */
const AO_REACH = 0.25;
/** Vertices per slice before yielding to the browser. */
const SLICE = 600;

/**
 * Builds the BVH off the main thread: a Web Worker (three-mesh-bvh's own) on a private copy of the
 * positions and indices, because the worker takes the buffers it is given and the shown geometry
 * must keep its own. The returned tree refers to the copy, which has the same coordinates. Without
 * Workers (or if the worker fails, or the positions are interleaved) the tree is built on the
 * main thread, as before. The queue keeps one worker busy with one model at a time and ends it
 * when idle.
 */
let queued = 0;
let tail: Promise<unknown> = Promise.resolve();
let sharedWorker: { generate(g: BufferGeometry): Promise<MeshBVH>; dispose(): void } | null = null;

function privateCopy(geometry: BufferGeometry): BufferGeometry | null {
  const pos = geometry.getAttribute('position');
  if (!pos || 'isInterleavedBufferAttribute' in pos) return null;
  const copy = new Geometry();
  copy.setAttribute('position', new BufferAttribute(new Float32Array(pos.array), 3));
  const index = geometry.getIndex();
  if (index) {
    if ('isInterleavedBufferAttribute' in index) return null;
    const Ctor = index.array.constructor as new (a: ArrayLike<number>) => Uint16Array | Uint32Array;
    copy.setIndex(new BufferAttribute(new Ctor(index.array), 1));
  }
  return copy;
}

export async function buildBvh(geometry: BufferGeometry): Promise<MeshBVH> {
  const copy = typeof Worker === 'undefined' ? null : privateCopy(geometry);
  if (!copy) return new MeshBVH(geometry);
  queued++;
  const run = tail.then(async () => {
    try {
      if (!sharedWorker) {
        const { GenerateMeshBVHWorker } = await import('three-mesh-bvh/worker');
        sharedWorker = new GenerateMeshBVHWorker();
      }
      return await sharedWorker.generate(copy);
    } catch {
      sharedWorker?.dispose();
      sharedWorker = null;
      return null;
    }
  });
  tail = run.catch(() => undefined);
  const bvh = await run;
  if (--queued === 0) {
    sharedWorker?.dispose();
    sharedWorker = null;
  }
  return bvh ?? new MeshBVH(geometry);
}

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

  const bvh = await buildBvh(geometry);
  if (isCancelled()) return false;
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
