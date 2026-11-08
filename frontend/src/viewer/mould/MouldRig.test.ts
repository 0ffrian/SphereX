// Issue #60: the rig poses a built scene for the build animation and undoes it exactly, so the
// frame after a build is the normal render (same geometry objects, same arrays, same transforms).
import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
} from 'three/webgpu';
import { MORPH_SHADE_INTERVAL_MS, MouldRig } from './MouldRig';
import { NORMAL_POSE, type MouldPose } from './mouldSteps';

function scene() {
  const group = new Group();
  const sphere = new Mesh(new SphereGeometry(1, 8, 6), new MeshBasicNodeMaterial());
  sphere.scale.set(1, 0.6, 0.6);
  const holder = new Group();
  const model = new Mesh(new BoxGeometry(2, 1, 1, 4, 2, 2), new MeshBasicNodeMaterial());
  holder.add(model);
  const volume = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial());
  volume.scale.set(2, 1, 1);
  volume.position.set(3, 0, 0);
  group.add(sphere, holder, volume);
  const knobs: unknown[] = [];
  const rig = new MouldRig({
    group,
    spheres: [{ mesh: sphere, axes: [1, 0.6, 0.6] }],
    holders: [() => holder],
    volumes: [volume],
    wireAt: { position: [0, 0, 0], radius: 1 },
    shader: { setMould: (k) => knobs.push(k) },
  });
  return { group, sphere, model, volume, rig, knobs };
}

const mid: MouldPose = {
  scale: 0.7,
  wire: 0.5,
  shape: 0.25,
  grow: 0.5,
  terrain: 0.1,
  sea: 0,
  colour: 0,
  clouds: 0,
};

describe('MouldRig', () => {
  it('poses the scene mid-build', () => {
    const { group, sphere, model, volume, rig, knobs } = scene();
    const original = model.geometry;
    rig.apply(mid);
    expect(group.scale.x).toBeCloseTo(0.7);
    expect(sphere.scale.y).toBeCloseTo(1 - 0.4 * 0.25);
    expect(model.geometry).not.toBe(original); // a private copy is morphed
    expect(volume.scale.x).toBeCloseTo(1);
    expect(volume.position.x).toBeCloseTo(1.5);
    expect(group.getObjectByName('mould-wire')?.visible).toBe(true);
    expect(knobs.at(-1)).toEqual({ terrain: 0.1, sea: 0, colour: 0, clouds: 0 });
  });

  it('restores exactly what was built (null pose or the normal pose)', () => {
    for (const end of [null, NORMAL_POSE]) {
      const { group, sphere, model, volume, rig, knobs } = scene();
      const original = model.geometry;
      const before = Float32Array.from(original.getAttribute('position').array);
      rig.apply(mid);
      rig.apply(end);
      if (end) rig.apply(null);
      expect(group.scale.toArray()).toEqual([1, 1, 1]);
      expect(sphere.scale.toArray()).toEqual([1, 0.6, 0.6]);
      expect(model.geometry).toBe(original);
      expect(Array.from(original.getAttribute('position').array)).toEqual(Array.from(before));
      expect(volume.scale.toArray()).toEqual([2, 1, 1]);
      expect(volume.position.toArray()).toEqual([3, 0, 0]);
      expect(group.getObjectByName('mould-wire')?.visible ?? false).toBe(false);
      expect(knobs.at(-1)).toBeNull();
    }
  });

  it('moves the vertices every frame but recomputes normals at about 20 Hz', () => {
    const { model, rig } = scene();
    const normals = vi.spyOn(BufferGeometry.prototype, 'computeVertexNormals');
    let t = 1000;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => t);
    const first = Float32Array.from(model.geometry.getAttribute('position').array);
    rig.apply({ ...mid, shape: 0.2 });
    const a = Float32Array.from(model.geometry.getAttribute('position').array);
    t += 16;
    rig.apply({ ...mid, shape: 0.3 });
    const b = Float32Array.from(model.geometry.getAttribute('position').array);
    expect(normals).toHaveBeenCalledTimes(1); // the second frame is inside the interval
    expect(Array.from(b)).not.toEqual(Array.from(a)); // positions did move
    expect(Array.from(a)).not.toEqual(Array.from(first));
    t += MORPH_SHADE_INTERVAL_MS;
    rig.apply({ ...mid, shape: 0.4 });
    expect(normals).toHaveBeenCalledTimes(2);
    now.mockRestore();
    normals.mockRestore();
  });
});
