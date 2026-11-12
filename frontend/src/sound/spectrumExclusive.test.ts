// Q-446: the chord, the Listen sweep and the Hear it sweep are mutually exclusive whoever starts them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetHearAudioForTests, startSpectrum } from '@/app/build/hearAudio';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from './audioContext';
import { duckHolds } from './audioGraph';
import { ListenSweep, planSweep } from './listenSweep';
import { defaultSettings, flushSoundSettings, useSoundSettings } from './settings';
import { planChord, SpectrumChord } from './spectrumChord';
import { claimSpectrumSound, spectrumSoundHeld, stopSpectrumSound } from './spectrumExclusive';
import { buildSpectrumMapping } from './spectrumMapping';

const pts = Array.from({ length: 40 }, (_, i) => ({
  wavelength_um: 0.75 + (4.25 * i) / 39,
  flux: 1,
  error: 0.01,
  flagged: false,
}));
const mapping = buildSpectrumMapping(pts);
const values = Array.from({ length: 64 }, () => 0.8);

let ctx: FakeAudioContext;
const page = { isHidden: () => false, onHidden: () => () => {} };

function players() {
  const opts = { context: () => ctx.asAudioContext(), page };
  return { chord: new SpectrumChord(opts), sweep: new ListenSweep(opts) };
}

beforeEach(() => {
  localStorage.clear();
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
  ctx = new FakeAudioContext();
  setAudioContextFactory(() => ctx.asAudioContext());
  resetHearAudioForTests();
});
afterEach(() => {
  stopSpectrumSound();
  resetHearAudioForTests();
  setAudioContextFactory(null);
  flushSoundSettings();
  localStorage.clear();
});

describe('one spectrum sound at a time (Q-446)', () => {
  it('a new claim stops the holder; release only clears its own claim', () => {
    let stopped = 0;
    const a = claimSpectrumSound(() => stopped++);
    const b = claimSpectrumSound(() => {});
    expect(stopped).toBe(1);
    a.release();
    expect(b.held).toBe(true);
    b.release();
    expect(spectrumSoundHeld()).toBe(false);
  });

  it('chord → Listen sweep: the chord stops', () => {
    const { chord, sweep } = players();
    expect(chord.start(planChord(mapping)!, 'data', 'derived')).toBe(true);
    expect(sweep.play(planSweep(mapping)!, 'derived')).toBe(true);
    expect(chord.playing).toBe(false);
    expect(sweep.playing).toBe(true);
  });

  it('Listen sweep → chord: the sweep stops', () => {
    const { chord, sweep } = players();
    sweep.play(planSweep(mapping)!, 'derived');
    chord.start(planChord(mapping)!, 'data', 'derived');
    expect(sweep.playing).toBe(false);
    expect(chord.playing).toBe(true);
  });

  it('chord → Hear it sweep: the chord stops', () => {
    const { chord } = players();
    chord.start(planChord(mapping)!, 'data', 'derived');
    const h = startSpectrum(values, 0)!;
    expect(chord.playing).toBe(false);
    expect(h.position().done).toBe(false);
  });

  it('Hear it sweep → chord: the Hear it sweep stops', () => {
    const { chord } = players();
    const h = startSpectrum(values, 0)!;
    chord.start(planChord(mapping)!, 'data', 'derived');
    expect(h.position().done).toBe(true);
    expect(chord.playing).toBe(true);
  });

  it('Hear it sweep ↔ Listen sweep, both ways', () => {
    const { sweep } = players();
    const h = startSpectrum(values, 0)!;
    sweep.play(planSweep(mapping)!, 'derived');
    expect(h.position().done).toBe(true);
    const h2 = startSpectrum(values, 0)!;
    expect(sweep.playing).toBe(false);
    h2.stop();
    expect(spectrumSoundHeld()).toBe(false);
  });

  it('after all of that, only the last sound holds the duck', () => {
    const { chord, sweep } = players();
    chord.start(planChord(mapping)!, 'data', 'derived');
    sweep.play(planSweep(mapping)!, 'derived');
    const h = startSpectrum(values, 0)!;
    expect(duckHolds(ctx.asAudioContext())).toBe(1);
    h.stop();
    expect(duckHolds(ctx.asAudioContext())).toBe(0);
  });
});
