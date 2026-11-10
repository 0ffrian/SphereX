// Issue #68 Part 3d: the substellar mode of the terrain field. Ice and ocean follow the angle from
// the body-fixed star-facing point (+X), the polar mode is byte-identical to before, and the worker,
// the client fallback and the main thread give the same bytes.
import { describe, expect, it } from 'vitest';
import {
  FieldSampler,
  SUBSTELLAR_DIRECTION,
  directionToUV,
  fieldHash,
  generateField,
  pixelDirection,
  type FieldParams,
} from './fieldGenerator';
import { handleFieldRequest } from './fieldWorker';
import { requestField } from './fieldClient';

const W = 128;
const H = 64;
const rocky: FieldParams = {
  kind: 'terrain',
  seed: 10,
  freq: 1.6,
  seaLevel: 0,
  iceExtent: 0,
  heat: 0,
  bands: 0,
  turbulence: 0,
  storms: 0,
};
const water: FieldParams = { ...rocky, seed: 11, freq: 2, seaLevel: 0.4, iceExtent: 0.22 };
const eyeball: FieldParams = { ...water, substellar: true, iceAngleRad: (52 * Math.PI) / 180 };
const snowRock: FieldParams = { ...rocky, substellar: true, iceAngleRad: 0 };
const snowSea: FieldParams = { ...water, substellar: true, iceAngleRad: 0 };

const angleDeg = (c: number, r: number, w = W, h = H): number => {
  const d = pixelDirection(c, r, w, h);
  const dot =
    d[0] * SUBSTELLAR_DIRECTION[0] +
    d[1] * SUBSTELLAR_DIRECTION[1] +
    d[2] * SUBSTELLAR_DIRECTION[2];
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
};
/** Mean ice mask over the pixels whose angle from the substellar point lies in [lo, hi) degrees. */
function meanIce(p: FieldParams, lo: number, hi: number): number {
  const f = generateField(p, W, H);
  let s = 0;
  let n = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const a = angleDeg(c, r);
      if (a >= lo && a < hi) {
        s += f.b[(r * W + c) * 4 + 1]!;
        n++;
      }
    }
  return s / n;
}

describe('the polar mode is unchanged', () => {
  it('absent, false or irrelevant substellar fields give the bytes the generator gave before', () => {
    // Hashes of generateField for these params, taken from the generator before this change.
    expect(fieldHash(generateField(water))).toBe('ab641599');
    expect(fieldHash(generateField({ ...rocky, seed: 10, freq: 1.6, heat: 0.8 }))).toBe('a4aded1a');
    expect(fieldHash(generateField({ ...water, substellar: false, iceAngleRad: 1 }))).toBe(
      'ab641599',
    );
  });
});

describe('substellar mode', () => {
  it('+X is the star-facing point: longitude 0 sits at the middle column of the texture', () => {
    const { u, v } = directionToUV(SUBSTELLAR_DIRECTION);
    expect(u).toBeCloseTo(0.5, 12);
    expect(v).toBeCloseTo(0.5, 12);
  });

  it('keeps the open cap free of ice and puts ice outside it, the night side included', () => {
    expect(meanIce(eyeball, 0, 35)).toBeLessThan(0.02);
    expect(meanIce(eyeball, 70, 180)).toBeGreaterThan(0.98);
    // the edge is between: a smooth, irregular transition around 52 degrees
    const edge = meanIce(eyeball, 45, 60);
    expect(edge).toBeGreaterThan(0.1);
    expect(edge).toBeLessThan(0.9);
  });

  it('does not depend on latitude: the same ice at the north pole region and the equator for equal angles', () => {
    // Points at 90 degrees from +X are on the night/day boundary at any latitude: all iced.
    const f = generateField(eyeball, W, H);
    const iceAt = (c: number, r: number) => f.b[(r * W + c) * 4 + 1]!;
    expect(iceAt(W / 2 + 0, 1)).toBeGreaterThan(0.9); // near the north pole: 90 degrees from +X
    expect(iceAt(W / 2, H / 2)).toBeLessThan(0.02); // star-facing point
    expect(iceAt(0, H / 2)).toBeGreaterThan(0.98); // anti-stellar point
  });

  it('a snowball is ice everywhere on a water world and mostly ice with a little rock on bare ground', () => {
    expect(meanIce(snowSea, 0, 180)).toBe(1);
    const rock = meanIce(snowRock, 0, 180);
    expect(rock).toBeLessThan(1);
    expect(rock).toBeGreaterThan(0.85);
  });

  it('ignores iceExtent (the polar rule) in this mode', () => {
    const a = fieldHash(generateField({ ...eyeball, iceExtent: 0.9 }, W, H));
    const b = fieldHash(generateField({ ...eyeball, iceExtent: 0 }, W, H));
    expect(a).toBe(b);
  });

  it('is deterministic and the seed changes the edge', () => {
    expect(fieldHash(generateField(eyeball, W, H))).toBe(fieldHash(generateField(eyeball, W, H)));
    expect(fieldHash(generateField(eyeball, W, H))).not.toBe(
      fieldHash(generateField({ ...eyeball, seed: 12 }, W, H)),
    );
    // A different cap gives a different field.
    expect(fieldHash(generateField(eyeball, W, H))).not.toBe(
      fieldHash(generateField({ ...eyeball, iceAngleRad: 1.2 }, W, H)),
    );
  });

  it('haptics read the same mask: the sampler sees ice outside the cap and none inside', () => {
    const s = new FieldSampler(generateField(eyeball));
    expect(s.sampleDirection([1, 0, 0]).ice).toBeLessThan(0.02);
    expect(s.sampleDirection([-1, 0, 0]).ice).toBeGreaterThan(0.98);
    expect(s.sampleDirection([0, 0, 1]).ice).toBeGreaterThan(0.9);
  });
});

describe('worker, client and main-thread paths give identical bytes in substellar mode', () => {
  it('handleFieldRequest, requestField (no Worker in node) and generateField agree', async () => {
    const direct = fieldHash(generateField(eyeball));
    const res = handleFieldRequest({ id: 1, kind: 'field', params: eyeball });
    expect('field' in res && fieldHash(res.field)).toBe(direct);
    expect(fieldHash(await requestField(eyeball))).toBe(direct);
    // The worker receives the params by structured clone: the extra fields survive it.
    expect(fieldHash(generateField(structuredClone(eyeball)))).toBe(direct);
  });
});
