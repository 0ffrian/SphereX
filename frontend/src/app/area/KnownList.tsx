// Known objects: the right-side card after the island's search (mock-up `openKnownCard`).
// A prepared area's `/v1/areas/{id}/known` reply (Q-205, A18.5; issues #96, #130): one row per object
// with its number and name, kind, frames and visits and the Estimated badge (SkyBoT and Horizons,
// A16.5); the card's foot says when the area ran, when SkyBoT last answered, and what is missing.
// "Track it" opens the Eros card when the backend can Track the object offline; otherwise "Open"
// searches it as a marker's left click does. Else DEMO DATA: the one object, only for an area over
// the prepared Eros area, under the Demo tag; anywhere else the card says there is no prepared data
// (Q-414).
import { PanelCard } from '@/app/shell/PanelCard';
import { DEMO_OBJECT_ID, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import { ProvenanceBadge } from '@/app/Badge';
import { latestSkybot, type KnownObject } from './areaService';
import { DemoTag } from './DemoTag';
import { isoToMjd, mjdDay, mjdYear } from './erosModel';
import { RealAreaNotes } from './RealAreaNotes';

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

/**
 * True when "Track it" opens the Eros card. The demo object (433 Eros) is always trackable: the card
 * falls back to its demo frames, and the committed pack still answers `track_available: false` for it
 * until backend #129 lands.
 */
export function canTrack(o: KnownObject): boolean {
  return (o.trackAvailable ?? false) || o.objectId === DEMO_OBJECT_ID;
}

function Row({ o }: { o: KnownObject }) {
  const track = canTrack(o);
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
  const real = known?.real ?? null;
  // SkyBoT answers per visit of the area, not per object (A17.5): one date for the whole card.
  const skybotAt = real ? latestSkybot(real.known) : null;
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
      ) : real ? (
        <>
          <RealAreaNotes
            computedAt={real.known.computed_at}
            synthetic={real.synthetic}
            missing={real.missing}
          />
          <p className="fb-muted" data-testid="known-skybot">
            {skybotAt ? `SkyBoT last answered ${dateOf(skybotAt)}` : 'No SkyBoT answer for this area'}
          </p>
        </>
      ) : known?.demo ? (
        <div className="sx-kn-foot">
          <DemoTag />
        </div>
      ) : null}
      {!refusal && known && (
        <div className="sx-lk-list" data-testid="known-list">
          {known.objects.map((o) => (
            <Row key={o.designation ?? o.id} o={o} />
          ))}
        </div>
      )}
      {!refusal && known && known.objects.length === 0 && (
        <p className="fb-muted" role="status" data-testid="known-none">
          No known objects crossed this area.
        </p>
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
