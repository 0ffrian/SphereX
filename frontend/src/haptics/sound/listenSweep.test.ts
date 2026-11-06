import { describe, expect, it } from 'vitest';
import {
  FakeAudioContext,
  FakeCompressor,
  FakeGain,
  FakePanner,
  FakeSource,
  type FakeNode,
} from '@/test/fakeAudio';
import { fixture } from '@/test/sharedFixtures';
import { getMasterBus } from '../audioGraph';
import { pitchToHz, wavelengthToPitch } from '../pitch';
import { buildSpectrumMapping, type SpectrumMappingPoint } from '../spectrumMapping';
import {
  AUDIO_LOOKAHEAD_S,
  SWEEP_CHIME_GAIN,
  SWEEP_PAN,
  SWEEP_PEAK_GAIN,
  SWEEP_SAMPLES_PER_POINT,
  SWEEP_STEPS,
} from '../tuning';
import {
  GAS_LINES_UM,
  gasLinesForEpoch,
  ListenSweep,
  planSweep,
  sweepPanAt,
  type GasLine,
} from './listenSweep';

/** 1–5 µm, flat at 1 with an absorption dip to 0.05 around 3 µm. */
function dipSpectrum(): SpectrumMappingPoint[] {
  const pts: SpectrumMappingPoint[] = [];
  for (let i = 0; i <= 80; i++) {
    const l = 1 + (4 * i) / 80;
    pts.push({
      wavelength_um: l,
      flux: Math.abs(l - 3) < 0.2 ? 0.05 : 1,
      error: 0.01,
      flagged: false,
    });
  }
  return pts;
}

const H2O: GasLine = { gas: 'h2o', lambdaUm: GAS_LINES_UM.h2o, tag: 'measured' };

describe('planSweep (A8, R8.6 item 3)', () => {
  it('pitch from λ, gain from the normalised flux, the dip silent', () => {
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()))!;
    expect(plan.tag).toBe('measured');
    expect(plan.steps).toHaveLength(Math.max(SWEEP_STEPS, SWEEP_SAMPLES_PER_POINT * 81) + 1);
    // Same λ → pitch mapping as the haptics (pitch.ts).
    for (const st of plan.steps)
      expect(st.hz).toBeCloseTo(pitchToHz(wavelengthToPitch(st.lambdaUm)));
    // Pitch rises with λ (PITCH_RISES_WITH_WAVELENGTH).
    expect(plan.steps.at(-1)!.hz).toBeGreaterThan(plan.steps[0]!.hz);
    const dip = plan.steps.filter((s) => Math.abs(s.lambdaUm - 3) < 0.1);
    expect(dip.length).toBeGreaterThanOrEqual(3);
    expect(dip.every((s) => s.quiet && s.level === 0)).toBe(true);
    expect(plan.steps[0]!.level).toBeCloseTo(1);
  });

  it('chimes only at gas lines inside the range, with their tag', () => {
    const lines: GasLine[] = [
      { ...H2O, tag: 'model_dependent' },
      { gas: 'co', lambdaUm: 7, tag: 'measured' },
    ];
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()), lines, { durationS: 6 })!;
    expect(plan.chimes).toHaveLength(1);
    expect(plan.chimes[0]!.t).toBeCloseTo((6 * (2.7 - 1)) / 4);
    expect(plan.chimes[0]!.tag).toBe('model_dependent');
  });

  it('nothing to play for an empty or one-wavelength spectrum (the pad refuses it too)', () => {
    expect(planSweep(buildSpectrumMapping([]))).toBeNull();
    const one = [{ wavelength_um: 2, flux: 1, error: 0.01, flagged: false }];
    expect(planSweep(buildSpectrumMapping(one))).toBeNull();
    const two = [...one, { wavelength_um: 3, flux: 1, error: 0.01, flagged: false }];
    expect(planSweep(buildSpectrumMapping(two))).not.toBeNull();
  });

  it('gas lines (A4.3) only for gases with Q in the selected epoch, tagged by their Q', () => {
    const { card } = fixture('comet');
    expect(GAS_LINES_UM).toEqual({ h2o: 2.7, co2: 4.25, co: 4.67 });
    const aug = gasLinesForEpoch(card, '2025-08');
    expect(aug.map((l) => l.gas)).toEqual(['h2o', 'co2', 'co']);
    expect(aug.every((l) => l.tag === card.gas_Q!.co2!.tag)).toBe(true);
    expect(gasLinesForEpoch(card, '2025-12')).toEqual([]);
    expect(gasLinesForEpoch(fixture('star').card, '2025-08')).toEqual([]);
  });
});

/** A settings stand-in: volume and sound switch, with change notification. */
function fakeSettings(volume = 1, soundOn = true) {
  let state = { volume, soundOn };
  const subs = new Set<(st: typeof state) => void>();
  return {
    get: () => state,
    subscribe(fn: (st: typeof state) => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const fn of [...subs]) fn(state);
    },
    get subscribers() {
      return subs.size;
    },
  };
}

