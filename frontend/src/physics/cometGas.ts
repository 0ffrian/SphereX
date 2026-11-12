// Issue #71 stream F (Q-260, Q-262): comet gas production over time.
//   Two SPHEREx epochs carry measured gas rates (Lisse et al. 2026, arXiv:2512.07318v3 for August,
//   arXiv:2601.06759v2 for December). For 3I/ATLAS water there is one more measured point between
//   them, from another instrument: SOHO/SWAN near perihelion (RATE_ANCHORS_BY_CARD). Between
//   measured points nothing was observed, so a rate there is `model_dependent`: a straight line in
//   log Q between the nearest measured values. Outside the two SPHEREx epochs there is no rate at
//   all. Water is also broken up by sunlight (Haser scale length, h2oScaleLengthKm).
//   Pure and deterministic: no Date, no Math.random.
import type { CometEpoch, GasQ, ObjectCard, Tag } from '@/contract';

/** The gases of R7.3. `key` is the card's member name; `band` the emission band in micrometres. */
export const GAS_BANDS = [
  // Band centres from Lisse et al. 2026 (Aug) Sect. 4.2: H2O 2.7-2.8 um, CO2 4.25-4.27 um, CO 4.6-4.8 um.
  { key: 'h2o', label: 'H₂O', bandUm: 2.75, halfWidthUm: 0.08 },
  { key: 'co2', label: 'CO₂', bandUm: 4.26, halfWidthUm: 0.04 },
  { key: 'co', label: 'CO', bandUm: 4.7, halfWidthUm: 0.1 },
] as const;
export type GasKey = (typeof GAS_BANDS)[number]['key'];

/**
 * Julian date (UT) of the middle of each SPHEREx observing window: 1-15 Aug 2025 and 8-15 Dec 2025
 * (Lisse et al. 2026 abstract and Sect. 1). A midpoint is a display choice for "when", so it is
 * `derived` (the midpoint of the quoted window), not a measured time of any one frame.
 * 2025-08-08 00:00 UT = JD 2460895.5; 2025-12-11 12:00 UT = JD 2461021.0.
 */
export const EPOCH_JD: Readonly<Record<CometEpoch, number>> = {
  '2025-08': 2460895.5,
  '2025-12': 2461021.0,
};
/** First day of the August observing window: dust is modelled from here (earlier activity unknown). JD 2460888.5. */
export const EMISSION_START_JD = 2460888.5;
/** Half the observing window in days; a time this close to an epoch centre shows the measured value. */
export const EPOCH_HALF_WINDOW_DAYS: Readonly<Record<CometEpoch, number>> = {
  '2025-08': 7,
  '2025-12': 3.5,
};
/**
 * Perihelion of 3I/ATLAS: 2025-Oct-29.48 TDB at q = 1.356 au (JPL Small-Body Database, the orbit
 * solution of the committed Horizons track). JD 2460977.98 (TDB; TDB - UT is about 69 s, far below
 * the one-day display step).
 */
export const PERIHELION_JD = 2460977.98;

export const EPOCH_ORDER: readonly CometEpoch[] = ['2025-08', '2025-12'];

export type RateKind = 'measured' | 'interpolated';

/** One measured rate from outside the card: a published value from another instrument. */
export interface RateAnchor {
  key: GasKey;
  /** Time of the measurement (JD, UT). */
  jd: number;
  /** A time this close (days) shows the measured value. */
  halfWindowDays: number;
  /** Molecules per second. */
  value: number;
  /** One-sigma error, or null when it is not carried (the source says why). */
  err: number | null;
  /** Heliocentric distance at the measurement, au. */
  rhAu: number;
  /** The instrument, for the note. */
  instrument: string;
  /** Citation and caveats, in plain words. */
  source: string;
}

/**
 * Measured rates from other instruments, by card id. Water only: CO2 and CO stay SPHEREx-only.
 * 3I/ATLAS (`sbdb-1004083`, the backend's SBDB id): SOHO/SWAN water production near perihelion,
 * Combi et al. (arXiv:2512.22354), 6 Nov 2025 at r_h 1.40 au, Q(H2O) about 3.2 x 10^29 /s, `measured`.
 * Without it a straight line in log Q from August to December misses the perihelion peak by about
 * 65 times. ASSUMPTION: the value is a daily one; noon UT of 6 Nov (JD 2460986.0) is taken as its
 * time and +-0.5 d as its window. No error is carried: the spread between analyses (Tan, Yan and
 * Li, arXiv:2601.15443, about 4 x 10^28) is far larger than a quoted sigma, and the source says so.
 */
