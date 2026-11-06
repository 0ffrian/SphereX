// R8.6 spectrum haptics: 8 px spacing, the R11 absorption-dip test (≥ 3 consecutive quiet steps),
// seeded jitter, keyboard stepping, pan and pitch, and the engine's honesty gate and rate cap.
import { describe, expect, it } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeClock, FakeDriver } from '@/test/fakeHaptics';
import { HapticEngine } from '../haptics';
import { wavelengthToPitch } from '../pitch';
import type { SpectrumMappingPoint } from '../spectrumMapping';
import { JITTER_FRACTION, SPECTRUM_TICK_PX } from '../tuning';
import {
  SpectrumHapticSource,
  jitterUnit,
  spectrumXToLambda,
  type HapticSink,
  type SpectrumStep,
} from './spectrum';

const L0 = 0.75;
const L1 = 5.0;
const PX = 800; // plot width in px: 0.75–5 µm over 0–800 px
const DIP_UM = 4.25; // a CO₂-like absorption band
const DIP_SIGMA_UM = 0.2;

/** A flat continuum with one deep Gaussian absorption dip at 4.25 µm (σ 0.2 µm, 90% deep). */
function dipSpectrum(opts: { noisy?: boolean } = {}): SpectrumMappingPoint[] {
  const pts: SpectrumMappingPoint[] = [];
  for (let i = 0; i <= 200; i++) {
    const wavelength_um = L0 + ((L1 - L0) * i) / 200;
    const g = Math.exp(-((wavelength_um - DIP_UM) ** 2) / (2 * DIP_SIGMA_UM ** 2));
    const flux = 100 * (1 - 0.9 * g);
    pts.push({ wavelength_um, flux, error: opts.noisy ? flux * 0.5 : 1, flagged: false });
  }
  return pts;
}

class Recorder implements HapticSink {
  readonly events: HapticEvent[] = [];
  emit(e: HapticEvent): boolean {
    this.events.push({ ...e });
    return true;
  }
}

function setup(points = dipSpectrum(), seed?: number) {
  const sink = new Recorder();
  const steps: SpectrumStep[] = [];
  const source = new SpectrumHapticSource(sink, {
    points,
    tag: 'measured',
    xToLambda: spectrumXToLambda(0, PX, [L0, L1]),
    ...(seed === undefined ? {} : { seed }),
    onStep: (s) => steps.push({ ...s }),
  });
  return { sink, steps, source };
}

/** Drag from x0 to x1 in 1 px moves. */
function drag(source: SpectrumHapticSource, x0: number, x1: number) {
  source.begin(x0);
  const dir = x1 > x0 ? 1 : -1;
  for (let x = x0 + dir; dir > 0 ? x <= x1 : x >= x1; x += dir) source.move(x);
  source.end();
}

function longestQuietRun(steps: readonly SpectrumStep[]): { length: number; at: number } {
  let best = { length: 0, at: NaN };
  let run = 0;
  for (const s of steps) {
    run = s.inRange && s.quiet ? run + 1 : 0;
    if (run > best.length) best = { length: run, at: s.lambdaUm };
  }
  return best;
}

