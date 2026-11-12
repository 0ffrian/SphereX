// §16 test 8: levels (R1 area integral, world scaling, presentation offset and caption, stage window).
import { describe, expect, it } from 'vitest';
import { CEILING_TEXT } from './captions';
import { earthAir, makeAir, makePlace, makeWind, marsAir, venusAir } from './fakeEngine.testutil';
import { bedKey, cellWeight, flowOffsetDb, iRef, mixFrame, patternSamples, presentOffsetDb, stageGainDb } from './levels';
import { SILENT_DB } from './tuning';

const S5 = new Set([bedKey('S5', 0)]);
const bed = (f: ReturnType<typeof mixFrame>, id: string) => f.beds.find((b) => b.id === id)!;
const seaPlace = (z: number) => makePlace(z, () => ({ cls: 'sea' }), { wind: makeWind({ U10: 7, Uz: 7 }) });

describe('R1 area integral', () => {
  it('a full plane out to 1.25 R sums to the exact disc integral, ≈ 1/4 at any height (cos² directivity)', () => {
    for (const z of [0.002, 0.3, 3, 30]) {
      const sum = patternSamples(z).reduce((t, s) => t + cellWeight(s, z), 0);
      const R = Math.min(Math.max(4 * z + 2, 2), 400);
      const exact = 0.25 * (1 - (z * z) / (z * z + (1.25 * R) ** 2));
      expect(sum).toBeCloseTo(exact, 12);
      expect(10 * Math.log10(0.25 / sum)).toBeLessThan(0.2); // the disc misses < 0.2 dB of the infinite plane
    }
  });
  it('I_ref at 100 Hz is in [0.249, 0.25]', () => {
    expect(iRef(100)).toBeGreaterThanOrEqual(0.249);
    expect(iRef(100)).toBeLessThanOrEqual(0.25);
  });
  it('an infinite sea on Earth is flat within ±1 dB from 2 m to 300 m (low-frequency bed)', () => {
    const air = earthAir();
    const lo = bed(mixFrame(air, seaPlace(0.002), S5), 'S5').trueDb;
    const hi = bed(mixFrame(air, seaPlace(0.3), S5), 'S5').trueDb;
    expect(Math.abs(hi - lo)).toBeLessThanOrEqual(1);
  });
});

describe('monotone levels', () => {
  const air = earthAir();
  it('higher z -> quieter ground beds', () => {
    let last = Infinity;
    for (const z of [0.3, 1, 3, 10, 30]) {
      const L = bed(mixFrame(air, seaPlace(z), S5), 'S5').trueDb;
      expect(L).toBeLessThan(last);
      last = L;
    }
  });
  it('nearer coast -> louder surf', () => {
    const S4 = new Set([bedKey('S4', 0)]);
    const at = (ring: number) =>
      bed(
        mixFrame(air, makePlace(0.5, (s) => ({ coast: s.index > 0 && Math.ceil(s.index / 12) === ring }), { wind: makeWind({ U10: 8 }) }), S4),
        'S4',
      ).trueDb;
    expect(at(1)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(3));
  });
  it('pan follows the side the sound comes from and is capped at 0.8', () => {
    const east = makePlace(0.3, (s) => ({ cls: Math.abs(Math.sin(s.bearing) - 1) < 1e-9 ? 'sea' : 'land' }));
    const p = bed(mixFrame(air, east, S5), 'S5').pan;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(0.8);
  });
});

