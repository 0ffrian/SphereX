// R8.9, D-10, D-12: the audio driver on a fake AudioContext: timbre by tag and voice, gain,
// pitch, pan, scheduling on the audio clock, offsets, stop, cleanup and latency.
import { describe, expect, it } from 'vitest';
import type { HapticEvent } from '@/contract';
import {
  FakeAudioContext,
  FakeCompressor,
  FakeFilter,
  FakeGain,
  FakePanner,
  FakeSource,
  type FakeNode,
} from '@/test/fakeAudio';
import { getBus, sharedNodes } from './audioGraph';
import type { TrainWindow } from './engine';
import { pitchToHz } from './pitch';
import {
  AUDIO_FLOOR_STRENGTH,
  AUDIO_LOOKAHEAD_S,
  AUDIO_PEAK_GAIN,
  NOISE_BURST_S,
  NOISE_DECAY_S,
  MAX_AUDIO_VOICES,
} from './tuning';
import { AudioDriver, audioGain, clampTrainRate, patternOnsetsMs, selectTimbre } from './voices';

function setup(options: ConstructorParameters<typeof FakeAudioContext>[0] = {}) {
  const ctx = new FakeAudioContext(options);
  const driver = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  return { ctx, driver };
}

const ev = (over: Partial<HapticEvent> = {}): HapticEvent => ({
  kind: 'tick',
  strength: 1,
  tag: 'measured',
  ...over,
});

/** The envelope gain node a source feeds (directly or through a filter). */
function envelopeOf(src: FakeSource): FakeGain {
  let n = src.outputs[0]!;
  if (n instanceof FakeFilter) n = n.outputs[0]!;
  return n as FakeGain;
}

describe('timbre (R8.9, D-12, Q-72)', () => {
  it.each([
    ['measured', undefined, 'tone', false],
    ['derived', undefined, 'tone', true],
    ['model_dependent', undefined, 'tone', true],
    ['inferred_from_analog', undefined, 'tone', true],
    ['artistic', undefined, 'grain', false],
    ['artistic', 'tone', 'grain', false],
    ['artistic', 'click', 'grain', false],
    ['artistic', 'chime', 'grain', false],
    ['artistic', 'surf', 'surf', false],
    ['measured', 'chime', 'bell', false],
    ['derived', 'chime', 'bell', true],
    ['measured', 'surf', 'tone', false],
    ['measured', 'click', 'tone', false],
  ] as const)('%s + voice %s → %s (soft %s)', (tag, voice, source, soft) => {
    expect(selectTimbre(tag, voice)).toEqual({ source, soft });
  });

  it('measured: a sine blip at the pitch, gain = strength × volume × peak', () => {
    const { ctx, driver } = setup();
    driver.setVolume(0.5);
    driver.emit(ev({ strength: 0.8, pitch: 1 }));
    const [osc] = ctx.sources();
    expect(osc!.nodeType).toBe('oscillator');
    expect(osc!.frequency.value).toBeCloseTo(pitchToHz(1));
    const env = envelopeOf(osc!);
    const peak = Math.max(...env.gain.calls.map((c) => c[1]));
    expect(peak).toBeCloseTo(0.8 * AUDIO_PEAK_GAIN); // the master gain carries the volume
    const master = env.outputs[0] as FakeGain;
    expect(master.gain.value).toBe(0.5);
  });

  it('artistic: a 4 ms noise burst with a 2 ms decay, band-passed at the pitch', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ tag: 'artistic', pitch: 0, voice: 'tone' }));
    const [src] = ctx.sources();
    expect(src!.nodeType).toBe('bufferSource');
    const bp = src!.outputs[0] as FakeFilter;
    expect(bp.type).toBe('bandpass');
    expect(bp.frequency.value).toBeCloseTo(pitchToHz(0));
    const env = envelopeOf(src!);
    const t0 = AUDIO_LOOKAHEAD_S;
    expect(env.gain.calls.at(-1)).toEqual(['linear', 0, t0 + NOISE_BURST_S + NOISE_DECAY_S]);
  });

  it('surf: low-passed noise; chime: two partials', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ tag: 'artistic', voice: 'surf' }));
    driver.emit(ev({ voice: 'chime' }));
    const [noise, o1, o2] = ctx.sources();
    expect((noise!.outputs[0] as FakeFilter).type).toBe('lowpass');
    expect(o1!.nodeType).toBe('oscillator');
    expect(o2!.frequency.value / o1!.frequency.value).toBeCloseTo(2.01);
  });

  it('pans with a StereoPannerNode, and skips the pan where it is missing', () => {
    const a = setup();
    a.driver.emit(ev({ pan: -2 }));
    const panner = a.ctx.nodes.find((n) => n instanceof FakePanner) as FakePanner;
    expect(panner.pan.value).toBe(-1);
    const b = setup({ stereoPanner: false });
    b.driver.emit(ev({ pan: 0.5 }));
    expect(b.ctx.sources()).toHaveLength(1);
  });

  it('strength 0 is still heard, at the floor gain', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ strength: 0 }));
    const [osc] = ctx.sources();
    const peak = Math.max(...envelopeOf(osc!).gain.calls.map((c) => c[1]));
    expect(peak).toBeCloseTo(AUDIO_FLOOR_STRENGTH * AUDIO_PEAK_GAIN);
    expect(audioGain(0.5)).toBeCloseTo(0.5 * AUDIO_PEAK_GAIN); // continuous above the floor
  });
});

