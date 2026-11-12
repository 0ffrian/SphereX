// The zoom card's bridge to the sky view (bottom left, same controls as the wheel and the + and -
// keys). SkyPane registers what it can do while its view exists; the card calls it. The percentage
// is the default field of view over the current one, so 100% is the view the sky opens with and
// zooming in reads above 100%. It is a display choice (artistic), not a measurement.

export interface SkyZoomControl {
  /** factor < 1 zooms in, > 1 zooms out (as `zoomAt`). */
  zoom(factor: number): void;
  reset(): void;
}

let control: SkyZoomControl | null = null;

export function registerSkyZoom(c: SkyZoomControl | null): void {
  control = c;
}

export function skyZoom(): SkyZoomControl | null {
  return control;
}

/** "150%": how much narrower the view is than the one the sky opened with. */
export function skyZoomPercent(defaultFovDeg: number, fovDeg: number): string {
  if (!(fovDeg > 0)) return '100%';
  return `${Math.round((defaultFovDeg / fovDeg) * 100)}%`;
}
