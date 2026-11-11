// Issue #71 stream D, round 2 (Q-245): the cloud tracer's clock rule and its construction without a GPU.
import { describe, expect, it } from 'vitest';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import { CloudTracer, TRACER_STEP_SIM_S, targetStep, tracerWindScale } from './CloudTracer';

describe('cloud tracer', () => {
  it('the step count is a pure function of the clock time', () => {
    expect(targetStep(0)).toBe(0);
    expect(targetStep(-5)).toBe(0);
    expect(targetStep(NaN)).toBe(0);
    expect(targetStep(TRACER_STEP_SIM_S * 7.5)).toBe(7);
    expect(targetStep(TRACER_STEP_SIM_S * 7.5)).toBe(targetStep(TRACER_STEP_SIM_S * 7.5));
  });
  it('wind scale is bounded and rises with the wind', () => {
    expect(tracerWindScale(1)).toBeGreaterThanOrEqual(0.003);
    expect(tracerWindScale(1e6)).toBeLessThanOrEqual(0.0095);
    expect(tracerWindScale(300)).toBeGreaterThan(tracerWindScale(5));
  });
  it('builds without a renderer (no step is run) and disposes', () => {
    const clim = new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
    const t = new CloudTracer({
      climate: clim,
      windMs: 100,
      jets: 6,
      locked: true,
      seed: 3,
      low: true,
    });
    expect(t.stepsRun).toBe(0);
    expect(t.texture).toBeTruthy();
    t.dispose();
  });
});