describe('SpectrumHapticSource (R8.6)', () => {
  it('ticks every 8 px of travel, none on pointer down', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    source.begin(10);
    expect(steps).toHaveLength(0);
    for (let x = 11; x <= 50; x++) source.move(x);
    expect(steps.map((s) => s.x)).toEqual([18, 26, 34, 42, 50]);
    expect(sink.events).toHaveLength(5);
    expect(sink.events.every((e) => e.kind === 'tick' && e.tag === 'measured')).toBe(true);
  });

  it('counts travel in both directions, and only the last step of a long move plays', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    source.begin(100);
    source.move(105);
    source.move(99); // 5 + 6 = 11 px of travel: one step, at 102 on the way back
    expect(steps.map((s) => s.x)).toEqual([102]);
    expect(source.move(99 + 3 * SPECTRUM_TICK_PX)).toBe(3);
    expect(steps.slice(1).map((s) => s.emitted)).toEqual([false, false, true]);
    expect(sink.events).toHaveLength(2);
  });

  it('R11: dragging across a known absorption dip gives ≥ 3 consecutive quiet steps', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    drag(source, 0, PX);
    const run = longestQuietRun(steps);
    expect(run.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(run.at - DIP_UM)).toBeLessThan(2 * DIP_SIGMA_UM);
    // Quiet is silent: no event was emitted for any quiet step, and none near the dip centre.
    expect(steps.filter((s) => s.quiet).every((s) => !s.emitted)).toBe(true);
    expect(sink.events.length).toBe(steps.filter((s) => s.emitted).length);
    // Away from the dip every step plays, at full strength on the continuum.
    const continuum = steps.filter((s) => s.lambdaUm < 3);
    expect(continuum.every((s) => s.emitted && s.strength > 0.99)).toBe(true);
  });

  it('R11 through the real engine: the dip is silent on both drivers, the rate cap holds', () => {
    const clock = new FakeClock();
    const vib = new FakeDriver(clock.clock);
    const audio = new FakeDriver(clock.clock);
    const engine = new HapticEngine([vib, audio], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
    });
    const steps: SpectrumStep[] = [];
    const source = new SpectrumHapticSource(engine, {
      points: dipSpectrum(),
      tag: 'measured',
      xToLambda: spectrumXToLambda(0, PX, [L0, L1]),
      onStep: (s) => steps.push({ ...s }),
    });
    // A slow drag: 8 px every 30 ms, so the engine's 25 ms gap never drops a tick.
    source.begin(0);
    for (let x = 1; x <= PX; x++) {
      if (x % SPECTRUM_TICK_PX === 0) clock.advance(30);
      source.move(x);
    }
    expect(longestQuietRun(steps).length).toBeGreaterThanOrEqual(3);
    const played = steps.filter((s) => s.emitted).length;
    expect(vib.events).toHaveLength(played);
    expect(audio.events).toHaveLength(played);
    const dipLow = DIP_UM - DIP_SIGMA_UM / 2;
    const dipHigh = DIP_UM + DIP_SIGMA_UM / 2;
    const dipPitches = [dipLow, dipHigh].map((l) => wavelengthToPitch(l));
    expect(audio.events.some((e) => e.pitch! > dipPitches[0]! && e.pitch! < dipPitches[1]!)).toBe(
      false,
    );

    // A fast drag (100 px per 16 ms move) is held to ≥ 25 ms between ticks by the engine.
    vib.events.length = 0;
    source.begin(0);
    for (let x = 100; x <= PX; x += 100) {
      clock.advance(16);
      source.move(x);
    }
    const times = vib.events.map((e) => e.at);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(25);
  });

  it('strength, pitch from λ, pan from x, and the tag from the spectrum response', () => {
    const { sink, source } = setup(dipSpectrum());
    drag(source, 0, PX);
    const first = sink.events[0]!;
    const last = sink.events[sink.events.length - 1]!;
    expect(first.pan).toBeCloseTo(-1 + (2 * SPECTRUM_TICK_PX) / PX, 6);
    expect(last.pan).toBeCloseTo(1, 6);
    expect(first.pitch).toBeCloseTo(wavelengthToPitch(L0 + ((L1 - L0) * 8) / PX), 6);
    expect(last.pitch!).toBeGreaterThan(first.pitch!);
    for (const e of sink.events) {
      expect(e.strength).toBeGreaterThanOrEqual(0.2);
      expect(e.strength).toBeLessThanOrEqual(1);
    }
  });

  it('ignores non-finite positions', () => {
    const { steps, source } = setup(dipSpectrum());
    source.begin(Number.NaN);
    expect(source.move(50)).toBe(0);
    source.begin(10);
    expect(source.move(Number.NaN)).toBe(0);
    expect(source.move(18)).toBe(1);
    expect(steps).toHaveLength(1);
  });

  it('outside the spectrum λ range nothing plays', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    source.setScale(spectrumXToLambda(0, PX, [0.1, 0.7]));
    drag(source, 0, 100);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => !s.inRange && !s.emitted)).toBe(true);
    expect(sink.events).toHaveLength(0);
  });

  it('an empty spectrum (all flagged) is empty and silent', () => {
    const points = dipSpectrum().map((p) => ({ ...p, flagged: true }));
    const { sink, source } = setup(points);
    expect(source.empty).toBe(true);
    drag(source, 0, PX);
    expect(sink.events).toHaveLength(0);
  });
});

