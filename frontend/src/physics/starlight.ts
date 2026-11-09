// R5.1 / issue #68 Part 2: the colour of a star's light from its effective temperature.
// A TS twin of `backend/app/core/render/blackbody.py` (`teff_to_rgb`): Planck spectrum integrated
// 380-780 nm at 1 nm steps against the CIE 1931 2-degree colour-matching functions (Wyman, Sloan &
// Shirley 2013 multi-lobe fit), XYZ -> linear sRGB (IEC 61966-2-1, D65), negatives clipped. The
// twin test (starlight.test.ts) compares it with a committed table of the Python helper's output.
// Deterministic: no Math.random, no Date.
import type { Rgb } from '@/viewer/planTypes';

export const STARLIGHT_FORMULA =
  'Planck(Teff) integrated 380-780 nm against the CIE 1931 2-degree colour-matching functions (Wyman, Sloan & Shirley 2013 fit), XYZ -> linear sRGB (D65), clipped at 0, scaled to unit luminance';

const H = 6.62607015e-34;
const C = 299792458.0;
const K = 1.380649e-23;

type Lobe = readonly [number, number, number, number];
const XBAR: readonly Lobe[] = [
  [1.056, 599.8, 37.9, 31.0],
  [0.362, 442.0, 16.0, 26.7],
  [-0.065, 501.1, 20.4, 26.2],
];
const YBAR: readonly Lobe[] = [
  [0.821, 568.8, 46.9, 40.5],
  [0.286, 530.9, 16.3, 31.1],
];
const ZBAR: readonly Lobe[] = [
  [1.217, 437.0, 11.8, 36.0],
  [0.681, 459.0, 26.0, 13.8],
];
const M = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.204, 1.057],
] as const;

function lobe(nm: number, lobes: readonly Lobe[]): number {
  let out = 0;
  for (const [w, mu, s1, s2] of lobes) {
    const s = nm < mu ? s1 : s2;
    out += w * Math.exp(-0.5 * ((nm - mu) / s) ** 2);
  }
  return out;
}

function planck(nm: number, teffK: number): number {
  const lam = nm * 1e-9;
  const x = (H * C) / (lam * K * teffK);
  if (x > 700) return 0;
  return 1 / (lam ** 5 * Math.expm1(x));
}

/** Python's `round(x, 4)` for the values here (half-even differs from half-up only on exact ties). */
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/**
 * Linear sRGB with the brightest channel 1, rounded to 4 decimals: the twin of `teff_to_rgb`.
 * Null when Teff is not a positive finite number or no light comes out.
 */
export function teffToRgbMax1(teffK: number): Rgb | null {
  if (!Number.isFinite(teffK) || teffK <= 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let nm = 380; nm <= 780; nm++) {
    const b = planck(nm, teffK);
    x += b * lobe(nm, XBAR);
    y += b * lobe(nm, YBAR);
    z += b * lobe(nm, ZBAR);
  }
  const rgb = M.map((r) => Math.max(0, r[0] * x + r[1] * y + r[2] * z));
  const peak = Math.max(...rgb);
  if (!(peak > 0) || !Number.isFinite(peak)) return null;
  return [round4(rgb[0]! / peak), round4(rgb[1]! / peak), round4(rgb[2]! / peak)];
}

/** Rec. 709 / sRGB luminance weights (IEC 61966-2-1) for linear light. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * The light colour for a star of `teffK`: the blackbody chromaticity scaled so that the linear
 * luminance is 1 (the exposure stays `DIRECTIONAL_INTENSITY`). A red dwarf's light has R above 1
 * and B near 0: there is no white balance, because that is what the light really is. Null when
 * Teff is not usable (the caller keeps the light white).
 */
export function starlightColour(teffK: number): Rgb | null {
  const c = teffToRgbMax1(teffK);
  if (!c) return null;
  const y = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
  if (!(y > 0)) return null;
  return [c[0] / y, c[1] / y, c[2] / y];
}
