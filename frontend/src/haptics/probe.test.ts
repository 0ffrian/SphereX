import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { directionToUV } from '@/viewer/fields/fieldGenerator';
import { intersectEllipsoid, panFromX, pointerRay, TouchProbe } from './probe';
import { createTouchSample, type Vec3 } from './sources/types';

const RECT = { left: 100, top: 50, width: 400, height: 300 };

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, RECT.width / RECT.height, 0.1, 100);
  cam.position.set(0.3, 0.2, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('pointer → ray', () => {
  it('matches three.js Raycaster.setFromCamera', () => {
    const cam = camera();
    const o: Vec3 = [0, 0, 0];
    const d: Vec3 = [0, 0, 0];
    for (const [x, y] of [
      [300, 200],
      [120, 60],
      [480, 330],
    ] as const) {
      pointerRay(x, y, RECT, cam, o, d);
      const rc = new Raycaster();
      rc.setFromCamera(
        new Vector2(
          ((x - RECT.left) / RECT.width) * 2 - 1,
          -(((y - RECT.top) / RECT.height) * 2 - 1),
        ),
        cam,
      );
      expect(o[0]).toBeCloseTo(rc.ray.origin.x, 6);
      expect(o[2]).toBeCloseTo(rc.ray.origin.z, 6);
      expect(d[0]).toBeCloseTo(rc.ray.direction.x, 6);
      expect(d[1]).toBeCloseTo(rc.ray.direction.y, 6);
      expect(d[2]).toBeCloseTo(rc.ray.direction.z, 6);
    }
  });

  it('pan follows the finger from left (−1) to right (1)', () => {
    expect(panFromX(100, RECT)).toBe(-1);
    expect(panFromX(300, RECT)).toBe(0);
    expect(panFromX(500, RECT)).toBe(1);
    expect(panFromX(900, RECT)).toBe(1);
  });
});

describe('analytic intersection (R8.4 item 1)', () => {
  it('meets a sphere and an ellipsoid at the nearest side', () => {
    expect(intersectEllipsoid([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])).toBeCloseTo(4);
    expect(intersectEllipsoid([0, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 0.5])).toBeCloseTo(4.5);
    expect(intersectEllipsoid([2, 0, 5], [0, 0, -1], [0, 0, 0], [1, 1, 1])).toBeNaN();
    // From inside: the far side.
    expect(intersectEllipsoid([0, 0, 0], [0, 0, -1], [0, 0, 0], [1, 1, 1])).toBeCloseTo(1);
  });

  it('fills the hit body, its unit-sphere direction, UV, normal and pan', () => {
    const probe = new TouchProbe({
      bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }],
    });
    const s = createTouchSample();
    probe.fromWorldRay([0.3, 0.4, 5], [0, 0, -1], 10, 20, 0.25, 1234, s);
    expect(s.bodyId).toBe('body');
    const z = Math.sqrt(1 - 0.09 - 0.16);
    expect(s.dir[0]).toBeCloseTo(0.3);
    expect(s.dir[1]).toBeCloseTo(0.4);
    expect(s.dir[2]).toBeCloseTo(z);
    const uv = directionToUV(s.dir);
    expect(s.u).toBeCloseTo(uv.u);
    expect(s.v).toBeCloseTo(uv.v);
    expect(s.normal[2]).toBeCloseTo(z);
    expect(s).toMatchObject({ xPx: 10, yPx: 20, pan: 0.25, timeMs: 1234 });
    expect(s.centreDistance).toBeCloseTo(0.5);
    probe.fromWorldRay([3, 0, 5], [0, 0, -1], 0, 0, 0, 0, s);
    expect(s.bodyId).toBeNull();
    expect(s.centreDistance).toBeCloseTo(3);
  });

  it('wraps the texture on the unit sphere of an ellipsoid', () => {
    const probe = new TouchProbe({
      bodies: [{ id: 'body', position: [0, 0, 0], axes: [2, 1, 1] }],
    });
    const s = createTouchSample();
    probe.fromWorldRay([1, 0, 5], [0, 0, -1], 0, 0, 0, 0, s);
    // x = 1 on an a = 2 ellipsoid is x = 0.5 on the unit sphere.
    expect(s.dir[0]).toBeCloseTo(0.5);
    // The ellipsoid normal leans less towards x than the sphere point does.
    expect(s.normal[0]).toBeLessThan(s.dir[0]);
  });

  it('picks the nearest of several bodies (binary)', () => {
    const probe = new TouchProbe({
      bodies: [
        { id: 'body_a', position: [-0.8, 0, 0], axes: [0.5, 0.5, 0.5] },
        { id: 'body_b', position: [0.8, 0, 0], axes: [0.5, 0.5, 0.5] },
      ],
    });
    const s = createTouchSample();
    expect(probe.fromWorldRay([0.8, 0, 5], [0, 0, -1], 0, 0, 0, 0, s).bodyId).toBe('body_b');
    expect(probe.fromWorldRay([-0.8, 0.1, 5], [0, 0, -1], 0, 0, 0, 0, s).bodyId).toBe('body_a');
    expect(probe.fromWorldRay([0, 0, 5], [0, 0, -1], 0, 0, 0, 0, s).bodyId).toBeNull();
  });

  it('gives the ring radius in front of the planet only, in the body frame', () => {
    // Body frame: the ring plane is y = 0. A tilted view from above.
    const probe = new TouchProbe({
      bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }],
      rings: true,
    });
    const s = createTouchSample();
    const d: Vec3 = [0, -Math.sin(0.4), -Math.cos(0.4)];
    // Aim at a ring point at radius 2 in front of the planet.
    const target: Vec3 = [0, 0, 2];
    const o: Vec3 = [target[0] - 6 * d[0], target[1] - 6 * d[1], target[2] - 6 * d[2]];
    probe.fromWorldRay(o, d, 0, 0, 0, 0, s);
    expect(s.ringRadius).toBeCloseTo(2);
    // Behind the planet: the planet is hit first, so no ring.
    const back: Vec3 = [0, 0, -1.2];
    const o2: Vec3 = [back[0] - 6 * d[0], back[1] - 6 * d[1], back[2] - 6 * d[2]];
    probe.fromWorldRay(o2, d, 0, 0, 0, 0, s);
    expect(s.bodyId).toBe('body');
    expect(s.ringRadius).toBeNaN();
  });

  it('uses the body transform (worldToBody) for shader bodies', () => {
    // A body scaled ×2 and moved +3 in x: world → body divides it out.
    const toBody = (p: readonly [number, number, number]) =>
      [(p[0] - 3) / 2, p[1] / 2, p[2] / 2] as const;
    const probe = new TouchProbe({
      bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }],
      toBody,
    });
    const s = createTouchSample();
    probe.fromWorldRay([4, 0, 10], [0, 0, -1], 0, 0, 0, 0, s);
    expect(s.bodyId).toBe('body');
    expect(s.dir[0]).toBeCloseTo(0.5);
    probe.fromWorldRay([0, 0, 10], [0, 0, -1], 0, 0, 0, 0, s);
    expect(s.bodyId).toBeNull();
  });

  it('fromPointer combines ray, hit and pan', () => {
    const cam = new PerspectiveCamera(45, RECT.width / RECT.height, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const probe = new TouchProbe({
      bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }],
    });
    const s = createTouchSample();
    probe.fromPointer(300, 200, RECT, cam, 7, s);
    expect(s.bodyId).toBe('body');
    expect(s.dir[2]).toBeCloseTo(1);
    expect(s.pan).toBe(0);
    probe.fromPointer(101, 51, RECT, cam, 8, s);
    expect(s.bodyId).toBeNull();
  });
});
