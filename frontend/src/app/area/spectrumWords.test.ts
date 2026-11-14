// Issue #162 (A18.7): the verdict words, the card lines, the largest-step rule, the rows and the chart
// model, on the committed Eros pack's spectrum check (#161) and small hand-made tracks.
import { describe, expect, it } from 'vitest';
import { erosPackStage } from '@/test/areaFixtures';
import type { AreaSpectra, SpectrumStep, TrackSpectrum } from './spectraApi';
import {
  chartLabel,
  chartModel,
  colourText,
  comparedText,
  distanceText,
  heatGlowLine,
  largestStep,
  rangeLine,
  starScatter,
  steadyText,
  VERDICT_WORDS,
  verdictCounts,
  verdictLine,
} from './spectrumWords';

const spectra = erosPackStage<AreaSpectra>('spectra');
const track = (id: string) => structuredClone(spectra.tracks.find((t) => t.track_id === id)!);
const step = (detector: number, change: number, ok = true): SpectrumStep => ({
  visit: 1,
  detector,
  dot_id_a: 'a:1',
  dot_id_b: 'b:1',
  time_a: '2026-03-20T08:33:00Z',
  time_b: '2026-03-20T08:35:09Z',
  change,
  allowed: 0.2,
  ok,
});
const bare = (over: Partial<TrackSpectrum>): TrackSpectrum => ({
  track_id: 'T0',
  verdict: 'rock',
  heat_glow: null,
  r_au: 1,
  r_source: 'worst_case',
  phase_deg: 60,
  pairs: [],
  steps: [],
  points: [],
  ...over,
});

describe('verdict words (every enum value)', () => {
  it('row word, dot and card title per verdict', () => {
    expect(VERDICT_WORDS).toEqual({
      rock: { word: 'Rock-like', tone: 'ok', title: 'Looks like sunlight off a rock' },
      very_red: { word: 'Very red', tone: 'warn', title: 'Redder than sunlight off any rock' },
      too_red: { word: 'Too red', tone: 'warn', title: 'Too red for sunlight off a rock' },
      too_blue: { word: 'Too blue', tone: 'fail', title: 'Bluer than sunlight off any rock' },
      flickers: { word: 'Flickers', tone: 'fail', title: 'Flickers between exposures' },
      too_faint: { word: 'Too faint', tone: 'muted', title: 'Too faint to tell' },
      one_colour: { word: 'One colour', tone: 'muted', title: 'One colour only' },
    });
  });

  it('the card line per verdict', () => {
    expect(verdictLine(track('T8'), false)).toBe('Only a warm, dark rock close to the Sun would fit. Its distance is not known.');
    expect(verdictLine(bare({ verdict: 'too_red', r_au: 2.95, r_source: 'parallax' }), false)).toBe(
      'Even with heat glow at 2.95 AU from the Sun.',
    );
    expect(verdictLine(bare({ verdict: 'too_blue' }), false)).toBe('Probably a star, a blend or an artefact.');
    expect(verdictLine(bare({ verdict: 'flickers', steps: [step(1, 0.05), step(1, 0.7, false)] }), false)).toBe(
      'Changed 70% in 2 min, faster than a rock larger than 200 m can spin.',
    );
    expect(verdictLine(bare({ verdict: 'too_faint' }), false)).toBe('Its colour is uncertain by more than a third.');
    expect(verdictLine(track('T5'), false)).toBe('Seen by one detector, so its colour cannot be compared.');
  });

  it('never calls an unmatched track an asteroid (A16.5): the lines describe the light, not the body', () => {
    for (const verdict of Object.keys(VERDICT_WORDS) as (keyof typeof VERDICT_WORDS)[]) {
      const line = verdictLine(bare({ verdict, r_au: 1.2, r_source: 'parallax' }), false);
      expect(line, verdict).not.toMatch(/asteroid|near-Earth|discovery|\bnew\b/i);
      expect(VERDICT_WORDS[verdict].title, verdict).not.toMatch(/asteroid/i);
      expect(VERDICT_WORDS[verdict].word, verdict).not.toMatch(/asteroid/i);
    }
    expect(verdictLine(track('T8'), false)).not.toMatch(/asteroid/i);
  });
});

describe('the rock line', () => {
  it('T3 (433 Eros): the pairs\' rho range and the heat glow at its parallax distance', () => {
    const t3 = track('T3');
    expect(rangeLine(t3)).toBe('1.5 to 3.3 times redder than the Sun.');
    expect(heatGlowLine(t3)).toBe('Includes heat glow, as expected 1.16 AU from the Sun.');
    expect(verdictLine(t3, true)).toBe(
      '1.5 to 3.3 times redder than the Sun. Includes heat glow, as expected 1.16 AU from the Sun.',
    );
  });

  it('T1, an unknown possible that passes: a lead worth following (state C)', () => {
    expect(verdictLine(track('T1'), false)).toBe('1.4 to 1.8 times redder than the Sun. A lead worth following.');
  });

  it('one pair gives one number; a colour below the Sun\'s is not called redder; limits are left out', () => {
    expect(rangeLine(track('T4'))).toBe('1.3 times redder than the Sun.');
    const p = track('T1').pairs[0]!;
    expect(rangeLine(bare({ pairs: [{ ...p, rho: 0.84 }, { ...p, rho: 1.2 }] }))).toBe("0.8 to 1.2 times the Sun's colour.");
    expect(rangeLine(bare({ pairs: [{ ...p, rho: 9, limit: 'lower' }] }))).toBeNull();
    expect(heatGlowLine(bare({ heat_glow: null, r_au: 1.2 }))).toBeNull();
    expect(heatGlowLine(bare({ heat_glow: false, r_au: 1.2 }))).toBeNull();
  });
});

