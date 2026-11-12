// R13.12 (Q-443, Q-446): the spectrum chord. Plan, render and player on the fake AudioContext.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, type FakeGain, type FakeSource } from '@/test/fakeAudio';
import { duckHolds, getBus } from './audioGraph';
import { equalLoudnessDb, loudnessWeightDb } from './iso226';
import { pitchToHz, wavelengthToPitch } from './pitch';
import {
  beatMeanPower,
  fnv1a,
  planChord,
  renderChord,
  renderPartials,
  SMOOTH_FORMULA,
  SpectrumChord,
  type ChordPlan,
} from './spectrumChord';
import { spectrumSoundHeld, stopSpectrumSound } from './spectrumExclusive';
import { buildSpectrumMapping, type SpectrumMappingPoint } from './spectrumMapping';
import {
  AUDIO_LOOKAHEAD_S,
  CHORD_AB_FADE_S,
  CHORD_ATTACK_S,
  CHORD_BEAT_DEPTH,
  CHORD_ISO_CAP_DB,
  CHORD_LOOP_S,
  CHORD_RELEASE_S,
  CHORD_TARGET_RMS_DBFS,
  DUCK_SAFETY_S,
} from './tuning';
import type { Tag } from '@/contract';

const N = 102;
const lam = (i: number) => 0.75 + (4.25 * i) / (N - 1);

function spectrum(
  flux: (l: number) => number,
  error: (l: number, f: number) => number = (_l, f) => 0.01 * Math.abs(f),
  flagged: (l: number) => boolean = () => false,
): SpectrumMappingPoint[] {
  return Array.from({ length: N }, (_, i) => {
    const l = lam(i);
    const f = flux(l);
    return { wavelength_um: l, flux: f, error: error(l, f), flagged: flagged(l) };
  });
}

const plan = (pts: SpectrumMappingPoint[], tag: Tag = 'measured', seed?: number) =>
  planChord(buildSpectrumMapping(pts), { tag, ...(seed === undefined ? {} : { seed }) });

const flat = () => plan(spectrum(() => 1))!;
const binOf = (l: number) => Math.min(11, Math.floor((l - 0.75) / (4.25 / 12)));

function rmsDb(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return 20 * Math.log10(Math.sqrt(s / x.length));
}

describe('planChord: bins (R13.12 item 1, Q-430)', () => {
  it('12 equal-λ bins tiling 0.75–5 µm, one note per bin centre, long λ low', () => {
    const p = flat();
    expect(p.bins).toHaveLength(12);
    expect(p.bins[0]!.lambdaLoUm).toBeCloseTo(0.75, 12);
    expect(p.bins[11]!.lambdaHiUm).toBeCloseTo(5, 12);
    for (let i = 1; i < 12; i++) {
      expect(p.bins[i]!.lambdaLoUm).toBeCloseTo(p.bins[i - 1]!.lambdaHiUm, 12);
      // Monotone: the pitch falls as λ grows (Q-430).
      expect(p.bins[i]!.hz).toBeLessThan(p.bins[i - 1]!.hz);
      // Equal pitch steps (2.4 / 12 octave), within the 1/6 Hz loop grid.
      const ratio = p.bins[i - 1]!.hz / p.bins[i]!.hz;
      expect(Math.abs(1200 * Math.log2(ratio) - 240)).toBeLessThan(2);
    }
    for (const b of p.bins) {
      expect(b.hz * CHORD_LOOP_S).toBe(Math.round(b.hz * CHORD_LOOP_S));
      expect(Math.abs(b.hz - pitchToHz(wavelengthToPitch(b.lambdaUm)))).toBeLessThanOrEqual(
        1 / (2 * CHORD_LOOP_S) + 1e-9,
      );
    }
    // Golden: the 12 notes are constants (bin edges are fixed).
    expect(p.bins.map((b) => b.hz * CHORD_LOOP_S)).toEqual([
      6500, 5659, 4926, 4289, 3734, 3250, 2829, 2463, 2144, 1867, 1625, 1415,
    ]);
  });

  it('ISO 226 weights at 60 phon, capped at +6 dB (golden table, [verify])', () => {
    expect(equalLoudnessDb(1000)).toBeCloseTo(60, 1);
    const w = flat().bins.map((b) => b.isoDb);
    const golden = [
      0.7688, -0.0328, -0.1104, 0.3125, 0.8689, 1.6114, 2.4078, 3.2769, 4.3558, 5.4937, 6, 6,
    ];
    w.forEach((v, i) => expect(v).toBeCloseTo(golden[i]!, 3));
    expect(Math.max(...w)).toBeLessThanOrEqual(CHORD_ISO_CAP_DB);
    // Outside the table rows (200–1250 Hz) the edge row is used, never extrapolated.
    expect(equalLoudnessDb(150)).toBe(equalLoudnessDb(200));
    expect(equalLoudnessDb(2000)).toBe(equalLoudnessDb(1250));
    expect(loudnessWeightDb(150)).toBe(CHORD_ISO_CAP_DB);
  });
});

