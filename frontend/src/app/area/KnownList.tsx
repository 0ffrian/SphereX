// Known objects: the right-side card after the island's search (mock-up `openKnownCard`).
// DEMO DATA (areaService.knownObjectsIn): the one object, only for an area over the prepared Eros area;
// anywhere else the card says there is no prepared data (Q-414).
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { DemoTag } from './DemoTag';

export function KnownList() {
  const known = useAreaStore((s) => s.known);
  const refusal = useAreaStore((s) => s.refusal);
  const closePanel = useShellStore((s) => s.closePanel);
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
          <DemoTag />
        </div>
      )}
      {!refusal && (
        <div className="sx-lk-list" data-testid="known-list">
          {(known?.objects ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="sx-lk-row"
              onClick={() => useAreaStore.getState().openEros()}
              data-testid="known-eros"
            >
              <b>{o.id}</b>
              <span>
                {o.name}
                <small>
                  {o.kind} · {o.frames} frames in {o.visits} visits
                </small>
              </span>
              <span className="sx-chip" data-tone="ok">
                Track it
              </span>
            </button>
          ))}
        </div>
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