describe('rows', () => {
  it('Steady: the largest |change| on the short arm, else on the long arm', () => {
    expect(largestStep(bare({ steps: [step(1, 0.04), step(4, 0.3), step(2, -0.09)] }))?.change).toBe(-0.09);
    expect(largestStep(bare({ steps: [step(4, 0.1), step(5, -0.2)] }))?.change).toBe(-0.2);
    expect(steadyText(bare({ steps: [] }))).toBeNull();
    expect(steadyText(track('T8'))).toBe('within 13% between exposures');
  });

  it('Colour, Distance and Compared with', () => {
    expect(colourText(track('T3'))).toBe('6 exposures, both detectors at once');
    expect(colourText(track('T8'))).toBe('3 exposures; not seen below 1 µm');
    expect(colourText(track('T5'))).toBeNull();
    expect(distanceText(track('T3'))).toBe('1.16 AU from the Sun, from its parallax');
    expect(distanceText(track('T1'))).toBeNull();
    expect(comparedText(spectra.calibration)).toBe('the Sun, and stars in the same frames');
    expect(comparedText(spectra.calibration.map((c) => ({ ...c, source: 'default' as const })))).toBe('the Sun');
    expect(starScatter(spectra.calibration)).toBeCloseTo(0.0488, 3);
    expect(starScatter(spectra.calibration.map((c) => ({ ...c, sigma_sys: 0 })))).toBeNull();
  });

  it('the step-list counts, in the table\'s order', () => {
    expect(verdictCounts(spectra.tracks)).toBe('3 rock-like, 1 very red, 5 one colour');
  });
});

describe('chart model', () => {
  const range: [number, number] = [0.6, 3];

  it('T3: rel against wavelength, visit 2 open, the range, the heat glow and the Sun', () => {
    const m = chartModel(track('T3'), range, false);
    expect(m.points).toHaveLength(14);
    expect(m.points.filter((p) => p.visitIdx === 1)).toHaveLength(7);
    expect([m.x0, m.x1]).toEqual([0.7, 3.8]);
    expect(m.yTicks).toEqual([1, 2, 3, 4]);
    expect(m.band).not.toBeNull();
    expect(m.glow).not.toBeNull();
    expect(m.limits).toEqual([]);
    expect(m.yLabel).toBe("times the Sun's colour");
    const label = chartLabel('T3', m, 'rock');
    expect(label).toMatch(/^Brightness divided by sunlight .* 14 points .* Looks like sunlight off a rock\. Every point is listed under Points used\.$/);
    expect(label).toContain('2 above the rock range, inside the heat glow allowance for 1.16 AU.');
  });

  it('T8: lower limits as arrows and no heat glow; no short-arm point, so no rel to draw', () => {
    const t8 = track('T8');
    expect(t8.points.every((p) => p.rel === null)).toBe(true);
    const m = chartModel(t8, range, false);
    expect(m.points).toEqual([]);
    expect(m.limits).toHaveLength(3);
    expect(m.glow).toBeNull();
    expect(m.yTicks.at(-1)).toBeGreaterThanOrEqual(4);
  });

  it('points with used: false are hidden from the chart (listed under Points used)', () => {
    const t = track('T3');
    t.points[0] = { ...t.points[0]!, used: false };
    expect(chartModel(t, range, false).points.map((p) => p.dotId)).not.toContain(t.points[0]!.dot_id);
    expect(chartModel(t, range, true).points).toHaveLength(13);
  });

  it('a large colour steps the ticks so their labels never crowd', () => {
    const t = track('T1');
    t.points[1] = { ...t.points[1]!, rel: 37 };
    const m = chartModel(t, range, false);
    expect(m.yTicks.length).toBeLessThanOrEqual(10);
    expect(m.yTicks[0]).toBe(1);
    expect(m.yTicks.at(-1)).toBeGreaterThanOrEqual(35);
  });

  it('x extends to 5.1 µm when a point is beyond 3.8; y gains ticks when needed', () => {
    const t = track('T1');
    t.points[1] = { ...t.points[1]!, lambda_um: 4.6, rel: 5.2 };
    const m = chartModel(t, range, false);
    expect(m.x1).toBe(5.1);
    expect(m.yTicks).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('Measured only: raw µJy points alone, no range, no heat glow, no limits, no verdict in the label', () => {
    const m = chartModel(track('T3'), range, true);
    expect(m.measuredOnly).toBe(true);
    expect(m.band).toBeNull();
    expect(m.glow).toBeNull();
    expect(m.limits).toEqual([]);
    expect(m.yLabel).toBe('µJy');
    expect(m.points[0]!.y).toBe(track('T3').points[0]!.flux_uJy);
    expect(chartLabel('T3', m, 'rock')).not.toMatch(/rock/);
    expect(chartLabel('T3', m, 'rock')).toMatch(/Every point is listed under Points used\.$/);
  });
});