describe('seeded jitter (R8.3 roughness)', () => {
  const gaps = (steps: readonly SpectrumStep[]) => steps.slice(1).map((s, i) => s.x - steps[i]!.x);

  it('noisy points jitter the spacing within ±30%, deterministically per seed', () => {
    const a = setup(dipSpectrum({ noisy: true }), 7);
    const b = setup(dipSpectrum({ noisy: true }), 7);
    const c = setup(dipSpectrum({ noisy: true }), 8);
    for (const r of [a, b, c]) drag(r.source, 0, 400);
    const ga = gaps(a.steps);
    expect(ga.length).toBeGreaterThan(20);
    for (const g of ga) {
      expect(g).toBeGreaterThanOrEqual(SPECTRUM_TICK_PX * (1 - JITTER_FRACTION) - 1e-9);
      expect(g).toBeLessThanOrEqual(SPECTRUM_TICK_PX * (1 + JITTER_FRACTION) + 1e-9);
    }
    expect(new Set(ga.map((g) => g.toFixed(3))).size).toBeGreaterThan(5);
    expect(a.steps).toEqual(b.steps);
    expect(gaps(c.steps)).not.toEqual(ga);
  });

  it('clean points keep exact 8 px spacing', () => {
    const { steps, source } = setup(dipSpectrum(), 7);
    drag(source, 0, 200);
    expect(new Set(gaps(steps))).toEqual(new Set([SPECTRUM_TICK_PX]));
  });

  it('jitterUnit is in [0, 1) and depends only on (seed, k)', () => {
    for (let k = 0; k < 1000; k++) {
      const u = jitterUnit(3, k);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
    expect(jitterUnit(3, 5)).toBe(jitterUnit(3, 5));
    expect(jitterUnit(3, 5)).not.toBe(jitterUnit(4, 5));
  });
});

describe('keyboard stepping (R9)', () => {
  it('arrow steps move one 8 px step and emit the same events as a drag', () => {
    const dragged = setup(dipSpectrum());
    drag(dragged.source, 0, 80);
    const keyed = setup(dipSpectrum());
    expect(keyed.source.stepBy(1)).toBe(true); // first press: the left end, x = 0
    for (let i = 0; i < 10; i++) keyed.source.stepBy(1);
    expect(keyed.steps.map((s) => s.x)).toEqual([0, ...dragged.steps.map((s) => s.x)]);
    expect(keyed.sink.events.slice(1)).toEqual(dragged.sink.events);
    expect(keyed.source.cursorX).toBe(80);
    keyed.source.stepBy(-1);
    expect(keyed.source.cursorX).toBe(72);
  });

  it('keeps its λ when the plot moves between key presses', () => {
    const { steps, source } = setup(dipSpectrum());
    source.stepBy(1);
    source.stepBy(1);
    const lambda = steps[1]!.lambdaUm;
    source.setScale(spectrumXToLambda(100, 100 + PX, [L0, L1])); // scrolled 100 px right
    expect(source.cursorX).toBeCloseTo(108, 9);
    source.stepBy(-1);
    expect(steps[2]!.x).toBeCloseTo(100, 9);
    expect(source.stepBy(1)).toBe(true);
    expect(steps[3]!.lambdaUm).toBeCloseTo(lambda, 9);
  });

  it('stops at the edges, and the first left press starts at the right end', () => {
    const { source } = setup(dipSpectrum());
    expect(source.stepBy(-1)).toBe(true);
    expect(source.cursorX).toBe(PX);
    expect(source.stepBy(1)).toBe(false);
    expect(source.cursorX).toBe(PX);
  });

  it('a step past an edge lands on the edge, so the last pixels are reachable', () => {
    const { steps, source } = setup(dipSpectrum());
    source.setScale(spectrumXToLambda(0, 803, [L0, L1])); // not a multiple of 8 px
    while (source.stepBy(1));
    expect(steps.at(-1)!.x).toBe(803);
    expect(steps.at(-2)!.x).toBe(800);
    expect(steps.at(-1)!.lambdaUm).toBeCloseTo(L1, 9);
  });

  it('Home and End jump to the ends; several steps at once play only where they land', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    expect(source.jumpTo('end')).toBe(true);
    expect(source.cursorX).toBe(PX);
    source.jumpTo('start');
    expect(source.cursorX).toBe(0);
    const before = sink.events.length;
    expect(source.stepBy(1, 10)).toBe(true);
    expect(source.cursorX).toBe(80);
    expect(sink.events.length).toBe(before + 1);
    expect(steps.at(-1)!.emitted).toBe(true);
    expect(source.stepBy(-1, 100)).toBe(true);
    expect(source.cursorX).toBe(0);
    expect(source.stepBy(-1, 10)).toBe(false);
  });

  it('quiet steps are silent from the keyboard too', () => {
    const { sink, steps, source } = setup(dipSpectrum());
    while (source.stepBy(1));
    expect(longestQuietRun(steps).length).toBeGreaterThanOrEqual(3);
    expect(sink.events).toHaveLength(steps.filter((s) => s.emitted).length);
    expect(steps.some((s) => s.quiet && s.emitted)).toBe(false);
  });
});