describe('planChord: levels and refusals (R13.12 items 4, 8; Q-446)', () => {
  it('a bin under 0.2 of the bin peak is silent; at 0.2 it sounds; levels within [−30, 0] dB', () => {
    const at = (v: number) => plan(spectrum((l) => (binOf(l) === 5 ? v : 1)))!;
    const low = at(0.15);
    expect(low.bins[5]!.quiet).toBe(true);
    expect(low.data.some((p) => p.bin === 5)).toBe(false);
    const edge = at(0.2 + 1e-9); // just over the line (the bin mean of 0.2s can round below it)
    expect(edge.bins[5]!.quiet).toBe(false);
    expect(edge.bins[5]!.levelDb).toBeCloseTo(20 * Math.log10(0.2), 6);
    for (const b of edge.bins) {
      expect(b.levelDb!).toBeLessThanOrEqual(0);
      expect(b.levelDb!).toBeGreaterThanOrEqual(-30);
    }
  });

  it('a bin whose points are all flagged is silent in both modes and listed (no interpolation)', () => {
    const p = plan(
      spectrum(
        () => 1,
        undefined,
        (l) => binOf(l) === 5,
      ),
    )!;
    expect(p.bins[5]!.points).toBe(0);
    expect(p.bins[5]!.quiet && p.bins[5]!.smoothQuiet).toBe(true);
    expect(p.missing).toEqual(['chord.bin.5.no-data']);
    expect(p.data.some((x) => x.bin === 5) || p.smooth.some((x) => x.bin === 5)).toBe(false);
    expect(p.data).toHaveLength(11);
  });

  it('bins with no point are silent and listed; the rest still play', () => {
    const pts = spectrum(() => 1).filter((x) => x.wavelength_um >= 1 && x.wavelength_um <= 2);
    const p = plan(pts)!;
    const covered = p.bins.filter((b) => b.points > 0).map((b) => b.index);
    expect(covered.length).toBeGreaterThan(0);
    expect(p.missing).toHaveLength(12 - covered.length);
    expect(p.data.map((x) => x.bin)).toEqual(covered);
  });

  it('refuses (null) what has nothing to play', () => {
    expect(plan([])).toBeNull();
    expect(
      plan(
        spectrum(
          () => 1,
          undefined,
          () => true,
        ),
      ),
    ).toBeNull();
    expect(plan([{ wavelength_um: 2, flux: 1, error: 0.01, flagged: false }])).toBeNull();
    expect(plan(spectrum(() => -1))).toBeNull();
  });

  it('power normalisation g_i = a_i/√Σa² from Data, for both modes; flux scale does not matter', () => {
    const pts = spectrum((l) => 1 / l);
    const p = plan(pts)!;
    expect(p.data.reduce((s, x) => s + x.gain ** 2, 0)).toBeCloseTo(1, 9);
    const doubled = plan(pts.map((x) => ({ ...x, flux: 2 * x.flux, error: 2 * x.error })))!;
    doubled.data.forEach((x, i) => expect(x.gain).toBeCloseTo(p.data[i]!.gain, 12));
    // One factor: where Smooth equals Data, the gains are the same in both modes.
    for (const b of p.bins) {
      if (b.levelDb === null || b.levelDb !== b.smoothLevelDb) continue;
      const d = p.data.find((x) => x.bin === b.index)!;
      const s = p.smooth.find((x) => x.bin === b.index)!;
      expect(s.gain).toBe(d.gain);
    }
  });

  it('renders Data at −18 dBFS RMS for 1, 4 and 12 notes; Smooth uses the same scale', () => {
    const one = plan(spectrum(() => 1).filter((x) => binOf(x.wavelength_um) === 3))!;
    const four = plan(spectrum((l) => ([2, 4, 6, 8].includes(binOf(l)) ? 1 : 0.01)))!;
    for (const p of [one, four, flat()]) {
      const r = renderChord(p, 8000);
      expect(rmsDb(r.data)).toBeCloseTo(CHORD_TARGET_RMS_DBFS, 1);
    }
    expect(one.data).toHaveLength(1);
    expect(four.data).toHaveLength(4);
  });
});

