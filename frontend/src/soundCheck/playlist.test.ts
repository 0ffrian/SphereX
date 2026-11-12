import { describe, expect, it } from 'vitest';
import { clips, peakDb, PeakHold, rmsDb, METER_FLOOR_DB } from './meter';
import { BED_STEP_S, playlist } from './playlist';
import type { BedLevel, SourceId } from '@/sound/ambience/types';

const bed = (id: SourceId, gainDb = -6, variant = 0): BedLevel => ({
  id,
  variant,
  trueDb: 60,
  gainDb,
  lowpassHz: 8000,
  shelfDb: 0,
  pan: 0,
  playbackRate: 1,
  harmonic: false,
});

describe('sound-check playlist', () => {
  it('present baked beds in priority order, 5 s each, then thunder, then the data sound', () => {
    const steps = playlist({
      beds: [bed('S6'), bed('S5'), bed('S1_land'), bed('S4', -120)],
      baked: new Set(['S6|0', 'S5|0', 'S1_land|0', 'S4|0']),
      lightning: { allowed: true, reason: null },
      thunderVariants: [0, 2],
      chord: false,
    });
    expect(steps.map((s) => s.kind)).toEqual(['bed', 'bed', 'bed', 'thunder', 'data']);
    expect(steps.slice(0, 3).map((s) => (s.kind === 'bed' ? s.id : ''))).toEqual([
      'S1_land',
      'S5',
      'S6',
    ]);
    expect(steps[0]!.seconds).toBe(BED_STEP_S);
  });

  it('a refused thunder gives a reason step; unbaked beds are skipped', () => {
    const steps = playlist({
      beds: [bed('S1_land'), bed('S5')],
      baked: new Set(['S1_land|0']),
      lightning: {
        allowed: false,
        reason: 'No lightning has ever been detected on Titan, so there is no thunder here.',
      },
      thunderVariants: [],
      chord: true,
    });
    expect(steps.map((s) => s.kind)).toEqual(['bed', 'reason', 'data']);
    expect(steps[1]!.label).toMatch(/Titan/);
    expect(steps[2]!.label).toMatch(/chord/);
  });
});

describe('sound-check meter maths', () => {
  it('rms and peak of a full-scale sine', () => {
    const s = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * i) / 48));
    expect(rmsDb(s)).toBeCloseTo(-3.01, 1);
    expect(peakDb(s)).toBeCloseTo(0, 1);
    expect(clips(s)).toBeGreaterThan(0);
    expect(rmsDb(new Float32Array(16))).toBe(METER_FLOOR_DB);
  });
  it('peak hold keeps the max for 1 s', () => {
    const h = new PeakHold(1);
    expect(h.update(-6, 0)).toBe(-6);
    expect(h.update(-20, 0.5)).toBe(-6);
    expect(h.update(-20, 1.6)).toBe(-20);
  });
});
