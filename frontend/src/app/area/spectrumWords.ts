// The spectrum check in words and in chart geometry (A18.7, A17.13, Q-474; issue #162). Pure: the
// numbers are the stored reply's (spectraApi.ts), only rounded and placed here, never computed anew.
import type { AreaSpectra, SpectrumPair, SpectrumPoint, SpectrumStep, SpectrumVerdict, TrackSpectrum } from './spectraApi';

export type VerdictTone = 'ok' | 'warn' | 'fail' | 'muted';

/** A18.7's table: the row word, its dot, and the card title. */
export const VERDICT_WORDS: Record<SpectrumVerdict, { word: string; tone: VerdictTone; title: string }> = {
  rock: { word: 'Rock-like', tone: 'ok', title: 'Looks like sunlight off a rock' },
  very_red: { word: 'Very red', tone: 'warn', title: 'Redder than sunlight off any rock' },
  too_red: { word: 'Too red', tone: 'warn', title: 'Too red for sunlight off a rock' },
  too_blue: { word: 'Too blue', tone: 'fail', title: 'Bluer than sunlight off any rock' },
  flickers: { word: 'Flickers', tone: 'fail', title: 'Flickers between exposures' },
  too_faint: { word: 'Too faint', tone: 'muted', title: 'Too faint to tell' },
  one_colour: { word: 'One colour', tone: 'muted', title: 'One colour only' },
};

/** The reflected range of A17.13 step 5 (start values, Q-475), unless the reply's settings say otherwise. */
export const R_MIN = 0.6;
export const R_MAX = 3.0;
/** The dichroic split between the arms (A17.13 step 1). */
export const SPLIT_UM = 2.42;

export function reflectedRange(method: AreaSpectra['method'] | null): [number, number] {
  const s = method?.settings ?? {};
  const lo = typeof s.r_min === 'number' && Number.isFinite(s.r_min) ? s.r_min : R_MIN;
  const hi = typeof s.r_max === 'number' && Number.isFinite(s.r_max) ? s.r_max : R_MAX;
  return [lo, hi];
}

const one = (x: number) => x.toFixed(1);
const r2 = (x: number) => x.toFixed(2);
/** A share as a whole percent: 0.044 -> "4%". */
export const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

/** The pairs that measure a colour (not a limit). */
export const measuredPairs = (t: TrackSpectrum): SpectrumPair[] => t.pairs.filter((p) => p.limit === null);

/** "1.5 to 3.3 times redder than the Sun." from the pairs' rho min and max (1 decimal), or null. */
export function rangeLine(t: TrackSpectrum): string | null {
  const rho = measuredPairs(t).map((p) => p.rho);
  if (rho.length === 0) return null;
  const lo = one(Math.min(...rho));
  const hi = one(Math.max(...rho));
  const span = lo === hi ? lo : `${lo} to ${hi}`;
  // A colour below the Sun's is not "redder": the range is then given as times the Sun's colour.
  return Math.min(...rho) >= 1 ? `${span} times redder than the Sun.` : `${span} times the Sun's colour.`;
}

/** "Includes heat glow, as expected 1.16 AU from the Sun." when the reply says the colour needs it. */
export function heatGlowLine(t: TrackSpectrum): string | null {
  return t.heat_glow === true && t.r_au !== null ? `Includes heat glow, as expected ${r2(t.r_au)} AU from the Sun.` : null;
}

const minutes = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

/** The failed step with the largest change (the one the flicker line names), or null. */
export function worstFailedStep(t: TrackSpectrum): SpectrumStep | null {
  let out: SpectrumStep | null = null;
  for (const s of t.steps) if (!s.ok && (!out || Math.abs(s.change) > Math.abs(out.change))) out = s;
  return out;
}

/**
 * The card's muted line (A18.7). `matched`: the track is a known object (found blind), so a passing
 * unknown mover gets the mock-up's "A lead worth following." (state C).
 */
export function verdictLine(t: TrackSpectrum, matched: boolean): string {
  switch (t.verdict) {
    case 'rock':
      return [rangeLine(t), heatGlowLine(t), matched ? null : 'A lead worth following.'].filter(Boolean).join(' ');
    case 'very_red':
      return 'Only a warm, dark near-Earth asteroid fits. Its distance is not known.';
    case 'too_red':
      return t.r_au !== null
        ? `Even with heat glow at ${r2(t.r_au)} AU. Probably not an asteroid.`
        : 'Even with heat glow. Probably not an asteroid.';
    case 'too_blue':
      return 'Probably a star, a blend or an artefact.';
    case 'flickers': {
      const s = worstFailedStep(t);
      return s
        ? `Changed ${pct(s.change)} in ${minutes(s.time_a, s.time_b)} min, faster than a rock larger than 200 m can spin.`
        : 'Faster than a rock larger than 200 m can spin.';
    }
    case 'too_faint':
      return 'Its colour is uncertain by more than a third.';
    case 'one_colour':
      return 'Seen by one detector, so its colour cannot be compared.';
  }
}

