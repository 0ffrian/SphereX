// Issue #62, R7.5: the flared, lit T Tauri disc. Geometry and plan values (no GPU needed).
import { describe, expect, it } from 'vitest';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { defaultContext, planRender } from '../renderPlan';
import { fixture } from './fixtures.testutil';
import { TTAURI_DISC } from './Star';
import { buildTTauriDisc, discHalfHeight, DISC_SEGMENTS, flaredDiscGeometry } from './ttauriDisc';
import { meanLuma } from './textureMean';

const disc = { id: 'disc', ...TTAURI_DISC };

describe('flared disc geometry', () => {
  it('flares: the half-thickness grows with radius, from the plan value at the inner edge', () => {
    expect(discHalfHeight(disc, disc.innerRadius)).toBeCloseTo(disc.heightAtInner, 12);
    const mid = (disc.innerRadius + disc.outerRadius) / 2;
    expect(discHalfHeight(disc, mid)).toBeGreaterThan(disc.heightAtInner);
    expect(discHalfHeight(disc, disc.outerRadius)).toBeGreaterThan(discHalfHeight(disc, mid));
    // Slight: still a thin disc at the outer edge (under a fifth of the radius).
    expect(discHalfHeight(disc, disc.outerRadius) / disc.outerRadius).toBeLessThan(0.2);
  });

  it('has a top and bottom surface and walls, inside the radii, and is deterministic', () => {
    const g = flaredDiscGeometry(disc);
    const p = g.getAttribute('position');
    expect(g.getAttribute('normal').count).toBe(p.count);
    const { around, radial, thickness } = DISC_SEGMENTS;
    expect(p.count).toBe(2 * (radial + 1) * (around + 1) + 2 * (thickness + 1) * (around + 1));
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      expect(r).toBeGreaterThan(disc.innerRadius - 1e-6);
      expect(r).toBeLessThan(disc.outerRadius + 1e-6);
      zMin = Math.min(zMin, p.getZ(i));
      zMax = Math.max(zMax, p.getZ(i));
      // Every vertex is within the flared half-thickness at its radius.
      expect(Math.abs(p.getZ(i))).toBeLessThanOrEqual(discHalfHeight(disc, r) + 1e-6);
    }
    expect(zMax).toBeCloseTo(discHalfHeight(disc, disc.outerRadius), 5);
    expect(zMin).toBeCloseTo(-zMax, 5);
    const again = flaredDiscGeometry(disc).getAttribute('position').array;
    expect(Array.from(again)).toEqual(Array.from(p.array));
    g.dispose();
  });

  it('normals point away from the midplane on the surfaces and toward the axis on the inner wall', () => {
    const g = flaredDiscGeometry(disc);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const { around, radial } = DISC_SEGMENTS;
    const topMid = (radial / 2) * (around + 1);
    expect(n.getZ(topMid)).toBeGreaterThan(0.5);
    const bottomMid = (radial + 1) * (around + 1) + topMid;
    expect(n.getZ(bottomMid)).toBeLessThan(-0.5);
    // Inner wall, at angle 0, mid-height: the normal points to -x (toward the axis).
    const innerWall = 2 * (radial + 1) * (around + 1);
    const mid = innerWall + (DISC_SEGMENTS.thickness / 2) * (around + 1);
    expect(p.getX(mid)).toBeCloseTo(disc.innerRadius, 5);
    expect(n.getX(mid)).toBeLessThan(-0.5);
    g.dispose();
  });
});

describe('flared disc mesh', () => {
  it('is tilted by the plan, blended, depth-tested and writes no depth (near half in front, far half behind the star)', () => {
    const mesh = buildTTauriDisc(disc);
    expect(mesh.rotation.x).toBeCloseTo((TTAURI_DISC.inclinationDeg * Math.PI) / 180, 12);
    const m = mesh.material as MeshBasicNodeMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.colorNode).toBeTruthy();
    expect(m.opacityNode).toBeTruthy();
    mesh.geometry.dispose();
    m.dispose();
  });
});

describe('T Tauri plan', () => {
  it('keeps the 45 to 60 degree tilt and the artistic disc layer; the flaring is in the plan', () => {
    expect(TTAURI_DISC.inclinationDeg).toBeGreaterThanOrEqual(45);
    expect(TTAURI_DISC.inclinationDeg).toBeLessThanOrEqual(60);
    const { card, params } = fixture('star_ttauri');
    const plan = planRender(card, params, defaultContext({ honesty: 'artistic' }));
    expect(plan.discs[0]).toMatchObject({
      heightAtInner: TTAURI_DISC.heightAtInner,
      flareExponent: TTAURI_DISC.flareExponent,
    });
    expect(plan.drawn.find((d) => d.id === 'disc')).toMatchObject({ tag: 'artistic', tier: 5 });
    // Hidden below + Artistic, as before.
    expect(planRender(card, params, defaultContext()).discs).toEqual([]);
  });
});

describe('meanLuma', () => {
  it('answers null where no canvas can read the image, never a guess', () => {
    expect(meanLuma(null)).toBeNull();
    expect(meanLuma({})).toBeNull();
  });
});