describe('honesty (D-21)', () => {
  it('a measured spectrum plays in Measured only', () => {
    const clock = new FakeClock();
    const vib = new FakeDriver(clock.clock);
    const engine = new HapticEngine([vib], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
      honesty: 'measured',
    });
    const source = new SpectrumHapticSource(engine, {
      points: dipSpectrum(),
      tag: 'measured',
      xToLambda: spectrumXToLambda(0, PX, [L0, L1]),
    });
    source.stepBy(1);
    clock.advance(30);
    source.stepBy(1);
    expect(vib.events).toHaveLength(2);
    // An artistic-tagged source would be silent at this level (the gate is the engine's).
    const artistic = new SpectrumHapticSource(engine, {
      points: dipSpectrum(),
      tag: 'artistic',
      xToLambda: spectrumXToLambda(0, PX, [L0, L1]),
    });
    clock.advance(30);
    artistic.stepBy(1);
    expect(vib.events).toHaveLength(2);
  });
});

// R11 at phone width (Q-65). A 360 px viewport leaves about 296 px for the pad (the page and panel
// padding). Over the full 0.75–5 µm band that is 69.6 px/µm; three quiet 8 px steps need a quiet
// stretch of 16–24 px, i.e. 0.23–0.35 µm of λ.
describe('R11 at phone width (360 px viewport, Q-65)', () => {
  const PHONE_PX = 296;

  /** T/Y-dwarf-like (WISE 0855): a 4–5 µm peak and a deep, broad CH₄ trough at 3.0–3.8 µm. */
  function brownDwarfLike(): SpectrumMappingPoint[] {
    const sig = (x: number) => 1 / (1 + Math.exp(-x));
    const pts: SpectrumMappingPoint[] = [];
    for (let i = 0; i <= 200; i++) {
      const wavelength_um = L0 + ((L1 - L0) * i) / 200;
      const trough = 0.95 * sig((wavelength_um - 2.95) / 0.05) * sig((3.85 - wavelength_um) / 0.05);
      const flux = 100 * (1 - trough);
      pts.push({ wavelength_um, flux, error: 1, flagged: false });
    }
    return pts;
  }

  function runAt(points: SpectrumMappingPoint[], domain: [number, number]) {
    const sink = new Recorder();
    const steps: SpectrumStep[] = [];
    const source = new SpectrumHapticSource(sink, {
      points,
      tag: 'measured',
      xToLambda: spectrumXToLambda(0, PHONE_PX, domain),
      onStep: (s) => steps.push({ ...s }),
    });
    drag(source, 0, PHONE_PX);
    return { steps, run: longestQuietRun(steps).length };
  }

  it('a broad band (brown dwarf CH₄) gives ≥ 3 quiet steps over the full band', () => {
    expect(runAt(brownDwarfLike(), [L0, L1]).run).toBeGreaterThanOrEqual(3);
  });

  it('a narrow dip (σ 0.2 µm) gives ≥ 3 quiet steps once the pad is zoomed to 3.5–5 µm', () => {
    expect(runAt(dipSpectrum(), [3.5, L1]).run).toBeGreaterThanOrEqual(3);
  });

  it('documents the limit: the same narrow dip over the full band is too narrow (Q-65)', () => {
    // Quiet where 1 − 0.9·g < 0.2: |Δλ| < 0.2·√(2 ln 1.125) ≈ 0.097 µm, so 0.194 µm ≈ 13.5 px.
    expect(runAt(dipSpectrum(), [L0, L1]).run).toBeLessThan(3);
  });
});
