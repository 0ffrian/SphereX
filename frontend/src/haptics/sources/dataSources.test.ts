// Data sources (R8.5) and the comet / cloud field (R8.4), plus the mesh-normal angle rule.
import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { RecordingSink, sampleAt } from '@/test/hapticRecorder';
import { fixture } from '@/test/sharedFixtures';
import type { PointSet } from '@/viewer/renderers/pointClouds';
import { lightcurveScrub, screenOpacity } from '@/viewer/renderers/Star';
import {
  BINARY_COOL_HZ,
  BINARY_WARM_HZ,
  DATA_PULSE_MAX_HZ,
  DATA_PULSE_MIN_HZ,
  DATA_PULSE_STRENGTH,
  FIELD_K,
  FIELD_MAX_HZ,
  FIELD_MIN_HZ,
  STRENGTH_FIRM,
  TEQ_DISPLAY_MAX_K,
  TEQ_DISPLAY_MIN_K,
  TTAURI_PULSE_HZ,
} from '../tuning';
import {
  BinaryPulseSource,
  binaryRates,
  classRank,
  DATA_TRAIN_ID,
  HoldPulseSource,
  normaliseTeq,
  pulseRateHz,
} from './dataPulse';
import { CometFieldSource, cometFieldRateHz, PointDensitySource, pointsNearRay } from './field';
import { MiraHeartbeatSource, TTauriDimmingSource } from './lightcurve';
import { angleDeg, MeshNormalSource, normalTurnStrength } from './meshNormal';
import { TrainSlot } from './types';

describe('teq_pulse / flux_pulse rates (R8.5: 2–12 Hz)', () => {
  it('maps 0–1 onto 2–12 Hz, capped by maxRateHz', () => {
    expect(pulseRateHz(0)).toBe(DATA_PULSE_MIN_HZ);
    expect(pulseRateHz(1)).toBe(DATA_PULSE_MAX_HZ);
    expect(pulseRateHz(2)).toBe(DATA_PULSE_MAX_HZ);
    expect(pulseRateHz(1, 6)).toBe(6);
    expect(pulseRateHz(0.5)).toBe((DATA_PULSE_MIN_HZ + DATA_PULSE_MAX_HZ) / 2);
  });

  it('normalises Teq over the display range', () => {
    expect(normaliseTeq(TEQ_DISPLAY_MIN_K - 50)).toBe(0);
    expect(normaliseTeq(TEQ_DISPLAY_MAX_K + 50)).toBe(1);
    expect(normaliseTeq((TEQ_DISPLAY_MIN_K + TEQ_DISPLAY_MAX_K) / 2)).toBeCloseTo(0.5);
  });

  it('HoldPulseSource plays only on hold over the body and stops when the finger leaves', () => {
    const sink = new RecordingSink();
    const src = new HoldPulseSource(sink, 'teq_pulse', 'measured', 5);
    src.move(sampleAt([0, 0, 1]));
    expect(sink.activeTrainId).toBeNull();
    src.hold(sampleAt([0, 0, 1]));
    expect(sink.activeTrainId).toBe(DATA_TRAIN_ID);
    expect(sink.current).toMatchObject({ rateHz: 5, tag: 'measured' });
    src.move(sampleAt([0, 0, 1], { bodyId: null }));
    expect(sink.activeTrainId).toBeNull();
    src.hold(sampleAt([0, 0, 1], { bodyId: null }));
    expect(sink.activeTrainId).toBeNull();
  });
});

describe('brown_dwarf_binary: rate by temperature class, warmer faster', () => {
  it('orders classes along O B A F G K M L T Y', () => {
    expect(classRank('T1')! < classRank('T6')!).toBe(true);
    expect(classRank('L9')! < classRank('T0')!).toBe(true);
    expect(classRank('Y0')! > classRank('T9')!).toBe(true);
    expect(classRank('??')).toBeNull();
    expect(binaryRates(['T1', 'T6'])).toEqual([BINARY_WARM_HZ, BINARY_COOL_HZ]);
    expect(binaryRates(['T6', 'T1'])).toEqual([BINARY_COOL_HZ, BINARY_WARM_HZ]);
    expect(binaryRates(['T1', 'T1'])).toBeNull();
    expect(binaryRates(['T1'])).toBeNull();
    // Words are not classes: the subclass digit is required and no letter may follow it.
    for (const bad of ['Brown', 'Late T', 'mid-L', 'T', 'Tx', 'T1V', 'L dwarf', '']) {
      expect(classRank(bad), bad).toBeNull();
    }
    expect(classRank('T6.5')).toBe(classRank('T6')! + 0.5);
    expect(binaryRates(['Brown', 'T6'])).toBeNull();
    expect(BINARY_WARM_HZ).toBeGreaterThan(BINARY_COOL_HZ);
  });

  it('switches rate between the bodies and stops off them', () => {
    const sink = new RecordingSink();
    const src = new BinaryPulseSource(sink, 'measured', [BINARY_WARM_HZ, BINARY_COOL_HZ]);
    src.move(sampleAt([0, 0, 1], { bodyId: 'body_a' }));
    expect(sink.current!.rateHz).toBe(BINARY_WARM_HZ);
    src.move(sampleAt([0, 0, 1], { bodyId: 'body_b' }));
    expect(sink.current!.rateHz).toBe(BINARY_COOL_HZ);
    src.move(sampleAt([0, 0, 1], { bodyId: null }));
    expect(sink.activeTrainId).toBeNull();
  });

  it('a single drawn body plays the first component', () => {
    const sink = new RecordingSink();
    const src = new BinaryPulseSource(sink, 'measured', [BINARY_WARM_HZ, BINARY_COOL_HZ]);
    src.move(sampleAt([0, 0, 1], { bodyId: 'body' }));
    expect(sink.current!.rateHz).toBe(BINARY_WARM_HZ);
  });
});

