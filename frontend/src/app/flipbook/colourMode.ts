// Flipbook colour views (sky-view prototype). The flipbook shows the SPHEREx frames as measured grey
// pictures (Raw) or in one of two colour views:
// - Wavelength tint: each grey frame multiplied by the false colour of its own wavelength, with the
//   Rainbow Trails mapping (wavelengthColor.ts). `derived`, formula "false colour: hue = wavelength".
// - SPHEREx composite: one RGB picture the backend builds from three aligned frames
//   (`GET /v1/objects/{id}/composite`), `derived` with the reply's formula.
// Both are false colour, so both carry the Estimated badge and both are hidden in "Measured only"
// (D-21): the flipbook falls back to the grey frames there and says why. See Q-27.
// Pure, so the rules are unit-tested.
import type { Tag } from '@/contract';
import type { HonestyState } from '@/state/store';
import { WAVELENGTH_COLOR_FORMULA, WAVELENGTH_COLOR_TAG, wavelengthColor } from './wavelengthColor';

/** Which colour view the "Colour" choice opens. */
export type ColourView = 'tint' | 'composite';
/** What the flipbook draws: the grey frames, the tinted frames or the composite. */
export type FlipColour = 'raw' | ColourView;

export const COLOUR_VIEWS: readonly ColourView[] = ['tint', 'composite'];

/** The user's choice: the Raw | Colour switch, and which colour view Colour means. */
export interface ColourChoice {
  on: boolean;
  view: ColourView;
}

export const DEFAULT_COLOUR_CHOICE: ColourChoice = { on: false, view: 'tint' };

/** The view the user asked for, before the honesty filter. */
export function requestedColour(choice: ColourChoice): FlipColour {
  return choice.on ? choice.view : 'raw';
}

/** Tag of each colour view (D-02). Raw pixels are `measured`; both colour views are false colour. */
export const COLOUR_TAG: Readonly<Record<ColourView, Tag>> = {
  tint: WAVELENGTH_COLOR_TAG,
  composite: 'derived',
};

/**
 * D-21: "Measured only" shows `measured` layers only. Both colour views are `derived`, so there
 * the flipbook draws the grey frames instead. `null` is the store's unset state, which the viewer
 * reads as the starting state (+ Estimated).
 */
export function effectiveColour(choice: ColourChoice, honesty: HonestyState | null): FlipColour {
  const asked = requestedColour(choice);
  if (asked === 'raw') return 'raw';
  return honesty === 'measured' ? 'raw' : asked;
}

/** True when a colour view was asked for but the honesty state hides it. */
export function colourHidden(choice: ColourChoice, honesty: HonestyState | null): boolean {
  return requestedColour(choice) !== 'raw' && effectiveColour(choice, honesty) === 'raw';
}

/** The transport bar does not drive a composite: it is one picture, not a frame sequence. */
export function transportLocked(colour: FlipColour): boolean {
  return colour === 'composite';
}

export const COMPOSITE_TRANSPORT_NOTE =
  'A composite is one picture; switch to Raw or Wavelength tint to play frames.';

const VIEW_NAME: Readonly<Record<FlipColour, string>> = {
  raw: 'Raw',
  tint: 'Wavelength tint',
  composite: 'SPHEREx composite',
};

export function colourViewName(c: FlipColour): string {
  return VIEW_NAME[c];
}

/** Note shown when "Measured only" hides the colour view that was asked for. */
export function colourHiddenNote(view: ColourView): string {
  const what = view === 'tint' ? 'The wavelength tint' : 'The SPHEREx composite';
  return `${what} is a false colour (Estimated), so it is hidden in Measured only. Showing the grey frames.`;
}

/** Text for the polite live region when the view changes (R9). */
export function colourAnnouncement(c: FlipColour, hidden: boolean): string {
  if (hidden) return 'Colour hidden in Measured only. Showing the grey frames.';
  if (c === 'tint') return 'Wavelength tint: each frame coloured by its wavelength (false colour).';
  if (c === 'composite') return 'SPHEREx composite: one colour picture from three frames.';
  return 'Raw frames: grey, as measured.';
}

/** CSS colour that multiplies a grey frame of this wavelength (grey luminance × colour). */
export function tintColour(wavelengthUm: number): string {
  return wavelengthColor(wavelengthUm);
}

/** Tooltip of the tint's Estimated badge: the false-colour formula plus the display stretch. */
export function tintFormula(stretch: string): string {
  return `${WAVELENGTH_COLOR_FORMULA}; frame brightness: ${stretch}`;
}

/** Where a wavelength sits on the 0.75–5.0 µm legend, 0–1 (clamped like the hue). */
export function legendPosition(wavelengthUm: number, min: number, max: number): number {
  return Math.min(Math.max((wavelengthUm - min) / (max - min), 0), 1);
}

/** Parses the `colour=` value of a link (urlHash.ts): `tint`, `composite`, or null if unknown. */
export function parseColourParam(value: string): ColourView | null {
  return (COLOUR_VIEWS as readonly string[]).includes(value) ? (value as ColourView) : null;
}