/** Every node of the sweep is disconnected; the shared master bus and its limiter stay. */
function freed(ctx: FakeAudioContext, nodes: readonly FakeNode[] = ctx.nodes): boolean {
  const bus = getMasterBus(ctx.asAudioContext()) as unknown as FakeNode;
  return nodes
    .filter((n) => n.nodeType !== 'destination' && n !== bus && !(n instanceof FakeCompressor))
    .every((n) => n.disconnected);
}

describe('planSweep: a one-channel dip is quiet in the sweep as under the finger (R8.6 item 3)', () => {
  it('catches a 2% one-channel dip at every position across a 102-channel spectrum', () => {
    // About 102 SPHEREx-like channels, log-spaced over 0.75 to 5 um.
    const n = 102;
    const lambdas = Array.from({ length: n }, (_, i) => 0.75 * (5 / 0.75) ** (i / (n - 1)));
    let missed = 0;
    let tried = 0;
    for (let k = 1; k < n - 1; k++) {
      const pts = lambdas.map((l, i) => ({
        wavelength_um: l,
        flux: i === k ? 0.02 : 1,
        error: 0.01,
        flagged: false,
      }));
      const mapping = buildSpectrumMapping(pts);
      // The finger is quiet at the dip's own wavelength,
      expect(mapping.sampleAt(lambdas[k]!)!.quiet).toBe(true);
      // and the sweep has at least one quiet step there.
      const plan = planSweep(mapping)!;
      const quiet = plan.steps.filter(
        (st) => st.quiet && st.lambdaUm > lambdas[k - 1]! && st.lambdaUm < lambdas[k + 1]!,
      );
      tried++;
      if (quiet.length === 0) missed++;
    }
    expect(tried).toBe(100);
    expect(missed).toBe(0);
  });

  it('pans chimes where the sweep is', () => {
    expect(sweepPanAt(0, 6)).toBeCloseTo(-SWEEP_PAN);
    expect(sweepPanAt(3, 6)).toBeCloseTo(0);
    expect(sweepPanAt(6, 6)).toBeCloseTo(SWEEP_PAN);
  });
});

