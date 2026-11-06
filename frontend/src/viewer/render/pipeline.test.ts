// The pipeline needs a GPU to run; the chain choice per tier is pure and tested here. The real
// build is exercised by the e2e shader-kinds run (WebGL2 on SwiftShader).
import { describe, expect, it } from 'vitest';
import { BLOOM_THRESHOLD, chainConfig, SETTLE_FRAMES_SMAA, SETTLE_FRAMES_TAAU } from './pipeline';

describe('chainConfig', () => {
  it('high: full-res bloom, TAAU with velocity, a full jitter cycle to settle', () => {
    expect(chainConfig('high')).toEqual({
      aa: 'taau',
      bloomScale: 1,
      needsVelocity: true,
      settleFrames: SETTLE_FRAMES_TAAU,
    });
  });
  it('medium: half-res bloom, TAAU', () => {
    expect(chainConfig('medium')).toMatchObject({ aa: 'taau', bloomScale: 0.5 });
  });
  it('low: half-res bloom, SMAA, no velocity, short settle', () => {
    expect(chainConfig('low')).toEqual({
      aa: 'smaa',
      bloomScale: 0.5,
      needsVelocity: false,
      settleFrames: SETTLE_FRAMES_SMAA,
    });
  });
  it('only HDR values glow: the threshold is at the LDR ceiling', () => {
    expect(BLOOM_THRESHOLD).toBeGreaterThanOrEqual(2);
  });
});
