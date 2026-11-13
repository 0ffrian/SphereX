// #77: the R8.8 tone stream (Q-189) and the grouped exposure tick (Q-458). The engine on a fake
// clock and a recording tone driver; the audio driver on a fake AudioContext (fades, glides, release,
// a locked context, timbre by tag, the ambience duck); AppSound for mute and the unlock.
import { afterEach, describe, expect, it } from 'vitest';
import type { HapticEvent, ToneId } from '@/contract';
import {
  FakeAudioContext,
  FakeFilter,
  FakeGain,
  FakePanner,
  FakeSource,
  type FakeNode,
} from '@/test/fakeAudio';
import { FakeClock, FakeDriver } from '@/test/fakeSound';
import { setAudioContextFactory } from './audioContext';
import { duckHolds, getBus } from './audioGraph';
import { createAppSound, type AppSound } from './appSound';
import { HAPTIC_DEBUG_EVENT, SoundEngine, type ToneCapableDriver, type ToneOutput } from './engine';
import { pitchToHz, wavelengthToPitch } from './pitch';
import { defaultSettings, flushSoundSettings, useSoundSettings } from './settings';
import {
  AUDIO_LOOKAHEAD_S,
  DUCK_TAU_DIVISOR,
  MAX_EVENTS_PER_SECOND,
  MAX_GROUP_NOTES,
  SOFT_TONE_GAIN,
  TONE_FADE_IN_S,
  TONE_FADE_OUT_S,
  TONE_GLIDE_S,
  TONE_STOP_AFTER_FADES,
  TONE_UPDATE_MIN_MS,
} from './tuning';
import { AudioDriver, toneGain } from './voices';

// ---------------------------------------------------------------- engine, fake tone driver

type ToneCall = [op: 'start' | 'update' | 'stop', id: ToneId, out?: ToneOutput, at?: number];

class FakeToneDriver extends FakeDriver implements ToneCapableDriver {
  readonly toneCalls: ToneCall[] = [];
  startTone(id: ToneId, t: ToneOutput): void {
    this.toneCalls.push(['start', id, { ...t }, this.now()]);
  }
  updateTone(id: ToneId, t: ToneOutput): void {
    this.toneCalls.push(['update', id, { ...t }, this.now()]);
  }
  stopTone(id: ToneId): void {
    this.toneCalls.push(['stop', id]);
  }
  constructor(private readonly now: () => number) {
    super(now);
  }
}

function setup(honesty: 'measured' | 'derived' | 'artistic' = 'derived', multiplier = 1) {
  const clock = new FakeClock();
  const driver = new FakeToneDriver(clock.clock);
  const engine = new SoundEngine([driver], {
    clock: clock.clock,
    timers: clock,
    debugTarget: null,
    honesty,
    strengthMultiplier: multiplier,
  });
  return { clock, driver, engine };
}

const path = { pitch: 0.5, strength: 0.3, tag: 'model_dependent' as const, pan: 0 };

