// Structural similarity (SSIM, Wang et al. 2004) on 8-bit luminance, no dependencies.
// Mean SSIM over 8x8 uniform windows moved 4 px at a time; C1 = (0.01 L)^2, C2 = (0.03 L)^2, L = 255.
// Used by the golden-frame tests (10.6 gate 2): GPUs and rasterisers differ in rounding, so frames
// are compared by structure, not by exact pixels.

export interface Luma {
  width: number;
  height: number;
  /** width * height values 0..255, row-major. */
  data: Uint8Array | Float32Array;
}

const WIN = 8;
const STEP = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Rec. 709 luminance of RGBA bytes. */
export function lumaFromRgba(width: number, height: number, rgba: Uint8Array): Luma {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
  }
  return { width, height, data };
}

export function ssim(a: Luma, b: Luma): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`ssim: size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const { width: w, height: h } = a;
  if (w < WIN || h < WIN) throw new Error('ssim: image smaller than one window');
  const n = WIN * WIN;
  let sum = 0;
  let count = 0;
  for (let y = 0; y + WIN <= h; y += STEP) {
    for (let x = 0; x + WIN <= w; x += STEP) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let j = 0; j < WIN; j++) {
        const row = (y + j) * w + x;
        for (let i = 0; i < WIN; i++) {
          const va = a.data[row + i]!;
          const vb = b.data[row + i]!;
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return sum / count;
}

export interface Rgb {
  width: number;
  height: number;
  /** RGBA bytes, row-major. */
  rgba: Uint8Array;
}

export interface FrameScore {
  /** Mean SSIM of the luminance. */
  luma: number;
  /** Lowest of the per-channel SSIMs (R, G, B). */
  channelMin: number;
  /** Mean absolute difference per channel (0..255) over pixels lit in either frame. */
  colourDelta: number;
}

/** Pixels darker than this in both frames (luminance) are background and do not count for colourDelta. */
const LIT = 8;

function channel(img: Rgb, c: number): Luma {
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.rgba[i * 4 + c]!;
  return { width: img.width, height: img.height, data };
}

/**
 * Colour-sensitive comparison. Luminance SSIM alone misses a change of chroma or hue at equal
 * luminance (e.g. tone mapping that mutes a star's colour), and colour is honesty-critical (Teff,
 * equilibrium-temperature colours). So a frame passes only if luminance SSIM, every channel's SSIM
 * and the mean colour difference over lit pixels are all within their thresholds (golden.ts).
 */
export function scoreFrames(a: Rgb, b: Rgb): FrameScore {
  const la = lumaFromRgba(a.width, a.height, a.rgba);
  const lb = lumaFromRgba(b.width, b.height, b.rgba);
  const luma = ssim(la, lb);
  let channelMin = 1;
  for (let c = 0; c < 3; c++) channelMin = Math.min(channelMin, ssim(channel(a, c), channel(b, c)));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < la.data.length; i++) {
    if (la.data[i]! < LIT && lb.data[i]! < LIT) continue;
    for (let c = 0; c < 3; c++) sum += Math.abs(a.rgba[i * 4 + c]! - b.rgba[i * 4 + c]!);
    n += 3;
  }
  return { luma, channelMin, colourDelta: n ? sum / n : 0 };
}
