// Negative control for the golden-frame comparison (10.6 gate 2): the SSIM score must separate
// "same picture, rasteriser noise" from "the picture changed". Pure Node, no browser.
import { expect, test } from '@playwright/test';
import { GOLDEN_MIN_SSIM } from './golden';
import { ssim, type Luma } from './ssim';

const W = 256;
const H = 192;

/** A disc with smooth shading and fine texture, a stand-in for a lit body on black. */
function body(opts: { dx?: number; radius?: number; noise?: number; blur?: boolean } = {}): Luma {
  const { dx = 0, radius = 70, noise = 0 } = opts;
  const data = new Float32Array(W * H);
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x - W / 2 - dx;
      const py = y - H / 2;
      const r = Math.hypot(px, py);
      let v = 0;
      if (r < radius) {
        const shade = 1 - (px + py) / (4 * radius);
        const tex = 0.5 + 0.5 * Math.sin(px * 0.35) * Math.cos(py * 0.27);
        v = 255 * Math.min(1, Math.max(0, shade * (0.55 + 0.45 * tex)));
      }
      data[y * W + x] = Math.min(255, Math.max(0, v + noise * rnd()));
    }
  }
  return { width: W, height: H, data };
}

test('identical frames score 1', () => {
  expect(ssim(body(), body())).toBeCloseTo(1, 6);
});

test('rasteriser-level noise stays above the threshold', () => {
  // +-2 grey levels of rounding noise, far more than reruns on one machine show.
  expect(ssim(body(), body({ noise: 4 }))).toBeGreaterThan(GOLDEN_MIN_SSIM);
});

test.describe('a real regression fails', () => {
  const cases: [string, Luma][] = [
    ['body shifted by 6 px', body({ dx: 6 })],
    ['body 12% smaller', body({ radius: 62 })],
    ['heavy noise', body({ noise: 60 })],
    ['blank frame', { width: W, height: H, data: new Float32Array(W * H) }],
  ];
  for (const [name, img] of cases) {
    test(name, () => {
      const score = ssim(body(), img);
      expect(score, `score ${score.toFixed(4)}`).toBeLessThan(GOLDEN_MIN_SSIM);
    });
  }
});

test('size mismatch throws', () => {
  expect(() => ssim(body(), { width: 8, height: 8, data: new Float32Array(64) })).toThrow();
});