describe('comet field (R8.4)', () => {
  it('rate = clamp(k·Q/r, 2, max)', () => {
    expect(cometFieldRateHz(1, 0.1, 1, 30)).toBeCloseTo(10);
    expect(cometFieldRateHz(1, 0.01, 1, 30)).toBe(30);
    expect(cometFieldRateHz(0.1, 0.9, 1, 30)).toBe(FIELD_MIN_HZ);
    expect(cometFieldRateHz(1, 0, 1, FIELD_MAX_HZ)).toBe(FIELD_MAX_HZ);
  });

  it('December (Q 1) feels denser than August (Q 0.25) across the coma at the default k', () => {
    for (const r of [0.3, 0.5, 0.75, 1]) {
      expect(cometFieldRateHz(1, r, FIELD_K, FIELD_MAX_HZ)).toBeGreaterThan(
        cometFieldRateHz(0.25, r, FIELD_K, FIELD_MAX_HZ),
      );
    }
  });

  it('denser near the nucleus, firm tick on the nucleus, nothing outside the coma', () => {
    const sink = new RecordingSink();
    const src = new CometFieldSource(sink, 'model_dependent', { qNorm: 1, nucleusRadius: 0.02 });
    const at = (r: number) => {
      const s = sampleAt([0, 0, 1], { bodyId: null });
      s.centreDistance = r;
      src.move(s);
    };
    at(0.5);
    const far = sink.current!.rateHz;
    at(0.1);
    expect(sink.current!.rateHz).toBeGreaterThan(far);
    expect(sink.current!.tag).toBe('model_dependent');
    at(0.01);
    // On the nucleus: one firm tick and no coma pulse under the finger.
    expect(sink.activeTrainId).toBeNull();
    at(0.005);
    expect(sink.ticks()).toHaveLength(1);
    expect(sink.ticks()[0]!.strength).toBe(STRENGTH_FIRM);
    // Leaving and coming back ticks again.
    at(0.2);
    expect(sink.activeTrainId).not.toBeNull();
    at(0.015);
    expect(sink.ticks()).toHaveLength(2);
    at(1.5);
    expect(sink.activeTrainId).toBeNull();
  });
});

function set(points: [number, number, number][]): PointSet {
  return {
    count: points.length,
    positions: new Float32Array(points.flat()),
    colors: new Float32Array(points.length * 3),
  };
}

describe('nebula / nova point density (R8.4 item 4)', () => {
  it('counts points within the radius of the ray', () => {
    const s = set([
      [0, 0, 0],
      [0.05, 0, 0.5],
      [0.5, 0, 0],
    ]);
    expect(pointsNearRay([s], [0, 0, 5], [0, 0, -1], 0.1)).toBe(2);
    expect(pointsNearRay([s], [0.5, 0, 5], [0, 0, -1], 0.1)).toBe(1);
    expect(pointsNearRay([s], [3, 0, 5], [0, 0, -1], 0.1)).toBe(0);
  });

  it('a denser spot pulses faster; an empty spot is silent', () => {
    const dense: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) dense.push([0, 0, i / 12 - 0.5]);
    for (let i = 0; i < 2; i++) dense.push([0.5, 0, i / 2 - 0.5]);
    // Background far from both rays, so the density is relative to a realistic cloud size.
    for (let i = 0; i < 2000; i++) dense.push([0.9, 0.5, i / 2000 - 0.5]);
    const sink = new RecordingSink();
    const src = new PointDensitySource(sink, { glow: set(dense) }, 'artistic');
    const ray = (x: number, px = x * 100) => {
      const s = sampleAt([0, 0, 1], { bodyId: null, x: px });
      s.rayOrigin = [x, 0, 5];
      s.rayDir = [0, 0, -1];
      src.move(s);
    };
    ray(0.5);
    const sparse = sink.current!.rateHz;
    ray(0);
    expect(sink.current!.rateHz).toBeGreaterThan(sparse);
    expect(sink.current!.tag).toBe('artistic');
    ray(-0.7);
    expect(sink.activeTrainId).toBeNull();
    expect(src.rateFor(0)).toBe(0);

    // Under 1 px of finger travel the O(points) count is skipped (perf review).
    ray(0, 0);
    const before = src.recounts;
    ray(0, 0.4); // 0.4 px from the last count at px 0
    expect(src.recounts).toBe(before);
    ray(0, 5);
    expect(src.recounts).toBe(before + 1);
  });
});