describe('presentation (§11.4, §11.7)', () => {
  it('Mars-like air: the offset round-trips into the caption ("about 20 dB quieter ... raised")', () => {
    const air = marsAir();
    const G = presentOffsetDb(air);
    expect(G).toBeGreaterThan(19);
    expect(G).toBeLessThan(22);
    const f = mixFrame(air, makePlace(0.3), new Set([bedKey('S1_land', 0)]));
    // R10: the wind bed is raised by the impedance at the listener's height.
    expect(f.presentOffsetDb).toBe(flowOffsetDb(air, 0.3));
    expect(f.caption.levelNote).toBe('Real level: about 20 dB quieter than on Earth (raised so you can hear it)');
    expect(f.caption.line).toContain('real level about 20 dB quieter than Earth');
  });
  it('Venus-like air is louder and lowered; Earth gets no note', () => {
    expect(mixFrame(venusAir(), makePlace(0.3), new Set()).caption.levelNote).toMatch(/louder than on Earth \(lowered\)$/);
    expect(mixFrame(earthAir(), makePlace(0.3), new Set()).caption.levelNote).toBeNull();
  });
  it('the stage window lifts a quiet bed to -24 dB, holds +6 dB headroom, never lifts silence', () => {
    expect(stageGainDb(20, 0)).toBe(-24);
    expect(stageGainDb(100, 0)).toBe(6);
    expect(stageGainDb(70, 0)).toBe(0);
    expect(stageGainDb(-Infinity, 30)).toBe(SILENT_DB);
  });
  it('a ground bed with no source around the listener is silent', () => {
    const f = mixFrame(earthAir(), makePlace(0.3), S5);
    expect(bed(f, 'S5').gainDb).toBe(SILENT_DB);
  });
  it('above the silence ceiling everything is silent and captioned', () => {
    const f = mixFrame(earthAir(), seaPlace(120), new Set([bedKey('S5', 0), bedKey('S1_land', 0)]));
    expect(f.silent).toBe(true);
    expect(f.beds.every((b) => b.gainDb === SILENT_DB)).toBe(true);
    expect(f.caption.silentReason).toBe(CEILING_TEXT);
  });
  it('is deterministic, skips thunder, and keeps the previous caption object when unchanged', () => {
    const keys = new Set([bedKey('S1_land', 0), bedKey('S5', 0), bedKey('thunder', 0)]);
    const a = mixFrame(earthAir(), seaPlace(0.3), keys);
    const b = mixFrame(earthAir(), seaPlace(0.3), keys);
    expect(b).toEqual(a);
    expect(a.beds.map((x) => x.id)).toEqual(['S1_land', 'S5']);
    expect(mixFrame(earthAir(), seaPlace(0.3), keys, a).caption).toBe(a.caption);
    for (const x of a.beds) for (const v of Object.values(x)) if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
  });

  it('R10: a gas giant roar at altitude is raised by the listener-height impedance and is audible', () => {
    const jup = makeAir({ T0: 130, P0: 1e4, mu: 2.3, gas: true, U: 150, H_km: 27, presetId: 'jup' });
    expect(flowOffsetDb(jup, 50)).toBeGreaterThan(presentOffsetDb(jup));
    const f = mixFrame(jup, makePlace(50, () => ({}), { wind: makeWind({ U10: 120, Uz: 120, Iu: 0.15, parts: [{ kind: 'jet', U: 120 }] }) }), new Set([bedKey('S12', 0)]));
    expect(f.beds[0]!.gainDb).toBeGreaterThan(-24);
    expect(f.caption.heard[0]?.id).toBe('S12');
  });
});

describe('R8 presence before presentation', () => {
  const air = earthAir();
  it('an absent class is silent, not lifted: land rumble over open sea', () => {
    const f = mixFrame(air, seaPlace(0.3), new Set([bedKey('S1_land', 0), bedKey('S1_sea', 0)]));
    expect(bed(f, 'S1_land').gainDb).toBe(SILENT_DB);
    expect(bed(f, 'S1_sea').gainDb).toBeGreaterThan(SILENT_DB);
  });
  it('when only one rumble variant is baked it takes the whole share', () => {
    const f = mixFrame(air, seaPlace(0.3), new Set([bedKey('S1_land', 0)]));
    expect(bed(f, 'S1_land').gainDb).toBeGreaterThan(SILENT_DB);
  });
  it('still air (< 1 m/s) is silent', () => {
    const calm = makePlace(0.3, () => ({}), { wind: makeWind({ U10: 0.5, Uz: 0.5 }) });
    expect(bed(mixFrame(air, calm, new Set([bedKey('S1_land', 0)])), 'S1_land').gainDb).toBe(SILENT_DB);
  });
  it('a bed more than 40 dB under the loudest present bed is silent and not captioned', () => {
    const p = makePlace(0.3, () => ({}), { exposure: 1e-4, wind: makeWind({ U10: 7, Uz: 7 }) });
    const f = mixFrame(air, p, new Set([bedKey('S1_land', 0), bedKey('S3', 0)]));
    expect(bed(f, 'S3').gainDb).toBe(SILENT_DB);
    expect(f.caption.heard.map((h) => h.id)).toEqual(['S1_land']);
  });
});
