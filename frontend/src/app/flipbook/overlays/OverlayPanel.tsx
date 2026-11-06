// Overlay controls and everything said about them under the flipbook (issue #12): the toggles,
// loading and error states, catalogue tables and epochs, badges (D-02), the flag legend, the field
// of view map, a text list of the markers (R9) and the refused parts (`missing`, A11). Overlays
// are optional: a failed request shows its own error box and never stops the flipbook.
import { useMemo } from 'react';
import type { Frame, OverlayCatalogName } from '@/app/api/types';
import { overlaysErrorMessage } from '@/app/messages';
import { RefusalList } from '@/app/RefusalList';
import { groupMissing } from '@/app/refusals';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { buttonClass, pressedClass } from '@/app/ui';
import { useAppStore, type OverlayLayer, type SkyState } from '@/state/store';
import { FieldOfView } from './FieldOfView';
import { FlagLegend } from './FlagMask';
import { MARKER_STYLE } from './MarkerLayer';
import { provenanceOf, type OverlayView } from './model';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  CATALOG_LABEL,
  catalogPending,
  catalogPendingText,
  catalogUnavailableReason,
  contaminationLines,
  describeCatalog,
  findCatalog,
  formatMag,
  sourceNoun,
  sourcesById,
} from './text';

const TOGGLES: readonly { layer: OverlayLayer; label: string }[] = [
  { layer: 'gaia', label: 'Gaia stars' },
  { layer: 'wise', label: 'WISE sources' },
  { layer: 'flags', label: 'Flagged pixels' },
  { layer: 'fov', label: 'Field of view' },
];

export function OverlayControls({ sky, view }: { sky: SkyState; view: OverlayView | null }) {
  const toggle = useAppStore((s) => s.skyToggleOverlay);
  const reload = useAppStore((s) => s.skyLoadOverlays);
  const { overlays } = sky;
  const reasons = TOGGLES.flatMap(({ layer }) => {
    if (!view || (layer !== 'gaia' && layer !== 'wise')) return [];
    const why = catalogUnavailableReason(view.data, layer);
    return why ? [{ layer, why }] : [];
  });
  const reasonOf = (layer: OverlayLayer) => reasons.find((r) => r.layer === layer)?.why ?? null;
  // A switched-on catalogue the backend was still fetching: enabled, with a "Try again" button.
  const pending = view
    ? (['gaia', 'wise'] as const).filter((c) => overlays.toggles[c] && catalogPending(view.data, c))
    : [];
  const loading = overlays.status === 'loading';

  return (
    <div className="flex flex-col gap-2" data-testid="overlay-controls">
      <div role="group" aria-label="Overlays" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-300" aria-hidden="true">
          Overlays:
        </span>
        {TOGGLES.map(({ layer, label }) => {
          const why = reasonOf(layer);
          return (
            <button
              key={layer}
              type="button"
              className={`${buttonClass} ${pressedClass} gap-2`}
              aria-pressed={why === null && overlays.toggles[layer]}
              disabled={why !== null}
              aria-describedby={why ? `overlay-reason-${layer}` : undefined}
              onClick={() => toggle(layer)}
              data-testid={`overlay-toggle-${layer}`}
            >
              {(layer === 'gaia' || layer === 'wise') && <MarkerIcon catalog={layer} />}
              {label}
            </button>
          );
        })}
      </div>
      {reasons.map(({ layer, why }) => (
        <p
          key={layer}
          id={`overlay-reason-${layer}`}
          className="text-sm text-neutral-400"
          data-testid="overlay-reason"
        >
          {why}
        </p>
      ))}
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="overlay-pending">
          {pending.map((c) => (
            <p key={c} className="text-sm text-neutral-300" data-testid="overlay-pending-line">
              {catalogPendingText(c)}
            </p>
          ))}
          <button
            type="button"
            className={buttonClass}
            disabled={loading}
            onClick={() => void reload()}
            data-testid="overlay-retry"
          >
            Try again
          </button>
        </div>
      )}
      {loading && <LoadingBox text="Loading overlays…" startedAt={null} />}
      {overlays.status === 'error' && overlays.error && (
        <ErrorBox
          message={overlaysErrorMessage(overlays.error)}
          detail={overlays.error.detail}
          onRetry={() => void reload()}
        />
      )}
    </div>
  );
}

/** The marker shape in the button, so the legend is the control itself. */
function MarkerIcon({ catalog }: { catalog: OverlayCatalogName }) {
  const s = MARKER_STYLE[catalog];
  return (
    <svg viewBox="-8 -8 16 16" className="size-4" aria-hidden="true">
      {s.shape === 'circle' ? (
        <circle r={6} fill="none" stroke={s.colour} strokeWidth={2} />
      ) : (
        <path d="M0 -6 L6 0 L0 6 L-6 0 Z" fill="none" stroke={s.colour} strokeWidth={2} />
      )}
    </svg>
  );
}

