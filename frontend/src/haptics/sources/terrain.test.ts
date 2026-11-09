import { describe, expect, it } from 'vitest';
import { RecordingSink, sampleAt, sampleUV } from '@/test/hapticRecorder';
import {
  FieldSampler,
  fieldHash,
  generateField,
  type FieldData,
  type FieldParams,
} from '@/viewer/fields/fieldGenerator';
import {
  ICE_TICK_SPACING_PX,
  MASK_THRESHOLD,
  OCEAN_SWELL_HZ,
  OCEAN_SWELL_MAX_HZ,
  OCEAN_SWELL_MIN_HZ,
  STRENGTH_FIRM,
  STRENGTH_LOWEST,
  STRENGTH_SOFT,
} from '../tuning';
import { SWELL_TRAIN_ID, TerrainSource } from './terrain';

const W = 64;
const H = 32;

/**
 * Synthetic terrain field: columns 0–15 ocean; 16–47 land with a ridge at column 24 and a lava
 * crack at column 40; rows 0–3 (north) ice everywhere over land.
 */
function terrainField(): FieldSampler {
  const a = new Float32Array(W * H * 4);
  const b = new Float32Array(W * H * 4);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      const ocean = c < 16 || c >= 48;
      a[i] = ocean ? 0.2 : c === 24 ? 0.9 : 0.5;
      b[i] = ocean ? 1 : 0;
      b[i + 1] = !ocean && r < 4 ? 1 : 0;
      b[i + 2] = c === 40 && !ocean ? 1 : 0;
    }
  }
  const data: FieldData = { width: W, height: H, a, b };
  return new FieldSampler(data);
}

/** u at the centre of column c. */
const uc = (c: number) => (c + 0.5) / W;

describe('TerrainSource (R8.4, D-12)', () => {
  it('ocean swell → coastline firm tick → land relief tick → lava double', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, terrainField(), 'artistic', { lava: true });
    const v = 0.5;
    let x = 0;
    for (let c = 4; c <= 44; c += 0.25) src.move(sampleUV(uc(c), v, { x: (x += 3) }));

    // Open ocean: a swell train at the lowest level, voice surf, 1–2 Hz.
    const start = sink.trains.find((t) => t.op === 'start');
    expect(start).toMatchObject({ id: SWELL_TRAIN_ID });
    expect(start!.params).toMatchObject({ rateHz: OCEAN_SWELL_HZ, voice: 'surf', tag: 'artistic' });
    expect(OCEAN_SWELL_HZ).toBeGreaterThanOrEqual(OCEAN_SWELL_MIN_HZ);
    expect(OCEAN_SWELL_HZ).toBeLessThanOrEqual(OCEAN_SWELL_MAX_HZ);
    expect(start!.params!.strength).toBe(STRENGTH_LOWEST);
    // Leaving the ocean stops it.
    expect(sink.trains.some((t) => t.op === 'stop' && t.id === SWELL_TRAIN_ID)).toBe(true);

    // The coastline (firm), then the ridge (rise ≫ 3τ, so also full strength).
    const ticks = sink.ticks();
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.strength).toBe(STRENGTH_FIRM);
    expect(ticks[1]!.strength).toBeGreaterThan(0);
    expect(sink.ticks('double')).toHaveLength(1); // the lava crack
    for (const e of sink.events) expect(e).toMatchObject({ tag: 'artistic', voice: 'click' });
  });

  it('lava cracks are felt only when asked (planet_rocky)', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, terrainField(), 'artistic');
    for (let c = 30; c <= 44; c += 0.25) src.move(sampleUV(uc(c), 0.5));
    expect(sink.ticks('double')).toHaveLength(0);
  });

  it('polar ice gives dense soft ticks by distance travelled', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, terrainField(), 'artistic');
    const v = 2 / H; // inside the ice rows
    const steps = 20;
    for (let i = 0; i < steps; i++) src.move(sampleUV(uc(30) + i * 0.001, v, { x: i * 2 }));
    const soft = sink.ticks().filter((t) => t.strength === STRENGTH_SOFT);
    const travelled = (steps - 1) * 2;
    expect(soft.length).toBe(Math.floor(travelled / ICE_TICK_SPACING_PX));
  });

  it('coming back to the ocean ticks the coast again and restarts the swell; off the body stops it', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, terrainField(), 'artistic');
    for (let c = 20; c >= 10; c -= 0.5) src.move(sampleUV(uc(c), 0.5));
    expect(sink.ticks().filter((t) => t.strength === STRENGTH_FIRM)).toHaveLength(1);
    expect(sink.activeTrainId).toBe(SWELL_TRAIN_ID);
    const off = sampleUV(uc(10), 0.5);
    off.bodyId = null;
    src.move(off);
    expect(sink.activeTrainId).toBeNull();
  });
});

