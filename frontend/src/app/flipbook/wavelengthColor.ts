// Rainbow Trails colour (D-28): a false-colour encoding of each frame's measured wavelength,
// like the SPHEREx infrared mode (R5.2). Hue is computed from the wavelength, so it is tagged
// `derived` with its formula and shows the Estimated badge (D-02). In "Measured only" (D-21) the
// trail is drawn in one colour instead, with the wavelength still in each dot's label.
import type { Tag } from '@/contract';
import type { HonestyState } from '@/state/store';

export const WAVELENGTH_COLOR_TAG: Tag = 'derived';
export const WAVELENGTH_COLOR_FORMULA = 'false colour: hue = wavelength';

/** D-21: "Measured only" hides `derived` layers, so the trail loses its false colour there. */
export function trailsMonochrome(honesty: HonestyState | null): boolean {
  return honesty === 'measured';
}

/** SPHEREx covers 0.75–5.0 µm (A3.1). Used only to spread the hues. */
export const SPHEREX_MIN_UM = 0.75;
export const SPHEREX_MAX_UM = 5.0;

/** Short wavelengths violet, long wavelengths red, like the visible spectrum. */
export function wavelengthColor(um: number): string {
  const t = Math.min(Math.max((um - SPHEREX_MIN_UM) / (SPHEREX_MAX_UM - SPHEREX_MIN_UM), 0), 1);
  const hue = Math.round(270 * (1 - t));
  return `hsl(${hue} 85% 62%)`;
}

/** CSS gradient for the legend, with the same mapping. */
export function wavelengthGradient(): string {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const um = SPHEREX_MIN_UM + t * (SPHEREX_MAX_UM - SPHEREX_MIN_UM);
    return `${wavelengthColor(um)} ${t * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
