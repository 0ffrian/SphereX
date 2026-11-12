// The pipeline needs a GPU to run; the chain choice per tier is pure and tested here. The real
// build is exercised by the e2e shader-kinds run (WebGL2 on SwiftShader).
import { describe, expect, it } from 'vitest';
import { BLOOM_THRESHOLD, chainConfig, SETTLE_FRAMES_SMAA, SETTLE_FRAMES_TAAU } from './pipeline';
import { TAAU_RENDER_SCALE } from './quality';

describe('chainConfig', () => {
  it('high: half-res bloom (roadmap 1.3), TAAU with velocity at 75% scene scale, a full jitter cycle to settle', () => {
    expect(chainConfig('high')).toEqual({
      aa: 'taau',
      bloomScale: 0.5,
      renderScale: TAAU_RENDER_SCALE,
      needsVelocity: true,
      settleFrames: SETTLE_FRAMES_TAAU,
    });
  });
  it('medium: half-res bloom, TAAU upscaling a 75% scene (roadmap 1.14)', () => {
    expect(chainConfig('medium')).toMatchObject({
      aa: 'taau',
      bloomScale: 0.5,
      renderScale: TAAU_RENDER_SCALE,
    });
    expect(TAAU_RENDER_SCALE).toBe(0.75);
  });
  it('low: half-res bloom, SMAA, no velocity, short settle', () => {
    expect(chainConfig('low')).toEqual({
      aa: 'smaa',
      bloomScale: 0.5,
      renderScale: 1,
      needsVelocity: false,
      settleFrames: SETTLE_FRAMES_SMAA,
    });
  });
  it('only HDR values glow: the threshold is at the LDR ceiling', () => {
    expect(BLOOM_THRESHOLD).toBeGreaterThanOrEqual(2);
  });
  it('reduced motion: SMAA instead of the jittering TAAU, on every tier', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(chainConfig(tier, true)).toMatchObject({
        aa: 'smaa',
        // SMAA has no upscaler: the scene renders at full size.
        renderScale: 1,
        needsVelocity: false,
        settleFrames: SETTLE_FRAMES_SMAA,
      });
    }
  });
});
