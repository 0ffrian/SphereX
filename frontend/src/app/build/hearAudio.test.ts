// #111 (R13.9, Q-442): Moon's Hear it sound runs on the shared sound engine: the shared context,
// the spectrum bus into the one limiter, the Sound settings (off = no output gain, volume scales
// it) and the ambience duck while the spectrum sweep plays. On the fake AudioContext.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAnalyser, FakeAudioContext, type FakeGain, type FakeSource } from '@/test/fakeAudio';
import { setAudioContextFactory } from '@/sound/audioContext';
import { duckHolds, getBus } from '@/sound/audioGraph';
import { defaultSettings, flushSoundSettings, useSoundSettings } from '@/sound/settings';
import {
  MASTER_GAIN,
  hearGain,
  resetHearAudioForTests,
  startAtmosphere,
  startSpectrum,
} from './hearAudio';

let ctx: FakeAudioContext;
const values = Array.from({ length: 64 }, (_, i) => (i % 7) / 6);
const model = { P: 1, T: 288, c: 340, gas: 'air', gMs2: 9.8 } as never;

function master(): FakeGain {
  const analyser = ctx.nodes.find((n) => n instanceof FakeAnalyser)!;
  return ctx.nodes.find((n) => n.outputs.includes(analyser)) as FakeGain;
}

beforeEach(() => {
  localStorage.clear();
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  ctx = new FakeAudioContext();
  setAudioContextFactory(() => ctx.asAudioContext());
  resetHearAudioForTests();
});
afterEach(() => {
  resetHearAudioForTests();
  setAudioContextFactory(null);
  flushSoundSettings();
  localStorage.clear();
});

describe('Hear it on the shared sound engine', () => {
  it('uses the shared context and plays into the spectrum bus (one limiter)', () => {
    expect(startSpectrum(values, 0)).not.toBeNull();
    expect(ctx.resumes).toBe(0); // the fake starts running; the unlock made no second context
    const analyser = ctx.nodes.find((n) => n instanceof FakeAnalyser)!;
    expect(analyser.outputs).toEqual([getBus(ctx.asAudioContext(), 'spectrum')]);
    expect(master().gain.value).toBeCloseTo(MASTER_GAIN * defaultSettings().volume);
  });

  it('Sound off gives no output gain; volume 0 gives zero gain; both follow live', () => {
    useSoundSettings.getState().update({ soundOn: false });
    startSpectrum(values, 0);
    expect(master().gain.value).toBe(0);
    useSoundSettings.getState().update({ soundOn: true, volume: 0.5 });
    expect(master().gain.calls.at(-1)).toEqual(['target', MASTER_GAIN * 0.5, 0]);
    useSoundSettings.getState().update({ volume: 0 });
    expect(master().gain.calls.at(-1)).toEqual(['target', 0, 0]);
    useSoundSettings.getState().update({ volume: 0.8, soundOn: false });
    expect(master().gain.calls.at(-1)).toEqual(['target', 0, 0]);
    expect(hearGain({ soundOn: true, volume: 0 })).toBe(0);
    expect(hearGain({ soundOn: false, volume: 1 })).toBe(0);
  });

  it('the spectrum sweep ducks the ambience until it ends or stops; the wind does not', () => {
    const a = startSpectrum(values, 0)!;
    expect(duckHolds(ctx.asAudioContext())).toBe(1);
    a.stop();
    expect(duckHolds(ctx.asAudioContext())).toBe(0);
    startSpectrum(values, 0);
    const osc = ctx
      .sources()
      .filter((s: FakeSource) => s.type === 'triangle')
      .at(-1)!;
    osc.end();
    expect(duckHolds(ctx.asAudioContext())).toBe(0);
    const wind = startAtmosphere(model)!;
    expect(duckHolds(ctx.asAudioContext())).toBe(0);
    wind.stop();
  });

  it('a new shared context rebuilds the nodes on it', () => {
    startSpectrum(values, 0)!.stop();
    const first = ctx;
    ctx = new FakeAudioContext();
    first.simulateState('closed'); // the shared one is gone: the next unlock makes this one
    startSpectrum(values, 0);
    expect(ctx.nodes.some((n) => n instanceof FakeAnalyser)).toBe(true);
  });
});
