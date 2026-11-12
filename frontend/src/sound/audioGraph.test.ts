// R8.9, R13.9: the one graph per AudioContext (three buses, a single limiter for every module),
// the ambience duck and level, the harmonic branch and the shared bell, on the fake context.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FakeAudioContext,
  FakeCompressor,
  FakeFilter,
  FakeGain,
  FakeSource,
  FakeWaveShaper,
  type FakeNode,
} from '@/test/fakeAudio';
import {
  createHarmonicBranch,
  dbToGain,
  duckHolds,
  getBus,
  getMasterBus,
  harmonicBranchSample,
  harmonicCurve,
  holdDuck,
  playBell,
  refreshAmbienceLevel,
  setAmbienceLevelSource,
} from './audioGraph';
import { AudioDriver } from './voices';
import {
  AMBIENCE_DUCK_ATTACK_S,
  AMBIENCE_DUCK_DB,
  AMBIENCE_DUCK_RELEASE_S,
  AMBIENCE_HIGHPASS_HZ,
  CHIME_DECAY_S,
  CHIME_PARTIAL_RATIO,
  DUCK_TAU_DIVISOR,
  HARMONIC_MIX_DB,
  HARMONIC_PREGAIN_DB,
  LIMITER_THRESHOLD_DB,
} from './tuning';

const asCtx = (c: FakeAudioContext) => c.asAudioContext();

describe('master bus', () => {
  it('is made once per context: gain → one limiter → destination', () => {
    const ctx = new FakeAudioContext();
    const bus = getMasterBus(asCtx(ctx)) as unknown as FakeGain;
    expect(getMasterBus(asCtx(ctx))).toBe(bus);
    const limiter = bus.outputs[0] as FakeCompressor;
    expect(limiter).toBeInstanceOf(FakeCompressor);
    expect(limiter.threshold.value).toBe(LIMITER_THRESHOLD_DB);
    expect(limiter.outputs[0]).toBe(ctx.destination);
    expect(getMasterBus(asCtx(new FakeAudioContext()))).not.toBe(bus);
  });

  it('falls back to the destination directly where there is no compressor', () => {
    const ctx = new FakeAudioContext({ compressor: false });
    const bus = getMasterBus(asCtx(ctx)) as unknown as FakeGain;
    expect(bus.outputs[0]).toBe(ctx.destination);
  });

  it('the audio driver and another module share the one limiter', () => {
    const ctx = new FakeAudioContext();
    const driver = new AudioDriver({ context: () => asCtx(ctx), supported: true });
    driver.emit({ kind: 'tick', strength: 1, tag: 'measured' });
    const sweepOut = ctx.createGain(); // e.g. the Listen sweep's own volume
    sweepOut.connect(getMasterBus(asCtx(ctx)) as unknown as FakeGain);
    expect(ctx.nodes.filter((n) => n instanceof FakeCompressor)).toHaveLength(1);
  });
});

describe('playBell', () => {
  it('schedules two partials under one envelope into the destination given', () => {
    const ctx = new FakeAudioContext();
    const dest = ctx.createGain();
    const bell = playBell(asCtx(ctx), dest as unknown as AudioNode, {
      freqHz: 440,
      when: 2,
      gain: 0.3,
    });
    const [o1, o2] = bell.sources as unknown as FakeSource[];
    expect(o1!.frequency.value).toBe(440);
    expect(o2!.frequency.value).toBeCloseTo(440 * CHIME_PARTIAL_RATIO);
    expect([o1!.startAt, o2!.startAt]).toEqual([2, 2]);
    expect(bell.end).toBeCloseTo(2 + CHIME_DECAY_S);
    const env = bell.nodes[0] as unknown as FakeGain;
    expect(env.outputs[0]).toBe(dest);
    expect(Math.max(...env.gain.calls.map((c) => c[1]))).toBeCloseTo(0.3);
  });
});

describe('limiter (R13.9, §11.5)', () => {
  it('sits at −3 dB', () => {
    expect(LIMITER_THRESHOLD_DB).toBe(-3);
  });
});

/** The ambience chain of a context: input → high-pass → duck → level → master. */
function ambienceChain(ctx: FakeAudioContext) {
  const input = getBus(asCtx(ctx), 'ambience') as unknown as FakeGain;
  const hpf = input.outputs[0] as FakeFilter;
  const duck = hpf.outputs[0] as FakeGain;
  const level = duck.outputs[0] as FakeGain;
  return { input, hpf, duck, level };
}

