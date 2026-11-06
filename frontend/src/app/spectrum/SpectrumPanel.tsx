// A1.1 P0 spectrum for the clicked object (UML 09, display level 2): loading and error states,
// the provenance badge (D-02), the chart, refused items (`missing`, grouped by reason, A11) and a
// data table as the text equivalent of the chart (R9). With no points, the panel says why (Q-26);
// with some frames refused, it says which part of the frames' range the points cover. The light
// curve is parsed but not drawn in M1.
import { useEffect, useMemo, useRef } from 'react';
import { DataBadge } from '@/app/Badge';
import { formatCoords, formatNumber, formatUtc, formatWavelength } from '@/app/format';
import {
  spectrumCoverageMessage,
  spectrumEmptyMessage,
  spectrumErrorMessage,
} from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { summarizeSpectrum } from '@/app/refusals';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { buttonClass } from '@/app/ui';
import { useAppStore } from '@/state/store';
import { SpectrumChart } from './SpectrumChart';

export function SpectrumPanel() {
  const sky = useAppStore((s) => s.sky);
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);
  const seekFrame = useAppStore((s) => s.skySeekFrame);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { status, data, error } = sky.spectrum;
  const listed = sky.frames?.frames;
  const outcome = useMemo(
    () => (data ? summarizeSpectrum(data.spectrum, data.missing, listed) : null),
    [data, listed],
  );

  // Move focus to the panel when it opens, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (status === 'loading') headingRef.current?.focus();
  }, [status]);

  if (status === 'idle' || !sky.resolved) return null;
  const name = sky.resolved.name ?? formatCoords(sky.resolved.ra, sky.resolved.dec);
  const currentFrameId = sky.frames?.frames[sky.index]?.frame_id ?? null;

  return (
    <section
      aria-labelledby="spectrum-heading"
      className="flex flex-col gap-3"
      data-testid="spectrum-panel"
    >
      <h2
        id="spectrum-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-medium focus:outline-none"
      >
        Spectrum of {name}
      </h2>
      {status === 'loading' && <LoadingBox text="Measuring the spectrum…" startedAt={null} />}
      {status === 'error' && error && (
        <ErrorBox
          message={spectrumErrorMessage(error)}
          detail={error.detail}
          onRetry={() => void loadSpectrum()}
        />
      )}
      {status === 'ready' && data && outcome && (
        <>
          {outcome.points > 0 ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <DataBadge fixture={sky.fixture} />
                <span>
                  Flux per frame against wavelength, unit: {data.flux_unit}
                  {data.cached_at ? ` · Cached ${formatUtc(data.cached_at)}` : ''}
                </span>
              </p>
              {/* Q-23: no aperture correction yet, so this is not absolute photometry. */}
              <p className="text-sm text-neutral-300" data-testid="spectrum-caveat">
                Not absolute photometry: no aperture correction is applied yet, so fluxes read low
                by an amount that changes with wavelength.
              </p>
              {outcome.refused > 0 && (
                <p className="text-sm text-neutral-200" data-testid="spectrum-coverage">
                  {spectrumCoverageMessage(outcome)}
                </p>
              )}
              <SpectrumChart
                points={data.spectrum}
                fluxUnit={data.flux_unit}
                objectName={name}
                selectedFrameId={currentFrameId}
                onSelectFrame={seekFrame}
              />
            </>
          ) : (
            <>
              {/* D-02: the frame checks are SPHEREx data too, so the badge stays. */}
              <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                <DataBadge fixture={sky.fixture} />
                <span>
                  Frame checks{data.cached_at ? ` · Cached ${formatUtc(data.cached_at)}` : ''}
                </span>
              </p>
              <p className="text-sm text-neutral-200" data-testid="no-spectrum">
                {spectrumEmptyMessage(outcome)}
              </p>
            </>
          )}
          {data.spectrum.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-sky-400">
                Show data table
              </summary>
              <div className="overflow-x-auto">
                <table
                  className="min-w-full border-collapse text-left"
                  data-testid="spectrum-table"
                >
                  <caption className="sr-only">Spectrum points of {name}</caption>
                  <thead>
                    <tr className="border-b border-neutral-700">
                      <th scope="col" className="px-2 py-1">
                        Wavelength
                      </th>
                      <th scope="col" className="px-2 py-1">
                        Flux ({data.flux_unit})
                      </th>
                      <th scope="col" className="px-2 py-1">
                        1σ error
                      </th>
                      <th scope="col" className="px-2 py-1">
                        Flagged
                      </th>
                      <th scope="col" className="px-2 py-1">
                        Frame
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.spectrum.map((p) => (
                      <tr
                        key={`${p.frame_id}-${p.wavelength_um}`}
                        className="border-b border-neutral-800"
                      >
                        <td className="px-2 py-1">{formatWavelength(p.wavelength_um)}</td>
                        <td className="px-2 py-1">{formatNumber(p.flux)}</td>
                        <td className="px-2 py-1">{formatNumber(p.error)}</td>
                        <td className="px-2 py-1">
                          {p.flagged
                            ? p.flag_reasons && p.flag_reasons.length > 0
                              ? `Yes: ${p.flag_reasons.join(', ')}`
                              : 'Yes'
                            : 'No'}
                        </td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            className={`${buttonClass} text-sm`}
                            onClick={() => seekFrame(p.frame_id)}
                            aria-label={`Show the frame at ${formatWavelength(p.wavelength_um)}`}
                          >
                            Show frame
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {/* After the data table, so the chart stays next to its text equivalent (R9). */}
          <RefusalList
            groups={outcome.groups}
            lead="Frames not measured:"
            testId="spectrum-missing"
          />
        </>
      )}
    </section>
  );
}