describe('engine tone stream: gate (R8.8, Q-189)', () => {
  it('startTone sends the tone with the strength multiplier applied once', () => {
    const { driver, engine } = setup('derived', 1.5);
    expect(engine.startTone('path', path)).toBe(true);
    expect(engine.hasTone('path')).toBe(true);
    expect(driver.toneCalls).toEqual([
      ['start', 'path', { pitch: 0.5, strength: 0.3 * 1.5, tag: 'model_dependent', pan: 0 }, 0],
    ]);
  });

  it('refuses a hidden tag or a strength that is not finite; nothing plays', () => {
    const { driver, engine } = setup('measured');
    expect(engine.startTone('path', path)).toBe(false); // model_dependent hidden in Measured only
    expect(engine.startTone('path', { ...path, tag: 'measured', strength: NaN })).toBe(false);
    expect(driver.toneCalls.filter((c) => c[0] !== 'stop')).toHaveLength(0);
    expect(engine.hasTone('path')).toBe(false);
  });

  it('an update to a hidden tag stops the tone; a NaN strength is refused and the tone plays on', () => {
    const { clock, driver, engine } = setup('derived');
    engine.startTone('path', path);
    clock.advance(20);
    expect(engine.updateTone('path', { strength: NaN })).toBe(false);
    expect(engine.hasTone('path')).toBe(true);
    expect(engine.updateTone('path', { tag: 'artistic' })).toBe(false);
    expect(engine.hasTone('path')).toBe(false);
    expect(driver.toneCalls.at(-1)).toEqual(['stop', 'path']);
  });

  it('a honesty change stops every tone the new state hides, and only those', () => {
    const { driver, engine } = setup('derived');
    engine.startTone('path', path);
    engine.startTone('body', { ...path, tag: 'measured' });
    engine.setHonesty('measured');
    expect(engine.hasTone('path')).toBe(false);
    expect(engine.hasTone('body')).toBe(true);
    expect(driver.toneCalls.filter((c) => c[0] === 'stop').map((c) => c[1])).toEqual(['path']);
  });

  it('stop() ends every tone; later updates return false until startTone', () => {
    const { driver, engine } = setup();
    engine.startTone('path', path);
    engine.stop();
    expect(driver.stops).toBe(1);
    expect(engine.updateTone('path', { pitch: 0.2 })).toBe(false);
    expect(engine.startTone('path', path)).toBe(true);
  });
});

describe('engine tone stream: updates (R8.8)', () => {
  it('coalesces updates to one send per TONE_UPDATE_MIN_MS; the last change always lands', () => {
    const { clock, driver, engine } = setup();
    engine.startTone('path', path);
    for (let i = 1; i <= 10; i++) {
      clock.advance(1);
      expect(engine.updateTone('path', { pitch: i / 10, pan: -i / 10 })).toBe(true);
    }
    expect(driver.toneCalls.filter((c) => c[0] === 'update')).toHaveLength(0);
    clock.advance(TONE_UPDATE_MIN_MS);
    const updates = driver.toneCalls.filter((c) => c[0] === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]![2]).toMatchObject({ pitch: 1, pan: -1 });
    expect(updates[0]![3]).toBe(TONE_UPDATE_MIN_MS);
    expect(clock.pendingCount).toBe(0);
  });

  it('a 200 Hz update stream sends at most one update per frame', () => {
    const { clock, driver, engine } = setup();
    engine.startTone('path', path);
    for (let i = 0; i < 200; i++) {
      engine.updateTone('path', { pitch: (i % 100) / 100 });
      clock.advance(5);
    }
    const times = driver.toneCalls.filter((c) => c[0] === 'update').map((c) => c[3]!);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(TONE_UPDATE_MIN_MS);
    expect(times.length).toBeGreaterThan(50);
  });

  it('updates do not count against the 40 events/s cap', () => {
    const { clock, driver, engine } = setup();
    engine.startTone('path', path);
    for (let i = 0; i < MAX_EVENTS_PER_SECOND; i++) {
      engine.updateTone('path', { pitch: i / 100 });
      clock.advance(TONE_UPDATE_MIN_MS);
    }
    expect(engine.emit({ kind: 'tick', strength: 0.5, tag: 'measured' })).toBe(true);
    expect(driver.events).toHaveLength(1);
  });

  it('stopTone cancels a pending coalesced send', () => {
    const { clock, driver, engine } = setup();
    engine.startTone('path', path);
    engine.updateTone('path', { pitch: 0.9 });
    expect(clock.pendingCount).toBe(1);
    engine.stopTone('path');
    clock.advance(100);
    expect(clock.pendingCount).toBe(0);
    expect(driver.toneCalls.map((c) => c[0])).toEqual(['start', 'stop']);
  });

  it('a disabled driver (sound off) gets no tone calls; the tone resumes on the next update', () => {
    const { clock, driver, engine } = setup();
    engine.startTone('path', path);
    engine.setDriverEnabled(driver, false);
    expect(driver.stops).toBe(1);
    clock.advance(20);
    engine.updateTone('path', { pitch: 0.4 });
    expect(driver.toneCalls.filter((c) => c[0] === 'update')).toHaveLength(0);
    engine.setDriverEnabled(driver, true);
    clock.advance(20);
    engine.updateTone('path', { pitch: 0.6 });
    const last = driver.toneCalls.at(-1)!;
    expect(last[0]).toBe('update');
    expect(last[2]?.pitch).toBe(0.6);
  });
});

