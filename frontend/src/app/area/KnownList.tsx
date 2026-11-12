// Known objects: the right-side card after the island's search (mock-up `openKnownCard`).
// Real data (issue #130, A18.5): one row per object of `/v1/areas/{id}/known` with its number and
// name, kind, frames and visits, the Estimated badge (SkyBoT and Horizons, A16.5) and the date of the
// SkyBoT answer. "Track it" opens the Eros card when the backend can Track the object offline;
// otherwise "Open" searches it as a marker's left click does. Only the fixed fallback row (backend
// unreachable) wears the Demo tag. A box with no prepared area says so (Q-414).
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import { ProvenanceBadge } from '@/app/Badge';
import { areaMissingNote } from '@/app/refusals';
import type { KnownObject } from './areaService';
import { DemoTag } from './DemoTag';
import { isoToMjd, mjdDay, mjdYear } from './erosModel';

export const NO_TRACK_NOTE = 'Track not prepared for this object offline';
const ESTIMATED_NOTE =
  'Estimated: candidates from SkyBoT, positions from JPL Horizons as seen from SPHEREx. Orbit solutions as of the answer date, not a measurement.';

/** "12 Nov 2026" (UTC) from an ISO time. */
const dateOf = (iso: string): string => `${mjdDay(isoToMjd(iso))} ${mjdYear(isoToMjd(iso))}`;

/** A click on "Open": the same search a marker's left click makes (Q-120), the object panel opens. */
export function openObject(o: KnownObject): void {
  useShellStore.getState().cancelCard();
  void useAppStore.getState().skySearch({ q: o.designation ?? `${o.id} ${o.name}`.trim(), kind: 'name', origin: 'sky' });
}

function Row({ o }: { o: KnownObject }) {
  const track = o.trackAvailable ?? false;
  return (
    <button
      type="button"
      className="sx-lk-row"
      onClick={() => (track ? useAreaStore.getState().openEros(o) : openObject(o))}
      data-testid="known-row"
      data-track={track ? 'yes' : 'no'}
    >
      <b>{o.name ? o.id : ''}</b>
      <span>
        {o.name || o.id}
        <small>
          {o.kind} · {o.frames} frames in {o.visits} visits
        </small>
        {!o.designation ? null : (
          <small className="sx-lk-meta" data-testid="known-meta">
            <ProvenanceBadge tag="model_dependent" tooltip={ESTIMATED_NOTE} srText variant="tag" />
            {o.skybotAt ? <span>SkyBoT answered {dateOf(o.skybotAt)}</span> : <span>No SkyBoT answer</span>}
          </small>
        )}
        {!track && <small data-testid="known-no-track">{NO_TRACK_NOTE}</small>}
      </span>
      <span className="sx-chip" data-tone={track ? 'ok' : undefined}>
        {track ? 'Track it' : 'Open'}
      </span>
    </button>
  );
}

export function KnownList() {
  const known = useAreaStore((s) => s.known);
  const refusal = useAreaStore((s) => s.refusal);
  const closePanel = useShellStore((s) => s.closePanel);
  const notes = (known?.missing ?? []).filter((c) => c !== 'area:not_prepared');
  return (
    <PanelCard
      title="Known objects"
      subtitle="In this area"
      icon="area"
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-known"]'
      testId="area-card"
    >
      {refusal ? (
        <p className="fb-muted" role="status" data-testid="area-refused" data-code={refusal.code}>
          {refusal.message}
        </p>
      ) : (
        <div className="sx-kn-foot">
          {known?.demo && <DemoTag />}
          {known?.fixture && (
            <span className="sx-tagbadge" data-testid="known-fixture" title="Synthetic fixture data for development, not a SPHEREx result">
              Fixture
            </span>
          )}
        </div>
      )}
      {!refusal && (
        <div className="sx-lk-list" data-testid="known-list">
          {(known?.objects ?? []).map((o) => (
            <Row key={o.designation ?? o.id} o={o} />
          ))}
        </div>
      )}
      {!refusal && known && known.objects.length === 0 && (
        <p className="fb-muted" role="status" data-testid="known-none">
          No known objects crossed this area.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="fb-muted sx-lk-notes" data-testid="known-missing">
          {notes.map((c) => (
            <li key={c} data-code={c}>
              {areaMissingNote(c)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sx-btn sx-btn-ghost"
          data-testid="area-redraw"
          onClick={() => useAreaStore.getState().redraw()}
        >
          Draw again
        </button>
      </div>
    </PanelCard>
  );
}