/** Detectors 1 to 3 see the short arm, 4 to 6 the long one (bands 1 and 4, 2 and 5, 3 and 6). */
export const shortDetector = (d: number) => d <= 3;

/** The Steady row's step: the largest |change| on the short arm, else on the long arm; null if none. */
export function largestStep(t: TrackSpectrum): SpectrumStep | null {
  const pick = (xs: SpectrumStep[]) => xs.reduce<SpectrumStep | null>((m, s) => (!m || Math.abs(s.change) > Math.abs(m.change) ? s : m), null);
  return pick(t.steps.filter((s) => shortDetector(s.detector))) ?? pick(t.steps);
}

/** "within 4% between exposures", or null when no step was measured. */
export function steadyText(t: TrackSpectrum): string | null {
  const s = largestStep(t);
  return s ? `within ${pct(s.change)} between exposures` : null;
}

/** "6 exposures, both detectors at once"; lower limits only: "3 exposures; not seen below 1 µm". */
export function colourText(t: TrackSpectrum): string | null {
  const n = measuredPairs(t).length;
  const low = t.pairs.filter((p) => p.limit === 'lower');
  const up = t.pairs.filter((p) => p.limit === 'upper');
  const ex = (k: number) => `${k} exposure${k === 1 ? '' : 's'}`;
  if (n > 0) {
    const lim = low.length + up.length;
    return `${ex(n)}, both detectors at once` + (lim > 0 ? `; ${lim} more as limits` : '');
  }
  if (low.length > 0) return `${ex(low.length)}; not seen below ${Math.ceil(Math.max(...low.map((p) => p.lambda_short_um)))} µm`;
  if (up.length > 0) return `${ex(up.length)}; not seen above ${SPLIT_UM} µm`;
  return null;
}

/** "1.16 AU from the Sun, from its parallax", only for a distance from the track's parallax. */
export function distanceText(t: TrackSpectrum): string | null {
  return t.r_source === 'parallax' && t.r_au !== null ? `${r2(t.r_au)} AU from the Sun, from its parallax` : null;
}

/** "the Sun, and stars in the same frames"; "the Sun" alone when every calibration used the default. */
export function comparedText(calibration: AreaSpectra['calibration']): string {
  return calibration.some((c) => c.source === 'stars') ? 'the Sun, and stars in the same frames' : 'the Sun';
}

