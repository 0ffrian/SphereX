// The flipbook's colour views (colourMode.ts): the Raw | Colour switch, the wavelength tint's
// legend, and the SPHEREx colour composite (one RGB picture from three aligned frames, built by the
// backend). Both colour views are false colour, `derived`, with the Estimated badge (D-02, Q-27).
import { useEffect, useId, useMemo, useState } from 'react';
import type { CompositeBand, CompositeResponse } from '@/app/api/types';
import { DataBadge, EstimatedBadge } from '@/app/Badge';
import { formatUtc, formatWavelength } from '@/app/format';
import {
  COMPOSITE_NO_FORMULA,
  COMPOSITE_NO_REASON,
  COMPOSITE_REFUSED,
  COMPOSITE_REFUSED_NEXT,
  compositeErrorMessage,
  compositeWaitingText,
} from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { groupCompositeMissing } from '@/app/refusals';
import { Segmented } from '@/app/Segmented';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { framesFetching, useAppStore } from '@/state/store';
import { framesCounts } from './progressive';
import { legendPosition, tintFormula, type ColourChoice, type ColourView } from './colourMode';
import { SPHEREX_MAX_UM, SPHEREX_MIN_UM, wavelengthGradient } from './wavelengthColor';

export function ColourControls({
  choice,
  onChange,
}: {
  choice: ColourChoice;
  onChange(c: ColourChoice): void;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="colour-controls">
      <Segmented
        label="Picture"
        value={choice.on ? 'colour' : 'raw'}
        options={[
          { value: 'raw', label: 'Raw', testId: 'colour-raw' },
          { value: 'colour', label: 'Colour', testId: 'colour-on' },
        ]}
        onChange={(v) => onChange({ ...choice, on: v === 'colour' })}
        testId="colour-switch"
      />
      {choice.on && (
        <Segmented<ColourView>
          label="Colour view"
          value={choice.view}
          options={[
            { value: 'tint', label: 'Wavelength tint', testId: 'colour-tint' },
            { value: 'composite', label: 'SPHEREx composite', testId: 'colour-composite' },
          ]}
          onChange={(view) => onChange({ on: true, view })}
          testId="colour-view"
        />
      )}
    </div>
  );
}

/** Colour scale over the SPHEREx range with the current frame's wavelength marked. */
export function TintLegend({ wavelengthUm, stretch }: { wavelengthUm: number; stretch: string }) {
  const at = legendPosition(wavelengthUm, SPHEREX_MIN_UM, SPHEREX_MAX_UM) * 100;
  return (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid="tint-legend">
      <span className="flex flex-wrap items-center gap-2">
        Tint shows each frame’s wavelength (false colour)
        <EstimatedBadge tooltip={tintFormula(stretch)} />
      </span>
      <div className="relative h-3 w-full max-w-xs" aria-hidden="true">
        <div className="h-3 w-full rounded-sm" style={{ background: wavelengthGradient() }} />
        <span
          className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-sm border border-black bg-white"
          style={{ left: `${at}%` }}
          data-testid="tint-legend-marker"
        />
      </div>
      <div className="flex w-full max-w-xs justify-between text-xs text-neutral-400">
        <span>{SPHEREX_MIN_UM} µm</span>
        <span data-testid="tint-legend-current">This frame: {formatWavelength(wavelengthUm)}</span>
        <span>{SPHEREX_MAX_UM} µm</span>
      </div>
    </div>
  );
}

const SWATCH: Readonly<Record<CompositeBand['channel'], string>> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
};
const CHANNEL_NAME: Readonly<Record<CompositeBand['channel'], string>> = {
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
};
const CHANNEL_ORDER: readonly CompositeBand['channel'][] = ['blue', 'green', 'red'];

/** The composite of the current object: loads it once (the store caches it), never blank. */
export function CompositeView({
  name,
  fixture,
  onShowSpectrum,
}: {
  name: string;
  fixture: boolean;
  onShowSpectrum(): void;
}) {
  const composite = useAppStore((s) => s.sky.composite);
  const load = useAppStore((s) => s.skyLoadComposite);
  // A composite from part of the frames could pick worse bands: built once they are all in.
  const waiting = useAppStore((s) => framesFetching(s.sky));
  const frames = useAppStore((s) => s.sky.frames);

  useEffect(() => {
    if (!waiting && composite.status === 'idle') void load();
  }, [waiting, composite.status, load]);

  return (
    <div className="flex flex-col gap-3" data-testid="composite">
      {waiting && composite.status === 'idle' && (
        <p className="text-sm text-neutral-300" data-testid="composite-waiting">
          {compositeWaitingText(frames ? framesCounts(frames) : null)}
        </p>
      )}
      {!waiting && (composite.status === 'idle' || composite.status === 'loading') && (
        <LoadingBox
          text="Building the SPHEREx colour composite… This can take a few seconds."
          startedAt={composite.startedAt}
        />
      )}
      {composite.status === 'error' && composite.error && (
        <ErrorBox
          message={compositeErrorMessage(composite.error)}
          detail={composite.error.detail}
          onRetry={() => void load()}
        />
      )}
      {composite.status === 'ready' && composite.data && (
        <CompositeResult
          data={composite.data}
          name={name}
          fixture={fixture}
          onShowSpectrum={onShowSpectrum}
        />
      )}
    </div>
  );
}

