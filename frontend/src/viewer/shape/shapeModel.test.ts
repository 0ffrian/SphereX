// Issue #43: shape-model logic (LOD choice, resolution, Lommel-Seeliger, AO sampling, shadows).
import { Float32BufferAttribute, BufferGeometry } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { bakeVertexAo } from './ShapeAo';
import {
  aoRayCount,
  aoVisibility,
  chooseLod,
  hemisphereDirections,
  LOD1_MAX_SCREEN_PX,
  lodUrls,
  lommelSeeliger,
  meanEdgeLength,
  regolithMinFrequency,
  shadowSettings,
  SHAPE_TRIANGLE_BUDGET,
  unitScale,
  type Vec3,
} from './shapeModel';

describe('level of detail', () => {
  it('derives the backend coarse file from the full-detail path', () => {
    expect(lodUrls('/data/shapes/eros-gaskell.glb')).toEqual({
      lod0: '/data/shapes/eros-gaskell.glb',
      lod1: '/data/shapes/eros-gaskell.lod1.glb',
    });
    expect(lodUrls('./m.GLTF?v=2').lod1).toBe('./m.lod1.GLTF?v=2');
  });

  it('has no coarse level for an .obj, and keeps a path that already is the coarse one', () => {
    expect(lodUrls('/data/shapes/x.obj')).toEqual({ lod0: '/data/shapes/x.obj', lod1: null });
    const coarse = '/data/shapes/x.lod1.glb';
    expect(lodUrls(coarse)).toEqual({ lod0: coarse, lod1: coarse });
  });

  it('low quality takes the coarse model; the others take full detail', () => {
    expect(chooseLod('low', null, true)).toBe(1);
    expect(chooseLod('medium', null, true)).toBe(0);
    expect(chooseLod('high', null, true)).toBe(0);
  });

  it('a small body on screen takes the coarse model at any level', () => {
    expect(chooseLod('high', LOD1_MAX_SCREEN_PX - 1, true)).toBe(1);
    expect(chooseLod('high', LOD1_MAX_SCREEN_PX, true)).toBe(0);
    expect(chooseLod('high', 0, true)).toBe(0);
  });

  it('falls back to full detail when there is no coarse file', () => {
    expect(chooseLod('low', null, false)).toBe(0);
  });

  it('the registry triangle counts (49,152 and 12,288) fit the 50k budget', () => {
    expect(49_152).toBeLessThanOrEqual(SHAPE_TRIANGLE_BUDGET);
    expect(12_288).toBeLessThan(49_152);
  });
});

describe('size and resolution', () => {
  it('unitScale turns the bounding radius into 1, and refuses a degenerate model', () => {
    // Eros: the longest extent is 32.658 km, so a bounding radius near 16.3 km (metres in the GLB).
    expect(unitScale(16_329)).toBeCloseTo(1 / 16_329, 15);
    expect(unitScale(0)).toBe(0);
    expect(unitScale(-1)).toBe(0);
    expect(unitScale(NaN)).toBe(0);
  });

  it('mean edge length of an indexed mesh: a unit right tetrahedron', () => {
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const idx = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
    const e = meanEdgeLength(pos, idx)!;
    // Three edges of length 1 and three of sqrt(2), each counted twice.
    expect(e).toBeCloseTo((3 + 3 * Math.SQRT2) / 6, 12);
  });

  it('works on a non-indexed mesh, and is null for an empty or malformed one', () => {
    expect(meanEdgeLength([0, 0, 0, 2, 0, 0, 0, 2, 0], null)).toBeCloseTo(
      (2 + 2 + 2 * Math.SQRT2) / 3,
      12,
    );
    expect(meanEdgeLength([], null)).toBeNull();
    expect(meanEdgeLength([0, 0, 0], [0, 1, 2])).toBeNull();
  });
});

describe('regolith only below the model resolution (tier 5)', () => {
  it('starts at a wavelength of two mean edges', () => {
    expect(regolithMinFrequency(0.01)).toBeCloseTo(50, 12);
  });

  it('is refused when the resolution is unknown', () => {
    expect(regolithMinFrequency(null)).toBeNull();
    expect(regolithMinFrequency(0)).toBeNull();
  });

  it('a finer model leaves less room for regolith (higher cut-off frequency)', () => {
    expect(regolithMinFrequency(0.005)!).toBeGreaterThan(regolithMinFrequency(0.01)!);
  });
});

