import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Frame, FramesResponse, ResolveResponse } from '@/app/api/types';
import {
  RainbowTrails,
  RainbowTrailsLegend,
  TRAILS_NO_CUTOUTS,
  TRAILS_WAITING,
  trailsUnavailableReason,
} from './RainbowTrails';
import {
  trailsMonochrome,
  WAVELENGTH_COLOR_FORMULA,
  WAVELENGTH_COLOR_TAG,
} from './wavelengthColor';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Test data only, not physical claims.
const frame = (i: number, wl: number): Frame => ({
  frame_id: `f${i}`,
  time: '2025-05-03T00:00:00Z',
  wavelength_um: wl,
  x: 10 + i,
  y: 20,
  cutout_url: `/c/${i}.png`,
  flags: [],
});
const frames = [frame(0, 0.8), frame(1, 2.5), frame(2, 4.9)];
const mover: ResolveResponse = {
  id: 'm',
  name: 'Mover',
  ra: 1,
  dec: 1,
  moving: true,
  resolver: 'sbdb',
  cached_at: null,
};
const response = (north_up: boolean): FramesResponse => ({
  id: 'm',
  frames,
  north_up,
  stretch: { kind: 'asinh', params: {} },
  data_release: 'test',
  cached_at: null,
  missing: [],
});
const size = { w: 64, h: 64 };

describe('Rainbow Trails availability', () => {
  it('needs a north-up grid and a moving object', () => {
    const ok = { imageSize: size, allSettled: true };
    expect(trailsUnavailableReason(mover, response(true), ok)).toBeNull();
    expect(trailsUnavailableReason(mover, response(false), ok)).toMatch(/native orientation/);
    expect(trailsUnavailableReason({ ...mover, moving: false }, response(true), ok)).toMatch(
      /moving objects/,
    );
  });

  // Review finding 6: with every cutout failed, the mode was enabled but drew nothing.
  it('is disabled with a reason when no cutout could be loaded', () => {
    expect(
      trailsUnavailableReason(mover, response(true), { imageSize: null, allSettled: true }),
    ).toBe(TRAILS_NO_CUTOUTS);
    expect(
      trailsUnavailableReason(mover, response(true), { imageSize: null, allSettled: false }),
    ).toBe(TRAILS_WAITING);
  });
});

describe('Rainbow Trails colour (false colour, derived)', () => {
  it('is tagged derived with its formula', () => {
    expect(WAVELENGTH_COLOR_TAG).toBe('derived');
    expect(WAVELENGTH_COLOR_FORMULA).toBe('false colour: hue = wavelength');
  });

  it('goes monochrome only in Measured only', () => {
    expect(trailsMonochrome('measured')).toBe(true);
    expect(trailsMonochrome('derived')).toBe(false);
    expect(trailsMonochrome('artistic')).toBe(false);
    expect(trailsMonochrome(null)).toBe(false);
  });
});

describe('Rainbow Trails rendering', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const fills = () =>
    [...host.querySelectorAll('[data-testid="trail-dot"]')].map((d) => d.getAttribute('fill'));

  it('colours each dot by wavelength, or one colour when monochrome', () => {
    act(() =>
      root.render(<RainbowTrails frames={frames} width={64} height={64} currentIndex={0} />),
    );
    expect(new Set(fills()).size).toBe(3);
    act(() =>
      root.render(
        <RainbowTrails frames={frames} width={64} height={64} currentIndex={0} monochrome />,
      ),
    );
    expect(new Set(fills()).size).toBe(1);
  });

  // Review finding 4: the legend said "artist's choice"; it is an Estimated (derived) false colour.
  it('legend shows the Estimated badge with the formula, not "artist’s choice"', () => {
    act(() => root.render(<RainbowTrailsLegend />));
    const badge = host.querySelector('[data-testid="badge-estimated"]')!;
    expect(badge.textContent).toBe('Estimated: false colour: hue = wavelength');
    expect(badge.hasAttribute('aria-label')).toBe(false);
    // Re-review item 2: the formula is text (sr-only) that screen readers read, not only a tooltip.
    const formula = host.querySelector('[data-testid="badge-estimated-formula"]')!;
    expect(formula.className).toContain('sr-only');
    expect(formula.textContent).toBe(': false colour: hue = wavelength');
    expect(badge.getAttribute('title')).toBe('false colour: hue = wavelength');
    expect(host.textContent).not.toMatch(/artist/i);
    act(() => root.render(<RainbowTrailsLegend monochrome />));
    expect(host.querySelector('[data-testid="badge-estimated"]')).toBeNull();
    expect(host.textContent).toMatch(/hidden in Measured only/);
  });
});
