// Which all-sky image to load (pure). The index lists equirectangular images in sizes such as
// 4096×2048 and 8192×4096 (ICRS, RA 0 at the left edge increasing to the right, north at the top).
// The smallest loads first so the sky shows quickly; a larger one replaces it only on a device
// that can hold it (renderer max texture size) and is not a phone.

import type { SkyEquirect, SkySurvey } from '@/app/api/types';

/**
 * Largest equirect width loaded on a phone or tablet (coarse pointer), in px.
 * ASSUMPTION: 4096 (the task brief: "phones stay at 4096"). D-05 budgets body textures at
 * 2048×1024 desktop and 1024×512 mobile and says nothing about a sky background; see the report.
 */
export const SKY_PHONE_MAX_WIDTH = 4096;
/** Largest width loaded anywhere, whatever the GPU reports. Display budget, not a physical value. */
export const SKY_DESKTOP_MAX_WIDTH = 8192;

export interface DeviceCaps {
  /** Renderer max 2D texture size in px (WebGPU maxTextureDimension2D or WebGL MAX_TEXTURE_SIZE). */
  maxTextureSize: number;
  /** `(pointer: coarse)` matched: a phone or tablet. */
  coarsePointer: boolean;
  /** `navigator.connection.saveData` is on. */
  saveData: boolean;
}

/** Equirects with a usable size (2:1, positive integers), smallest first. */
export function usableEquirects(survey: SkySurvey): SkyEquirect[] {
  return survey.equirect
    .filter((e) => Number.isInteger(e.width) && e.width > 0 && e.width === 2 * e.height)
    .slice()
    .sort((a, b) => a.width - b.width);
}

export interface SkyLoadPlan {
  /** Loaded first. Null when nothing can be drawn. */
  first: SkyEquirect | null;
  /** Loaded after `first` and swapped in on success, or null. */
  upgrade: SkyEquirect | null;
}

export function planSkyLoad(survey: SkySurvey, caps: DeviceCaps): SkyLoadPlan {
  const cap = Math.min(
    caps.maxTextureSize,
    caps.coarsePointer || caps.saveData ? SKY_PHONE_MAX_WIDTH : SKY_DESKTOP_MAX_WIDTH,
  );
  const fits = usableEquirects(survey).filter((e) => e.width <= caps.maxTextureSize);
  const first = fits[0] ?? null;
  if (!first) return { first: null, upgrade: null };
  const best = fits.filter((e) => e.width <= cap).at(-1) ?? first;
  return { first, upgrade: best.width > first.width ? best : null };
}

/** The first survey the viewer can draw: ICRS frame and at least one 2:1 image. */
export function pickSurvey(surveys: readonly SkySurvey[]): SkySurvey | null {
  return surveys.find((s) => s.frame === 'icrs' && usableEquirects(s).length > 0) ?? null;
}
