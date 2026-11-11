// Known objects: the right-side card after the island's search (mock-up `openKnownCard`).
// DEMO DATA (areaService.knownObjectsIn): the same one object for any square.
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { DemoTag } from './DemoTag';

export function KnownList() {
  const known = useAreaStore((s) => s.known);
  const closePanel = useShellStore((s) => s.closePanel);
  return (
    <PanelCard
      title="Known objects"
      subtitle="In this square"
      icon="area"
      onClose={closePanel}
      returnFocusTo='[data-testid="tool-known"]'
      testId="area-card"
    >
      <div className="sx-kn-foot">
        <DemoTag />
      </div>
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
