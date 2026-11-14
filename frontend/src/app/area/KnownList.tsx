// Known objects: the right-side card after the island's search (mock-up state 6; issues #96, #130,
// #145). A stored area's `/known` reply (Q-205, A18.5), one row per object with its number and name,
// kind and brightness. With the area's Discovery tracks beside it (Q-466), a row is Detected when a
// track found it blind, else Predicted (SkyBoT and Horizons put it here; Discovery did not find it),
// detected rows first, then by brightness, with an All / Detected / Predicted filter. Every row has
// Track it and Build it (Q-469). The provenance lines say how and when the area was computed, its
// visits and frames, and when SkyBoT last answered. Else DEMO DATA: the one object, only for an area
// over the prepared Eros area, under the Demo tag.
import { useState } from 'react';
import { PanelCard } from '@/app/shell/PanelCard';
import { DEMO_OBJECT_ID, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { latestSkybot, type KnownObject } from './areaService';
import { buildKnown } from './buildFrom';
import { DemoTag } from './DemoTag';
import { isoToMjd, mjdDay, mjdYear } from './erosModel';
import { RealAreaNotes } from './RealAreaNotes';
import { visitStarts, type RealKnown } from './realArea';
import { middleTime } from './trackJobStore';
import { AreaAlert, BoxIcon, RouteIcon } from './areaBits';

export const ESTIMATED_NOTE =
  'Estimated: candidates from SkyBoT, positions from JPL Horizons as seen from SPHEREx. Orbit solutions as of the answer date, not a measurement.';
export const PREDICTED_NOTE =
  'Predicted means SkyBoT and JPL Horizons put the object here; Discovery did not find it in the frames, usually because it is too faint. Sorted by brightness.';
export const NO_ID_NOTE = 'No JPL id for this object, so its Track cannot be computed';

/** Rows drawn at first; "Show all" draws the rest (a 144-row list stays usable, held UI issue 4). */
export const PAGE = 40;

/** "12 Nov 2026" (UTC) from an ISO time. */
const dateOf = (iso: string): string => `${mjdDay(isoToMjd(iso))} ${mjdYear(isoToMjd(iso))}`;

/**
 * True when "Track it" opens the Track view at once: the backend says the object is
 * Track-available (`track_available`, Q-461), or it is the demo object, which falls back to the
 * demo frames. Otherwise Track it computes the Track first (`trackAround`, issue #145).
 */
export function canTrack(o: KnownObject): boolean {
  return (o.trackAvailable ?? false) || o.objectId === DEMO_OBJECT_ID;
}

/**
 * The time a Track on demand is centred on (Q-468: ±3 days of the area's visits): the middle of the
 * object's own predicted frame times, else of the area's visits; null when neither is known.
 */
export function trackAround(o: KnownObject, real: RealKnown | null): string | null {
  const own = middleTime((o.positions ?? []).map((p) => p.time));
  if (own) return own;
  return real?.summary ? middleTime(visitStarts(real.summary)) : null;
}

export type KnownFilter = 'all' | 'detected' | 'predicted';

/** Pure: the rows a filter shows (the order is the list's, sortKnown). */
export function filterKnown(objects: readonly KnownObject[], f: KnownFilter): KnownObject[] {
  if (f === 'all') return objects.slice();
  return objects.filter((o) => (f === 'detected' ? !!o.detection : o.detection === null));
}

/** "asteroid · V 17.4 · 0.24 px from predicted" or "asteroid · V 17.9 · 14 frames in 2 visits". */
export function rowLine(o: KnownObject): string {
  const parts = [o.kind];
  if (o.vMag !== undefined && o.vMag !== null) parts.push(`V ${o.vMag.toFixed(1)}`);
  if (o.detection && o.detection.sepPx !== null) parts.push(`${o.detection.sepPx.toFixed(2)} px from predicted`);
  else parts.push(`${o.frames} frame${o.frames === 1 ? '' : 's'} in ${o.visits} visit${o.visits === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Track it: the Track view at once, or the Track computed first; null when it cannot be. */
export function trackAction(o: KnownObject, real: RealKnown | null, release: string): (() => void) | null {
  if (canTrack(o)) return () => useAreaStore.getState().openEros(o);
  const around = o.objectId ? trackAround(o, real) : null;
  if (!o.objectId || !around) return null;
  return () => useAreaStore.getState().openTrack(o, around, release);
}

function Chip({ o }: { o: KnownObject }) {
  if (o.detection === undefined) return <span />;
  return o.detection ? (
    <span className="sx-chip sx-chip-dot" style={{ ['--dot' as string]: 'var(--p-meas)' }} title={`Measured: Discovery found it blind (${o.detection.trackId})`} data-testid="known-chip" data-kind="detected">
      Detected
    </span>
  ) : (
    <span className="sx-chip sx-chip-dot" style={{ ['--dot' as string]: 'var(--p-phys)' }} title={ESTIMATED_NOTE} data-testid="known-chip" data-kind="predicted">
      Predicted
    </span>
  );
}

function Row({ o, real, release }: { o: KnownObject; real: RealKnown | null; release: string }) {
  const track = trackAction(o, real, release);
  const name = [o.id, o.name].filter(Boolean).join(' ');
  return (
    <div className="sx-kr" data-testid="known-row" data-track={canTrack(o) ? 'yes' : track ? 'compute' : 'no'} data-object={o.designation ?? o.id}>
      <b className="sx-kr-num">{o.name ? o.id : ''}</b>
      <span className="sx-kr-nm">
        <span>{o.name || o.id}</span>
        <small>{rowLine(o)}</small>
      </span>
      <Chip o={o} />
      <span className="sx-kr-acts">
        <button
          type="button"
          className="sx-btn-outline sx-btn-sm"
          disabled={!track}
          onClick={track ?? undefined}
          aria-label={`Track it: ${name}`}
          title={track ? (canTrack(o) ? undefined : 'Computes its Track first: a few minutes') : NO_ID_NOTE}
          data-testid="known-track"
        >
          <RouteIcon />
          Track it
        </button>
        <button
          type="button"
          className="sx-btn-outline sx-btn-sm"
          onClick={() => buildKnown(o)}
          aria-label={`Build it: ${name}`}
          data-testid="known-build"
        >
          <BoxIcon />
          Build it
        </button>
      </span>
    </div>
  );
}

export function KnownList() {
  const known = useAreaStore((s) => s.known);
  const refusal = useAreaStore((s) => s.refusal);
  const closePanel = useShellStore((s) => s.closePanel);
  const [filter, setFilter] = useState<KnownFilter>('all');
  const [all, setAll] = useState(false);
  const real = known?.real ?? null;
  // SkyBoT answers per visit of the area, not per object (A17.5): one date for the whole card.
  const skybotAt = real ? latestSkybot(real.known) : null;
  const objects = known?.objects ?? [];
  // Detected or not is known only with Discovery's tracks (Q-466); without them, no filter.
  const marked = objects.some((o) => o.detection !== undefined);
  const nDet = objects.filter((o) => !!o.detection).length;
  const shown = filterKnown(objects, marked ? filter : 'all');
  const rows = all ? shown : shown.slice(0, PAGE);
  const release = real?.entry.data_release ?? '';
  return (
    <PanelCard
      title="Known objects"
      subtitle="In this area"
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-known"]'
      testId="area-card"
    >
      <div className="sx-live sx-results" data-testid="known-card">
      {refusal ? (
        <AreaAlert refusal={refusal} />
      ) : real ? (
        <RealAreaNotes
          areaId={real.entry.area_id}
          release={real.entry.data_release}
          computedAt={real.known.computed_at}
          summary={real.summary}
          synthetic={real.synthetic}
          missing={real.missing}
        >
          <span data-testid="known-skybot">
            {skybotAt ? `SkyBoT last answered ${dateOf(skybotAt)}` : 'No SkyBoT answer for this area'}
          </span>
        </RealAreaNotes>
      ) : known?.demo ? (
        <div className="sx-kn-foot">
          <DemoTag />
        </div>
      ) : null}
      {!refusal && known && marked && objects.length > 0 && (
        <div className="sx-seg" role="group" aria-label="Show" data-testid="known-filter">
          {(
            [
              ['all', 'All', objects.length],
              ['detected', 'Detected', nDet],
              ['predicted', 'Predicted', objects.length - nDet],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setAll(false);
              }}
              data-testid={`known-filter-${id}`}
            >
              {label} {n}
            </button>
          ))}
        </div>
      )}
      {!refusal && known && (
        <div className="sx-kr-list" data-testid="known-list">
          {rows.map((o) => (
            <Row key={o.designation ?? o.id} o={o} real={real} release={release} />
          ))}
        </div>
      )}
      {!refusal && known && rows.length < shown.length && (
        <button type="button" className="sx-btn-outline" onClick={() => setAll(true)} data-testid="known-more">
          Show all {shown.length}
        </button>
      )}
      {!refusal && known && objects.length === 0 && (
        <p className="fb-muted" role="status" data-testid="known-none">
          No known objects crossed this area.
        </p>
      )}
      {!refusal && marked && objects.length > nDet && (
        <p className="fb-muted" data-testid="known-predicted-note">
          {PREDICTED_NOTE}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sx-btn-outline"
          data-testid="area-redraw"
          onClick={() => useAreaStore.getState().redraw()}
        >
          Choose another region
        </button>
      </div>
      </div>
    </PanelCard>
  );
}