describe('buses (R13.9)', () => {
  afterEach(() => setAmbienceLevelSource(null));

  it('one bus per name per context; events and spectrum feed the master', () => {
    const ctx = new FakeAudioContext();
    const master = getMasterBus(asCtx(ctx)) as unknown as FakeGain;
    for (const name of ['events', 'spectrum'] as const) {
      const bus = getBus(asCtx(ctx), name) as unknown as FakeGain;
      expect(getBus(asCtx(ctx), name)).toBe(bus);
      expect(bus.outputs).toEqual([master]);
      // No volume on the bus: the producers' own gains carry it, so it is never applied twice.
      expect(bus.gain.calls).toEqual([]);
    }
    expect(getBus(asCtx(ctx), 'events')).not.toBe(getBus(asCtx(ctx), 'spectrum'));
    expect(ctx.nodes.filter((n) => n instanceof FakeCompressor)).toHaveLength(1);
  });

  it('ambience: input → 35 Hz high-pass → duck → level → master', () => {
    const ctx = new FakeAudioContext();
    const { hpf, duck, level } = ambienceChain(ctx);
    expect(hpf).toBeInstanceOf(FakeFilter);
    expect(hpf.type).toBe('highpass');
    expect(hpf.frequency.value).toBe(AMBIENCE_HIGHPASS_HZ);
    expect(duck).toBeInstanceOf(FakeGain);
    expect(level.outputs).toEqual([getMasterBus(asCtx(ctx))]);
  });

  it('the ambience level starts from the registered source, also on a later context', () => {
    const before = new FakeAudioContext();
    expect(ambienceChain(before).level.gain.value).toBe(0); // nothing registered: silent
    setAmbienceLevelSource(() => 0.35);
    const after = new FakeAudioContext();
    expect(ambienceChain(after).level.gain.value).toBeCloseTo(0.35);
    refreshAmbienceLevel(asCtx(before));
    expect(ambienceChain(before).level.gain.calls.at(-1)).toEqual(['target', 0.35, 0]);
    setAmbienceLevelSource(() => 7); // clamped to 1
    refreshAmbienceLevel(asCtx(after));
    expect(ambienceChain(after).level.gain.calls.at(-1)![1]).toBe(1);
    expect(() => refreshAmbienceLevel(null)).not.toThrow();
  });
});

describe('ambience duck (R13.9, §11.5)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is reference-counted: the first hold ducks, the last release restores', () => {
    const ctx = new FakeAudioContext();
    const { duck } = ambienceChain(ctx);
    const a = holdDuck(asCtx(ctx));
    expect(duck.gain.calls.slice(-2)).toEqual([
      ['cancel', 0, 0],
      ['target', dbToGain(AMBIENCE_DUCK_DB), 0],
    ]);
    const n = duck.gain.calls.length;
    const b = holdDuck(asCtx(ctx));
    expect(duck.gain.calls.length).toBe(n); // already ducked
    expect(duckHolds(asCtx(ctx))).toBe(2);
    a.release();
    a.release(); // idempotent
    expect(duckHolds(asCtx(ctx))).toBe(1);
    expect(duck.gain.calls.length).toBe(n);
    b.release();
    expect(duckHolds(asCtx(ctx))).toBe(0);
    expect(duck.gain.calls.at(-1)).toEqual(['target', 1, 0]);
  });

  it('uses the attack and release time constants', () => {
    const ctx = new FakeAudioContext();
    const { duck } = ambienceChain(ctx);
    const spy = vi.spyOn(duck.gain, 'setTargetAtTime');
    holdDuck(asCtx(ctx)).release();
    expect(spy.mock.calls[0]).toEqual([
      dbToGain(AMBIENCE_DUCK_DB),
      0,
      AMBIENCE_DUCK_ATTACK_S / DUCK_TAU_DIVISOR,
    ]);
    expect(spy.mock.calls[1]).toEqual([1, 0, AMBIENCE_DUCK_RELEASE_S / DUCK_TAU_DIVISOR]);
  });

  it('the safety timeout releases a forgotten hold; extend pushes it back', () => {
    vi.useFakeTimers();
    const ctx = new FakeAudioContext();
    const h = holdDuck(asCtx(ctx), 2);
    vi.advanceTimersByTime(1500);
    h.extend(2);
    vi.advanceTimersByTime(1500);
    expect(duckHolds(asCtx(ctx))).toBe(1);
    vi.advanceTimersByTime(600);
    expect(h.released).toBe(true);
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });
});

