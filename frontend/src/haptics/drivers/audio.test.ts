// R8.9, D-10, D-12: the audio driver on a fake AudioContext: timbre by tag and voice, gain,
// pitch, pan, scheduling on the audio clock, offsets, stop, cleanup and latency.
import { describe, expect, it } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeAudioContext, FakeFilter, FakeGain, FakePanner, FakeSource } from '@/test/fakeAudio';
import type { TrainWindow } from '../haptics';
import { pitchToHz } from '../pitch';
import { AUDIO_LOOKAHEAD_S, AUDIO_PEAK_GAIN, NOISE_BURST_S, NOISE_DECAY_S } from '../tuning';
import { AudioDriver, patternOnsetsMs, selectTimbre } from './audio';

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

describe('timbre (R8.9, D-12, Q-60)', () => {
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

  it('strength 0 is silent', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ strength: 0 }));
    expect(ctx.sources()).toHaveLength(0);
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
    driver.setOffsetMs(100);
    const w: TrainWindow = {
      rateHz: 20,
      strength: 1,
      tag: 'measured',
      pulseOffsetsMs: [15, 65, 115, 165],
      resentCount: 2,
    };
    driver.playTrain(w);
    const base = AUDIO_LOOKAHEAD_S + 0.1;
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
    const master = made.find((n) => n instanceof FakeGain && n.outputs[0] === ctx.destination);
    for (const n of made) if (n !== master) expect(n.disconnected).toBe(true);
    expect(master?.disconnected).toBe(false);
  });

  it('reuses the master gain and the noise buffer', () => {
    const { ctx, driver } = setup();
    driver.emit(ev({ tag: 'artistic' }));
    driver.emit(ev({ tag: 'artistic' }));
    const [a, b] = ctx.sources();
    expect(a!.buffer).toBe(b!.buffer);
    const masters = ctx.nodes.filter(
      (n) => n instanceof FakeGain && n.outputs[0] === ctx.destination,
    );
    expect(masters).toHaveLength(1);
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
