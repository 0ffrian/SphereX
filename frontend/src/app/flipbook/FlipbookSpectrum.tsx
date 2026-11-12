// The Flipbook card's spectrum (always shown): loads when the card opens and draws like the
// approved preview. Points are SPHEREx measurements (`measured`); flagged points are hollow. The
// type and temperature line comes only from the object's card when it is loaded (spectral class
// or object type; effective or surface temperature). No absorption bands or molecules are drawn:
// the app has no detected-band data yet, and none are hard-coded. The amber tick is the F_nu
// peak, lambda = 5100 um K / T (Wien, in F_nu: `derived`), drawn only with a card temperature.
import { useEffect, useMemo } from 'react';
import type { SpectrumPoint } from '@/app/api/types';
import { typeLabel } from '@/app/build/selectedBody';
import { formatWavelength } from '@/app/format';
import { summarizeSpectrum, ALL_SATURATED } from '@/app/refusals';
import { DataBadge, ProvenanceBadge } from '@/app/Badge';
import { useAppStore } from '@/state/store';
import { SpectrumSound } from '@/app/sound/SpectrumSound';

const W = 400;
const H = 170;
const L = 34;
const R = 14;
const T = 12;
const B = 30;
const X0 = 0.75;
const X1 = 5;
/**
 * F_nu peak: lambda_max [um] = 5100 / T [K] (derived). 5100 um K is the frequency-form Wien
 * displacement constant, b' ~ 5.1e-3 m K (the peak of F_nu; the familiar 2898 um K is the peak of
 * F_lambda). A known physical constant, not a tuned number.
 */
export const FNU_PEAK_UM_K = 5100;

/** The card's `{value}` fields, or null; a card of another object is not used. */
export function useObjectFacts(): { type: string | null; tempK: number | null; tempTag: string | null } {
  const card = useAppStore((s) => s.card);
  const id = useAppStore((s) => s.sky.resolved?.id);
  if (!card || !id || card.id !== id) return { type: null, tempK: null, tempTag: null };
  const t = card.teff_K ?? card.surface_temperature_K;
  const tempK = t && typeof t.value === 'number' && t.value > 0 ? t.value : null;
  const cls = card.spectral_class?.value;
  return {
    type: (cls && cls.trim()) || typeLabel(card.type),
    tempK,
    tempTag: tempK !== null && t ? t.tag : null,
  };
}