describe('planChord: noise beats, never detunes (R13.12 item 6, Q-446)', () => {
  const withRatio = (r: number) =>
    plan(
      spectrum(
        () => 1,
        (l, f) => (binOf(l) === 4 ? r * f : 0.01 * f),
      ),
    )!;

  it('σ/flux → 2 + 4·clamp(σ/flux) Hz, capped at 6; quiet ones have none; the pitch is unchanged', () => {
    expect(withRatio(0.5).bins[4]!.beatHz).toBe(4);
    expect(withRatio(2).bins[4]!.beatHz).toBe(6);
    expect(withRatio(0.2).bins[4]!.beatHz).toBeNull();
    expect(withRatio(0.5).bins[4]!.hz).toBe(withRatio(0.2).bins[4]!.hz);
  });

  it('a beating note keeps the mean power of its level (+2.26 dB compensation)', () => {
    expect(10 * Math.log10(1 / beatMeanPower(CHORD_BEAT_DEPTH))).toBeCloseTo(2.26, 2);
    const p = withRatio(0.5);
    const noisy = p.data.find((x) => x.bin === 4)!;
    const clean = p.data.find((x) => x.bin === 3)!;
    expect(noisy.beatCycles).toBeGreaterThan(0);
    const db = (x: typeof noisy) => rmsDb(renderPartials([x], 8000));
    // Equal flux; compare with the ISO weight taken out.
    expect(db(noisy) - p.bins[4]!.isoDb).toBeCloseTo(db(clean) - p.bins[3]!.isoDb, 1);
  });

  it('noisy notes do not beat in lockstep (seeded beat phases)', () => {
    const p = plan(
      spectrum(
        () => 1,
        (_l, f) => 0.5 * f,
      ),
    )!;
    const phases = new Set(p.data.map((x) => x.beatPhase));
    expect(phases.size).toBe(12);
  });
});

describe('planChord: Smooth = running median of log flux over 0.5 µm (Q-446)', () => {
  it('is `derived`, with its formula, and weaker of the spectrum tag', () => {
    const p = flat();
    expect(p.smoothTag).toBe('derived');
    expect(p.smoothFormula).toBe(SMOOTH_FORMULA);
    expect(
      plan(
        spectrum(() => 1),
        'model_dependent',
      )!.smoothTag,
    ).toBe('model_dependent');
  });

  it('a convex spectrum (λ⁻²): Smooth equals Data in every bin', () => {
    const p = plan(spectrum((l) => l ** -2))!;
    for (const b of p.bins) expect(b.smoothLevel / b.level).toBeCloseTo(1, 9);
  });

  it('a concave spectrum (3000 K blackbody peak, σ 3 %): Smooth is never below Data by more than the noise', () => {
    const bb = (l: number) => 1 / l ** 3 / (Math.exp(14388 / (l * 3000)) - 1);
    const p = plan(spectrum(bb, (_l, f) => 0.03 * f))!;
    for (const b of p.bins) expect(b.smoothLevel).toBeGreaterThanOrEqual(b.level * (1 - 0.03));
  });

  it('removes a narrow dip (0.15 µm) and never adds one', () => {
    const p = plan(spectrum((l) => (Math.abs(l - 2.3) < 0.075 ? 0.05 : 1)))!;
    const b = p.bins[binOf(2.3)]!;
    expect(b.level).toBeLessThan(0.8);
    expect(b.smoothLevel).toBeCloseTo(1, 9);
    for (const bin of p.bins) expect(bin.smoothLevel).toBeGreaterThanOrEqual(bin.level - 1e-12);
  });
});

