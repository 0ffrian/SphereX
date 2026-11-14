// The spectrum check on a Discovery Result card (A18.7, A17.13, Q-474; issue #162, mock-up states B
// to F): the verdict (a status dot, the card title, one muted line), the Spectrum section (an SVG
// chart of the track's colours against the Sun's, coloured through tokens only, with its key), the
// rows Colour, Steady, Distance and Compared with, and the accordion "How this is checked" with
// "Points used". The verdict is an extra line: it never changes the track's own verdict, chip or order.
//
// Measured only (D-21): the chart shows the points' raw brightness alone; the verdict, the range, the
// heat-glow band and the Distance row are hidden (they are model_dependent), and so is the Steady row
// (a step's change is a ratio of fluxes, derived: Q-379).
import { ProvenanceBadge } from '@/app/Badge';
import { badgeForTag } from '@/viewer/honesty';
import { FormulaMath } from '@/app/FormulaMath';
import { Row, Rows } from '@/app/PanelControls';
import type { AreaSpectra, TrackSpectrum } from './spectraApi';
import {
  chartLabel,
  chartModel,
  colourText,
  comparedText,
  distanceText,
  pct,
  reflectedRange,
  starScatter,
  steadyText,
  VERDICT_WORDS,
  verdictLine,
  type ChartModel,
} from './spectrumWords';
import { whenUtc } from './RealAreaNotes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null;
};

/** The verdict under the card header: a status dot, the card title and one muted line. */
export function SpectrumVerdictLine({ spectrum, matched }: { spectrum: TrackSpectrum; matched: boolean }) {
  const w = VERDICT_WORDS[spectrum.verdict];
  return (
    <div className="sx-sp-verdict" data-tone={w.tone} data-testid="spectrum-verdict" data-verdict={spectrum.verdict}>
      <b>{w.title}</b>
      <span>{verdictLine(spectrum, matched)}</span>
    </div>
  );
}

/** The dot and word at the end of a results row. */
export function SpectrumRowWord({ spectrum }: { spectrum: TrackSpectrum }) {
  const w = VERDICT_WORDS[spectrum.verdict];
  return (
    <span className="sx-sp-word" data-tone={w.tone} data-testid="spectrum-word" data-verdict={spectrum.verdict}>
      {w.word}
    </span>
  );
}

// ---- Chart -------------------------------------------------------------------------------------

const W = 328;
const H = 186;
const L = 34;
const R = 8;
const T = 18;
const B = 24;

function ticksLabel(m: ChartModel, y: number): string {
  if (!m.measuredOnly) return `${y}×`;
  return y >= 1000 ? `${(y / 1000).toFixed(y % 1000 === 0 ? 0 : 1)}k` : `${Math.round(y)}`;
}

export function SpectrumChart({ trackId, model, verdict }: { trackId: string; model: ChartModel; verdict: TrackSpectrum['verdict'] }) {
  const m = model;
  const sx = (x: number) => L + ((x - m.x0) / (m.x1 - m.x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - m.y0) / (m.y1 - m.y0)) * (H - T - B);
  const poly = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('L') + 'Z';
  return (
    <svg
      className="sx-sp-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={chartLabel(trackId, m, verdict)}
      data-testid="spectrum-chart"
      data-measured-only={m.measuredOnly || undefined}
    >
      {m.yTicks.map((y) => (
        <g key={`y${y}`}>
          <line className="gr" x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} />
          <text x={L - 6} y={sy(y) + 3} textAnchor="end">
            {ticksLabel(m, y)}
          </text>
        </g>
      ))}
      {m.xTicks.map((x) => (
        <text key={`x${x}`} x={sx(x)} y={H - 8} textAnchor="middle">
          {x} µm
        </text>
      ))}
      <line className="ax" x1={L} x2={W - R} y1={sy(0)} y2={sy(0)} />
      <text x={0} y={9} data-testid="spectrum-ylabel">
        {m.yLabel}
      </text>
      {m.glow && <path className="glow" d={poly(m.glow)} data-testid="spectrum-glow" />}
      {m.band && (
        <>
          <path className="band" d={poly(m.band)} data-testid="spectrum-band" />
          <text className="bandlbl" x={sx(2.47)} y={sy(m.band[2]![1]) - 4}>
            rocks
          </text>
        </>
      )}
      {!m.measuredOnly && (
        <>
          <line className="sun" x1={L} x2={W - R} y1={sy(1)} y2={sy(1)} data-testid="spectrum-sun" />
          <text x={sx(1.55)} y={sy(1) + 12}>
            Sun
          </text>
        </>
      )}
      {m.points.map((p) => (
        <g key={p.dotId}>
          {Math.abs(sy(p.y - p.err) - sy(p.y + p.err)) > 6 && (
            <line className="eb" x1={sx(p.x)} x2={sx(p.x)} y1={sy(Math.max(p.y - p.err, m.y0))} y2={sy(Math.min(p.y + p.err, m.y1))} data-testid="spectrum-errbar" />
          )}
          <circle className={p.visitIdx > 0 ? 'pt v2' : 'pt'} cx={sx(p.x)} cy={sy(Math.min(p.y, m.y1))} r={3.2} data-testid="spectrum-point" />
        </g>
      ))}
      {m.limits.map((l, k) => {
        const x = sx(l.x);
        const y = sy(l.y);
        return (
          <g key={`lim${k}`} data-testid="spectrum-limit">
            <line className="lim" x1={x} x2={x} y1={y} y2={y - 12} />
            <line className="lim" x1={x - 4} x2={x + 4} y1={y} y2={y} />
            <path className="limh" d={`M${x - 3.5},${y - 10}L${x + 3.5},${y - 10}L${x},${y - 16}Z`} />
          </g>
        );
      })}
    </svg>
  );
}