// ---------------------------------------------------------------- emitTogether (Q-458)

const note = (pitch: number, over: Partial<HapticEvent> = {}): HapticEvent => ({
  kind: 'tick',
  strength: 0.6,
  tag: 'measured',
  pitch,
  voice: 'tone',
  channel: 'data',
  ...over,
});

describe('emitTogether: the two-note exposure tick (Q-458, R8.9.2)', () => {
  const d1 = wavelengthToPitch(1.2);
  const d4 = wavelengthToPitch(3.4);

  it('both notes of an exposure reach the driver at the same time', () => {
    const { driver, engine } = setup('measured');
    expect(engine.emitTogether([note(d1, { pan: -0.2 }), note(d4, { pan: -0.2 })])).toBe(2);
    expect(driver.events.map((e) => e.pitch)).toEqual([d1, d4]);
    expect(new Set(driver.events.map((e) => e.at)).size).toBe(1);
  });

  it('the old path: two emits at once lose the second note to the 25 ms gap', () => {
    const { driver, engine } = setup('measured');
    expect(engine.emit(note(d1))).toBe(true);
    expect(engine.emit(note(d4))).toBe(false);
    expect(driver.events).toHaveLength(1);
  });

  it('a group is one event: it keeps the 25 ms gap and counts once against the cap', () => {
    const { clock, driver, engine } = setup('measured');
    expect(engine.emitTogether([note(d1), note(d4)])).toBe(2);
    clock.advance(10);
    expect(engine.emitTogether([note(d1), note(d4)])).toBe(0); // inside 25 ms
    expect(engine.emit(note(d1))).toBe(false);
    clock.advance(990); // a fresh 1 s window
    // 40 groups 25 ms apart in one second: all play. Were each note an event, 80 would hit the cap.
    let groups = 0;
    for (let i = 0; i < MAX_EVENTS_PER_SECOND; i++) {
      if (engine.emitTogether([note(d1), note(d4)]) === 2) groups++;
      clock.advance(25);
    }
    expect(groups).toBe(MAX_EVENTS_PER_SECOND);
    expect(driver.events).toHaveLength(2 + 2 * MAX_EVENTS_PER_SECOND);
  });

  it('each note keeps its own honesty gate', () => {
    const { driver, engine } = setup('measured');
    expect(engine.emitTogether([note(d1), note(d4, { tag: 'derived' })])).toBe(1);
    expect(driver.events.map((e) => e.pitch)).toEqual([d1]);
    expect(engine.emitTogether([note(d1, { tag: 'artistic' })])).toBe(0);
  });

  it('the debug hook fires once per note that played (Q-458)', () => {
    const clock = new FakeClock();
    const driver = new FakeToneDriver(clock.clock);
    const debug = new EventTarget();
    let n = 0;
    debug.addEventListener(HAPTIC_DEBUG_EVENT, () => n++);
    const engine = new SoundEngine([driver], {
      clock: clock.clock,
      timers: clock,
      debugTarget: debug,
      honesty: 'measured',
    });
    expect(engine.emitTogether([note(d1), note(d4), note(0.5, { tag: 'derived' })])).toBe(2);
    expect(n).toBe(2);
  });

  it('refuses empty, oversized, stop, pulseTrain or NaN-strength groups', () => {
    const { driver, engine } = setup('measured');
    expect(engine.emitTogether([])).toBe(0);
    expect(engine.emitTogether(Array.from({ length: MAX_GROUP_NOTES + 1 }, () => note(0.5)))).toBe(
      0,
    );
    expect(engine.emitTogether([note(0.5), note(0.5, { kind: 'stop' })])).toBe(0);
    expect(engine.emitTogether([note(0.5, { kind: 'pulseTrain', rateHz: 4 })])).toBe(0);
    expect(engine.emitTogether([note(0.5, { strength: NaN })])).toBe(0);
    expect(driver.events).toHaveLength(0);
    expect(driver.stops).toBe(0);
  });
});