describe('renderChord: determinism and the loop (R13.12 item 3, Q-444)', () => {
  // A band at 3 µm and noisy points beyond 4.3 µm.
  const fixtureSpectrum = () =>
    spectrum(
      (l) => (Math.abs(l - 3) < 0.2 ? 0.1 : 1 / l),
      (l) => (l > 4.3 ? 0.6 / l : 0.01),
    );

  it('byte-identical renders; golden FNV-1a hash at 48 kHz (V8)', () => {
    const a = renderChord(plan(fixtureSpectrum())!, 48000);
    const b = renderChord(plan(fixtureSpectrum())!, 48000);
    expect(fnv1a(a.data)).toBe(fnv1a(b.data));
    expect(fnv1a(a.smooth)).toBe(fnv1a(b.smooth));
    expect(fnv1a(a.data)).toBe('544e25df');
    expect(fnv1a(a.smooth)).toBe('d84d0dc5');
    const other = renderChord(plan(fixtureSpectrum(), 'measured', 7)!, 48000);
    expect(fnv1a(other.data)).not.toBe(fnv1a(a.data));
  });

  it('Data and Smooth share the phase of each note (A/B changes levels only)', () => {
    const p = plan(fixtureSpectrum())!;
    for (const s of p.smooth) {
      const d = p.data.find((x) => x.bin === s.bin);
      if (d)
        expect([s.phase, s.beatPhase, s.cycles, s.beatCycles]).toEqual([
          d.phase,
          d.beatPhase,
          d.cycles,
          d.beatCycles,
        ]);
    }
  });

  it('the loop is exact (sample N equals sample 0) and the onset has no in-phase spike', () => {
    const p = flat();
    const x = renderPartials(p.data, 8000, CHORD_LOOP_S * 8000 + 1);
    expect(x[CHORD_LOOP_S * 8000]).toBe(x[0]);
    const sumGains = p.data.reduce((s, g) => s + g.gain, 0);
    expect(Math.abs(x[0]!)).toBeLessThan(0.5 * sumGains);
  });

  it('12 equal notes peak at or below 0.5 (−6 dBFS) at −18 dBFS RMS', () => {
    const r = renderChord(flat(), 48000);
    let peak = 0;
    for (const v of r.data) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.5);
  });
});

// ------------------------------------------------------------------ the player

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
  };
}

