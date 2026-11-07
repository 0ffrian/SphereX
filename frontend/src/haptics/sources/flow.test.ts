import { describe, expect, it } from 'vitest';
import { RecordingSink, sampleAt, sampleUV } from '@/test/hapticRecorder';
import {
  FieldSampler,
  gasBandAt,
  generateField,
  RING_GAP_EDGES,
  RING_INNER,
  RING_OUTER,
  STORM_EDGE_FACTOR,
  stormsFor,
  type FieldParams,
} from '@/viewer/fields/fieldGenerator';
import { latitudeToPitch } from '../pitch';
import {
  FLOW_JET_MAX_HZ,
  FLOW_JET_MIN_HZ,
  STORM_SWIRL_CENTRE_HZ,
  STORM_SWIRL_EDGE_HZ,
  STRENGTH_FIRM,
  STRENGTH_SOFT,
} from '../tuning';
import { FlowSource, JET_TRAIN_ID, jetRateHz, STORM_TRAIN_ID, swirlRateHz } from './flow';

const GAS: FieldParams = {
  kind: 'gas',
  seed: 4242,
  freq: 0,
  seaLevel: 0,
  iceExtent: 0,
  heat: 0,
  bands: 12,
  turbulence: 0.5,
  storms: 0,
};

// Half resolution keeps the test fast; the sampler and the rule are the same at 512×256.
const W = 256;
const H = 128;

describe('flow rates (D-12)', () => {
  it('jet rate = clamp(k·|wind|/max|wind|, 2, 20) Hz', () => {
    expect(jetRateHz(0)).toBe(FLOW_JET_MIN_HZ);
    expect(jetRateHz(1)).toBe(FLOW_JET_MAX_HZ);
    expect(jetRateHz(-0.5, 20)).toBe(10);
    expect(jetRateHz(0.05, 20)).toBe(FLOW_JET_MIN_HZ);
  });

  it('storm swirl rises from the edge rate to the centre rate', () => {
    expect(swirlRateHz(STORM_EDGE_FACTOR)).toBeCloseTo(STORM_SWIRL_EDGE_HZ);
    expect(swirlRateHz(0)).toBeCloseTo(STORM_SWIRL_CENTRE_HZ);
    expect(swirlRateHz(0.5)).toBeGreaterThan(swirlRateHz(1));
  });
});

describe('R11 shared field: band-boundary ticks line up with the drawn band edges', () => {
  it('ticks exactly where the field band index changes, at the 0.5 crossings the shader draws', () => {
    const field = new FieldSampler(generateField(GAS, W, H));
    const sink = new RecordingSink();
    const src = new FlowSource(sink, field, GAS, 'artistic');
    const u = 0.37;
    const N = 2000;
    const tickAt: number[] = [];
    const indexChangeAt: number[] = [];
    let prevIndex = NaN;
    for (let i = 0; i <= N; i++) {
      const v = 0.02 + (0.96 * i) / N;
      const s = sampleUV(u, v);
      const before = sink.events.length;
      src.move(s);
      if (sink.events.slice(before).some((e) => e.kind === 'tick')) tickAt.push(i);
      const idx = field.sampleUV(s.u, s.v).band;
      if (Number.isFinite(prevIndex) && idx !== prevIndex) indexChangeAt.push(i);
      prevIndex = idx;
    }
    // Same samples tick as change band index in the shared field (no storms here).
    expect(tickAt.length).toBeGreaterThan(6);
    expect(tickAt).toEqual(indexChangeAt);

    // And each tick is next to a crossing of the band profile's 0.5 (the drawn edge, gasBandAt):
    // within one field texel of latitude.
    const texel = 1 / H;
    for (const i of tickAt) {
      const v = 0.02 + (0.96 * i) / N;
      let near = false;
      for (let dv = -1.5 * texel; dv <= 1.5 * texel && !near; dv += texel / 8) {
        const a = sampleUV(u, v + dv).dir;
        const b = sampleUV(u, v + dv + texel / 8).dir;
        const pa = gasBandAt(a, GAS).value - 0.5;
        const pb = gasBandAt(b, GAS).value - 0.5;
        if (pa === 0 || pa * pb < 0) near = true;
      }
      expect(near, `tick at v=${v.toFixed(4)} is not at a drawn band edge`).toBe(true);
    }

    // Band ticks are soft, voice tone, pitch from latitude, artistic.
    const t = sink.ticks()[0]!;
    expect(t).toMatchObject({ strength: STRENGTH_SOFT, voice: 'tone', tag: 'artistic' });
    expect(t.pitch).toBeGreaterThan(latitudeToPitch(-90));
    expect(t.pitch).toBeLessThanOrEqual(latitudeToPitch(90));
  });
});