// ---------------------------------------------------------------- audio driver, fake AudioContext

function audio(options: ConstructorParameters<typeof FakeAudioContext>[0] = {}) {
  const ctx = new FakeAudioContext(options);
  const driver = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  return { ctx, driver };
}

const out = (over: Partial<ToneOutput> = {}): ToneOutput => ({
  pitch: 0.5,
  strength: 0.5,
  tag: 'measured',
  pan: 0.25,
  ...over,
});

/** The tone's envelope: the gain node its source (or its filter) feeds. */
function envOf(src: FakeSource): FakeGain {
  let n: FakeNode = src.outputs[0]!;
  if (n instanceof FakeFilter) n = n.outputs[0]!;
  return n as FakeGain;
}

function toneSources(ctx: FakeAudioContext): FakeSource[] {
  return ctx.sources();
}

describe('audio driver tones: shape (R8.8, R8.9)', () => {
  it('measured: a clean sine that fades in from currentTime + lookahead, into the events bus', () => {
    const { ctx, driver } = audio();
    ctx.currentTime = 1;
    driver.startTone('path', out());
    const [osc] = toneSources(ctx);
    expect(osc!.nodeType).toBe('oscillator');
    expect(osc!.type).toBe('sine');
    expect(osc!.frequency.value).toBeCloseTo(pitchToHz(0.5));
    const when = 1 + AUDIO_LOOKAHEAD_S;
    expect(osc!.startAt).toBeCloseTo(when);
    expect(osc!.stopAt).toBeNull(); // sustained
    const env = envOf(osc!);
    expect(env.gain.value).toBe(0);
    expect(env.gain.calls[0]).toEqual(['set', 0, when]);
    expect(env.gain.targets).toEqual([
      { v: toneGain(0.5, 'clean'), t: when, tau: TONE_FADE_IN_S / DUCK_TAU_DIVISOR },
    ]);
    const panner = env.outputs[0] as FakePanner;
    expect(panner.pan.value).toBe(0.25);
    const master = panner.outputs[0] as FakeGain;
    expect(master.outputs[0]).toBe(getBus(ctx.asAudioContext(), 'events'));
    expect(driver.toneIds).toEqual(['path']);
  });

  it('Estimated tags: a softer sine (× SOFT_TONE_GAIN) through a low-pass', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out({ tag: 'model_dependent' }));
    const [osc] = toneSources(ctx);
    const lp = osc!.outputs[0] as FakeFilter;
    expect(lp.type).toBe('lowpass');
    expect(envOf(osc!).gain.targets[0]!.v).toBeCloseTo(toneGain(0.5, 'clean') * SOFT_TONE_GAIN);
  });

  it('artistic: looped noise band-passed at the pitch, and the glide moves the band', () => {
    const { ctx, driver } = audio();
    driver.startTone('body', out({ tag: 'artistic', pitch: 0.2 }));
    const [noise] = toneSources(ctx);
    expect(noise!.nodeType).toBe('bufferSource');
    expect(noise!.loop).toBe(true);
    const bp = noise!.outputs[0] as FakeFilter;
    expect(bp.type).toBe('bandpass');
    expect(bp.frequency.value).toBeCloseTo(pitchToHz(0.2));
    driver.updateTone('body', out({ tag: 'artistic', pitch: 0.8 }));
    expect(bp.frequency.targets.at(-1)!.v).toBeCloseTo(pitchToHz(0.8));
  });

  it('updates glide pitch, gain and pan with TONE_GLIDE_S and build no nodes', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    const nodes = ctx.nodes.length;
    const [osc] = toneSources(ctx);
    const env = envOf(osc!);
    const panner = env.outputs[0] as FakePanner;
    ctx.currentTime = 2;
    driver.updateTone('path', out({ pitch: 0.9, strength: 0.2, pan: -2 }));
    expect(ctx.nodes.length).toBe(nodes);
    expect(osc!.frequency.targets.at(-1)).toEqual({ v: pitchToHz(0.9), t: 2, tau: TONE_GLIDE_S });
    expect(env.gain.targets.at(-1)).toEqual({ v: toneGain(0.2, 'clean'), t: 2, tau: TONE_GLIDE_S });
    expect(panner.pan.targets.at(-1)).toEqual({ v: -1, t: 2, tau: TONE_GLIDE_S }); // clamped
  });

  it('stopTone fades out, stops the source after the fade and releases every node on end', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    const [osc] = toneSources(ctx);
    const env = envOf(osc!);
    const panner = env.outputs[0] as FakePanner;
    ctx.currentTime = 3;
    driver.stopTone('path');
    // No cancelAndHoldAtTime on the fake: cancel, then hold the current value, then fade.
    expect(env.gain.calls.slice(-3, -1)).toEqual([
      ['cancel', 0, 3],
      ['set', env.gain.value, 3],
    ]);
    expect(env.gain.targets.at(-1)).toEqual({
      v: 0,
      t: 3,
      tau: TONE_FADE_OUT_S / DUCK_TAU_DIVISOR,
    });
    expect(osc!.stopAt).toBeCloseTo(3 + TONE_FADE_OUT_S * TONE_STOP_AFTER_FADES);
    expect(driver.toneIds).toEqual([]);
    expect(osc!.disconnected).toBe(false); // still fading
    osc!.end();
    for (const n of [osc!, env, panner]) expect(n.disconnected).toBe(true);
    expect(driver.ducking).toBe(false);
  });

  it('uses cancelAndHoldAtTime when the browser has it, so the fade cannot jump', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    const env = envOf(toneSources(ctx)[0]!);
    const held: number[] = [];
    (env.gain as unknown as { cancelAndHoldAtTime: (t: number) => void }).cancelAndHoldAtTime = (
      t,
    ) => held.push(t);
    ctx.currentTime = 0.01; // still inside the fade-in's lookahead
    driver.stopTone('path');
    expect(held).toEqual([0.01]);
    expect(env.gain.calls.filter((c) => c[0] === 'cancel')).toHaveLength(0);
    expect(env.gain.targets.at(-1)!.v).toBe(0);
  });

  it('a tag that changes the timbre cross-fades to a new voice', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out({ tag: 'measured' }));
    driver.updateTone('path', out({ tag: 'derived' }));
    const [a, b] = toneSources(ctx);
    expect(a!.stopAt).not.toBeNull(); // the old one fades out
    expect(b!.startAt).not.toBeNull();
    expect(b!.outputs[0]).toBeInstanceOf(FakeFilter);
  });

  it('startTone on a playing id replaces it (one tone per id)', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    driver.startTone('path', out({ pitch: 0.1 }));
    const [a, b] = toneSources(ctx);
    expect(a!.stopAt).not.toBeNull();
    expect(b!.stopAt).toBeNull();
    expect(driver.toneIds).toEqual(['path']);
  });

  it('stop() fades every tone out too', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    driver.startTone('body', out());
    driver.stop();
    expect(driver.toneIds).toEqual([]);
    for (const s of toneSources(ctx)) expect(s.stopAt).not.toBeNull();
  });
});