export const RATE_ANCHORS_BY_CARD: Readonly<Record<string, readonly RateAnchor[]>> = {
  'sbdb-1004083': [
    {
      key: 'h2o',
      jd: 2460986.0,
      halfWindowDays: 0.5,
      value: 3.2e29,
      err: null,
      rhAu: 1.4,
      instrument: 'SOHO/SWAN',
      source:
        'Measured by SOHO/SWAN, not SPHEREx: Combi et al., arXiv:2512.22354, water production on 6 Nov 2025 at 1.40 au from the Sun, from its hydrogen cloud. An independent re-analysis finds about 4 × 10^28 per second (Tan, Yan and Li, arXiv:2601.15443), so the value is uncertain by up to about 8 times.',
    },
  ],
};

export interface GasRate {
  key: GasKey;
  label: string;
  /** Molecules per second. */
  value: number;
  /** One-sigma error in molecules per second; null between measured points. */
  err: number | null;
  kind: RateKind;
  /** `measured` at a measured point; `model_dependent` between them. */
  tag: Tag;
  /** For `model_dependent`: what was assumed. */
  assumption?: string;
  /** For a measured value: the source string of the card's tagged value (or of the anchor). */
  source?: string;
  /** For a measured value: the instrument ('SPHEREx' for the card's epochs). */
  instrument?: string;
}

export const INTERPOLATION_ASSUMPTION =
  'Nothing was observed between the measurements. The rate is a straight line in the logarithm of Q between the nearest measured values before and after this time, so the path is a guess; it only shows how the activity could have changed.';

function qOf(
  q: GasQ | undefined,
  key: GasKey,
): { value: number; err: number | null; source: string } | null {
  const tv = q?.[key];
  const v = tv?.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const err = typeof tv?.err === 'number' && Number.isFinite(tv.err) ? tv.err : null;
  return { value: v, err, source: tv?.source ?? '' };
}

/** The epoch-keyed gas_Q of a card (Q-42 proposal), or null for a card that does not key by epoch. */
function keyed(card: ObjectCard, epoch: CometEpoch): GasQ | undefined {
  const g = card.gas_Q as (Partial<Record<CometEpoch, GasQ>> & GasQ) | undefined;
  return g?.[epoch] as GasQ | undefined;
}

/** True when the card carries gas rates keyed by epoch (the only shape that can be interpolated). */
export function hasKeyedEpochs(card: ObjectCard): boolean {
  return EPOCH_ORDER.some((e) => keyed(card, e) !== undefined);
}

/** Epochs for which the card holds at least one usable keyed rate. */
export function keyedEpochs(card: ObjectCard): CometEpoch[] {
  return EPOCH_ORDER.filter((e) => GAS_BANDS.some((g) => qOf(keyed(card, e), g.key) !== null));
}

/** The time range the slider covers: the two epoch centres, only when both have gas. */
export function timeRange(card: ObjectCard): { startJd: number; endJd: number } | null {
  const have = keyedEpochs(card);
  if (have.length < 2) return null;
  return { startJd: EPOCH_JD[have[0]!], endJd: EPOCH_JD[have.at(-1)!] };
}

interface RatePoint {
  jd: number;
  half: number;
  value: number;
  err: number | null;
  source: string;
  instrument: string;
}

/** The measured points of one gas in time order: the card's SPHEREx epochs plus any anchor. */
function ratePoints(card: ObjectCard, key: GasKey): RatePoint[] {
  const pts: RatePoint[] = [];
  for (const e of EPOCH_ORDER) {
    const q = qOf(keyed(card, e), key);
    if (q)
      pts.push({
        jd: EPOCH_JD[e],
        half: EPOCH_HALF_WINDOW_DAYS[e],
        value: q.value,
        err: q.err,
        source: q.source,
        instrument: 'SPHEREx',
      });
  }
  // An anchor refines the path of a gas the card measures; it never stands in for the card.
  if (pts.length > 0)
    for (const a of RATE_ANCHORS_BY_CARD[card.id] ?? [])
      if (a.key === key && a.value > 0)
        pts.push({
          jd: a.jd,
          half: a.halfWindowDays,
          value: a.value,
          err: a.err,
          source: a.source,
          instrument: a.instrument,
        });
  return pts.sort((p, q) => p.jd - q.jd);
}

/**
 * Gas rates at a Julian date. Inside a measured window the measured value; between measured points
 * a log-linear interpolation (`model_dependent`); outside [first epoch, last epoch] nothing, because
 * the papers give no rate there. A gas with no measured point on one side of the time gets no
 * interpolated value (that end is unknown), and is listed in `refused` with the reason.
 */
