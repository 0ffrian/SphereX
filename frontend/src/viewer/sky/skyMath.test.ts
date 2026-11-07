// Sky view maths: RA/Dec <-> direction, the orientation seen from inside (north up, east LEFT),
// pointer <-> RA/Dec round trips, agreement with a real r187 PerspectiveCamera, the sphere's UVs
// against the equirect convention, and the click-versus-drag rule.
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createSkyGeometry } from './SkyView';
import {
  cameraBasis,
  cameraEuler,
  CLICK_SLOP_PX,
  deltaRa,
  isClick,
  panByFraction,
  panByPixels,
  pickQuery,
  raDecToScreen,
  raDecToWorld,
  screenToRaDec,
  separationDeg,
  SKY_FOV_MAX_DEG,
  SKY_FOV_MIN_DEG,
  worldToRaDec,
  wrapRa,
  zoomAt,
  type SkyCamera,
} from './skyMath';

const W = 1200;
const H = 800;

const VIEWS: SkyCamera[] = [
  { ra: 0, dec: 0, fovDeg: 60 },
  { ra: 266.4, dec: -28.9, fovDeg: 60 },
  { ra: 83.8, dec: 22.0, fovDeg: 10 },
  { ra: 359.5, dec: 45, fovDeg: 2 },
  { ra: 120, dec: 80, fovDeg: 90 },
  { ra: 200, dec: -85, fovDeg: 120 },
];

describe('directions', () => {
  it('RA/Dec -> world -> RA/Dec round-trips', () => {
    for (const [ra, dec] of [
      [0, 0],
      [90, 30],
      [180, -45],
      [270, 60],
      [359.9, -89],
      [12.345, 67.89],
    ] as const) {
      const back = worldToRaDec(raDecToWorld(ra, dec));
      expect(back.ra).toBeCloseTo(ra, 9);
      expect(back.dec).toBeCloseTo(dec, 9);
    }
  });

  it('north is world +Y and RA 0 is world +X (a proper rotation of ICRS)', () => {
    const n = raDecToWorld(0, 90);
    expect(n.y).toBeCloseTo(1, 12);
    const x = raDecToWorld(0, 0);
    expect([x.x, x.y, x.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, -0]);
    // ICRS +Y (RA 90) is world −Z.
    expect(raDecToWorld(90, 0).z).toBeCloseTo(-1, 12);
    // Right-handed: (RA 0) × (RA 90) = north.
    const a = raDecToWorld(0, 0);
    const b = raDecToWorld(90, 0);
    const c = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    expect(c.y).toBeCloseTo(1, 12);
  });

  it('wraps and differences RA', () => {
    expect(wrapRa(-10)).toBe(350);
    expect(wrapRa(360)).toBe(0);
    expect(wrapRa(725)).toBe(5);
    expect(deltaRa(1, 359)).toBe(2);
    expect(deltaRa(359, 1)).toBe(-2);
  });
});

describe('orientation seen from inside: north up, east (higher RA) LEFT', () => {
  for (const cam of VIEWS) {
    it(`view RA ${cam.ra}, Dec ${cam.dec}, FOV ${cam.fovDeg}`, () => {
      const c = screenToRaDec(cam, W / 2, H / 2, W, H);
      expect(separationDeg(c.ra, c.dec, cam.ra, cam.dec)).toBeLessThan(1e-9);
      const d = Math.min(W, H) * 0.05;
      const left = screenToRaDec(cam, W / 2 - d, H / 2, W, H);
      const right = screenToRaDec(cam, W / 2 + d, H / 2, W, H);
      const up = screenToRaDec(cam, W / 2, H / 2 - d, W, H);
      const down = screenToRaDec(cam, W / 2, H / 2 + d, W, H);
      // The mirror: on the real sky, east is to the left when north is up.
      expect(deltaRa(left.ra, cam.ra)).toBeGreaterThan(0);
      expect(deltaRa(right.ra, cam.ra)).toBeLessThan(0);
      // Above the centre is further north (towards Dec +90, through the pole if close to it).
      const north = (p: { ra: number; dec: number }) => separationDeg(p.ra, p.dec, 0, 90);
      expect(north(up)).toBeLessThan(north(c));
      expect(north(down)).toBeGreaterThan(north(c));
    });
  }
});

describe('pointer <-> RA/Dec', () => {
  it('raDecToScreen inverts screenToRaDec', () => {
    for (const cam of VIEWS) {
      for (const [px, py] of [
        [10, 10],
        [W / 2, H / 2],
        [W - 20, H / 3],
        [W / 3, H - 5],
      ] as const) {
        const p = screenToRaDec(cam, px, py, W, H);
        const s = raDecToScreen(cam, p.ra, p.dec, W, H);
        expect(s.inFront).toBe(true);
        expect(s.x).toBeCloseTo(px, 6);
        expect(s.y).toBeCloseTo(py, 6);
      }
    }
  });

  it('a point behind the camera is not in front', () => {
    const cam: SkyCamera = { ra: 10, dec: 0, fovDeg: 60 };
    expect(raDecToScreen(cam, 190, 0, W, H).inFront).toBe(false);
  });

  it('matches a real three r187 PerspectiveCamera with Euler order YXZ', () => {
    for (const cam of VIEWS) {
      const camera = new PerspectiveCamera(cam.fovDeg, W / H, 0.1, 100);
      camera.rotation.order = 'YXZ';
      const { yaw, pitch } = cameraEuler(cam);
      camera.rotation.set(pitch, yaw, 0);
      camera.updateMatrixWorld(true);
      // The basis agrees with three's camera axes.
      const b = cameraBasis(cam);
      const fwd = new Vector3();
      camera.getWorldDirection(fwd);
      expect(fwd.x).toBeCloseTo(b.forward.x, 9);
      expect(fwd.y).toBeCloseTo(b.forward.y, 9);
      expect(fwd.z).toBeCloseTo(b.forward.z, 9);
      // Projection of RA/Dec points agrees with three's.
      for (const [dx, dy] of [
        [0.1, 0.05],
        [-0.2, 0.1],
        [0.05, -0.3],
      ] as const) {
        const p = screenToRaDec(cam, W * (0.5 + dx), H * (0.5 + dy), W, H);
        const v = raDecToWorld(p.ra, p.dec);
        const ndc = new Vector3(v.x, v.y, v.z).multiplyScalar(10).project(camera);
        expect(((ndc.x + 1) / 2) * W).toBeCloseTo(W * (0.5 + dx), 4);
        expect(((1 - ndc.y) / 2) * H).toBeCloseTo(H * (0.5 + dy), 4);
      }
    }
  });
});