describe('ListenSweep on the audio clock', () => {
  const plan = (lines: GasLine[] = [H2O]) => planSweep(buildSpectrumMapping(dipSpectrum()), lines)!;

  it('needs a running context and sound on', () => {
    expect(
      new ListenSweep({ context: () => null, settings: fakeSettings() }).play(plan(), 'derived'),
    ).toBe(false);
    const ctx = new FakeAudioContext();
    const off = new ListenSweep({
      context: () => ctx.asAudioContext(),
      settings: fakeSettings(1, false),
    });
    expect(off.play(plan(), 'derived')).toBe(false);
    expect(ctx.sources()).toHaveLength(0);
  });

  it('schedules from currentTime + lookahead into the shared master bus; frees its own nodes', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 10;
    let ended = 0;
    const settings = fakeSettings(0.5);
    const s2 = new ListenSweep({ context: () => ctx.asAudioContext(), settings });
    s2.onEnd = () => ended++;
    const p = plan();
    expect(s2.play(p, 'derived')).toBe(true);
    expect(s2.playing).toBe(true);
    const sources = ctx.sources();
    // The sweep tone and one two-partial bell.
    expect(sources).toHaveLength(3);
    const tone = sources[0]!;
    expect(tone.type).toBe('triangle');
    expect(tone.startAt).toBeCloseTo(10 + AUDIO_LOOKAHEAD_S);
    // One limiter only: the shared bus's.
    expect(ctx.nodes.filter((n) => n instanceof FakeCompressor)).toHaveLength(1);
    const bus = getMasterBus(ctx.asAudioContext()) as unknown as FakeNode;
    const gains = ctx.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n !== bus);
    const volume = gains[0]!;
    expect(volume.gain.value).toBe(0.5);
    expect(volume.outputs).toContain(bus);
    // Tone gain: peak at full flux, 0 at the dip, ramps (no hard steps) from the start.
    const calls = gains[1]!.gain.calls;
    expect(Math.max(...calls.map((c) => c[1]))).toBeCloseTo(SWEEP_PEAK_GAIN);
    expect(calls[0]).toEqual(['set', 0, 10 + AUDIO_LOOKAHEAD_S]);
    expect(calls[1]![0]).toBe('linear');
    const dipStep = p.steps.find((st) => st.quiet)!;
    const dipAt = 10 + AUDIO_LOOKAHEAD_S + dipStep.t;
    const atDip = calls.find((c) => Math.abs(c[2] - dipAt) < 1e-9)!;
    expect(atDip.slice(0, 2)).toEqual(['linear', 0]);
    // A 'set' only holds the level it already had (before an edge ramp): never a jump.
    for (let i = 1; i < calls.length; i++) {
      if (calls[i]![0] === 'set') expect(calls[i]![1]).toBe(calls[i - 1]![1]);
    }
    // The bell (audioGraph.playBell) sits where the sweep reaches 2.7 um, panned there.
    const bellT = (6 * 1.7) / 4;
    expect(sources[1]!.startAt).toBeCloseTo(10 + AUDIO_LOOKAHEAD_S + bellT);
    const panners = ctx.nodes.filter((n): n is FakePanner => n instanceof FakePanner);
    expect(panners.at(-1)!.pan.value).toBeCloseTo(sweepPanAt(bellT, 6));
    const env = gains.find((g) => g.gain.calls.some((c) => c[1] === SWEEP_CHIME_GAIN));
    expect(env).toBeDefined();

    // The volume is followed live.
    settings.set({ volume: 0.2 });
    expect(volume.gain.calls.at(-1)!.slice(0, 2)).toEqual(['target', 0.2]);

    // progress()
    ctx.currentTime = 10 + AUDIO_LOOKAHEAD_S + 3;
    expect(s2.progress()).toBeCloseTo(0.5);

    // Natural end: the tone ends, then the bell; every node of the sweep is disconnected.
    tone.end();
    expect(s2.playing).toBe(false);
    expect(s2.progress()).toBeNull();
    expect(ended).toBe(1);
    expect(settings.subscribers).toBe(0);
    expect(s2.liveVoices).toBe(2); // the bell and the volume gain
    (sources[1] as FakeSource).end();
    expect(s2.liveVoices).toBe(0);
    expect(freed(ctx)).toBe(true);
    expect(bus.disconnected).toBe(false);
    // stop() after the natural end does not fire onEnd again.
    s2.stop();
    expect(ended).toBe(1);
  });

  it('D-21: a chime backed by a model_dependent Q is silent in Measured only', () => {
    const ctx = new FakeAudioContext();
    const sweep = new ListenSweep({
      context: () => ctx.asAudioContext(),
      settings: fakeSettings(),
    });
    const p = plan([{ ...H2O, tag: 'model_dependent' }]);
    expect(sweep.play(p, 'measured')).toBe(true);
    expect(ctx.sources()).toHaveLength(1); // the measured tone, no bell
    sweep.stop();
    expect(sweep.play(p, 'derived')).toBe(true);
    expect(ctx.sources()).toHaveLength(1 + 3); // tone + bell now
    sweep.stop();
  });

  it('D-21: the tone follows the spectrum tag; with nothing shown it does not play', () => {
    const ctx = new FakeAudioContext();
    const settings = fakeSettings();
    const sweep = new ListenSweep({ context: () => ctx.asAudioContext(), settings });
    const base = planSweep(buildSpectrumMapping(dipSpectrum()), [H2O], { tag: 'derived' })!;
    // Measured only: the derived tone is hidden, the measured chime still rings, and ends the sweep.
    let ended = 0;
    sweep.onEnd = () => ended++;
    expect(sweep.play(base, 'measured')).toBe(true);
    const srcs = ctx.sources();
    expect(srcs).toHaveLength(2);
    expect(srcs.every((s) => s.type !== 'triangle')).toBe(true);
    srcs[0]!.end();
    expect(ended).toBe(1);
    expect(freed(ctx)).toBe(true);
    const hidden = { ...base, chimes: [] };
    expect(sweep.play(hidden, 'measured')).toBe(false);
  });

  it('stop cancels the tone and the bells at once; sound off mid-sweep stops it', () => {
    const ctx = new FakeAudioContext();
    const settings = fakeSettings();
    const sweep = new ListenSweep({ context: () => ctx.asAudioContext(), settings });
    let ended = 0;
    sweep.onEnd = () => ended++;
    sweep.play(plan(), 'derived');
    sweep.stop();
    expect(sweep.playing).toBe(false);
    expect(sweep.liveVoices).toBe(0);
    for (const s of ctx.sources()) expect(s.stopCalls).toBeGreaterThanOrEqual(2);
    expect(freed(ctx)).toBe(true);
    expect(ended).toBe(1);

    sweep.play(plan(), 'derived');
    settings.set({ soundOn: false });
    expect(sweep.playing).toBe(false);
    expect(sweep.liveVoices).toBe(0);
    expect(ended).toBe(2);
  });

  it('play while playing frees the first sweep and fires its onEnd once', () => {
    const ctx = new FakeAudioContext();
    const settings = fakeSettings();
    const sweep = new ListenSweep({ context: () => ctx.asAudioContext(), settings });
    let ended = 0;
    sweep.onEnd = () => ended++;
    sweep.play(plan(), 'derived');
    const firstNodes = [...ctx.nodes];
    const firstTone = ctx.sources()[0]!;
    sweep.play(plan(), 'derived');
    expect(ended).toBe(1);
    expect(freed(ctx, firstNodes)).toBe(true);
    expect(sweep.playing).toBe(true);
    expect(settings.subscribers).toBe(1);
    // The first tone's late onended does nothing.
    firstTone.end();
    expect(ended).toBe(1);
    expect(sweep.playing).toBe(true);
  });
});