function ChartKey({ model, rAu }: { model: ChartModel; rAu: number | null }) {
  const m = model;
  return (
    <div className="sx-sp-key" data-testid="spectrum-key">
      {m.visits.map((v, k) => {
        const day = dayMonth(v.time);
        return (
          <span key={`v${k}`}>
            <i className={k > 0 ? 'v2' : undefined} aria-hidden="true" />
            {`Visit ${v.visit ?? k + 1}${day ? ` · ${day}` : ''}`}
          </span>
        );
      })}
      {m.limits.length > 0 && (
        <span>
          <i className="lim" aria-hidden="true" />
          At least this red
        </span>
      )}
      {m.band && (
        <span>
          <i className="band" aria-hidden="true" />
          Where rocks fall
        </span>
      )}
      {m.glow && (
        <span>
          <i className="band glow" aria-hidden="true" />
          {rAu !== null ? `Heat glow at ${rAu.toFixed(2)} AU` : 'Heat glow'}
        </span>
      )}
    </div>
  );
}

// ---- Card section ------------------------------------------------------------------------------

export interface SpectrumBlockProps {
  spectrum: TrackSpectrum;
  spectra: Pick<AreaSpectra, 'calibration' | 'method' | 'provenance'>;
  /** A dot's flags from the area's `/dots` (Points used). */
  flags: (dotId: string) => readonly string[];
  measuredOnly: boolean;
  /** Synthetic fixture data: never wears the Measured badge. */
  fixture: boolean;
}

/** The Spectrum section (chart and key); none for `one_colour`, nothing to compare. */
export function SpectrumSection({ spectrum: t, spectra, measuredOnly, fixture }: Omit<SpectrumBlockProps, 'flags'>) {
  if (t.verdict === 'one_colour') return null;
  const model = chartModel(t, reflectedRange(spectra.method), measuredOnly);
  if (model.points.length === 0 && model.limits.length === 0) return null;
  const tag = measuredOnly ? spectra.provenance.points.tag : spectra.provenance.colour.tag;
  return (
    <section className="sx-sp-sec" aria-labelledby={`sp-h-${t.track_id}`} data-testid="spectrum-section">
      <h3 id={`sp-h-${t.track_id}`}>
        Spectrum
        <ProvenanceBadge
          tag={tag}
          variant="tag"
          fixture={fixture}
          // The first word follows the reply's tag, so the tooltip never disagrees with the badge.
          tooltip={
            measuredOnly
              ? `${badgeForTag(tag)}: each dot’s brightness as SPHEREx recorded it.`
              : `${badgeForTag(tag)}: brightness divided by the Sun’s, compared with the range where rocks fall (A17.13). The points themselves are measured.`
          }
        />
      </h3>
      <SpectrumChart trackId={t.track_id} model={model} verdict={t.verdict} />
      <ChartKey model={model} rAu={t.r_au} />
    </section>
  );
}

