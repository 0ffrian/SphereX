// Negative control for the golden-frame comparison (10.6 gate 2): the SSIM score must separate
// "same picture, rasteriser noise" from "the picture changed". Pure Node, no browser.
import { expect, test } from '@playwright/test';
import { GOLDEN_MAX_COLOUR_DELTA, GOLDEN_MIN_CHANNEL_SSIM, GOLDEN_MIN_SSIM } from './golden';
import { scoreFrames, ssim, type Luma, type Rgb } from './ssim';

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

// Colour: a saturated coloured body (orange, like a cool star) on black.
function colourBody(
  map: (rgb: [number, number, number]) => [number, number, number],
  noise = 0,
): Rgb {
  const base = body();
  const rgba = new Uint8Array(W * H * 4);
  let s = 99;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
  for (let i = 0; i < W * H; i++) {
    const v = base.data[i]! / 255;
    const [r, g, b] = map([255 * v, 120 * v, 40 * v]);
    rgba[i * 4] = Math.min(255, Math.max(0, r + noise * rnd()));
    rgba[i * 4 + 1] = Math.min(255, Math.max(0, g + noise * rnd()));
    rgba[i * 4 + 2] = Math.min(255, Math.max(0, b + noise * rnd()));
    rgba[i * 4 + 3] = 255;
  }
  return { width: W, height: H, rgba };
}
const lum = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const same = colourBody((c) => c);
function passes(img: Rgb) {
  const s = scoreFrames(same, img);
  return {
    s,
    ok:
      s.luma >= GOLDEN_MIN_SSIM &&
      s.channelMin >= GOLDEN_MIN_CHANNEL_SSIM &&
      s.colourDelta <= GOLDEN_MAX_COLOUR_DELTA,
  };
}

test('colour: small noise passes all three terms', () => {
  const { s, ok } = passes(colourBody((c) => c, 4));
  expect(ok, JSON.stringify(s)).toBe(true);
});

test('colour: 15% desaturation at equal luminance fails', () => {
  const { s, ok } = passes(
    colourBody((c) => {
      const y = lum(c);
      return [y + 0.85 * (c[0] - y), y + 0.85 * (c[1] - y), y + 0.85 * (c[2] - y)];
    }),
  );
  expect(ok, JSON.stringify(s)).toBe(false);
});

test('colour: hue rotation (R, G, B swapped) fails', () => {
  const { s, ok } = passes(colourBody(([r, g, b]) => [g, b, r]));
  expect(ok, JSON.stringify(s)).toBe(false);
});
