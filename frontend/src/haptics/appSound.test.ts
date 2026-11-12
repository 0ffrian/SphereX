// #76: AppSound, the event app's one audio-only engine. Real engine, sweep, settings store and
// unlock state on a fake AudioContext that starts suspended (as a browser's does before a click).
// The replies come through the app's own client and `parseSpectrum` (fixtures, no network).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/app/api/client';
import type { SpectrumResponse } from '@/app/api/types';
import { FakeAudioContext } from '@/test/fakeAudio';
import { fixtureFetch } from '@/test/fixtureFetch';
import { setAudioContextFactory } from './audioContext';
import { createAppSound, type AppSound, type SpectrumReply } from './appSound';
import { defaultSettings, flushHapticSettings, useHapticSettings } from './settings';
import { buildSpectrumMapping } from './spectrumMapping';
import type { HonestyState } from '@/viewer/honesty';
import { useAppStore } from '@/state/store';

const client = createApiClient({ fetchImpl: fixtureFetch });
let wise: SpectrumResponse;
let barnard: SpectrumResponse;

let ctx: FakeAudioContext;
const made: AppSound[] = [];

/** A honesty source the tests drive by hand. */
function honestySource(initial: HonestyState = 'derived') {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(next: HonestyState) {
      state = next;
      for (const fn of [...subs]) fn();
    },
    get subscribers() {
      return subs.size;
    },
  };
}

function make(): AppSound {
  const s = createAppSound({ engine: { debugTarget: null } });
  made.push(s);
  return s;
}

beforeEach(async () => {
  ctx = new FakeAudioContext({ state: 'suspended' });
  // Before any createAppSound: `AudioDriver.supported` is fixed at construction.
  setAudioContextFactory(() => ctx.asAudioContext());
  wise ??= (await client.spectrum('wise-0855')).data;
  barnard ??= (await client.spectrum('barnards-star')).data;
});

afterEach(() => {
  for (const s of made.splice(0)) s.outputs.engine.dispose();
  setAudioContextFactory(null);
  vi.restoreAllMocks();
  flushHapticSettings();
  localStorage.clear();
  useHapticSettings.setState({
    ...defaultSettings(),
    loaded: false,
  });
  useAppStore.setState({ honesty: 'derived' });
});

describe('the fixture replies', () => {
  it('wise-0855 has points and barnards-star has none (the real empty reply)', () => {
    expect(wise.spectrum.length).toBe(22);
    expect(wise.tag).toBe('measured');
    expect(barnard.spectrum.length).toBe(0);
  });
});

describe('createAppSound: audio only (Q-132)', () => {
  it('has the audio driver only, no side effects and a valid status before bind', () => {
    const sound = make();
    expect(sound.outputs.engine.activeDrivers).toEqual([sound.outputs.audio]);
    expect(sound.outputs).not.toHaveProperty('vibrate');
    expect(ctx.nodes.filter((n) => n.nodeType !== 'destination')).toHaveLength(0); // nothing built yet
    expect(sound.getStatus()).toEqual({
      unlocked: false,
      audio: 'suspended',
      muted: false,
      volume: sound.getStatus().volume,
      listening: false,
    });
  });
});

describe('listen outcomes', () => {
  it("'nothing-to-play' for a reply with no points: no unlock", async () => {
    const sound = make();
    const factory = vi.fn(() => ctx.asAudioContext());
    setAudioContextFactory(factory);
    expect(await sound.listen(barnard)).toBe('nothing-to-play');
    expect(factory).not.toHaveBeenCalled();
    expect(ctx.resumes).toBe(0);
  });

  it("'sound-off' after setMuted(true): no unlock", async () => {
    const sound = make();
    sound.setMuted(true);
    expect(await sound.listen(wise)).toBe('sound-off');
    expect(ctx.resumes).toBe(0);
  });

  it("'no-audio' when there is no AudioContext", async () => {
    const sound = make();
    setAudioContextFactory(() => null);
    expect(await sound.listen(wise)).toBe('no-audio');
  });

  it("'no-audio' when resume leaves the context suspended", async () => {
    const sound = make();
    ctx.resume = async () => {
      ctx.resumes++;
    };
    expect(await sound.listen(wise)).toBe('no-audio');
    expect(ctx.resumes).toBe(1);
    expect(ctx.sources()).toHaveLength(0);
  });

  it("'no-audio' when resume rejects", async () => {
    const sound = make();
    ctx.resume = async () => {
      ctx.resumes++;
      throw new Error('blocked');
    };
    expect(await sound.listen(wise)).toBe('no-audio');
    expect(ctx.sources()).toHaveLength(0);
  });

  it("'hidden' for a derived-tagged reply under Measured (typed, no cast)", async () => {
    const sound = make();
    const reply: SpectrumReply = { spectrum: wise.spectrum, tag: 'derived' };
    const h = honestySource('measured');
    const unbind = sound.bind(h);
    expect(await sound.listen(reply)).toBe('hidden');
    expect(ctx.resumes).toBe(0);
    unbind();
  });

  it("'playing' for wise-0855", async () => {
    const sound = make();
    const unbind = sound.bind(honestySource());
    expect(await sound.listen(wise)).toBe('playing');
    expect(sound.getStatus().listening).toBe(true);
    unbind();
  });
});