/** 64×32: ocean everywhere; rows 0–7 (north) ice over the ocean; a land island at columns 40–47. */
function icySea(): FieldSampler {
  const a = new Float32Array(W * H * 4);
  const b = new Float32Array(W * H * 4);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      const land = c >= 40 && c < 48;
      // A rough sea floor: if ice over the sea were read as land it would tick.
      a[i] = land ? 0.2 : 0.1 + 0.2 * (c % 2); // a flat island
      b[i] = land ? 0 : 1;
      b[i + 1] = r < 8 ? 1 : 0;
    }
  }
  return new FieldSampler({ width: W, height: H, a, b });
}

describe('TerrainSource: ice drawn over the ocean (review M2)', () => {
  it('ice over the sea is felt as ice, flat, with no hidden coastlines', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, icySea(), 'artistic');
    // Along an ice row over the rough sea floor and across the flat island's hidden coasts.
    for (let i = 0; i <= 200; i++) src.move(sampleUV(uc(10 + (45 * i) / 200), 3 / H, { x: i * 2 }));
    expect(sink.trains).toEqual([]); // no ocean swell under the ice
    const ticks = sink.ticks();
    expect(ticks.length).toBeGreaterThan(10);
    expect(ticks.map((t) => t.strength).filter((x) => x !== STRENGTH_SOFT)).toEqual([]); // ice ticks only
  });

  it('leaving the ice onto open water is a coastline, then the swell', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, icySea(), 'artistic');
    for (let v = 2; v <= 16; v += 0.25) src.move(sampleUV(uc(10), v / H));
    expect(sink.ticks().filter((t) => t.strength === STRENGTH_FIRM)).toHaveLength(1);
    expect(sink.activeTrainId).toBe(SWELL_TRAIN_ID);
  });
});

describe('TerrainSource coastline hysteresis (review m3)', () => {
  it('a finger jittering on the coast does not buzz', () => {
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, terrainField(), 'artistic');
    // Column 15 is ocean, 16 land: the bilinear mask crosses 0.5 at u = 16 / W.
    const edge = 16 / W;
    for (let i = 0; i < 40; i++) {
      const jitter = ((i % 2 ? 1 : -1) * 0.05) / W; // mask 0.45 to 0.55, inside the hysteresis band
      src.move(sampleUV(edge + jitter, 0.5));
    }
    expect(sink.ticks().filter((t) => t.strength === STRENGTH_FIRM).length).toBeLessThanOrEqual(1);
  });
});

describe('TerrainSource: a relief tick and an ice tick in one sample (review m2)', () => {
  it('the relief tick wins', () => {
    const a = new Float32Array(W * H * 4);
    const b = new Float32Array(W * H * 4);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        a[i] = c === 20 ? 1 : 0.5;
        b[i + 1] = 1; // ice on land everywhere
      }
    }
    const sink = new RecordingSink();
    const src = new TerrainSource(
      sink,
      new FieldSampler({ width: W, height: H, a, b }),
      'artistic',
    );
    // 8 px per sample: every sample is due an ice tick.
    for (let c = 17; c <= 23; c += 0.25) src.move(sampleUV(uc(c), 0.5, { x: c * 32 }));
    const strong = sink.ticks().filter((t) => t.strength > STRENGTH_SOFT);
    expect(strong).toHaveLength(1);
  });
});