function fakePage() {
  let hidden = false;
  const subs = new Set<() => void>();
  return {
    isHidden: () => hidden,
    onHidden(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    hide() {
      hidden = true;
      for (const fn of [...subs]) fn();
    },
  };
}

function rig(state: AudioContextState = 'running') {
  const ctx = new FakeAudioContext({ state });
  const settings = fakeSettings();
  const page = fakePage();
  const chord = new SpectrumChord({ context: () => ctx.asAudioContext(), settings, page });
  return { ctx, settings, page, chord, ac: ctx.asAudioContext() };
}

const bufferSources = (ctx: FakeAudioContext) =>
  ctx.sources().filter((s) => s.nodeType === 'bufferSource') as (FakeSource & { loop?: boolean })[];

afterEach(() => {
  stopSpectrumSound();
  vi.useRealTimers();
});

describe('SpectrumChord: the drone (R13.12 items 2, 3; R13.9)', () => {
  it('two looping buffers, started together, 30 ms attack, into the spectrum bus; holds the duck', () => {
    const { ctx, chord, ac } = rig();
    expect(chord.start(flat(), 'data', 'derived')).toBe(true);
    const [d, s] = bufferSources(ctx);
    expect(d!.loop && s!.loop).toBe(true);
    expect(d!.startAt).toBe(AUDIO_LOOKAHEAD_S);
    expect(s!.startAt).toBe(d!.startAt);
    const dGain = d!.outputs[0] as FakeGain;
    const sGain = s!.outputs[0] as FakeGain;
    expect([dGain.gain.value, sGain.gain.value]).toEqual([1, 0]);
    const env = dGain.outputs[0] as FakeGain;
    expect(env.gain.calls).toEqual([
      ['set', 0, AUDIO_LOOKAHEAD_S],
      ['linear', 1, AUDIO_LOOKAHEAD_S + CHORD_ATTACK_S],
    ]);
    const volume = env.outputs[0] as FakeGain;
    expect(volume.outputs).toEqual([getBus(ac, 'spectrum')]);
    expect(duckHolds(ac)).toBe(1);
    expect(chord.mode).toBe('data');
    expect(spectrumSoundHeld()).toBe(true);
  });

  it('A/B is a linear crossfade: the two gains sum to 1 at every scheduled point', () => {
    const { ctx, chord } = rig();
    chord.start(flat(), 'data', 'derived');
    ctx.currentTime = 2;
    expect(chord.setMode('smooth')).toBe(true);
    const [d, s] = bufferSources(ctx);
    const dc = (d!.outputs[0] as FakeGain).gain.calls.filter((c) => c[0] !== 'cancel');
    const sc = (s!.outputs[0] as FakeGain).gain.calls.filter((c) => c[0] !== 'cancel');
    const tail = (c: typeof dc) => c.slice(-2);
    expect(tail(dc)).toEqual([
      ['set', 1, 2],
      ['linear', 0, 2 + CHORD_AB_FADE_S],
    ]);
    tail(dc).forEach((c, i) => expect(c[1] + tail(sc)[i]![1]).toBe(1));
    expect(chord.mode).toBe('smooth');
  });

  it('stop: a short release, the duck and the slot let go, onEnd once, nodes freed', () => {
    vi.useFakeTimers();
    const { ctx, chord, ac } = rig();
    const onEnd = vi.fn();
    chord.onEnd = onEnd;
    chord.start(flat(), 'data', 'derived');
    ctx.currentTime = 1;
    chord.stop();
    const [d] = bufferSources(ctx);
    expect(d!.stopAt).toBeCloseTo(1 + CHORD_RELEASE_S, 9);
    expect(duckHolds(ac)).toBe(0);
    expect(spectrumSoundHeld()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(chord.liveVoices).toBe(0);
    expect(d!.disconnected).toBe(true);
    chord.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('every stop path releases the duck: sound off, hidden page, honesty, a new start', () => {
    const paths: [string, (r: ReturnType<typeof rig>) => void][] = [
      ['sound off', (r) => r.settings.set({ soundOn: false })],
      ['hidden page', (r) => r.page.hide()],
      ['honesty hides the tag', (r) => r.chord.setHonesty('measured')],
      ['another chord', (r) => r.chord.start(flat(), 'data', 'derived')],
    ];
    for (const [name, act] of paths) {
      const r = rig();
      const p =
        name === 'honesty hides the tag'
          ? (plan(
              spectrum(() => 1),
              'derived',
            ) as ChordPlan)
          : flat();
      expect(r.chord.start(p, 'data', 'derived')).toBe(true);
      act(r);
      if (name === 'another chord') {
        expect(duckHolds(r.ac)).toBe(1);
        r.chord.stop();
      }
      expect(duckHolds(r.ac)).toBe(0);
      expect(r.chord.playing).toBe(false);
    }
  });

  it('refuses with sound off, a suspended context, a hidden page or a hidden tag', () => {
    const off = rig();
    off.settings.set({ soundOn: false });
    expect(off.chord.start(flat(), 'data', 'derived')).toBe(false);
    expect(rig('suspended').chord.start(flat(), 'data', 'derived')).toBe(false);
    const hidden = rig();
    hidden.page.hide();
    expect(hidden.chord.start(flat(), 'data', 'derived')).toBe(false);
    const derived = plan(
      spectrum(() => 1),
      'derived',
    )!;
    const r = rig();
    expect(r.chord.start(derived, 'data', 'measured')).toBe(false);
    expect(duckHolds(r.ac)).toBe(0);
    expect(spectrumSoundHeld()).toBe(false);
  });

  it('honesty: Smooth (`derived`) is not played at Measured only; it falls back to Data', () => {
    const r = rig();
    expect(r.chord.start(flat(), 'smooth', 'measured')).toBe(true);
    expect(r.chord.mode).toBe('data');
    expect(r.chord.setMode('smooth')).toBe(false);
    r.chord.setHonesty('derived');
    expect(r.chord.setMode('smooth')).toBe(true);
    r.chord.setHonesty('measured');
    expect(r.chord.mode).toBe('data');
    expect(r.chord.playing).toBe(true); // the measured data still plays
  });

  it('duck safety: a heartbeat keeps it while running; a stalled chord lets go by itself', () => {
    vi.useFakeTimers();
    const r = rig();
    r.chord.start(flat(), 'data', 'derived');
    vi.advanceTimersByTime(60_000);
    expect(duckHolds(r.ac)).toBe(1);
    r.ctx.simulateState('suspended');
    vi.advanceTimersByTime((2 * CHORD_LOOP_S + DUCK_SAFETY_S) * 1000);
    expect(duckHolds(r.ac)).toBe(0);
  });
});
