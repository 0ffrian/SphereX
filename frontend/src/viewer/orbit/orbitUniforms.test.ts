import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import { rockyOrbitSources } from './orbitSources';
import { orbitUniformValues } from './orbitUniforms';
import { OrbitView } from './OrbitView';

const tex = () => new DataTexture(new Float32Array(16), 2, 2, RGBAFormat, FloatType);
const sources = () =>
  rockyOrbitSources({
    terrainTexture: tex(), climateTexture: tex(), terrain: { W: 2, H: 2, data: new Float32Array(8) }, radiusKm: 6371,
    lapseKPerKm: 9.8, fluid: { id: 'water', tripleK: 273.16, boilK: 373.15 }, cloudCover: 0.4, seed: 1011, hasOcean: true,
    scaleHeightKm: 8.5, pressureBar: 1, haze: 0.1,
  }).sources!;
const light = { sunDir: [0.3, 0.2, 0.9] as [number, number, number], starColour: [1, 0.9, 0.8] as [number, number, number], timeSec: 12, cloudsOn: true };
const state = { lon: 0.2, lat: 0.1, head: 0.5, pitch: -0.1, altKm: 300 };

describe('uniform values', () => {
  it('same sources, state, light and size give identical numbers (determinism)', () => {
    const a = orbitUniformValues(sources(), state, light, { w: 640, h: 480 });
    const b = orbitUniformValues(sources(), state, light, { w: 640, h: 480 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('seed is reduced for hash precision; air follows scale height; lapse is 0.66 dry', () => {
    const v = orbitUniformValues(sources(), state, light, { w: 10, h: 10 });
    expect(v.seed).toBe(1011 % 997);
    expect(v.hv).toBeCloseTo(8.5 * 3);
    expect(v.mx).toBeCloseTo(Math.sqrt((Math.PI * 6371) / (2 * v.hv)));
    expect(v.gam).toBeCloseTo(9.8 * 0.66);
    expect(v.tau).toBeGreaterThan(0.55);
  });
  it('no atmosphere data: no air is drawn', () => {
    const s = { ...sources(), scaleHeightKm: null };
    const v = orbitUniformValues(s, state, light, { w: 10, h: 10 });
    expect(v.tau).toBe(0);
    expect(v.hz).toBe(0);
  });
  it('the view reproduces them and a quarter-size target changes only the size', () => {
    const view = new OrbitView(sources());
    view.state = state;
    view.light = light;
    const a = view.uniformValues({ w: 100, h: 50 });
    const b = view.uniformValues({ w: 50, h: 25 });
    expect({ ...a, size: 0 }).toEqual({ ...b, size: 0 });
  });
});
