import { describe, expect, it } from 'vitest';
import { RecordingSink, sampleUV } from '@/test/hapticRecorder';
import { FieldSampler, type FieldData } from '@/viewer/fields/fieldGenerator';
import {
  ICE_TICK_SPACING_PX,
  OCEAN_SWELL_HZ,
  OCEAN_SWELL_MAX_HZ,
  OCEAN_SWELL_MIN_HZ,
  OCEAN_SWELL_STRENGTH,
  STRENGTH_FIRM,
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
    expect(start!.params!.strength).toBe(OCEAN_SWELL_STRENGTH);
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
