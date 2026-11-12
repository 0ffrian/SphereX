// R13.9 (Q-441), coordinator ruling 1: the ambience duck is reference-counted and every end path
// of every producer lets go of it: natural end, stop(), play during play, sound off mid-sweep, a
// hidden page, a honesty change, the voice cap, a new context, AppSound unbind and the safety
// timeout. On the fake AudioContext.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeAudioContext, type FakeGain, type FakeNode, type FakeSource } from '@/test/fakeAudio';
import { setAudioContextFactory } from './audioContext';
import { ambienceLevelNow, duckHolds, getBus, setAmbienceLevelSource } from './audioGraph';
import { createAppSound } from './appSound';
import { ListenSweep, planSweep, type PageVisibility, type SweepPlan } from './listenSweep';
import { defaultSettings, flushSoundSettings, useSoundSettings } from './settings';
import { buildSpectrumMapping } from './spectrumMapping';
import { MAX_AUDIO_VOICES } from './tuning';
import { AudioDriver } from './voices';

const asCtx = (c: FakeAudioContext) => c.asAudioContext();

function plan(lines = false): SweepPlan {
  const pts = Array.from({ length: 20 }, (_, i) => ({
    wavelength_um: 1 + i * 0.2,
    flux: 1,
    error: 0.01,
    flagged: false,
  }));
  return planSweep(
    buildSpectrumMapping(pts),
    lines ? [{ gas: 'h2o', lambdaUm: 2.7, tag: 'model_dependent' }] : [],
    { durationS: 2 },
  )!;
}

function settings() {
  let state = { volume: 1, soundOn: true };
  const subs = new Set<(s: typeof state) => void>();
  return {
    get: () => state,
    subscribe(fn: (s: typeof state) => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const fn of [...subs]) fn(state);
    },
  };
}