export function gasRatesAt(
  card: ObjectCard,
  jd: number,
): { rates: GasRate[]; refused: { key: GasKey; label: string; reason: string }[] } {
  const rates: GasRate[] = [];
  const refused: { key: GasKey; label: string; reason: string }[] = [];
  if (!Number.isFinite(jd)) return { rates, refused };
  const [first, last] = [EPOCH_ORDER[0]!, EPOCH_ORDER.at(-1)!];
  for (const g of GAS_BANDS) {
    const pts = ratePoints(card, g.key);
    // Inside a measured window.
    const hit = pts.find((p) => Math.abs(jd - p.jd) <= p.half);
    if (hit) {
      rates.push({
        key: g.key,
        label: g.label,
        value: hit.value,
        err: hit.err,
        kind: 'measured',
        tag: 'measured',
        source: hit.source,
        instrument: hit.instrument,
      });
      continue;
    }
    if (jd < EPOCH_JD[first] || jd > EPOCH_JD[last]) {
      refused.push({
        key: g.key,
        label: g.label,
        reason: 'No gas rate was measured at this time.',
      });
      continue;
    }
    const a = pts.filter((p) => p.jd < jd).at(-1);
    const b = pts.find((p) => p.jd > jd);
    if (!a || !b) {
      refused.push({
        key: g.key,
        label: g.label,
        reason:
          'This gas was measured on one side of this time only, so nothing can be drawn here.',
      });
      continue;
    }
    const f = (jd - a.jd) / (b.jd - a.jd);
    const value = Math.exp(Math.log(a.value) * (1 - f) + Math.log(b.value) * f);
    rates.push({
      key: g.key,
      label: g.label,
      value,
      err: null,
      kind: 'interpolated',
      tag: 'model_dependent',
      assumption: INTERPOLATION_ASSUMPTION,
    });
  }
  return { rates, refused };
}

/** The weakest of a set of tags, in the D-02 order (measured is the strongest). */
const ORDER: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];
export function weakestRateTag(rates: readonly GasRate[]): Tag | null {
  if (rates.length === 0) return null;
  return rates.reduce<Tag>(
    (w, r) => (ORDER.indexOf(r.tag) > ORDER.indexOf(w) ? r.tag : w),
    'measured',
  );
}

/** Whole days from perihelion; negative before it. */
export function daysFromPerihelion(jd: number): number {
  return jd - PERIHELION_JD;
}

// Haser parent model for water (Haser 1957). A molecule flows out at speed v and is broken up by
// sunlight with lifetime tau, so the density is n(r) ~ Q / (4 pi v r^2) * exp(-r / L), L = v tau;
// tau grows as r_h^2 (sunlight falls as 1 / r_h^2). CO2 and CO live far longer than the coma shown,
// so for them the pure 1 / r^2 shell (L infinite) stands. `model_dependent`: both constants are
// standard model values, not measured for 3I/ATLAS.
/** [verify] H2O photodissociation lifetime at 1 au, quiet Sun, seconds (Huebner, Keady and Lyon 1992). */
export const H2O_LIFETIME_1AU_S = 8.3e4;
/** [verify] H2O outflow speed at 1 au, km/s; v = 0.85 r_h^-0.5 km/s (Cochran and Schleicher 1993). */
export const H2O_OUTFLOW_1AU_KM_S = 0.85;

export const HASER_ASSUMPTION =
  'Water is broken up by sunlight as it flows out, so it thins faster than the other gases: its density falls as exp(−r/L)/r² (the Haser model), with L = v·τ, v = 0.85 km/s ÷ √r_h (Cochran and Schleicher 1993) and τ = 8.3 × 10⁴ s × r_h² (Huebner et al. 1992), r_h in au. These are standard model values, not measured for this comet.';

/** Haser scale length of water in km at heliocentric distance `rhAu` (au); null for a bad distance. */
export function h2oScaleLengthKm(rhAu: number): number | null {
  if (!Number.isFinite(rhAu) || rhAu <= 0) return null;
  const v = H2O_OUTFLOW_1AU_KM_S / Math.sqrt(rhAu);
  const tau = H2O_LIFETIME_1AU_S * rhAu * rhAu;
  return v * tau;
}

/**
 * exp(-r / L) averaged over a 1 / r^2 shell from `inner` to `outer` (all in one unit). With density
 * ~ 1 / r^2 the molecules are spread evenly in r, so this is the share of the pure-1/r^2 molecules
 * that survive inside the shell. 1 for an infinite L.
 */
export function haserShellFraction(inner: number, outer: number, L: number): number {
  if (!(outer > inner) || L === Infinity) return 1;
  if (!(L > 0)) return 0;
  return (L * (Math.exp(-inner / L) - Math.exp(-outer / L))) / (outer - inner);
}