describe('scheduling (R8.9)', () => {
  it('double and heartbeat follow the vibration timings', () => {
    expect(patternOnsetsMs([12, 40, 12])).toEqual([0, 52]);
    expect(patternOnsetsMs([20, 120, 12])).toEqual([0, 140]);
    const { ctx, driver } = setup();
    ctx.currentTime = 10;
    driver.emit(ev({ kind: 'heartbeat' }));
    expect(ctx.sources().map((s) => s.startAt)).toEqual([
      10 + AUDIO_LOOKAHEAD_S,
      10.14 + AUDIO_LOOKAHEAD_S,
    ]);
  });

  it('train pulses are scheduled at explicit times; re-sent pulses are skipped', () => {
    const { ctx, driver } = setup();
    const w: TrainWindow = {
      rateHz: 20,
      strength: 1,
      tag: 'measured',
      pulseOffsetsMs: [15, 65, 115, 165],
      resentCount: 2,
      atMs: 0,
      trainSeq: 1,
    };
    driver.playTrain(w);
    const base = AUDIO_LOOKAHEAD_S;
    expect(ctx.sources().map((s) => s.startAt)).toEqual([base + 0.115, base + 0.165]);
  });

  it('plays nothing until the context runs (no queueing)', () => {
    const { ctx, driver } = setup({ state: 'suspended' });
    driver.emit(ev());
    expect(ctx.sources()).toHaveLength(0);
  });

  it('stop cancels every scheduled sound and disconnects its nodes', () => {
    const { ctx, driver } = setup();
    driver.emit(ev());
    driver.emit(ev({ tag: 'artistic', pitch: 0.2 }));
    driver.stop();
    for (const s of ctx.sources()) {
      expect(s.stopCalls).toBe(2); // scheduled stop, then the cancel
      expect(s.disconnected).toBe(true);
    }
  });

  it('a finished sound disconnects its nodes (no leak); the master stays', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ pan: 0.3 }));
    const [osc] = ctx.sources();
    osc!.end();
    const made = ctx.nodes.filter((n) => n.nodeType !== 'destination');
    const limiter = made.find((n) => n instanceof FakeCompressor)!;
    // R13.9: the driver's volume feeds the events bus; the graph's own nodes stay.
    const bus = getBus(ctx.asAudioContext(), 'events') as unknown as FakeNode;
    const volume = made.find((n) => n instanceof FakeGain && n.outputs[0] === bus)!;
    const kept = [...(sharedNodes(ctx.asAudioContext()) as unknown as FakeNode[]), volume];
    for (const n of made) if (!kept.includes(n)) expect(n.disconnected).toBe(true);
    for (const n of kept) expect(n.disconnected).toBe(false);
    expect(limiter.outputs[0]).toBe(ctx.destination);
  });

  it('reuses the master gain and the noise buffer', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ tag: 'artistic' }));
    driver.emit(ev({ tag: 'artistic' }));
    const [a, b] = ctx.sources();
    expect(a!.buffer).toBe(b!.buffer);
    expect(ctx.nodes.filter((n) => n instanceof FakeCompressor)).toHaveLength(1);
  });

  it('limits the master so overlapping sounds do not clip; plain master where no compressor', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ voice: 'chime' }));
    const limiter = ctx.nodes.find((n) => n instanceof FakeCompressor) as FakeCompressor;
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(10);
    expect(limiter.threshold.value).toBeLessThan(0);
    const b = setup({ compressor: false });
    b.driver.emit(ev());
    const env = envelopeOf(b.ctx.sources()[0]!);
    const volume = env.outputs[0] as FakeGain;
    const events = volume.outputs[0] as FakeGain; // events bus → master → destination
    expect((events.outputs[0] as FakeGain).outputs[0]).toBe(b.ctx.destination);
  });

  it('keeps one audio-clock anchor per train across windows (sample-accurate, R8.9)', () => {
    const { ctx, driver } = setup();
    const win = (atMs: number, trainSeq: number, offsets: number[]): TrainWindow => ({
      rateHz: 20,
      strength: 1,
      tag: 'measured',
      pulseOffsetsMs: offsets,
      resentCount: 0,
      atMs,
      trainSeq,
    });
    ctx.currentTime = 1;
    driver.playTrain(win(0, 1, [0, 50]));
    ctx.currentTime = 1.2337; // the next window's timer ran with some jitter
    driver.playTrain(win(230, 1, [20, 70]));
    const t0 = 1 + AUDIO_LOOKAHEAD_S;
    const starts = ctx.sources().map((s) => s.startAt!);
    [0, 0.05, 0.25, 0.3].forEach((d, i) => expect(starts[i]).toBeCloseTo(t0 + d, 9));
    // A new train re-anchors; so does a clock that drifted past the tolerance.
    ctx.currentTime = 5;
    driver.playTrain(win(300, 2, [0]));
    expect(ctx.sources().at(-1)!.startAt).toBeCloseTo(5 + AUDIO_LOOKAHEAD_S, 9);
    ctx.currentTime = 7;
    driver.playTrain(win(400, 2, [0]));
    expect(ctx.sources().at(-1)!.startAt).toBeCloseTo(7 + AUDIO_LOOKAHEAD_S, 9);
  });

  it('stopTrain cancels train sounds and leaves one-shots ringing', () => {
    const { ctx, driver } = setup();
    driver.playTrain({
      rateHz: 4,
      strength: 1,
      tag: 'measured',
      pulseOffsetsMs: [0],
      resentCount: 0,
      atMs: 0,
      trainSeq: 1,
    });
    driver.emit(ev({ voice: 'chime' }));
    driver.stopTrain();
    const [train, o1, o2] = ctx.sources();
    expect(train!.stopCalls).toBe(2);
    expect(o1!.stopCalls).toBe(1);
    expect(o2!.stopCalls).toBe(1);
  });
});