/** The star scatter for the accordion: the median measured floor, or null when none was measured. */
export function starScatter(calibration: AreaSpectra['calibration']): number | null {
  const v = calibration.filter((c) => c.source === 'stars').map((c) => c.sigma_sys).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** "3 rock-like, 1 very red, 5 one colour" for the step list, in the table's order. */
export function verdictCounts(tracks: readonly TrackSpectrum[]): string {
  const n = new Map<SpectrumVerdict, number>();
  for (const t of tracks) n.set(t.verdict, (n.get(t.verdict) ?? 0) + 1);
  return (Object.keys(VERDICT_WORDS) as SpectrumVerdict[])
    .filter((v) => n.has(v))
    .map((v) => `${n.get(v)} ${VERDICT_WORDS[v].word.toLowerCase()}`)
    .join(', ');
}

// ---- Chart -------------------------------------------------------------------------------------

export interface ChartPoint {
  dotId: string;
  x: number;
  y: number;
  err: number;
  /** 0: the track's first visit (filled), 1: a later visit (open). */
  visitIdx: number;
}
export interface ChartModel {
  measuredOnly: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  yTicks: number[];
  xTicks: number[];
  points: ChartPoint[];
  /** Lower limits (pairs), drawn as arrows. Empty under Measured only. */
  limits: { x: number; y: number }[];
  /** The reflected range as a closed polygon in data units; null under Measured only. */
  band: [number, number][] | null;
  /** The heat-glow allowance above R_max, when `heat_glow`; null otherwise. */
  glow: [number, number][] | null;
  /** The visits in order, for the key (visit number, first time). */
  visits: { visit: number; time: string | null }[];
  yLabel: string;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

/**
 * The chart in data units (A18.7): `rel` against wavelength, x from 0.7 to 3.8 µm (5.1 when a point
 * is beyond 3.8), y from 0 with ticks at 1× to 4× (more when needed), the reflected range widening
 * from the short arm, the heat-glow allowance above R_max, lower limits. Under Measured only: the
 * raw `flux_uJy` of the points alone. Points with `used: false` (and dots below snr_min) are left out.
 */
export function chartModel(t: TrackSpectrum, range: [number, number], measuredOnly: boolean): ChartModel {
  // A dot below snr_min (`point: false`) enters only as a limit (an arrow), never as a point.
  const used = t.points.filter((p) => p.used && p.point && (measuredOnly || p.rel !== null));
  const visitOrder: number[] = [];
  const firstTime = new Map<number, string>();
  for (const p of used) {
    if (!visitOrder.includes(p.visit)) visitOrder.push(p.visit);
    const ft = firstTime.get(p.visit);
    if (!ft || Date.parse(p.time) < Date.parse(ft)) firstTime.set(p.visit, p.time);
  }
  visitOrder.sort((a, b) => a - b);
  const pt = (p: SpectrumPoint): ChartPoint => {
    const y = measuredOnly ? p.flux_uJy : (p.rel as number);
    const err = measuredOnly ? p.flux_err : p.flux_uJy !== 0 ? Math.abs((p.rel as number) * (p.flux_err / p.flux_uJy)) : 0;
    return { dotId: p.dot_id, x: p.lambda_um, y, err, visitIdx: Math.min(1, visitOrder.indexOf(p.visit)) };
  };
  const points = used.map(pt);
  const limits = measuredOnly ? [] : t.pairs.filter((p) => p.limit === 'lower').map((p) => ({ x: p.lambda_long_um, y: p.rho }));
  const xs = [...points.map((p) => p.x), ...limits.map((l) => l.x)];
  const x0 = 0.7;
  const x1 = xs.some((x) => x > 3.8) ? 5.1 : 3.8;
  let y1: number;
  let yTicks: number[];
  if (measuredOnly) {
    y1 = niceMax(Math.max(1, ...points.map((p) => p.y + p.err)) * 1.05);
    yTicks = [0.25, 0.5, 0.75, 1].map((f) => f * y1);
  } else {
    // Room above the highest point or limit (the arrow is drawn above its value).
    const top = Math.max(range[1], ...points.map((p) => p.y + p.err), ...limits.map((l) => l.y + 0.5));
    const n = Math.max(4, Math.ceil(top));
    y1 = n + 0.6;
    yTicks = Array.from({ length: n }, (_, k) => k + 1);
  }
  const xTicks = [1, 2, 3, 4, 5].filter((x) => x > x0 && x < x1);
  const [lo, hi] = range;
  const band: [number, number][] | null = measuredOnly
    ? null
    : [
        [0.75, 1.2],
        [1.1, 1.3],
        [SPLIT_UM, hi],
        [x1, hi],
        [x1, lo],
        [SPLIT_UM, lo],
        [1.1, 0.8],
        [0.75, 0.85],
      ];
  let glow: [number, number][] | null = null;
  if (!measuredOnly && t.heat_glow === true) {
    const cap = (y: number) => Math.min(y, y1);
    const edge = t.pairs
      .filter((p) => p.lambda_long_um >= SPLIT_UM)
      .sort((a, b) => a.lambda_long_um - b.lambda_long_um)
      .map((p): [number, number] => [p.lambda_long_um, cap(p.rho_max)]);
    const last = edge.length > 0 ? edge[edge.length - 1]![1] : y1;
    glow = [[SPLIT_UM, hi], ...edge, [x1, last], [x1, hi]];
  }
  return {
    measuredOnly,
    x0,
    x1,
    y0: 0,
    y1,
    yTicks,
    xTicks,
    points,
    limits,
    band,
    glow,
    visits: visitOrder.map((v) => ({ visit: v, time: firstTime.get(v) ?? null })),
    yLabel: measuredOnly ? 'µJy' : "times the Sun's colour",
  };
}

/** The chart's aria-label: what it plots, its points, and the verdict (none under Measured only). */
export function chartLabel(trackId: string, m: ChartModel, verdict: SpectrumVerdict): string {
  const what = m.measuredOnly
    ? `Brightness in microjanskys against wavelength for ${trackId}.`
    : `Brightness divided by sunlight against wavelength for ${trackId}.`;
  const n = m.points.length;
  const xs = m.points.map((p) => p.x);
  const ys = m.points.map((p) => p.y);
  const fmt = (v: number) => (m.measuredOnly ? Math.round(v).toString() : v.toFixed(1));
  const pts =
    n === 0
      ? 'No points.'
      : `${n} point${n === 1 ? '' : 's'} from ${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)} micrometres, ` +
        (m.measuredOnly
          ? `${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))} microjanskys.`
          : `${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))} times the Sun's colour.`);
  const lim = m.limits.length > 0 ? ` ${m.limits.length} lower limit${m.limits.length === 1 ? '' : 's'}.` : '';
  return m.measuredOnly ? `${what} ${pts}` : `${what} ${pts}${lim} ${VERDICT_WORDS[verdict].title}.`;
}

/** A dot's flags from the area's `/dots` (Points used); none when the dots did not load. */
export function flagsFrom(dots: ReadonlyMap<string, readonly string[]>): (dotId: string) => readonly string[] {
  return (dotId) => dots.get(dotId) ?? [];
}
