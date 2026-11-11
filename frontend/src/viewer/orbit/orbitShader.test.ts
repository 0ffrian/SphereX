import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import { buildOrbitShader, createOrbitUniforms, type OrbitShaderConfig } from './orbitShader';
import { buildWgsl } from './wgslProbe.testutil';

const tex = (w = 4, h = 2) =>
  new DataTexture(new Float32Array(w * h * 4), w, h, RGBAFormat, FloatType);

describe('orbit shader builds to WGSL', () => {
  it('rocky with every layer', () => {
    const cfg: OrbitShaderConfig = {
      kind: 'rocky',
      height: tex(),
      climate: tex(),
      hydrology: tex(),
      cloudBase: tex(),
      clouds: true,
      ocean: true,
      snow: true,
      velocity: null,
      bands: null,
      tracer: null,
    };
    const { fragment } = buildOrbitShader(cfg, createOrbitUniforms());
    const wgsl = buildWgsl(fragment);
    expect(wgsl).toContain('@fragment');
    expect(wgsl.length).toBeGreaterThan(5000);
  });
  it('rocky with the minimum (height only)', () => {
    const cfg: OrbitShaderConfig = {
      kind: 'rocky',
      height: tex(),
      climate: null,
      hydrology: null,
      cloudBase: null,
      clouds: false,
      ocean: false,
      snow: false,
      velocity: null,
      bands: null,
      tracer: null,
    };
    expect(buildWgsl(buildOrbitShader(cfg, createOrbitUniforms()).fragment)).toContain('@fragment');
  });
  it('gas', () => {
    const t = tex();
    const cfg: OrbitShaderConfig = {
      kind: 'gas',
      height: null,
      climate: null,
      hydrology: null,
      cloudBase: null,
      clouds: false,
      ocean: false,
      snow: false,
      velocity: t,
      bands: t,
      tracer: t,
    };
    const r = buildOrbitShader(cfg, createOrbitUniforms());
    expect(r.tracerBase).not.toBeNull();
    expect(buildWgsl(r.fragment)).toContain('@fragment');
  });
});