describe('latency (R8.9, R12 #10)', () => {
  it('reads outputLatency and flags it when high', () => {
    expect(setup({ outputLatency: 0.2 }).driver.isHighLatency()).toBe(true);
    expect(setup({ outputLatency: 0.02 }).driver.isHighLatency()).toBe(false);
    const none = setup();
    expect(none.driver.outputLatency()).toBeNull();
    expect(none.driver.isHighLatency()).toBe(false);
  });
});

describe('resources (review P4, P5, S2)', () => {
  it('keeps at most MAX_AUDIO_VOICES sounds; the oldest is cut first', () => {
    const { ctx, driver } = setup();
    for (let i = 0; i < MAX_AUDIO_VOICES + 5; i++) driver.emit(ev());
    const sources = ctx.sources();
    expect(sources.filter((s) => s.stopCalls === 2)).toEqual(sources.slice(0, 5));
    driver.stop();
    expect(sources.every((s) => s.stopCalls === 2 && s.disconnected)).toBe(true);
  });

  it('a bell is released only when both partials have ended', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ voice: 'chime' }));
    const [o1, o2] = ctx.sources();
    o1!.end();
    expect(o2!.disconnected).toBe(false);
    o2!.end();
    expect(o1!.disconnected && o2!.disconnected).toBe(true);
  });

  it('a new context drops the sounds of the old one', () => {
    let ctx = new FakeAudioContext();
    const driver = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
    driver.emit(ev({ voice: 'chime' }));
    const old = ctx.sources();
    ctx = new FakeAudioContext();
    driver.emit(ev());
    for (const s of old) expect(s.disconnected).toBe(true);
  });

  it('setVolume replaces the scheduled value instead of piling events up', () => {
    const { ctx, driver } = setup();
    driver.emit(ev());
    const volume = ctx.nodes.find(
      (n) => n instanceof FakeGain && n.outputs[0] instanceof FakeGain && n !== n.outputs[0],
    ) as FakeGain;
    for (let i = 0; i < 5; i++) driver.setVolume(i / 5);
    expect(volume.gain.calls.filter((c) => c[0] === 'cancel')).toHaveLength(5);
  });

  it.each([1e20, Infinity, NaN, -4, 0])('emit(pulseTrain) at %s Hz is bounded', (rateHz) => {
    const { ctx, driver } = setup();
    driver.emit(ev({ kind: 'pulseTrain', rateHz }));
    expect(ctx.sources().length).toBeLessThanOrEqual(11);
  });
});

describe('clampTrainRate (R8.3, moved from the vibrate driver by D-39)', () => {
  it('clamps to the train range and refuses missing or bad rates', () => {
    expect(clampTrainRate(undefined)).toBeNull();
    expect(clampTrainRate(0)).toBeNull();
    expect(clampTrainRate(-3)).toBeNull();
    expect(clampTrainRate(NaN)).toBeNull();
    expect(clampTrainRate(0.01)).toBe(0.25);
    expect(clampTrainRate(10)).toBe(10);
    expect(clampTrainRate(1000)).toBe(40);
  });
});