describe('light curve (R8.5)', () => {
  it('star_mira: one heartbeat per scrub step, strength = flux ÷ brightest', () => {
    const { card } = fixture('star_mira');
    const sink = new RecordingSink();
    const src = new MiraHeartbeatSource(sink, card, 'measured');
    src.scrub(0);
    src.scrub(0.2); // same step: no new beat
    src.scrub(1);
    src.scrub(2);
    const beats = sink.ticks('heartbeat');
    expect(beats).toHaveLength(3);
    beats.forEach((b, i) => {
      expect(b.strength).toBeCloseTo(lightcurveScrub(card, i)!.brightness);
      expect(b.tag).toBe('measured');
    });
  });

  it('star_ttauri: the pulse weakens and thins out with the dimming depth', () => {
    const { card } = fixture('star_ttauri');
    const sink = new RecordingSink();
    const src = new TTauriDimmingSource(sink, card, 'measured');
    const n = card.lightcurve!.length;
    for (let i = 0; i < n; i++) {
      src.scrub(i);
      const depth = screenOpacity(card, i)!;
      expect(sink.current!.rateHz).toBeCloseTo(TTAURI_PULSE_HZ * (1 - depth));
      expect(sink.current!.strength).toBeCloseTo(DATA_PULSE_STRENGTH * (1 - depth));
    }
    src.release();
    expect(sink.activeTrainId).toBeNull();
  });

  it('a synthetic deep dip drops the rate in proportion', () => {
    const card = {
      ...fixture('star_ttauri').card,
      lightcurve: [1, 1, 1, 0.5].map((flux, i) => ({
        t_mjd: i,
        flux,
        sigma: 0.01,
        lambda_um: 2,
        flags: 0,
      })),
    } as ObjectCard;
    const sink = new RecordingSink();
    const src = new TTauriDimmingSource(sink, card, 'measured');
    src.scrub(0);
    expect(sink.current!.rateHz).toBeCloseTo(TTAURI_PULSE_HZ);
    src.scrub(3);
    expect(sink.current!.rateHz).toBeCloseTo(TTAURI_PULSE_HZ * 0.5);
  });
});

describe('mesh normals (R8.4): synthetic geometry', () => {
  it('angle rule: > 12° ticks with clamp(angle / 40°)', () => {
    expect(angleDeg([0, 0, 1], [0, 1, 0])).toBeCloseTo(90);
    expect(normalTurnStrength(12)).toBe(-1);
    expect(normalTurnStrength(20)).toBeCloseTo(0.5);
    expect(normalTurnStrength(60)).toBe(1);
  });

  it('a path over a cube edge ticks once; sliding off the limb gives one firm tick', () => {
    const sink = new RecordingSink();
    const src = new MeshNormalSource(sink, 'measured');
    const face = (n: [number, number, number]) => {
      const s = sampleAt([0, 0, 1]);
      s.normal = n;
      src.move(s);
    };
    face([0, 0, 1]);
    face([0, 0, 1]);
    face([0, Math.sin(0.05), Math.cos(0.05)]); // ~3°: no tick
    face([1, 0, 0]); // 90° edge: full tick
    src.move(sampleAt([0, 0, 1], { bodyId: null })); // off the limb
    src.move(sampleAt([0, 0, 1], { bodyId: null })); // still off: nothing more
    const ticks = sink.ticks();
    expect(ticks.map((t) => t.strength)).toEqual([1, STRENGTH_FIRM]);
    expect(ticks.every((t) => t.tag === 'measured')).toBe(true);
  });
});

describe('TrainSlot', () => {
  it('updates a running train when the pan moves, not on tiny changes', () => {
    const sink = new RecordingSink();
    const slot = new TrainSlot(sink, 'x', 'artistic', 'data');
    slot.play(4, 0.5, -0.5);
    slot.play(4, 0.5, -0.48);
    expect(sink.trains.filter((t) => t.op === 'update')).toHaveLength(0);
    slot.play(4, 0.5, 0.3);
    expect(sink.current!.pan).toBe(0.3);
    slot.stop();
    expect(sink.activeTrainId).toBeNull();
  });
});