/** Contamination of the photometry for this frame, under the frame caption. Nothing when empty. */
export function ContaminationNote({ view, fixture }: { view: OverlayView; fixture: boolean }) {
  const entry = provenanceOf(view.data, 'contamination');
  if (!view.show.contamination || !view.frame || !entry) return null;
  const lines = contaminationLines(view.frame.contamination, view.data);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm" data-testid="contamination">
      <ul role="list" className="flex flex-col text-amber-100">
        {lines.map((line) => (
          <li key={line} className="list-none" data-testid="contamination-line">
            {line}
          </li>
        ))}
      </ul>
      <ProvenanceBadge entry={entry} fixture={fixture} />
    </div>
  );
}

export function OverlayDetails({
  view,
  sky,
  frame,
  index,
  center,
  flagFailed,
}: {
  view: OverlayView;
  sky: SkyState;
  frame: Frame;
  index: number;
  center: { ra: number; dec: number };
  flagFailed: boolean;
}) {
  const { data, show } = view;
  const fixture = sky.fixture;
  const toggles = sky.overlays.toggles;
  const missingGroups = useMemo(() => groupMissing(view.missing), [view.missing]);
  const catalogsShown = (['gaia', 'wise'] as const).filter((c) => show[c]);
  const frameLabel = `frame ${index + 1}`;
  const positions = provenanceOf(data, 'catalog_positions');
  const mags = provenanceOf(data, 'catalog_mags');
  const placement = provenanceOf(data, 'markers');
  const flagsTag = provenanceOf(data, 'flags_mask');
  const footprintTag = provenanceOf(data, 'footprint');
  const boxTag = provenanceOf(data, 'cutout_box');

  return (
    <div className="flex flex-col gap-3 text-sm text-neutral-300" data-testid="overlay-details">
      {catalogsShown.length > 0 && positions && mags && placement && (
        <div className="flex flex-col gap-1" data-testid="catalog-info">
          {catalogsShown.map((name) => {
            const c = findCatalog(data, name);
            return c ? (
              <p key={name} data-testid="catalog-line">
                <span className="font-medium text-neutral-200">{CATALOG_LABEL[name]}:</span>{' '}
                {describeCatalog(c)}
              </p>
            ) : null;
          })}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              Positions <ProvenanceBadge entry={positions} fixture={fixture} />
            </span>
            <span className="flex items-center gap-1.5">
              Magnitudes <ProvenanceBadge entry={mags} fixture={fixture} />
            </span>
            <span className="flex items-center gap-1.5">
              Marker placement <ProvenanceBadge entry={placement} fixture={fixture} />
            </span>
          </p>
          <MarkerList view={view} catalogs={catalogsShown} frameLabel={frameLabel} />
        </div>
      )}
      {show.flags && flagsTag && (
        <FlagLegend
          groups={data.flag_groups}
          provenance={flagsTag}
          fixture={fixture}
          failed={flagFailed}
        />
      )}
      {show.fov && footprintTag && boxTag && view.frame && (
        <FieldOfView
          frame={view.frame}
          center={center}
          footprintTag={footprintTag}
          boxTag={boxTag}
          fixture={fixture}
          frameLabel={frameLabel}
        />
      )}
      {(toggles.gaia || toggles.wise || toggles.flags || toggles.fov) && !view.frame && (
        <p data-testid="overlay-no-frame">
          The overlays reply has nothing for {frameLabel} ({frame.frame_id}).
        </p>
      )}
      <RefusalList
        groups={missingGroups}
        lead="Overlay parts not shown:"
        testId="overlay-missing"
      />
    </div>
  );
}

/** R9: the markers drawn on this frame as text, behind a disclosure. */
function MarkerList({
  view,
  catalogs,
  frameLabel,
}: {
  view: OverlayView;
  catalogs: readonly OverlayCatalogName[];
  frameLabel: string;
}) {
  const byId = useMemo(() => sourcesById(view.data), [view.data]);
  const markers = (view.frame?.markers ?? []).filter((m) => catalogs.includes(m.catalog));
  return (
    <details data-testid="marker-list">
      <summary className="min-h-11 cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-sky-400">
        Catalogue sources on {frameLabel} ({markers.length})
      </summary>
      {markers.length === 0 ? (
        <p>None of the shown catalogues has a source on this frame.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-0.5">
          {markers.map((m) => {
            const band = findCatalog(view.data, m.catalog)?.mag_band ?? '';
            const mag = byId.get(`${m.catalog}:${m.id}`)?.mag ?? null;
            return (
              <li key={`${m.catalog}:${m.id}`} className="list-none" data-testid="marker-item">
                {CATALOG_LABEL[m.catalog]} {sourceNoun(m.catalog, 1)} {m.id}, {formatMag(band, mag)}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