describe('FlowSource jets, storms and rings', () => {
  it('plays a jet train whose rate follows the zonal wind', () => {
    const field = new FieldSampler(generateField(GAS, 64, 32));
    const sink = new RecordingSink();
    const src = new FlowSource(sink, field, GAS, 'artistic', { k: 20 });
    src.move(sampleUV(0.3, 0.4));
    expect(sink.activeTrainId).toBe(JET_TRAIN_ID);
    expect(sink.current!.rateHz).toBeGreaterThanOrEqual(FLOW_JET_MIN_HZ);
    expect(sink.current!.rateHz).toBeLessThanOrEqual(FLOW_JET_MAX_HZ);
    expect(sink.current!.voice).toBe('tone');
    const off = sampleUV(0.3, 0.4);
    off.bodyId = null;
    src.move(off);
    expect(sink.activeTrainId).toBeNull();
  });

  it('a storm gives one firm tick at its edge, then a swirl rising towards the centre', () => {
    const p: FieldParams = { ...GAS, storms: 1 };
    const field = new FieldSampler(generateField(p, W, H));
    const storm = stormsFor(p.seed, 1)[0]!;
    const sink = new RecordingSink();
    const src = new FlowSource(sink, field, p, 'artistic');
    // Walk from 3 sizes away straight to the centre along a great circle.
    const c = storm.center;
    const axis: [number, number, number] = [0, 1, 0];
    // A tangent direction at the centre.
    const tx = axis[1] * c[2] - axis[2] * c[1];
    const ty = axis[2] * c[0] - axis[0] * c[2];
    const tz = axis[0] * c[1] - axis[1] * c[0];
    const tl = Math.hypot(tx, ty, tz);
    const rates: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const ang = storm.size * 3 * (1 - i / 60);
      const d: [number, number, number] = [
        c[0] * Math.cos(ang) + (tx / tl) * Math.sin(ang),
        c[1] * Math.cos(ang) + (ty / tl) * Math.sin(ang),
        c[2] * Math.cos(ang) + (tz / tl) * Math.sin(ang),
      ];
      src.move(sampleAt(d));
      if (sink.activeTrainId === STORM_TRAIN_ID) rates.push(sink.current!.rateHz);
    }
    expect(sink.ticks().filter((t) => t.strength === STRENGTH_FIRM)).toHaveLength(1);
    expect(rates.length).toBeGreaterThan(5);
    // A first touch inside the storm is not an edge.
    const first = new RecordingSink();
    new FlowSource(first, field, p, 'artistic').move(sampleAt(storm.center));
    expect(first.ticks().filter((t) => t.strength === STRENGTH_FIRM)).toHaveLength(0);
    expect(first.activeTrainId).toBe(STORM_TRAIN_ID);
    expect(rates.at(-1)!).toBeGreaterThan(rates[0]!);
    expect(rates.at(-1)!).toBeCloseTo(STORM_SWIRL_CENTRE_HZ, 0);
  });

  it('rings tick on entering each gap, only when the rings are drawn', () => {
    const field = new FieldSampler(generateField(GAS, 32, 16));
    const walk = (rings: number) => {
      const sink = new RecordingSink();
      const src = new FlowSource(sink, field, GAS, 'artistic', { rings });
      for (let i = 0; i <= 200; i++) {
        const s = sampleUV(0.5, 0.5);
        s.bodyId = null;
        s.ringRadius = RING_INNER + ((RING_OUTER - RING_INNER) * i) / 200;
        src.move(s);
      }
      return sink.ticks().length;
    };
    expect(RING_GAP_EDGES.length).toBe(4); // one gap
    expect(walk(0.8)).toBe(1);
    expect(walk(0)).toBe(0);
  });
});
