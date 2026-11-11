// Issue #71 stream A: the lobed nucleus outline and the rock shading twin.
import { describe, expect, it } from 'vitest';
import { lobeSphere, lobedExtent, lobedRadius, nucleusAxes } from './rockShape';
import { lommelSeeliger, rockReflectance, ROCK_LAMBERT_BLEND } from './shapeModel';

describe('lobed nucleus outline', () => {
  it('has volume-normalised axes with the stated ratio', () => {
    const a = nucleusAxes();
    expect(a[0] * a[1] * a[2]).toBeCloseTo(1, 12);
    expect(a[0] / a[1]).toBeCloseTo(1.5, 12);
  });
  it('is narrower at the neck than at the lobes', () => {
    expect(lobedRadius(0, 1, 0)).toBeLessThan(lobedRadius(1, 0, 0));
    expect(lobedRadius(0, 0, 1)).toBeLessThan(lobedRadius(-1, 0, 0));
    expect(lobedRadius(1, 0, 0)).toBeGreaterThan(lobedRadius(-1, 0, 0)); // the +x lobe is bigger
  });
  it('is deterministic and scales to a unit extent', () => {
    expect(lobedExtent()).toBe(lobedExtent());
    const pos = { array: new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0, 1]) };
    lobeSphere(pos);
    const radii = [0, 3, 6, 9].map((i) =>
      Math.hypot(pos.array[i]!, pos.array[i + 1]!, pos.array[i + 2]!),
    );
    expect(Math.max(...radii)).toBeLessThanOrEqual(1 + 1e-6);
    expect(Math.max(...radii)).toBeGreaterThan(0.9);
    expect(radii.every(Number.isFinite)).toBe(true);
  });
});

describe('rock reflectance', () => {
  it('equals Lambert and Lommel-Seeliger at normal incidence and opposition', () => {
    expect(rockReflectance(1, 1, 0)).toBeCloseTo(1 / Math.PI, 12);
  });
  it('is zero on the night side and below the horizon', () => {
    expect(rockReflectance(0, 0.5, 0.3)).toBe(0);
    expect(rockReflectance(0.5, 0, 0.3)).toBe(0);
  });
  it('dims with phase angle and blends the two models', () => {
    expect(rockReflectance(0.6, 0.8, 1.2)).toBeLessThan(rockReflectance(0.6, 0.8, 0.1));
    const blend =
      (1 - ROCK_LAMBERT_BLEND) * lommelSeeliger(0.6, 0.8) + (ROCK_LAMBERT_BLEND * 0.6) / Math.PI;
    expect(rockReflectance(0.6, 0.8, 0)).toBeCloseTo(blend, 12);
  });
});
