// Flipbook colour views: the tint colour per wavelength, the D-21 "Measured only" fallback, the
// transport lock while the composite shows, and the link parameter.
import { describe, expect, it } from 'vitest';
import {
  COLOUR_TAG,
  colourAnnouncement,
  colourHidden,
  colourHiddenNote,
  COMPOSITE_TRANSPORT_NOTE,
  DEFAULT_COLOUR_CHOICE,
  effectiveColour,
  legendPosition,
  parseColourParam,
  requestedColour,
  tintColour,
  tintFormula,
  transportLocked,
  type ColourChoice,
} from './colourMode';
import {
  SPHEREX_MAX_UM,
  SPHEREX_MIN_UM,
  WAVELENGTH_COLOR_FORMULA,
  wavelengthColor,
} from './wavelengthColor';

const tint: ColourChoice = { on: true, view: 'tint' };
const composite: ColourChoice = { on: true, view: 'composite' };

/** Hue of an `hsl(<h> …)` string. */
const hue = (css: string) => Number(/^hsl\((\d+)/.exec(css)?.[1]);

describe('wavelength tint colour', () => {
  it('uses the Rainbow Trails mapping: violet at 0.75 µm, red at 5.0 µm', () => {
    expect(tintColour(0.75)).toBe(wavelengthColor(0.75));
    expect(hue(tintColour(SPHEREX_MIN_UM))).toBe(270);
    expect(hue(tintColour(SPHEREX_MAX_UM))).toBe(0);
    expect(hue(tintColour(2.875))).toBe(135);
  });

  it('gets warmer as the wavelength grows, and clamps outside the SPHEREx range', () => {
    const hues = [0.75, 1.5, 2.5, 3.5, 5.0].map((um) => hue(tintColour(um)));
    for (let i = 1; i < hues.length; i++) expect(hues[i]!).toBeLessThan(hues[i - 1]!);
    expect(tintColour(0.1)).toBe(tintColour(SPHEREX_MIN_UM));
    expect(tintColour(9)).toBe(tintColour(SPHEREX_MAX_UM));
  });

  it('is tagged derived with the false-colour formula plus the stretch (D-02)', () => {
    expect(COLOUR_TAG.tint).toBe('derived');
    expect(COLOUR_TAG.composite).toBe('derived');
    const f = tintFormula('Display stretch asinh, parameters {}');
    expect(f.startsWith(WAVELENGTH_COLOR_FORMULA)).toBe(true);
    expect(f).toContain('asinh');
  });

  it('places the current wavelength on the legend', () => {
    expect(legendPosition(0.75, SPHEREX_MIN_UM, SPHEREX_MAX_UM)).toBe(0);
    expect(legendPosition(5, SPHEREX_MIN_UM, SPHEREX_MAX_UM)).toBe(1);
    expect(legendPosition(2.875, SPHEREX_MIN_UM, SPHEREX_MAX_UM)).toBeCloseTo(0.5);
    expect(legendPosition(12, SPHEREX_MIN_UM, SPHEREX_MAX_UM)).toBe(1);
  });
});

describe('colour choice and honesty (D-21)', () => {
  it('starts at Raw, with the tint as the colour view', () => {
    expect(DEFAULT_COLOUR_CHOICE).toEqual({ on: false, view: 'tint' });
    expect(requestedColour(DEFAULT_COLOUR_CHOICE)).toBe('raw');
    expect(requestedColour({ on: false, view: 'composite' })).toBe('raw');
  });

  it('shows the colour view at + Estimated and + Artistic', () => {
    for (const h of ['derived', 'artistic', null] as const) {
      expect(effectiveColour(tint, h)).toBe('tint');
      expect(effectiveColour(composite, h)).toBe('composite');
      expect(colourHidden(tint, h)).toBe(false);
    }
  });

  it('falls back to the grey frames in Measured only, and says why', () => {
    expect(effectiveColour(tint, 'measured')).toBe('raw');
    expect(effectiveColour(composite, 'measured')).toBe('raw');
    expect(colourHidden(tint, 'measured')).toBe(true);
    expect(colourHidden(DEFAULT_COLOUR_CHOICE, 'measured')).toBe(false);
    expect(colourHiddenNote('tint')).toMatch(/hidden in Measured only.*grey frames/);
    expect(colourHiddenNote('composite')).toMatch(/^The SPHEREx composite/);
    expect(colourAnnouncement('raw', true)).toMatch(/Measured only/);
  });

  it('locks the transport only while the composite shows', () => {
    expect(transportLocked('composite')).toBe(true);
    expect(transportLocked('tint')).toBe(false);
    expect(transportLocked('raw')).toBe(false);
    expect(transportLocked(effectiveColour(composite, 'measured'))).toBe(false);
    expect(COMPOSITE_TRANSPORT_NOTE).toBe(
      'A composite is one picture; switch to Raw or Wavelength tint to play frames.',
    );
  });

  it('reads the link parameter', () => {
    expect(parseColourParam('tint')).toBe('tint');
    expect(parseColourParam('composite')).toBe('composite');
    expect(parseColourParam('raw')).toBeNull();
    expect(parseColourParam('rainbow')).toBeNull();
  });
});