describe('TerrainSource on a substellar (eyeball) field (issue #68 Part 3f)', () => {
  // Bare rock, no sea: the ice edge is the only zone change along the path. iceAngleRad 0.9 is
  // the TRAPPIST-1 f value.
  const params: FieldParams = {
    kind: 'terrain',
    seed: 7,
    freq: 2.5,
    seaLevel: 0,
    iceExtent: 0,
    heat: 0,
    substellar: true,
    iceAngleRad: 0.9,
    bands: 0,
    turbulence: 0,
    storms: 0,
  };
  const FW = 256;
  const FH = 128;
  const STEP_RAD = 0.005;
  const PX_PER_STEP = 2;

  /** Walks the equator from +X (the star-facing point) to 2 rad away, on the generated field. */
  function walk(data: FieldData) {
    const sampler = new FieldSampler(data);
    const sink = new RecordingSink();
    const src = new TerrainSource(sink, sampler, 'artistic');
    const iceMask: number[] = [];
    const eventAtStep: number[] = [];
    const steps = Math.round(2 / STEP_RAD);
    for (let i = 0; i <= steps; i++) {
      const th = i * STEP_RAD;
      const s = sampleAt([Math.cos(th), 0, Math.sin(th)], { x: i * PX_PER_STEP });
      iceMask.push(sampler.sampleUV(s.u, s.v).ice);
      const before = sink.events.length;
      src.move(s);
      eventAtStep.push(sink.events.length - before);
    }
    return { sink, iceMask, eventAtStep };
  }

  it('feels the ice edge where the generated ice mask says, and is deterministic', () => {
    const data = generateField(params, FW, FH);
    const { sink, iceMask, eventAtStep } = walk(data);

    // The edge in the mask: the first step at or above the threshold.
    const edge = iceMask.findIndex((m) => m >= MASK_THRESHOLD);
    expect(edge).toBeGreaterThan(0); // the cap is open at +X, so ice starts later
    // About 0.9 rad from +X, within the seeded wobble and soft edge (0.2 rad, artistic).
    expect(edge * STEP_RAD).toBeGreaterThan(0.9 - 0.45);
    expect(edge * STEP_RAD).toBeLessThan(0.9 + 0.45);
    // Past the edge the mask stays ice for the rest of this path.
    expect(iceMask.slice(edge).every((m) => m >= MASK_THRESHOLD)).toBe(true);

    // Open cap: no ice-texture ticks at all. Ice: dense soft ticks, one per ICE_TICK_SPACING_PX.
    const iceEvents = eventAtStep.slice(edge).reduce((a, n) => a + n, 0);
    const capEvents = eventAtStep.slice(0, edge).reduce((a, n) => a + n, 0);
    const expectedIce = Math.floor(
      ((iceMask.length - 1 - edge) * PX_PER_STEP) / ICE_TICK_SPACING_PX,
    );
    expect(iceEvents).toBeGreaterThan(expectedIce * 0.8);
    // The output changes at the edge: first soft tick lands within one spacing of it.
    const firstSoft = sink.events.findIndex((e) => e.strength === STRENGTH_SOFT);
    expect(firstSoft).toBeGreaterThanOrEqual(0);
    let seen = 0;
    let softStep = -1;
    for (let i = 0; i < eventAtStep.length && softStep < 0; i++) {
      seen += eventAtStep[i]!;
      if (seen > firstSoft) softStep = i;
    }
    expect(softStep).toBeGreaterThanOrEqual(edge);
    expect(softStep - edge).toBeLessThanOrEqual(Math.ceil(ICE_TICK_SPACING_PX / PX_PER_STEP) + 1);
    // Density on ice is far above the cap's (relief ticks only).
    expect(iceEvents / (iceMask.length - edge)).toBeGreaterThan(
      4 * (capEvents / Math.max(1, edge)),
    );

    // Same seed, same field, same haptic output.
    const again = generateField(params, FW, FH);
    expect(fieldHash(again)).toBe(fieldHash(data));
    expect(walk(again).sink.events).toEqual(sink.events);
  });
});
