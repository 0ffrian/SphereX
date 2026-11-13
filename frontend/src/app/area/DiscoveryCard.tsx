// Discovery (mock-up `openDiscoveryCard`, `arRenderSteps`, `arRenderList`): a compact step list
// that runs on its own (a loader on the current step, a tick on the done ones), then the movers it
// found. The dots and movers draw on the sky (AreaTrackLayer). The steps, counts and movers come
// from areaService.discoverIn: a prepared area's precomputed replies (Q-205), else DEMO DATA that
// is not a search of the square.
import GridLoader from '@/app/island/GridLoader';
import { FETCHING_LOOK, SEARCHING_LOOK } from '@/app/island/loaderLooks';
import { PanelCard } from '@/app/shell/PanelCard';
import { formatAreaDims, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { DemoTag } from './DemoTag';
import { ErosCard, MoverDemoCard } from './ErosCard';
import { RealAreaNotes } from './RealAreaNotes';
import { RealTrackCard } from './RealTrackCard';
import { visitNumbers } from '@/app/sky/area/blink';
import type { DiscoveryMover } from './areaService';

/** The result chip of a mover row: the stored verdict for a prepared area, the demo's kind else. */
function MoverChip({ m, step }: { m: DiscoveryMover; step: number }) {
  if (step < 4) return m.known || m.track ? <span className="sx-chip">checking</span> : <span className="sx-chip">{m.visits < 2 ? 'Seen once' : 'Unexplained'}</span>;
  const v = m.track?.verdict;
  if (v === 'possible') return <span className="sx-chip">Possible</span>;
  if (v === 'unchecked') return <span className="sx-chip">Not checked</span>;
  if (v === 'found_blind' && !m.known) return <span className="sx-chip" data-tone="ok">Matched on file</span>;
  if (m.known) return <span className="sx-chip" data-tone="ok">{`Known: ${m.known}`}</span>;
  if (m.visits < 2) return <span className="sx-chip">Seen once</span>;
  return (
    <span className="sx-chip" data-tone="warn">
      Unexplained
    </span>
  );
}

/** smoothui's demo looks (loaderLooks.ts) at the row's size; the current step shows one of them. */
const ROW_SIZE = 19;
const SEARCH_ROW = { ...SEARCHING_LOOK, size: ROW_SIZE };
const THINK_ROW = { ...FETCHING_LOOK, size: ROW_SIZE };
const stepLook = (label: string) =>
  label.startsWith('Drop') ? THINK_ROW : SEARCH_ROW;

export function DiscoveryCard() {
  const disc = useAreaStore((s) => s.disc);
  const step = useAreaStore((s) => s.step);
  const running = useAreaStore((s) => s.running);
  const box = useAreaStore((s) => s.box);
  const refusal = useAreaStore((s) => s.refusal);
  const closePanel = useShellStore((s) => s.closePanel);
  const visit = useAreaStore((s) => s.visit);
  const real = disc?.real ?? null;
  const visits = real ? visitNumbers(real.summary, real.dots) : [];
  const steps = disc?.steps ?? [];
  const total = steps.length;
  const nowStep = running ? step + 1 : -1;
  const announce =
    total === 0
      ? ''
      : running && steps[nowStep]
        ? `Step ${nowStep + 1} of ${total}: ${steps[nowStep]!.label}`
        : step >= total - 1
          ? real && !real.tracks
            ? 'The tracks could not be loaded'
            : `${disc?.movers.length ?? 0} movers found`
          : '';
  return (
    <PanelCard
      title="Discovery"
      subtitle={box ? `Area · ${formatAreaDims(box)}` : 'Area'}
      icon="area"
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-area"]'
      testId="area-card"
    >
      {refusal ? (
        <>
          <p className="fb-muted" role="status" data-testid="area-refused" data-code={refusal.code}>
            {refusal.message}
          </p>
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
        </>
      ) : real ? (
        <RealAreaNotes computedAt={real.summary.computed_at} synthetic={real.synthetic} missing={real.missing} />
      ) : disc?.demo ? (
        <div className="sx-kn-foot">
          <DemoTag />
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {total === 0 && !refusal && (
        <div className="fb-muted sx-ar-wait">
          <GridLoader {...SEARCH_ROW} />
          Loading the area…
        </div>
      )}
      <ol className="sx-ar-steps" data-testid="disc-steps">
        {steps.map((s, k) => {
          const on = k <= step;
          const now = k === nowStep;
          return (
            <li key={s.label} data-state={on ? 'on' : now ? 'now' : undefined}>
              <i aria-hidden="true">
                {now ? (
                  <GridLoader {...stepLook(s.label)} />
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </i>
              <span>{s.label}</span>
              <small>{on ? s.result : ''}</small>
            </li>
          );
        })}
      </ol>
      {real && visits.length > 1 && step >= 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visit shown on the sky">
          <span className="fb-muted">Visit</span>
          {visits.map((v) => {
            const on = (visit ?? visits[0]) === v;
            return (
              <button
                key={v}
                type="button"
                className="sx-btn sx-btn-ghost"
                aria-pressed={on}
                data-on={on || undefined}
                onClick={() => useAreaStore.getState().setVisit(v)}
                data-testid={`area-visit-${v}`}
              >
                {on ? `${v} (shown)` : v}
              </button>
            );
          })}
        </div>
      )}
      {step >= 3 && (
        <div className="sx-lk-list" data-testid="disc-list">
          {disc?.movers.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className="sx-lk-row"
              onClick={() => useAreaStore.getState().openMover(i)}
              data-testid={`disc-mover-${m.id}`}
            >
              <b>{m.id}</b>
              <span>
                {m.visits < 2
                  ? 'Seen in 1 visit'
                  : m.track
                    ? `Moves across ${m.visits} visits`
                    : 'Moves across both visits'}
              </span>
              <MoverChip m={m} step={step} />
            </button>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

/** The card of the mover chosen in the results: T1 is Eros (real demo frames), the rest are made up. */
export function MoverCard() {
  const sel = useAreaStore((s) => s.sel);
  const disc = useAreaStore((s) => s.disc);
  const openDisc = useAreaStore((s) => s.openDisc);
  const m = disc?.movers[sel];
  if (!m) return null;
  if (m.track && disc?.real?.tracks) {
    return (
      <RealTrackCard
        track={m.track}
        provenance={disc.real.tracks.provenance}
        synthetic={disc.real.synthetic}
        back={openDisc}
      />
    );
  }
  const title = m.known ? `${m.id} · ${m.known}` : m.id;
  if (m.kind === 'known') return <ErosCard title={title} back={openDisc} />;
  return (
    <MoverDemoCard
      title={title}
      kind={m.visits < 2 ? 'Seen once' : 'Unexplained'}
      frames={m.visits < 2 ? 4 : 8}
      back={openDisc}
    />
  );
}
