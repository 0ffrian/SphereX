// DEV/TEST FIXTURES ONLY. A SYNTHETIC all-sky test image and a fixture `/v1/sky/index.json`, so
// the sky view can be built and tested without the backend's survey data. The picture is not a
// survey: red encodes RA, green encodes Dec, with a 30° grid and a mark at the north pole, so an
// end-to-end test can read the orientation back from the screen.
//
// Same equirect convention as the backend: column x → RA = 360·(x+0.5)/W (RA 0 at the left edge,
// increasing to the right), row y → Dec = 90 − 180·(y+0.5)/H (north at the top). ICRS.
import type { SkyIndexResponse } from '../src/app/api/types';
import { encodePngRgb } from './png';
import { FIXTURE_DATA_RELEASE } from './synthetic';

/** Sizes served (2:1). The smaller loads first; the client may swap in the larger one. */
export const FIXTURE_SKY_WIDTHS = [512, 1024] as const;

export const FIXTURE_SKY_ID = `${FIXTURE_DATA_RELEASE}_sky`;

export function fixtureSkyPath(width: number): string {
  return `/v1/sky/${FIXTURE_SKY_ID}/equirect_${width}.png`;
}

/** Grid spacing of the synthetic picture, degrees. */
const GRID_DEG = 30;

/** Red channel at a given RA: 16 + 120·RA/360 (0 h is near black, 23 h dull red). */
export function fixtureRedForRa(ra: number): number {
  return Math.round(16 + (120 * ra) / 360);
}

/** Green channel at a given Dec: 16 + 120·(Dec + 90)/180. */
export function fixtureGreenForDec(dec: number): number {
  return Math.round(16 + (120 * (dec + 90)) / 180);
}

const cache = new Map<number, Uint8Array>();

/** The synthetic equirect PNG, `width × width/2`. Deterministic: same width → same bytes. */
export function renderFixtureSky(width: number): Uint8Array {
  const hit = cache.get(width);
  if (hit) return hit;
  const height = width / 2;
  const rgb = new Uint8Array(width * height * 3);
  const degPerPx = 360 / width;
  for (let y = 0; y < height; y++) {
    const dec = 90 - (180 * (y + 0.5)) / height;
    const g = fixtureGreenForDec(dec);
    // One-pixel grid lines; the band above Dec +88° marks the north pole.
    const onParallel = (dec + 90) % GRID_DEG < 180 / height || dec > 88;
    for (let x = 0; x < width; x++) {
      const ra = (360 * (x + 0.5)) / width;
      const onMeridian = ra % GRID_DEG < degPerPx;
      const i = (y * width + x) * 3;
      if (onParallel || onMeridian) {
        rgb[i] = 150;
        rgb[i + 1] = 160;
        rgb[i + 2] = 175;
      } else {
        rgb[i] = fixtureRedForRa(ra);
        rgb[i + 1] = g;
        rgb[i + 2] = 48;
      }
    }
  }
  const png = encodePngRgb(width, height, rgb);
  cache.set(width, png);
  return png;
}

export function makeSkyIndex(): SkyIndexResponse {
  return {
    surveys: [
      {
        id: FIXTURE_SKY_ID,
        title: 'Synthetic test sky (fixture)',
        credit: 'Synthetic fixture for development: a colour ramp, not a survey image.',
        tag: 'derived',
        formula: 'Synthetic: red = 16 + 120·RA/360°, green = 16 + 120·(Dec + 90°)/180°, 30° grid',
        assumption: null,
        frame: 'icrs',
        convention:
          'equirectangular; column x → RA = 360·(x+0.5)/W, row y → Dec = 90 − 180·(y+0.5)/H',
        equirect: FIXTURE_SKY_WIDTHS.map((w) => ({
          url: fixtureSkyPath(w),
          width: w,
          height: w / 2,
        })),
        hips: null,
      },
    ],
  };
}