function CompositeResult({
  data,
  name,
  fixture,
  onShowSpectrum,
}: {
  data: CompositeResponse;
  name: string;
  fixture: boolean;
  onShowSpectrum(): void;
}) {
  const groups = useMemo(() => groupCompositeMissing(data.missing), [data.missing]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const bandsId = useId();

  if (data.image_url === null || data.width === null || data.height === null) {
    return (
      <div
        className="flex flex-col gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        data-testid="composite-refused"
      >
        <p>{COMPOSITE_REFUSED}</p>
        {groups.length === 0 ? (
          <p className="text-neutral-300">{COMPOSITE_NO_REASON}</p>
        ) : (
          <RefusalList groups={groups} lead="Frames not used:" testId="composite-missing" />
        )}
        <p className="text-neutral-300">{COMPOSITE_REFUSED_NEXT}</p>
      </div>
    );
  }

  const { width: w, height: h, x, y } = data;
  const bands = CHANNEL_ORDER.flatMap((c) => data.bands.filter((b) => b.channel === c));
  // Never an empty tooltip: the Estimated badge always says how the picture was made (D-02).
  const formula = data.formula ?? COMPOSITE_NO_FORMULA;
  const bandText = bands.map((b) => `${b.channel} ${formatWavelength(b.wavelength_um)}`).join(', ');
  const marker =
    x !== null && y !== null && x >= -0.5 && x <= w - 0.5 && y >= -0.5 && y <= h - 0.5
      ? { left: `${((x + 0.5) / w) * 100}%`, top: `${((y + 0.5) / h) * 100}%` }
      : null;
  const failed = failedUrl === data.image_url;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={`SPHEREx colour composite of ${name}: ${bandText}. False colour, estimated.`}
        className="relative w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-black"
        style={{ aspectRatio: `${w} / ${h}` }}
        data-testid="composite-viewer"
      >
        {failed ? (
          <p
            className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-300"
            data-testid="composite-unavailable"
          >
            The composite image could not be loaded.
          </p>
        ) : (
          <img
            src={data.image_url}
            alt={`SPHEREx colour composite of ${name}, north up, east left: ${bandText}.`}
            className="absolute inset-0 h-full w-full"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
            onError={() => setFailedUrl(data.image_url)}
            data-testid="composite-image"
          />
        )}
        {marker && !failed && (
          <button
            type="button"
            className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-sky-400"
            style={marker}
            aria-label={`Show spectrum for ${name}`}
            title={`Show spectrum for ${name}`}
            onClick={onShowSpectrum}
            data-testid="composite-marker"
          >
            <svg viewBox="0 0 40 40" className="size-9" aria-hidden="true">
              <circle cx="20" cy="20" r="15" fill="none" stroke="#0a0a0a" strokeWidth="4" />
              <circle cx="20" cy="20" r="15" fill="none" stroke="#f8fafc" strokeWidth="2" />
            </svg>
          </button>
        )}
        {fixture && (
          <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-amber-400 px-1 text-[10px] font-bold tracking-wide text-black">
            SYNTHETIC
          </span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-300">
        <span>SPHEREx colour composite (false colour)</span>
        <EstimatedBadge tooltip={formula} />
      </p>
      <p className="text-sm text-neutral-400" data-testid="composite-orientation">
        North up, east left (as on a sky chart)
        {data.scale_arcsec_px !== null && ` · ${data.scale_arcsec_px}″ per pixel`} · Data release:{' '}
        {data.data_release}
      </p>
      <p id={bandsId} className="text-sm text-neutral-300">
        Which wavelength each colour shows:
      </p>
      <ul
        role="list"
        aria-labelledby={bandsId}
        className="flex flex-col gap-1 text-sm"
        data-testid="composite-bands"
      >
        {bands.map((b) => (
          <li
            key={b.channel}
            className="flex list-none flex-wrap items-center gap-x-2 gap-y-1"
            data-testid="composite-band"
            data-channel={b.channel}
          >
            <span
              className="inline-block size-3 flex-none rounded-sm border border-neutral-500"
              style={{ background: SWATCH[b.channel] }}
              aria-hidden="true"
            />
            <span className="font-medium">{CHANNEL_NAME[b.channel]}:</span>
            <span>{formatWavelength(b.wavelength_um)}</span>
            {b.bandwidth_um !== undefined && (
              <span className="text-neutral-400">
                (band {formatWavelength(b.bandwidth_um)} wide)
              </span>
            )}
            <span>taken {formatUtc(b.time)}</span>
            <DataBadge fixture={fixture} />
          </li>
        ))}
      </ul>
      <RefusalList groups={groups} lead="Frames not used:" testId="composite-missing" />
    </div>
  );
}
