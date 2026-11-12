// R8.9: the one master bus per AudioContext (a single limiter for every module) and the shared
// bell, on the fake context.
import { describe, expect, it } from 'vitest';
import { FakeAudioContext, FakeCompressor, FakeGain, FakeSource } from '@/test/fakeAudio';
import { getMasterBus, playBell } from './audioGraph';
import { AudioDriver } from './voices';
import { CHIME_DECAY_S, CHIME_PARTIAL_RATIO, LIMITER_THRESHOLD_DB } from './tuning';

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
