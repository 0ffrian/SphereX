// Reference objects (Q-258: Jupiter, Saturn, Titan, the Sun) have no place on the sky: the backend
// sends ra = dec = 0 as a placeholder, so no coordinates are printed and no cached marker is drawn.
import { describe, expect, it } from 'vitest';
import type { SkyCachedObject } from '@/app/api/types';
import { formatCoords } from '@/app/format';
import { cachedMarkersToShow } from './cachedMarkers';
import { NO_SKY_POSITION, hasSkyPosition, positionText, searchPlaceText } from './positionTags';

// Test data only, not physical claims.
const titan = { resolver: 'reference' as const, ra: 0, dec: 0, name: 'Titan' };
const star = { resolver: 'simbad' as const, ra: 181.8, dec: -39.5, name: 'TWA 27' };

describe('reference objects have no sky position', () => {
  it('only a reference object lacks a position', () => {
    expect(hasSkyPosition(titan)).toBe(false);
    for (const r of ['simbad', 'sbdb', 'coords'] as const)
      expect(hasSkyPosition({ resolver: r })).toBe(true);
  });
  it('prints "no fixed sky position" instead of 0, 0', () => {
    expect(positionText(titan)).toBe(NO_SKY_POSITION);
    expect(positionText(star)).toBe(formatCoords(181.8, -39.5));
  });
  it('the frame search names the reference object instead of a position', () => {
    expect(searchPlaceText(titan)).toBe('Titan');
    expect(searchPlaceText({ ...titan, name: null })).toBe(NO_SKY_POSITION);
    expect(searchPlaceText(star)).toBe(formatCoords(181.8, -39.5));
  });
  it('a cached reference object gets no marker', () => {
    const ref: SkyCachedObject = {
      id: 'ref-titan',
      name: 'Titan',
      query: 'Titan',
      ra: 0,
      dec: 0,
      resolver: 'reference',
      frames: 0,
      provenance: {},
    };
    expect(cachedMarkersToShow([ref], [])).toEqual([]);
  });
});
