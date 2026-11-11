import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import { rockyOrbitSources } from './orbitSources';
import {
  FAST_FRAMES,
  INTERACTING,
  LEVEL_GAP_MS,
  OrbitView,
  QUALITY_LEVELS,
  QualityGovernor,
  SLOW_MS,
} from './OrbitView';

const tex = () => new DataTexture(new Float32Array(16), 2, 2, RGBAFormat, FloatType);
const view = () =>
  new OrbitView(
    rockyOrbitSources({
      terrainTexture: tex(),
      climateTexture: tex(),
      terrain: { W: 2, H: 2, data: new Float32Array(8) },
      radiusKm: 6371,
      lapseKPerKm: 9.8,
      fluid: { id: 'water', tripleK: 273, boilK: 373 },
      cloudCover: 0.3,
      seed: 3,
      hasOcean: true,
    }).sources!,
  );

describe('adaptive quality', () => {
  it('steps down on slow frames with a gap, and back up after a run of fast ones', () => {
    const g = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 30;
      g.feed(30, t);
    }
    expect(g.level).toBe(1); // the gap stops a second step at once
    t += LEVEL_GAP_MS;
    g.feed(40, t);
    expect(g.level).toBeGreaterThan(1);
    const low = g.level;
    for (let i = 0; i < FAST_FRAMES + 70; i++) {
      t += LEVEL_GAP_MS;
      g.feed(8, t);
    }
    expect(g.level).toBeLessThan(low);
    expect(SLOW_MS).toBe(20);
  });
  it('levels get cheaper and interaction is a quarter scale', () => {
    for (let i = 1; i < QUALITY_LEVELS.length; i++)
      expect(QUALITY_LEVELS[i]!.march).toBeLessThan(QUALITY_LEVELS[i - 1]!.march);
    expect(INTERACTING.scale).toBe(0.25);
  });
  it('a settled frame ignores the adaptive level (deterministic); interaction refines after it stops', () => {
    const v = view();
    v.governor.level = 3;
    expect(v.qualityFor(1000, false)).toEqual({ ...QUALITY_LEVELS[0], scale: 1 });
    expect(v.qualityFor(1000, true).march).toBe(QUALITY_LEVELS[3]!.march);
    v.markInput(1000);
    expect(v.qualityFor(1100, false)).toBe(INTERACTING);
    expect(v.isInteracting(1500)).toBe(false);
    expect(v.qualityFor(1500, false).scale).toBe(1);
  });
  it('low quality halves the settled scale', () => {
    const v = view();
    v.renderScale = 0.5;
    expect(v.qualityFor(0, false).scale).toBe(0.5);
  });
});