describe('audio driver tones: locked context and the duck', () => {
  it('a suspended context builds nothing and does not throw; the next update after resume starts it', async () => {
    const { ctx, driver } = audio({ state: 'suspended' });
    expect(() => driver.startTone('path', out())).not.toThrow();
    expect(() => driver.updateTone('path', out())).not.toThrow();
    expect(() => driver.stopTone('path')).not.toThrow();
    expect(toneSources(ctx)).toHaveLength(0);
    await ctx.resume();
    driver.updateTone('path', out({ pitch: 0.7 }));
    const [osc] = toneSources(ctx);
    expect(osc!.frequency.value).toBeCloseTo(pitchToHz(0.7));
    expect(envOf(osc!).gain.targets[0]!.tau).toBeCloseTo(TONE_FADE_IN_S / DUCK_TAU_DIVISOR);
  });

  it('startTone while suspended cuts the old voice, so resume never brings back its old pitch', async () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out({ pitch: 0.1 }));
    const [old] = toneSources(ctx);
    ctx.simulateState('suspended');
    driver.startTone('path', out({ pitch: 0.9 }));
    expect(old!.disconnected).toBe(true);
    expect(driver.toneIds).toEqual([]);
    await ctx.resume();
    driver.updateTone('path', out({ pitch: 0.9 }));
    const fresh = toneSources(ctx).at(-1)!;
    expect(fresh).not.toBe(old);
    expect(fresh.frequency.value).toBeCloseTo(pitchToHz(0.9));
  });

  it('a context that has no output at all is a no-op', () => {
    const driver = new AudioDriver({ context: () => null, supported: true });
    expect(() => {
      driver.startTone('path', out());
      driver.updateTone('path', out());
      driver.stopTone('path');
    }).not.toThrow();
  });

  it('stopping while the context is suspended cuts and releases at once', () => {
    const { ctx, driver } = audio();
    driver.startTone('path', out());
    const [osc] = toneSources(ctx);
    ctx.simulateState('suspended');
    driver.stopTone('path');
    expect(osc!.disconnected).toBe(true);
  });

  it('holds the ambience duck while a tone sounds, with no safety timeout, and lets go after', () => {
    const { ctx, driver } = audio();
    const c = ctx.asAudioContext();
    driver.startTone('path', out());
    expect(driver.ducking).toBe(true);
    expect(duckHolds(c)).toBe(1);
    driver.updateTone('path', out({ pitch: 0.3 }));
    expect(duckHolds(c)).toBe(1);
    driver.stopTone('path');
    expect(duckHolds(c)).toBe(0);
    expect(driver.ducking).toBe(false);
  });
});

