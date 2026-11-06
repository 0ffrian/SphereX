import { describe, expect, it } from 'vitest';
import { FakeAudioContext, FakeGain, FakeSource } from '@/test/fakeAudio';
import { fixture } from '@/test/sharedFixtures';
import { pitchToHz, wavelengthToPitch } from '../pitch';
import { buildSpectrumMapping, type SpectrumMappingPoint } from '../spectrumMapping';
import { AUDIO_LOOKAHEAD_S, SWEEP_PEAK_GAIN, SWEEP_STEPS } from '../tuning';
import { GAS_LINES_UM, gasLinesForEpoch, ListenSweep, planSweep } from './listenSweep';

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

describe('planSweep (A8, R8.6 item 3)', () => {
  it('pitch from λ, gain from the normalised flux, the dip silent', () => {
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()))!;
    expect(plan.steps).toHaveLength(SWEEP_STEPS + 1);
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

  it('chimes only at gas lines inside the range', () => {
    const lines = [
      { gas: 'h2o' as const, lambdaUm: GAS_LINES_UM.h2o },
      { gas: 'co' as const, lambdaUm: 7 },
    ];
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()), lines, 6)!;
    expect(plan.chimes).toHaveLength(1);
    expect(plan.chimes[0]!.t).toBeCloseTo((6 * (2.7 - 1)) / 4);
  });

  it('nothing to play for an empty spectrum', () => {
    expect(planSweep(buildSpectrumMapping([]))).toBeNull();
  });

  it('gas lines (A4.3) only for gases with Q in the selected epoch', () => {
    const { card } = fixture('comet');
    expect(GAS_LINES_UM).toEqual({ h2o: 2.7, co2: 4.25, co: 4.67 });
    expect(gasLinesForEpoch(card, '2025-08').map((l) => l.gas)).toEqual(['h2o', 'co2', 'co']);
    expect(gasLinesForEpoch(card, '2025-12')).toEqual([]);
    expect(gasLinesForEpoch(fixture('star').card, '2025-08')).toEqual([]);
  });
});

describe('ListenSweep on the audio clock', () => {
  it('needs a running context; schedules from currentTime + lookahead; frees every node', () => {
    const sweep = new ListenSweep({ context: () => null, volume: () => 1 });
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()), [
      { gas: 'h2o', lambdaUm: GAS_LINES_UM.h2o },
    ])!;
    expect(sweep.play(plan)).toBe(false);

    const ctx = new FakeAudioContext();
    ctx.currentTime = 10;
    let ended = 0;
    const s2 = new ListenSweep({ context: () => ctx.asAudioContext(), volume: () => 0.5 });
    s2.onEnd = () => ended++;
    expect(s2.play(plan)).toBe(true);
    expect(s2.playing).toBe(true);
    const sources = ctx.sources();
    // The sweep tone and one two-partial bell.
    expect(sources).toHaveLength(3);
    const tone = sources[0]!;
    expect(tone.type).toBe('triangle');
    expect(tone.startAt).toBeCloseTo(10 + AUDIO_LOOKAHEAD_S);
    // Gain: volume × peak at full flux, and set to 0 on the quiet dip.
    const gain = ctx.nodes.find((n): n is FakeGain => n instanceof FakeGain)!;
    const values = gain.gain.calls.map((c) => c[1]);
    expect(Math.max(...values)).toBeCloseTo(0.5 * SWEEP_PEAK_GAIN);
    const dipTime = 10 + AUDIO_LOOKAHEAD_S + (6 * (3 - 1)) / 4;
    const atDip = gain.gain.calls.filter((c) => Math.abs(c[2] - dipTime) < 0.05);
    expect(atDip.length).toBeGreaterThan(0);
    expect(atDip.every((c) => c[1] === 0)).toBe(true);
    // The bell sits where the sweep reaches 2.7 µm.
    expect(sources[1]!.startAt).toBeCloseTo(10 + AUDIO_LOOKAHEAD_S + (6 * 1.7) / 4);

    // Natural end: the tone ends, then the bell; everything is disconnected.
    tone.end();
    expect(s2.playing).toBe(false);
    expect(ended).toBe(1);
    expect(s2.liveVoices).toBe(1);
    (sources[1] as FakeSource).end();
    expect(s2.liveVoices).toBe(0);
    expect(ctx.nodes.filter((n) => n.nodeType !== 'destination').every((n) => n.disconnected)).toBe(
      true,
    );
  });

  it('stop cancels the tone and the bells at once', () => {
    const ctx = new FakeAudioContext();
    const sweep = new ListenSweep({ context: () => ctx.asAudioContext(), volume: () => 1 });
    const plan = planSweep(buildSpectrumMapping(dipSpectrum()), [
      { gas: 'co2', lambdaUm: GAS_LINES_UM.co2 },
    ])!;
    sweep.play(plan);
    sweep.stop();
    expect(sweep.playing).toBe(false);
    expect(sweep.liveVoices).toBe(0);
    for (const s of ctx.sources()) expect(s.stopCalls).toBeGreaterThanOrEqual(2);
    expect(ctx.nodes.filter((n) => n.nodeType !== 'destination').every((n) => n.disconnected)).toBe(
      true,
    );
  });
});