/** The rows under the chart, as `<dt>`/`<dd>` pairs for the card's facts list. */
export function SpectrumFacts({ spectrum: t, spectra, measuredOnly }: Pick<SpectrumBlockProps, 'spectrum' | 'spectra' | 'measuredOnly'>) {
  const colour = colourText(t);
  const steady = measuredOnly ? null : steadyText(t);
  const distance = measuredOnly ? null : distanceText(t);
  const showColour = t.verdict !== 'one_colour' && colour !== null;
  return (
    <>
      {showColour && (
        <>
          <dt>Colour</dt>
          <dd data-testid="spectrum-colour">{colour}</dd>
        </>
      )}
      {steady && (
        <>
          <dt>Steady</dt>
          <dd data-testid="spectrum-steady">{steady}</dd>
        </>
      )}
      {distance && (
        <>
          <dt>Distance</dt>
          <dd data-testid="spectrum-distance">{distance}</dd>
        </>
      )}
      {showColour && !measuredOnly && (
        <>
          <dt>Compared with</dt>
          <dd data-testid="spectrum-compared">{comparedText(spectra.calibration)}</dd>
        </>
      )}
    </>
  );
}

const RHO_LATEX = String.raw`\rho = \dfrac{F_{\mathrm{long}} / F_{\mathrm{short}}}{F_{\odot,\mathrm{long}} / F_{\odot,\mathrm{short}}}`;
const RHO_PLAIN = 'rho equals F long over F short, divided by F sun long over F sun short';

/** "How this is checked" and "Points used n", the same on every track card. */
export function SpectrumHow({ spectrum: t, spectra, flags }: Pick<SpectrumBlockProps, 'spectrum' | 'spectra' | 'flags'>) {
  const scatter = starScatter(spectra.calibration);
  const fallback = spectra.method.settings.sigma_sys_default;
  const floor =
    scatter !== null
      ? `plus the ${pct(scatter)} scatter we measure on stars`
      : typeof fallback === 'number'
        ? `plus a ${pct(fallback)} allowance for the instrument`
        : 'plus an allowance for the instrument';
  const snrMin = spectra.method.settings.snr_min;
  const rows = t.points
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time) || a.lambda_um - b.lambda_um)
    .map((p) => ({ p, f: flags(p.dot_id) }));
  return (
    <div className="sx-sp-acc">
    <Rows>
      <Row title="How this is checked" testId="spectrum-how">
        <ol className="sx-sp-rules">
          <li>
            <b>Two detectors at once.</b> Each exposure sees the mover at a short and a long wavelength at the same moment, so
            spin and distance cancel out of their ratio.
          </li>
          <li>
            <b>Compared with the Sun.</b> The ratio is divided by the Sun’s own ratio at the same two wavelengths:
            <FormulaMath latex={RHO_LATEX} plain={RHO_PLAIN} testId="spectrum-formula" />
            Grey rocks give about 1; red rocks up to about 3. A warm body adds heat glow at the long end, more the closer it is
            to the Sun, so a track’s distance from its parallax sets how red it may be. Stars in the same frames check the
            calibration.
          </li>
          <li>
            <b>Steady between exposures.</b> Exposures are 2 minutes apart. Asteroids larger than about 200 m spin no faster
            than once per 2.2 hours, so their brightness can change only about 10% in that time, {floor}.
          </li>
        </ol>
        <p className="sx-sp-src">
          Sources: Pravec and Harris 2000 (spin limit); Harris 1998 (heat glow model, NEATM).
        </p>
      </Row>
      <Row title="Points used" count={t.points.filter((p) => p.used).length} testId="spectrum-points">
        <ul className="sx-sp-points" data-testid="spectrum-points-list">
          {rows.map(({ p, f }) => (
            <li key={p.dot_id} data-used={p.used || undefined}>
              <span>
                {whenUtc(p.time)} · D{p.detector} · {p.lambda_um.toFixed(2)} µm
              </span>
              <span>
                {Math.round(p.flux_uJy)} ± {Math.round(p.flux_err)} µJy · SNR {p.snr.toFixed(1)}
                {f.length > 0 ? ` · ${f.join(', ')}` : ''}
                {p.used
                  ? p.point
                    ? ''
                    : ' · used as a limit only'
                  : !p.point
                    ? ` · not used: below SNR ${typeof snrMin === 'number' ? snrMin : 'the minimum'}`
                    : ' · not used: no pair or step'}
              </span>
            </li>
          ))}
        </ul>
      </Row>
    </Rows>
    </div>
  );
}
