import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import {
  ENV_LAPSE_FACTOR,
  gasOrbitSources,
  resolveOrbitSources,
  rockyOrbitSources,
  ORBIT_LAYERS,
} from './orbitSources';

const tex = () => new DataTexture(new Float32Array(16), 2, 2, RGBAFormat, FloatType);
const rocky = () => ({
  terrainTexture: tex(),
  climateTexture: tex(),
  terrain: { W: 2, H: 2, data: new Float32Array(8) },
  radiusKm: 6371,
  lapseKPerKm: 9.8,
  fluid: { id: 'water', tripleK: 273.16, boilK: 373.15 },
  cloudCover: 0.4,
  seed: 11,
  hasOcean: true,
  haze: 0,
  hydrologyTexture: null,
  cloudTracerTexture: null,
});

describe('rocky adapter', () => {
  it("with D's current fields: draws, 0.66 lapse, lists hydrology and atmosphere as missing", () => {
    const r = rockyOrbitSources(rocky());
    expect(r.sources).not.toBeNull();
    expect(r.sources!.lapseKPerKm).toBeCloseTo(9.8 * ENV_LAPSE_FACTOR);
    expect(r.missing).toEqual(expect.arrayContaining(['orbit.hydrology', 'orbit.atmosphere']));
    expect(r.missing).not.toContain('orbit.height');
    expect(r.layers.find((l) => l.id === 'orbit.hydrology')!.drawn).toBe(false);
  });
  it('with D round 2: hydrology, live cloud tracer and the air are drawn', () => {
    const first = tex();
    const second = tex();
    const d: Record<string, unknown> = {
      ...rocky(),
      hydrologyTexture: tex(),
      scaleHeightKm: 8.4,
      pressureBar: 1.2,
      hazeColour: [0.7, 0.5, 0.2],
      surfaceTempK: 288,
      palette: { liq: [0, 0, 1], ice: [1, 1, 1], cld: [1, 1, 1], land: [0.3, 0.2, 0.1] },
      get cloudTracerTexture() {
        return cur;
      },
    };
    let cur = first;
    const r = rockyOrbitSources(d as never);
    expect(r.missing).toEqual([]);
    expect(r.sources!.cloudBase!()).toBe(first);
    cur = second;
    expect(r.sources!.cloudBase!()).toBe(second);
    expect(r.sources!.look!.liq).toEqual([0, 0, 1]);
  });
  it('refuses without a radius or heights, never throws', () => {
    expect(rockyOrbitSources({ ...rocky(), radiusKm: null }).sources).toBeNull();
    expect(rockyOrbitSources({ ...rocky(), terrainTexture: null }).refusal).toMatch(/height map/);
    expect(rockyOrbitSources(null).missing.length).toBe(ORBIT_LAYERS.length - 2);
    expect(resolveOrbitSources(undefined).sources).toBeNull();
  });
  it('an atmosphere needs both scale height and pressure', () => {
    expect(
      rockyOrbitSources({ ...rocky(), scaleHeightKm: 8, pressureBar: 1 }).missing,
    ).not.toContain('orbit.atmosphere');
    expect(rockyOrbitSources({ ...rocky(), scaleHeightKm: 8 }).missing).toContain(
      'orbit.atmosphere',
    );
  });
  it('no climate: no snow, no ocean', () => {
    const r = rockyOrbitSources({ ...rocky(), climateTexture: null });
    expect(r.missing).toEqual(expect.arrayContaining(['orbit.snow', 'orbit.ocean']));
    expect(r.sources!.hasOcean).toBe(false);
  });
});

describe('gas adapter', () => {
  const gas = (over = {}) => ({
    velocity: tex(),
    tracer: tex(),
    bands: tex(),
    noise: tex(),
    radiusKm: 69911,
    scaleHeightKm: 27,
    seed: 67,
    palette: {
      z: [0.9, 0.8, 0.7],
      b: [0.5, 0.3, 0.1],
      s: [0.8, 0.3, 0.1],
      d: [0.3, 0.2, 0.1],
      p: [0.4, 0.5, 0.5],
    },
    ready: true,
    ...over,
  });
  it("maps E's getter and reads the live tracer each time", () => {
    const first = tex();
    const second = tex();
    let cur: DataTexture | null = first;
    const live = () => gas({ tracer: cur });
    const r = resolveOrbitSources(live(), live);
    expect(r.sources!.kind).toBe('gas');
    expect(r.sources!.tracer!()).toBe(first);
    cur = second;
    expect(r.sources!.tracer!()).toBe(second);
  });
  it('shows the forming state until ready, and refuses without bands', () => {
    expect(gasOrbitSources(gas({ ready: false })).refusal).toMatch(/forming/);
    expect(gasOrbitSources(gas({ bands: null })).sources).toBeNull();
  });
  it('no velocity: eddies refused, deck still drawn', () => {
    const r = gasOrbitSources(gas({ velocity: null }));
    expect(r.missing).toContain('orbit.eddies');
    expect(r.sources).not.toBeNull();
  });
  it('every layer carries a tag, derived has a formula and model_dependent an assumption', () => {
    for (const l of ORBIT_LAYERS) {
      expect(l.tag).toBeTruthy();
      if (l.tag === 'derived') expect(l.formula).toBeTruthy();
      if (l.tag === 'model_dependent') expect(l.assumption).toBeTruthy();
    }
  });
});
