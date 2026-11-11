// Issue #71 F (Q-262): the comet "emissions" view, left panel. Shows the SPHEREx spectrum (when one
// has been measured), the gas bands with their production rates at the chosen time, and the time
// control between the two observed epochs. The nucleus and its gas particles are drawn by the
// viewer on the right. A rate inside an observing window is `measured` (SPHEREx, or SOHO/SWAN for
// 3I/ATLAS water near perihelion, cometGas.RATE_ANCHORS_BY_CARD); between them it is a
// `model_dependent` guess and says so. Nothing here is invented: a gas with no rate is listed as such.
import { useId } from 'react';
import type { ObjectCard } from '@/contract';
import { useAppStore } from '@/state/store';
import {
  EPOCH_JD,
  GAS_BANDS,
  daysFromPerihelion,
  gasRatesAt,
  RATE_ANCHORS_BY_CARD,
  timeRange,
  weakestRateTag,
} from '@/physics/cometGas';
import { ProvenanceBadge } from './Badge';
import { SpectrumChart } from './spectrum/SpectrumChart';
import { FormulaMath } from './FormulaMath';
import { COMET_FORMULA_NOTE, COMET_FORMULA_PLAIN } from './worldNotes.generated';

/** The preview's formula, set in KaTeX (its plain twin is generated from the preview). */
const COMET_FORMULA_LATEX = String.raw`N = \frac{4\pi\,\Delta^{2} F}{g\,h\,\nu} \;\to\; Q = \frac{2\,v\,N}{\pi\,\rho}`;

const UNIX_JD = 2440587.5;
/** A Julian date as a UTC calendar date, e.g. "11 Dec 2025". Display only. */
export function jdToDate(jd: number): string {
  return new Date((jd - UNIX_JD) * 86_400_000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRate(v: number): string {
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(1)} × 10^${e} molecules/s`;
}

export function EmissionsPanel({
  card,
  jd,
  onJd,
  fixture = false,
}: {
  card: ObjectCard;
  jd: number;
  onJd: (jd: number) => void;
  fixture?: boolean;
}) {
  const id = useId();
  const spectrum = useAppStore((s) => s.sky.spectrum.data);
  const range = timeRange(card);
  if (!range) return null;
  const { rates, refused } = gasRatesAt(card, jd);
  const interpolated = rates.some((r) => r.kind === 'interpolated');
  const days = Math.round(daysFromPerihelion(jd));
  const when = `${jdToDate(jd)}, ${Math.abs(days)} days ${days < 0 ? 'before' : 'after'} closest approach to the Sun`;
  const instruments = [
    ...new Set(rates.filter((r) => r.kind === 'measured').map((r) => r.instrument ?? 'SPHEREx')),
  ];
  const measuredBy = `measured by ${instruments.length ? instruments.join(' and ') : 'SPHEREx'}`;
  const state = interpolated
    ? instruments.length
      ? `partly ${measuredBy}, partly a guess between observations`
      : 'between observations, a guess'
    : measuredBy;
  const points = spectrum?.spectrum ?? [];
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex w-full flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3 lg:max-w-md"
      data-testid="emissions-panel"
    >
      <h3 id={`${id}-h`} className="text-base font-medium">
        Gas emissions
      </h3>
      {points.length > 0 ? (
        <SpectrumChart
          points={points}
          fluxUnit={spectrum?.flux_unit ?? ''}
          objectName={card.name}
        />
      ) : (
        <p className="text-sm text-neutral-300">
          No SPHEREx spectrum has been measured for this object here, so only the gas bands are
          listed below.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm text-neutral-300" htmlFor={`${id}-t`}>
        Time
        <input
          id={`${id}-t`}
          type="range"
          min={range.startJd}
          max={range.endJd}
          step={1}
          value={Math.min(Math.max(jd, range.startJd), range.endJd)}
          className="min-h-11 w-full"
          aria-valuetext={`${when}; ${state}`}
          onChange={(e) => onJd(Number(e.target.value))}
          data-testid="emissions-time"
        />
        <span className="text-xs text-neutral-400">
          {when}. Gas amounts: {state}.
        </span>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Jump to an observation">
        {(['2025-08', '2025-12'] as const).map((e) => (
          <button
            key={e}
            type="button"
            className="min-h-11 rounded border border-neutral-600 px-3 text-sm"
            onClick={() => onJd(EPOCH_JD[e])}
          >
            {e === '2025-08' ? 'August 2025' : 'December 2025'}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm" aria-label="Gas bands and production rates">
        <thead>
          <tr className="text-neutral-400">
            <th className="py-1 pr-2 font-normal">Gas</th>
            <th className="py-1 pr-2 font-normal">Band</th>
            <th className="py-1 font-normal">Amount made per second</th>
          </tr>
        </thead>
        <tbody>
          {GAS_BANDS.map((g) => {
            const r = rates.find((x) => x.key === g.key);
            const no = refused.find((x) => x.key === g.key);
            return (
              <tr key={g.key} className="border-t border-neutral-800 align-top">
                <td className="py-1 pr-2">{g.label}</td>
                <td className="py-1 pr-2 tabular-nums">{g.bandUm.toFixed(2)} µm</td>
                <td className="py-1">
                  {r ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {formatRate(r.value)}
                      {r.err !== null && (
                        <span className="text-xs text-neutral-400">± {formatRate(r.err)}</span>
                      )}
                      <ProvenanceBadge
                        tag={r.tag}
                        tooltip={r.assumption ?? r.source}
                        srText
                        fixture={fixture}
                      />
                    </span>
                  ) : (
                    <span className="text-neutral-400">{no?.reason ?? 'Not known.'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-1" data-testid="emissions-formula">
        <h4 className="text-sm font-medium">From a SPHEREx gas band to a production rate</h4>
        <FormulaMath
          latex={COMET_FORMULA_LATEX}
          plain={COMET_FORMULA_PLAIN}
          testId="emissions-formula-math"
        />
        <p className="text-xs text-neutral-300">{COMET_FORMULA_NOTE}</p>
      </div>
      {interpolated && (
        <p className="text-xs text-neutral-300" data-testid="emissions-guess">
          SPHEREx observed in August and December 2025 only
          {RATE_ANCHORS_BY_CARD[card.id]?.length
            ? '; for water, SOHO/SWAN adds one measurement near closest approach to the Sun (6 Nov 2025)'
            : ''}
          . Between measurements the amounts here are a straight line (in the logarithm) between the
          nearest ones. Weakest label shown: {weakestRateTag(rates)}.
        </p>
      )}
    </section>
  );
}