describe('listen: user activation and cancellation', () => {
  it('starts the unlock synchronously, before the first await (Q-73)', async () => {
    const sound = make();
    const p = sound.listen(wise);
    expect(ctx.resumes).toBe(1);
    await p;
  });

  it("stopListen() before the promise settles gives 'stopped' and no oscillator starts", async () => {
    const sound = make();
    const p = sound.listen(wise);
    sound.stopListen();
    expect(await p).toBe('stopped');
    expect(ctx.sources().filter((s) => s.startAt !== null)).toHaveLength(0);
  });

  it("unbind during the unlock gives 'stopped'", async () => {
    const sound = make();
    const unbind = sound.bind(honestySource());
    const p = sound.listen(wise);
    unbind();
    expect(await p).toBe('stopped');
    expect(ctx.sources().filter((s) => s.startAt !== null)).toHaveLength(0);
  });

  it("a hidden page during the unlock gives 'stopped'", async () => {
    const sound = make();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const p = sound.listen(wise);
    hidden.mockReturnValue(true);
    expect(await p).toBe('stopped');
    expect(ctx.sources().filter((s) => s.startAt !== null)).toHaveLength(0);
  });

  it("muting during the unlock gives 'sound-off'", async () => {
    const sound = make();
    const p = sound.listen(wise);
    sound.setMuted(true);
    expect(await p).toBe('sound-off');
  });
});

describe('listen: honesty changes during the unlock', () => {
  it("'stopped' (not 'no-audio') when the honesty state changed while unlocking", async () => {
    const sound = make();
    const h = honestySource('derived');
    const unbind = sound.bind(h);
    const p = sound.listen({ spectrum: wise.spectrum, tag: 'derived' });
    h.set('measured');
    expect(await p).toBe('stopped');
    expect(ctx.sources().filter((s) => s.startAt !== null)).toHaveLength(0);
    unbind();
  });
});

describe('settings reach the engine (R8.7)', () => {
  it('mute stops a playing sweep; the volume reaches the engine', async () => {
    const sound = make();
    const unbind = sound.bind(honestySource());
    expect(await sound.listen(wise)).toBe('playing');
    sound.setMuted(true);
    expect(sound.getStatus().listening).toBe(false);
    expect(sound.getStatus().muted).toBe(true);
    sound.setMuted(false);
    sound.setVolume(0.3);
    expect(sound.outputs.audio.volume).toBeCloseTo(0.3);
    expect(sound.getStatus().volume).toBeCloseTo(0.3);
    unbind();
  });
});

describe('honesty after bind (D-21)', () => {
  it('stops a derived train when the state becomes Measured', () => {
    const sound = make();
    const h = honestySource('derived');
    const unbind = sound.bind(h);
    const { engine } = sound.outputs;
    expect(engine.startTrain('t', { rateHz: 5, strength: 0.5, tag: 'derived' })).toBe(true);
    expect(engine.activeTrainId).toBe('t');
    h.set('measured');
    expect(engine.activeTrainId).toBeNull();
    unbind();
  });

  it('stops and disconnects a model_dependent chime in Measured; the tone plays on', async () => {
    const sound = make();
    const h = honestySource('derived');
    const unbind = sound.bind(h);
    const m = buildSpectrumMapping(wise.spectrum);
    const lambdaUm = (m.lambdaMinUm + m.lambdaMaxUm) / 2;
    const outcome = await sound.listen(wise, {
      lines: [{ gas: 'co2', lambdaUm, tag: 'model_dependent' }],
    });
    expect(outcome).toBe('playing');
    const [tone, ...bells] = ctx.sources();
    expect(bells.length).toBeGreaterThan(0);
    h.set('measured');
    for (const b of bells) {
      expect(b.stopCalls).toBeGreaterThanOrEqual(1);
      expect(b.disconnected).toBe(true);
    }
    expect(tone!.disconnected).toBe(false);
    expect(sound.getStatus().listening).toBe(true);
    unbind();
  });
});

describe('status and subscriptions', () => {
  it('is the same reference between changes and notifies on unlock, mute, listen start and end', async () => {
    const sound = make();
    const unbind = sound.bind(honestySource());
    const a = sound.getStatus();
    expect(sound.getStatus()).toBe(a);
    let calls = 0;
    const off = sound.subscribe(() => calls++);

    await sound.unlock();
    expect(calls).toBeGreaterThan(0);
    expect(sound.getStatus()).toMatchObject({ unlocked: true, audio: 'running' });
    expect(sound.getStatus()).not.toBe(a);
    const b = sound.getStatus();
    expect(sound.getStatus()).toBe(b);

    let before = calls;
    sound.setMuted(true);
    expect(calls).toBeGreaterThan(before);
    sound.setMuted(false);

    before = calls;
    expect(await sound.listen(wise)).toBe('playing');
    expect(calls).toBeGreaterThan(before);
    expect(sound.getStatus().listening).toBe(true);

    before = calls;
    sound.stopListen();
    expect(calls).toBeGreaterThan(before);
    expect(sound.getStatus().listening).toBe(false);

    off();
    unbind();
  });
});

describe('bind and unbind', () => {
  it('unbind stops the engine and the sweep, and removes every listener', async () => {
    const sound = make();
    const h = honestySource();
    const unbind = sound.bind(h);
    expect(h.subscribers).toBe(2); // the engine and the sweep
    const engineStop = vi.spyOn(sound.outputs.engine, 'stop');
    expect(await sound.listen(wise)).toBe('playing');
    unbind();
    expect(engineStop).toHaveBeenCalled();
    expect(sound.getStatus().listening).toBe(false);
    expect(h.subscribers).toBe(0);
  });

  it('survives bind, unbind, bind (StrictMode)', async () => {
    const sound = make();
    const h = honestySource();
    sound.bind(h)();
    const unbind = sound.bind(h);
    expect(h.subscribers).toBe(2);
    expect(await sound.listen(wise)).toBe('playing');
    unbind();
  });
});