describe('sky sphere UVs follow the equirect convention', () => {
  // Convention: u = RA/360 (RA 0 at the left edge, increasing to the right) and v = (Dec + 90)/180
  // (north at the top of the image, v = 1 with the texture flipY convention).
  it('every vertex samples the image at its own RA/Dec', () => {
    const g = createSkyGeometry(10, 64, 32);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = worldToRaDec({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
      expect(uv.getY(i)).toBeCloseTo((p.dec + 90) / 180, 5);
      if (Math.abs(p.dec) > 89.9) continue; // RA is undefined at the poles
      const u = (((uv.getX(i) % 1) + 1) % 1) * 360;
      // The sphere's seam vertices (u = ±0.5) sit at RA 180 from both sides.
      expect(Math.abs(deltaRa(u, p.ra))).toBeLessThan(1e-4); // float32 attributes
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    g.dispose();
  });

  it('u is continuous inside each triangle (no seam jump)', () => {
    const g = createSkyGeometry(10, 32, 16);
    const uv = g.getAttribute('uv');
    const index = g.getIndex()!;
    for (let t = 0; t < index.count; t += 3) {
      const us = [0, 1, 2].map((k) => uv.getX(index.getX(t + k)));
      expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.1);
    }
    g.dispose();
  });
});

describe('interaction', () => {
  it('drag right brings the east side (higher RA) to the centre; drag down brings the north', () => {
    const cam: SkyCamera = { ra: 100, dec: 10, fovDeg: 40 };
    const right = panByPixels(cam, 50, 0, H);
    expect(deltaRa(right.ra, cam.ra)).toBeGreaterThan(0);
    expect(right.dec).toBe(cam.dec);
    const down = panByPixels(cam, 0, 50, H);
    expect(down.dec).toBeGreaterThan(cam.dec);
  });

  it('a drag keeps the grabbed point under the pointer near the equator', () => {
    const cam: SkyCamera = { ra: 100, dec: 0, fovDeg: 20 };
    const grabbed = screenToRaDec(cam, W / 2, H / 2, W, H);
    const moved = panByPixels(cam, 40, 0, H);
    const after = screenToRaDec(moved, W / 2 + 40, H / 2, W, H);
    expect(separationDeg(after.ra, after.dec, grabbed.ra, grabbed.dec)).toBeLessThan(0.05);
  });

  it('keyboard pan: left looks east (higher RA), up looks north; the pole is clamped', () => {
    const cam: SkyCamera = { ra: 100, dec: 0, fovDeg: 40 };
    expect(deltaRa(panByFraction(cam, 0.1, 0).ra, cam.ra)).toBeCloseTo(4, 9);
    expect(panByFraction(cam, 0, 0.1).dec).toBeCloseTo(4, 9);
    let c = cam;
    for (let i = 0; i < 100; i++) c = panByFraction(c, 0, 0.1);
    expect(c.dec).toBeLessThan(90);
  });

  it('zoom is clamped to 2°…120° and keeps the point under the pointer', () => {
    const cam: SkyCamera = { ra: 50, dec: 20, fovDeg: 60 };
    let c = cam;
    for (let i = 0; i < 50; i++) c = zoomAt(c, 0.8, W, H);
    expect(c.fovDeg).toBe(SKY_FOV_MIN_DEG);
    for (let i = 0; i < 50; i++) c = zoomAt(c, 1.25, W, H);
    expect(c.fovDeg).toBe(SKY_FOV_MAX_DEG);

    const px = W * 0.8;
    const py = H * 0.3;
    const before = screenToRaDec(cam, px, py, W, H);
    const z = zoomAt(cam, 0.5, W, H, px, py);
    const after = screenToRaDec(z, px, py, W, H);
    expect(separationDeg(before.ra, before.dec, after.ra, after.dec)).toBeLessThan(0.5);
  });

  it('click versus drag: under 5 px is a click', () => {
    expect(CLICK_SLOP_PX).toBe(5);
    expect(isClick(0)).toBe(true);
    expect(isClick(4.9)).toBe(true);
    expect(isClick(5)).toBe(false);
    expect(isClick(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('pick query: "ra,dec" with 6 decimals, RA wrapped, as parseQuery accepts', () => {
    expect(pickQuery(76.9565301, 30.40144)).toBe('76.956530,30.401440');
    expect(pickQuery(359.99999999, -4.5)).toBe('0.000000,-4.500000');
    expect(pickQuery(-1, 90.0000001)).toBe('359.000000,90.000000');
  });
});