describe('Lommel-Seeliger (A7.4)', () => {
  it('equals the Lambert value 1/pi at normal incidence and emission', () => {
    expect(lommelSeeliger(1, 1)).toBeCloseTo(1 / Math.PI, 12);
  });

  it('is zero on the night side and below the horizon', () => {
    expect(lommelSeeliger(0, 0.5)).toBe(0);
    expect(lommelSeeliger(-0.2, 0.5)).toBe(0);
    expect(lommelSeeliger(0.5, 0)).toBe(0);
  });

  it('is mu0 / (mu0 + mu) up to its constant: symmetric in the sense of the formula', () => {
    const k = 2 / Math.PI;
    expect(lommelSeeliger(0.3, 0.9)).toBeCloseTo((k * 0.3) / 1.2, 12);
    // At the limb (mu -> 0) the radiance factor tends to 2/pi, finite (Lambert would be 0 at mu0 = 0).
    expect(lommelSeeliger(0.5, 1e-9)).toBeCloseTo(k, 6);
  });

  it('is brighter with the Sun higher for a fixed viewing angle', () => {
    expect(lommelSeeliger(0.9, 0.7)).toBeGreaterThan(lommelSeeliger(0.2, 0.7));
  });
});

describe('ambient occlusion sampling', () => {
  it('hemisphere directions are unit, above the surface and deterministic', () => {
    const a = hemisphereDirections(32);
    expect(hemisphereDirections(32)).toEqual(a);
    for (const d of a) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 9);
      expect(d[2]).toBeGreaterThanOrEqual(0);
    }
    // Cosine weighted: the mean z is 2/3.
    const meanZ = a.reduce((s, d) => s + d[2], 0) / a.length;
    expect(meanZ).toBeGreaterThan(0.6);
    expect(meanZ).toBeLessThan(0.73);
  });

  it('visibility is 1 in the open and 0 when every ray is blocked', () => {
    const dirs = hemisphereDirections(24);
    const n: Vec3 = [0, 1, 0];
    expect(aoVisibility(n, dirs, () => false)).toBe(1);
    expect(aoVisibility(n, dirs, () => true)).toBe(0);
  });

  it('rays are traced around the surface normal', () => {
    const dirs = hemisphereDirections(24);
    const n: Vec3 = [0, 0, 1];
    // Block everything in the normal's lower half-space: nothing is blocked.
    expect(aoVisibility(n, dirs, (d) => d[2] < -1e-9)).toBe(1);
    // Block rays with a positive x: a clear fraction is blocked.
    const v = aoVisibility(n, dirs, (d) => d[0] > 0);
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(0.7);
  });

  it('uses fewer rays on the low quality level', () => {
    expect(aoRayCount('low')).toBeLessThan(aoRayCount('medium'));
    expect(aoRayCount('medium')).toBeLessThan(aoRayCount('high'));
  });

  it('bakes AO into a geometry: a covered floor is darker than an open one', async () => {
    // A 2 x 2 floor and, for the covered case, a 8 x 8 roof 0.1 above it (a big overhang).
    const quad = (y: number, h: number): number[] => [-h, y, -h, h, y, -h, h, y, h, -h, y, h];
    const build = (withRoof: boolean) => {
      const g = new BufferGeometry();
      const pos = [...quad(0, 1), ...(withRoof ? quad(0.1, 4) : [])];
      const nor = [
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        ...(withRoof ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : []),
      ];
      const idx = [0, 2, 1, 0, 3, 2, ...(withRoof ? [4, 5, 6, 4, 6, 7] : [])];
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      return g;
    };
    const open = build(false);
    const roofed = build(true);
    expect(await bakeVertexAo(open, 16)).toBe(true);
    expect(await bakeVertexAo(roofed, 16)).toBe(true);
    const ao = (g: BufferGeometry, i: number) => g.getAttribute('ao')!.getX(i);
    expect(ao(open, 0)).toBe(1);
    expect(ao(roofed, 0)).toBeLessThan(0.5);
    // Deterministic: baking the same geometry again gives the same values.
    const again = build(true);
    await bakeVertexAo(again, 16);
    expect(Array.from(again.getAttribute('ao')!.array)).toEqual(
      Array.from(roofed.getAttribute('ao')!.array),
    );
  });

  it('keeps an existing ao attribute, and refuses a cancelled bake', async () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('ao', new Float32BufferAttribute([0.5, 0.5, 0.5], 1));
    expect(await bakeVertexAo(g, 8)).toBe(true);
    expect(g.getAttribute('ao')!.getX(0)).toBe(0.5);
    const h = new BufferGeometry();
    h.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(await bakeVertexAo(h, 8, () => true)).toBe(false);
    expect(h.getAttribute('ao')).toBeUndefined();
  });
});

describe('shadow map settings', () => {
  it('phones use a smaller map than desktop, and the box covers the unit body', () => {
    expect(shadowSettings('low').mapSize).toBeLessThan(shadowSettings('medium').mapSize);
    expect(shadowSettings('medium').mapSize).toBe(shadowSettings('high').mapSize);
    expect(shadowSettings('low').extent).toBeGreaterThan(1);
  });
});
