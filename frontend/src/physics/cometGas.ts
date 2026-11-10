// Issue #71 stream F (Q-260, Q-262): comet gas production over time.
//   Two SPHEREx epochs carry measured gas rates (Lisse et al. 2026, arXiv:2512.07318v3 for August,
//   arXiv:2601.06759v2 for December). Between them nothing was observed, so a rate there is
//   `model_dependent`: a straight line in log Q between the two measured values. Outside the two
//   epochs there is no rate at all. Pure and deterministic: no Date, no Math.random.
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
/** Perihelion of 3I/ATLAS, 30 Oct 2025 at 1.35 au (Lisse et al. 2026, Dec paper Sect. 5). JD 2460978.5. */
export const PERIHELION_JD = 2460978.5;

export const EPOCH_ORDER: readonly CometEpoch[] = ['2025-08', '2025-12'];

export type RateKind = 'measured' | 'interpolated';

export interface GasRate {
  key: GasKey;
  label: string;
  /** Molecules per second. */
  value: number;
  /** One-sigma error in molecules per second; null between the epochs. */
  err: number | null;
  kind: RateKind;
  /** `measured` at an epoch; `model_dependent` between epochs. */
  tag: Tag;
  /** For `model_dependent`: what was assumed. */
  assumption?: string;
  /** For a measured value: the source string of the card's tagged value. */
  source?: string;
}

export const INTERPOLATION_ASSUMPTION =
  'Nothing was observed between August and December 2025. The rate is a straight line in the logarithm of Q between the two measured values, so the path is a guess; it only shows how the activity could have grown.';

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

/**
 * Gas rates at a Julian date. Inside an epoch window the measured value; between the windows a
 * log-linear interpolation (`model_dependent`); outside [first epoch, last epoch] nothing, because
 * the papers give no rate there. A gas measured in only one epoch gets no interpolated value (the
 * other end is unknown), and is listed in `refused` with the reason.
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
    const a = qOf(keyed(card, first), g.key);
    const b = qOf(keyed(card, last), g.key);
    // Inside a measured window.
    for (const [e, q] of [
      [first, a],
      [last, b],
    ] as const) {
      if (q && Math.abs(jd - EPOCH_JD[e]) <= EPOCH_HALF_WINDOW_DAYS[e]) {
        rates.push({
          key: g.key,
          label: g.label,
          value: q.value,
          err: q.err,
          kind: 'measured',
          tag: 'measured',
          source: q.source,
        });
        break;
      }
    }
    if (rates.at(-1)?.key === g.key) continue;
    if (jd < EPOCH_JD[first] || jd > EPOCH_JD[last]) {
      refused.push({
        key: g.key,
        label: g.label,
        reason: 'No gas rate was measured at this time.',
      });
      continue;
    }
    if (!a || !b) {
      refused.push({
        key: g.key,
        label: g.label,
        reason:
          'Only one epoch has a measured rate for this gas, so nothing can be drawn between them.',
      });
      continue;
    }
    const f = (jd - EPOCH_JD[first]) / (EPOCH_JD[last] - EPOCH_JD[first]);
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