describe('harmonic branch (R13.9, §11.7)', () => {
  /** Amplitude of frequency f in x (a whole number of periods), by a plain DFT. */
  function amplitude(x: Float64Array, f: number, rate: number): number {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const p = (2 * Math.PI * f * i) / rate;
      re += x[i]! * Math.cos(p);
      im -= x[i]! * Math.sin(p);
    }
    return (2 * Math.hypot(re, im)) / x.length;
  }

  const rate = 8000;
  const sine = (a: number, i: number) => a * Math.sin((2 * Math.PI * 60 * i) / rate);

  it('a 60 Hz sine at −24 dB RMS (the −24 LUFS bed level) gets harmonics at ≥ −30 dB', () => {
    const a = Math.SQRT2 * dbToGain(-24);
    const y = new Float64Array(rate); // 1 s: whole periods of 60, 180 and 300 Hz
    for (let i = 0; i < y.length; i++) y[i] = harmonicBranchSample(sine(a, i));
    const f1 = amplitude(y, 60, rate);
    // tanh is odd, so the harmonics are odd: 180 Hz (3rd) and 300 Hz (5th, inside 200–600 Hz).
    expect(20 * Math.log10(amplitude(y, 180, rate) / f1)).toBeGreaterThanOrEqual(-30);
    expect(20 * Math.log10(amplitude(y, 300, rate) / f1)).toBeGreaterThanOrEqual(-30);
    // Without the +18 dB drive the same input stays almost linear (red review finding 2).
    const lin = new Float64Array(rate);
    for (let i = 0; i < lin.length; i++) lin[i] = Math.tanh(3 * sine(a, i));
    expect(20 * Math.log10(amplitude(lin, 180, rate) / amplitude(lin, 60, rate))).toBeLessThan(-25);
  });

  it('builds 40–120 Hz → +18 dB → tanh shaper → −18 dB → 200–600 Hz → −12 dB → ambience', () => {
    const ctx = new FakeAudioContext();
    const branch = createHarmonicBranch(asCtx(ctx))!;
    const chain: FakeNode[] = [branch.input as unknown as FakeNode];
    while (chain.at(-1)!.outputs.length > 0 && chain.length < 12) {
      chain.push(chain.at(-1)!.outputs[0]!);
    }
    const [inHp, inLp, pre, shaper, makeup, outHp, outLp, mix, into] = chain as [
      FakeFilter,
      FakeFilter,
      FakeGain,
      FakeWaveShaper,
      FakeGain,
      FakeFilter,
      FakeFilter,
      FakeGain,
      FakeNode,
    ];
    expect([inHp.type, inHp.frequency.value]).toEqual(['highpass', 40]);
    expect([inLp.type, inLp.frequency.value]).toEqual(['lowpass', 120]);
    expect(pre.gain.value).toBeCloseTo(dbToGain(HARMONIC_PREGAIN_DB));
    expect(shaper).toBeInstanceOf(FakeWaveShaper);
    expect(makeup.gain.value).toBeCloseTo(dbToGain(-HARMONIC_PREGAIN_DB));
    expect([outHp.type, outHp.frequency.value]).toEqual(['highpass', 200]);
    expect([outLp.type, outLp.frequency.value]).toEqual(['lowpass', 600]);
    expect(mix.gain.value).toBeCloseTo(dbToGain(HARMONIC_MIX_DB));
    expect(into).toBe(getBus(asCtx(ctx), 'ambience'));
    branch.dispose();
    expect(inHp.disconnected && mix.disconnected).toBe(true);
  });

  it('the curve is tanh(3x) and byte-identical every time; null without WaveShaperNode', () => {
    const c1 = harmonicCurve();
    const bytes = (c: Float32Array) => Array.from(new Uint8Array(c.buffer));
    expect(bytes(harmonicCurve())).toEqual(bytes(c1));
    expect(c1[(c1.length - 1) / 2]).toBe(0);
    expect(c1.at(-1)).toBeCloseTo(Math.tanh(3));
    const ctx = new FakeAudioContext();
    createHarmonicBranch(asCtx(ctx));
    const shaper = ctx.nodes.find((n) => n instanceof FakeWaveShaper) as FakeWaveShaper;
    expect(bytes(shaper.curve!)).toEqual(bytes(c1));
    expect(createHarmonicBranch(asCtx(new FakeAudioContext({ waveShaper: false })))).toBeNull();
  });
});