function Chart({
  points,
  name,
  tempK,
}: {
  points: readonly SpectrumPoint[];
  name: string;
  tempK: number | null;
}) {
  const good = points.filter((p) => !p.flagged);
  const basis = good.length > 0 ? good : points;
  const ymax = Math.max(...basis.map((p) => p.flux + Math.max(0, p.error)), 1e-9) * 1.1;
  const ymin = Math.min(0, ...basis.map((p) => p.flux - Math.max(0, p.error)));
  const X = (l: number) => L + ((l - X0) / (X1 - X0)) * (W - L - R);
  const Y = (f: number) =>
    T + (1 - (Math.max(ymin, Math.min(ymax, f)) - ymin) / (ymax - ymin)) * (H - T - B);
  const peak = tempK ? FNU_PEAK_UM_K / tempK : null;
  const wl = points.map((p) => p.wavelength_um);
  const label = `SPHEREx spectrum of ${name}: ${points.length} points from ${formatWavelength(Math.min(...wl))} to ${formatWavelength(Math.max(...wl))}, ${points.filter((p) => p.flagged).length} flagged.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="fb-spec" data-testid="spectrum-chart">
      {[1, 2, 3, 4, 5].map((l) => (
        <g key={l}>
          <line x1={X(l)} x2={X(l)} y1={T} y2={H - B} stroke="var(--line)" />
          <text x={X(l)} y={H - 10} fill="var(--muted)" fontSize="11" textAnchor="middle">
            {l} µm
          </text>
        </g>
      ))}
      <text x="6" y={T + 8} fill="var(--muted)" fontSize="10">
        µJy
      </text>
      {peak !== null && peak >= X0 && peak <= X1 && (
        <line x1={X(peak)} x2={X(peak)} y1={H - B} y2={H - B - 6} stroke="var(--warn)" strokeWidth="1.5" />
      )}
      {points.map((p) => {
        const cx = X(p.wavelength_um);
        if (cx < L || cx > W - R) return null;
        return (
          <g key={`${p.frame_id}-${p.wavelength_um}`}>
            {!p.flagged && (
              <line
                x1={cx}
                x2={cx}
                y1={Y(p.flux - p.error)}
                y2={Y(p.flux + p.error)}
                stroke="var(--p-phys)"
                strokeOpacity=".25"
              />
            )}
            {p.flagged ? (
              <circle cx={cx} cy={Y(p.flux)} r="2" fill="none" stroke="var(--muted)" strokeOpacity=".6" />
            ) : (
              <circle cx={cx} cy={Y(p.flux)} r="2" fill="var(--p-phys)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function FlipbookSpectrum({ name }: { name: string }) {
  const sky = useAppStore((s) => s.sky);
  const load = useAppStore((s) => s.skyLoadSpectrum);
  const { status, data } = sky.spectrum;
  const facts = useObjectFacts();
  const hasFrames = (sky.frames?.frames.length ?? 0) > 0;
  const outcome = useMemo(
    () => (data ? summarizeSpectrum(data.spectrum, data.missing, sky.frames?.frames) : null),
    [data, sky.frames?.frames],
  );
  // Loads when the card opens (and again for a new object, whose spectrum state starts idle).
  useEffect(() => {
    if (status === 'idle' && hasFrames) void load({ quiet: true });
  }, [status, hasFrames, load]);

  let body: React.ReactNode;
  if (status === 'idle' || status === 'loading') {
    body = <p className="fb-muted">Loading the spectrum…</p>;
  } else if (status === 'waiting') {
    const stopped = sky.progress && sky.progress.phase !== 'fetching';
    body = stopped ? (
      <p className="fb-muted">
        The spectrum waits for the frames.{' '}
        <button type="button" className="fb-stop" onClick={() => void load()} data-testid="spectrum-measure-now">
          Measure the frames found so far
        </button>
      </p>
    ) : (
      <p className="fb-muted">Loading the spectrum…</p>
    );
  } else if (status === 'error') {
    body = (
      <p className="fb-empty" data-testid="spectrum-error">
        The spectrum could not be loaded.{' '}
        <button type="button" className="fb-stop" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  } else if (data && outcome && outcome.points > 0) {
    const tempText = facts.tempK ? `${Math.round(facts.tempK).toLocaleString('en-US')} K` : null;
    const line = [facts.type, tempText].filter((x): x is string => !!x);
    body = (
      <>
        <Chart points={data.spectrum} name={name} tempK={facts.tempK} />
        {line.length > 0 && (
          <div className="fb-meta" data-testid="spectrum-facts" title={facts.tempTag ? `Temperature: ${facts.tempTag}` : undefined}>
            {line.map((t, i) => (
              <span key={t} className="contents">
                {i > 0 && <span aria-hidden="true">·</span>}
                {i === 0 ? <b>{t}</b> : <span>{t}</span>}
              </span>
            ))}
          </div>
        )}
        {/* D-02 badge for the measured points (Fixture on dev data) and the Q-23 caveat. */}
        <div className="fb-meta" data-testid="spectrum-provenance">
          {sky.fixture ? <DataBadge fixture variant="tag" /> : <ProvenanceBadge tag="measured" variant="tag" />}
          <span data-testid="spectrum-caveat">Not absolute photometry: no aperture correction yet.</span>
        </div>
        {/* R13.12, A8 (Q-446): hear it as a sweep or as a 12-note chord. */}
        <SpectrumSound reply={data} />
        {/* R9: the text equivalent of the chart. */}
        {/* The wrapper is what is hidden: a table's <caption> is drawn outside the table's own box,
            so sr-only on the table left "Spectrum points of ..." on screen. */}
        <div className="sr-only">
          <table data-testid="spectrum-table">
            <caption>Spectrum points of {name}</caption>
            <thead>
              <tr>
                <th scope="col">Wavelength</th>
                <th scope="col">Flux ({data.flux_unit})</th>
                <th scope="col">1σ error</th>
                <th scope="col">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {data.spectrum.map((p) => (
                <tr key={`${p.frame_id}-${p.wavelength_um}`}>
                  <td>{formatWavelength(p.wavelength_um)}</td>
                  <td>{p.flux}</td>
                  <td>{p.error}</td>
                  <td>{p.flagged ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  } else if (data && outcome) {
    const total = outcome.total || sky.frames?.frames.length || 0;
    const allSat = data.missing.includes(ALL_SATURATED);
    const sat = outcome.saturated || (allSat ? total : 0);
    let why: string;
    if (sat > 0) {
      why = `${name} is too bright and saturates the detector in ${sat} of ${total} frames, so its brightness can't be measured.`;
    } else if (total === 0) {
      why = 'no frames of this object were available to measure.';
    } else {
      why = `none of its ${total} frames could be measured.`;
    }
    body = (
      <p className="fb-empty" data-testid="no-spectrum">
        No spectrum: {why}
      </p>
    );
  } else {
    body = <p className="fb-muted">Loading the spectrum…</p>;
  }

  return (
    <div className="sx-pc-grp" data-testid="spectrum-panel">
      <span className="sx-eyebrow">Spectrum</span>
      {body}
    </div>
  );
}
