// Discovery (mock-up `openDiscoveryCard`, `arRenderSteps`, `arRenderList`): a compact step list
// that runs on its own (a loader on the current step, a tick on the done ones), then the movers it
// found. The dots and movers draw inside the square on the sky (AreaTrackLayer). DEMO DATA: the
// steps, counts and movers come from areaService.discoverIn and are not a search of the square.
import GridLoader from '@/app/island/GridLoader';
import { FETCHING_LOOK, SEARCHING_LOOK } from '@/app/island/loaderLooks';
import { PanelCard } from '@/app/shell/PanelCard';
import { formatAreaDims, useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { DemoTag } from './DemoTag';
import { ErosCard, MoverDemoCard } from './ErosCard';

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
  const closePanel = useShellStore((s) => s.closePanel);
  const steps = disc?.steps ?? [];
  const total = steps.length;
  const nowStep = running ? step + 1 : -1;
  const announce =
    total === 0
      ? ''
      : running && steps[nowStep]
        ? `Step ${nowStep + 1} of ${total}: ${steps[nowStep]!.label}`
        : step >= total - 1
          ? `${disc?.movers.length ?? 0} movers found`
          : '';
  return (
    <PanelCard
      title="Discovery"
      subtitle={box ? `Area · ${formatAreaDims(box)}` : 'Area'}
      icon="area"
      onClose={closePanel}
      returnFocusTo='[data-testid="tool-area"]'
      testId="area-card"
    >
      <div className="sx-kn-foot">
        <DemoTag />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {total === 0 && (
        <div className="fb-muted sx-ar-wait">
          <GridLoader {...SEARCH_ROW} />
          Loading the demo…
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
              <span>{m.pts.length < 2 ? 'Seen in 1 visit' : 'Moves across both visits'}</span>
              {m.known ? (
                <span className="sx-chip" data-tone={step < 4 ? undefined : 'ok'}>
                  {step < 4 ? 'checking' : `Known: ${m.known}`}
                </span>
              ) : m.pts.length < 2 ? (
                <span className="sx-chip">Seen once</span>
              ) : (
                <span className="sx-chip" data-tone="warn">
                  Unexplained
                </span>
              )}
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
  const title = m.known ? `${m.id} · ${m.known}` : m.id;
  if (m.kind === 'known') return <ErosCard title={title} back={openDisc} />;
  return (
    <MoverDemoCard
      title={title}
      kind={m.pts.length < 2 ? 'Seen once' : 'Unexplained'}
      frames={m.pts.length < 2 ? 4 : 8}
      back={openDisc}
    />
  );
}