function page(): PageVisibility & { hide(): void } {
  const subs = new Set<() => void>();
  return {
    isHidden: () => false,
    onHidden(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    hide() {
      for (const fn of [...subs]) fn();
    },
  };
}

function sweepSetup() {
  const ctx = new FakeAudioContext();
  const st = settings();
  const pg = page();
  const sweep = new ListenSweep({ context: () => asCtx(ctx), settings: st, page: pg });
  return { ctx, st, pg, sweep };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Listen sweep lets go of the duck on every end path', () => {
  it('holds while playing; releases at the natural end', () => {
    const { ctx, sweep } = sweepSetup();
    expect(sweep.play(plan(), 'measured')).toBe(true);
    expect(sweep.ducking).toBe(true);
    expect(duckHolds(asCtx(ctx))).toBe(1);
    for (const s of ctx.sources()) s.end();
    expect(sweep.playing).toBe(false);
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('stop() releases', () => {
    const { ctx, sweep } = sweepSetup();
    sweep.play(plan(true), 'derived');
    sweep.stop();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('play during play keeps one hold, then none after the end', () => {
    const { ctx, sweep } = sweepSetup();
    sweep.play(plan(), 'measured');
    sweep.play(plan(), 'measured');
    expect(duckHolds(asCtx(ctx))).toBe(1);
    for (const s of ctx.sources()) s.end();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('sound off mid-sweep releases', () => {
    const { ctx, st, sweep } = sweepSetup();
    sweep.play(plan(), 'measured');
    st.set({ soundOn: false });
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('a hidden page releases', () => {
    const { ctx, pg, sweep } = sweepSetup();
    sweep.play(plan(), 'measured');
    pg.hide();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('a honesty change that hides everything releases', () => {
    const { ctx, sweep } = sweepSetup();
    const estimated = { ...plan(true), tag: 'model_dependent' as const };
    expect(sweep.play(estimated, 'derived')).toBe(true);
    expect(duckHolds(asCtx(ctx))).toBe(1);
    sweep.setHonesty('measured'); // hides the tone and the model_dependent chime
    expect(sweep.playing).toBe(false);
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('the safety timeout releases when no onended ever comes (a suspended context)', () => {
    vi.useFakeTimers();
    const { ctx, sweep } = sweepSetup();
    sweep.play(plan(), 'measured');
    vi.advanceTimersByTime(60_000);
    expect(duckHolds(asCtx(ctx))).toBe(0);
    expect(sweep.ducking).toBe(false);
  });
});

describe('the audio driver lets go of the duck on every end path', () => {
  const ev = (over: Partial<HapticEvent> = {}): HapticEvent => ({
    kind: 'tick',
    strength: 1,
    tag: 'measured',
    ...over,
  });
  function driverSetup() {
    const ctx = new FakeAudioContext();
    const driver = new AudioDriver({ context: () => asCtx(ctx), supported: true });
    return { ctx, driver };
  }

  it('one hold for many voices; released when the last ends', () => {
    const { ctx, driver } = driverSetup();
    driver.emit(ev());
    driver.emit(ev({ voice: 'chime' }));
    expect(driver.ducking).toBe(true);
    expect(duckHolds(asCtx(ctx))).toBe(1);
    for (const s of ctx.sources()) s.end();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('stop() and stopTrain() release', () => {
    const a = driverSetup();
    a.driver.emit(ev());
    a.driver.stop();
    expect(duckHolds(asCtx(a.ctx))).toBe(0);
    const b = driverSetup();
    b.driver.playTrain({
      rateHz: 10,
      strength: 1,
      tag: 'measured',
      pulseOffsetsMs: [0, 100, 200],
      resentCount: 0,
      atMs: 0,
      trainSeq: 1,
    });
    expect(duckHolds(asCtx(b.ctx))).toBe(1);
    b.driver.stopTrain();
    expect(duckHolds(asCtx(b.ctx))).toBe(0);
  });

  it('the voice cap evicts without leaking a hold', () => {
    const { ctx, driver } = driverSetup();
    for (let i = 0; i < MAX_AUDIO_VOICES + 5; i++) driver.emit(ev());
    expect(duckHolds(asCtx(ctx))).toBe(1);
    for (const s of ctx.sources()) s.end();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('a new context drops the old one’s hold', () => {
    const first = new FakeAudioContext();
    const second = new FakeAudioContext();
    let ctx = first;
    const driver = new AudioDriver({ context: () => asCtx(ctx), supported: true });
    driver.emit(ev());
    expect(duckHolds(asCtx(first))).toBe(1);
    ctx = second;
    driver.emit(ev());
    expect(duckHolds(asCtx(first))).toBe(0);
    expect(duckHolds(asCtx(second))).toBe(1);
  });

  it('the safety timeout releases a voice whose onended never fires', () => {
    vi.useFakeTimers();
    const { ctx, driver } = driverSetup();
    driver.emit(ev({ voice: 'chime' }));
    vi.advanceTimersByTime(10_000);
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('plays into the events bus', () => {
    const { ctx, driver } = driverSetup();
    driver.emit(ev());
    const events = getBus(asCtx(ctx), 'events');
    expect(ctx.nodes.some((n) => n.outputs.includes(events as never))).toBe(true);
    expect((ctx.sources()[0] as FakeSource).startAt).not.toBeNull();
  });
});

describe('AppSound: unbind lets go, and the ambience level follows the settings', () => {
  afterEach(() => {
    setAudioContextFactory(null);
    setAmbienceLevelSource(null);
    flushSoundSettings();
    localStorage.clear();
    useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  });

  it('unbind during a sweep releases the duck', async () => {
    const ctx = new FakeAudioContext();
    setAudioContextFactory(() => asCtx(ctx));
    const sound = createAppSound({ engine: { debugTarget: null } });
    const unbind = sound.bind({ get: () => 'derived', subscribe: () => () => undefined });
    const reply = {
      tag: 'measured' as const,
      spectrum: Array.from({ length: 10 }, (_, i) => ({
        wavelength_um: 1 + i * 0.4,
        flux: 1,
        error: 0.01,
        flagged: false,
        frame_id: `f${i}`,
      })),
    };
    expect(await sound.listen(reply)).toBe('playing');
    expect(duckHolds(asCtx(ctx))).toBe(1);
    unbind();
    expect(duckHolds(asCtx(ctx))).toBe(0);
  });

  it('a settings change after the graph exists retargets the ambience level gain', async () => {
    const ctx = new FakeAudioContext();
    setAudioContextFactory(() => asCtx(ctx));
    const sound = createAppSound({ engine: { debugTarget: null } });
    const unbind = sound.bind({ get: () => 'derived', subscribe: () => () => undefined });
    await sound.unlock();
    const input = getBus(asCtx(ctx), 'ambience') as unknown as FakeNode;
    const level = input.outputs[0]!.outputs[0]!.outputs[0] as FakeGain;
    useSoundSettings.getState().update({ volume: 0.5, ambienceVolume: 0.2 });
    expect(level.gain.calls.at(-1)![0]).toBe('target');
    expect(level.gain.calls.at(-1)![1]).toBeCloseTo(0.1);
    useSoundSettings.getState().update({ ambienceOn: false });
    expect(level.gain.calls.at(-1)![1]).toBe(0);
    unbind();
  });

  it('bind registers ambienceVolume × volume; off or unbound gives 0', () => {
    const sound = createAppSound({ engine: { debugTarget: null } });
    const unbind = sound.bind({ get: () => 'derived', subscribe: () => () => undefined });
    useSoundSettings.getState().update({ volume: 0.8, ambienceVolume: 0.5, ambienceOn: true });
    expect(ambienceLevelNow()).toBeCloseTo(0.4);
    useSoundSettings.getState().update({ ambienceOn: false });
    expect(ambienceLevelNow()).toBe(0);
    useSoundSettings.getState().update({ ambienceOn: true, soundOn: false });
    expect(ambienceLevelNow()).toBe(0);
    useSoundSettings.getState().update({ soundOn: true });
    unbind();
    expect(ambienceLevelNow()).toBe(0);
  });
});