// ---------------------------------------------------------------- AppSound: unlock and mute

describe('AppSound tones (the API #78 calls)', () => {
  const made: AppSound[] = [];
  afterEach(() => {
    for (const s of made.splice(0)) s.outputs.engine.dispose();
    setAudioContextFactory(null);
    flushSoundSettings();
    localStorage.clear();
    useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  });

  function make(ctx: FakeAudioContext): AppSound {
    setAudioContextFactory(() => ctx.asAudioContext());
    const s = createAppSound({ engine: { debugTarget: null } });
    made.push(s);
    return s;
  }
  const honesty = { get: () => 'derived' as const, subscribe: () => () => undefined };

  it('started before the unlock: silent, then sounds once a click unlocks and the replay updates', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    const sound = make(ctx);
    const unbind = sound.bind(honesty);
    expect(sound.startTone('path', path)).toBe(true);
    expect(toneSources(ctx)).toHaveLength(0);
    expect(await sound.unlock()).toBe(true);
    await new Promise((r) => setTimeout(r, TONE_UPDATE_MIN_MS + 5));
    expect(sound.updateTone('path', { pan: 0.5 })).toBe(true);
    expect(sound.outputs.audio.toneIds).toEqual(['path']);
    expect(sound.hasTone('path')).toBe(true);
    unbind();
    expect(sound.outputs.audio.toneIds).toEqual([]);
    expect(sound.hasTone('path')).toBe(false); // the caller restarts it with startTone
  });

  it('mute fades the tone out; the volume sets the tone bus gain', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    const sound = make(ctx);
    const unbind = sound.bind(honesty);
    await sound.unlock();
    sound.setVolume(0.4);
    sound.startTone('path', path);
    const [osc] = toneSources(ctx);
    const master = (envOf(osc!).outputs[0] as FakePanner).outputs[0] as FakeGain;
    expect(master.gain.value).toBeCloseTo(0.4);
    sound.setMuted(true);
    expect(sound.outputs.audio.toneIds).toEqual([]);
    expect(osc!.stopAt).not.toBeNull();
    unbind();
  });

  it('emitTogether plays both notes of an exposure through the audio driver', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    const sound = make(ctx);
    const unbind = sound.bind(honesty);
    await sound.unlock();
    expect(sound.emitTogether([note(0.2), note(0.8)])).toBe(2);
    const freqs = toneSources(ctx).map((s) => s.frequency.value);
    expect(freqs).toEqual([pitchToHz(0.2), pitchToHz(0.8)]);
    unbind();
  });
});
