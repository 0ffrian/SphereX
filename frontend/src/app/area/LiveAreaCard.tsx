// The live area card (issue #144, Q-462; mock-up states 3 to 6), for a box no prepared area holds:
//   offer      the coverage check's plan: data, visit pair, frames, time; Compute this area or Choose another region.
//   computing  steps with check marks, a count and a bar on the current step, elapsed and remaining.
//   waiting    another area is computing; this one starts next.
//   failure    a status dot, a short title and one muted line; Try again (when it can help) or Choose another region.
// Closing the card does not stop the job (liveJobStore): the area opens when it is ready.
import { useEffect, useRef } from 'react';
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { formatBoxDeg } from './aim';
import type { LiveJobStatus, LivePlan, LiveVisit } from './liveAreaApi';
import {
  aboutMinutes,
  clock,
  failureText,
  releaseName,
  stepCount,
  useLiveJobStore,
  visitsText,
  type LiveJob,
  type LiveView,
} from './liveJobStore';

const flowTitle = (flow: 'known' | 'discovery') =>
  flow === 'known' ? 'Known objects' : 'Discovery';

export function LiveAreaCard() {
  const view = useLiveJobStore((s) => s.view);
  const job = useLiveJobStore((s) => s.job);
  const busy = useLiveJobStore((s) => s.busy);
  const closePanel = useShellStore((s) => s.closePanel);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stateKey = view
    ? `${view.kind}:${view.kind === 'job' ? (job?.status?.state ?? 'starting') : ''}`
    : '';
  // The card changes state under the button just pressed (Compute, Stop, Try again), which goes
  // away: focus moves to the card's title instead of being lost to the page (WCAG 2.4.3).
  useEffect(() => {
    const a = document.activeElement;
    if (a && a !== document.body) return;
    bodyRef.current
      ?.closest('section')
      ?.querySelector<HTMLElement>('h2')
      ?.focus({ preventScroll: true });
  }, [stateKey]);
  if (!view) return null;
  const title = flowTitle(view.flow);
  const status = view.kind === 'job' ? (job?.status ?? null) : null;
  const release =
    view.kind === 'offer'
      ? releaseName(view.plan.release)
      : job?.plan
        ? releaseName(job.plan.release)
        : '';
  const subtitle =
    view.kind === 'offer'
      ? 'In this area'
      : view.kind === 'failed'
        ? `Area · ${formatBoxDeg(view.box.widthDeg, view.box.heightDeg)}`
        : [status?.state === 'queued' ? 'Waiting' : 'Computing this area', release]
            .filter(Boolean)
            .join(' · ');
  const minimise = () => useAreaStore.getState().setMinimised(true);
  return (
    <PanelCard
      title={title}
      subtitle={subtitle}
      onClose={closePanel}
      onMinimise={minimise}
      returnFocusTo={
        view.flow === 'known' ? '[data-testid="tool-known"]' : '[data-testid="tool-area"]'
      }
      testId="area-card"
    >
      <div
        ref={bodyRef}
        className="sx-live"
        data-testid="live-card"
        data-state={view.kind === 'job' ? (status?.state ?? 'starting') : view.kind}
      >
        {view.kind === 'offer' && <Offer view={view} busy={busy} />}
        {view.kind === 'job' && <Job job={job} status={status} busy={busy} onMinimise={minimise} />}
        {view.kind === 'failed' && <Failed view={view} busy={busy} />}
      </div>
    </PanelCard>
  );
}

function Offer({ view, busy }: { view: Extract<LiveView, { kind: 'offer' }>; busy: boolean }) {
  const { plan } = view;
  return (
    <>
      <p className="sx-live-p">
        This area hasn&rsquo;t been computed yet. SPHEREx covers it, so it can be computed now.
      </p>
      <dl className="sx-live-facts" data-testid="live-facts">
        <dt>Data</dt>
        <dd>{releaseName(plan.release)}</dd>
        <dt>Visits</dt>
        <dd>
          {plan.alternatives.length > 0 ? (
            <VisitPicker plan={plan} busy={busy} />
          ) : (
            visitsText(plan)
          )}
        </dd>
        <dt>Frames</dt>
        <dd>about {plan.n_frames}</dd>
        <dt>Time</dt>
        <dd>{aboutMinutes(plan.estimate_s)}</dd>
      </dl>
      <p className="sx-live-m">
        The result is kept: anyone who draws this area later sees it at once.
      </p>
      <div className="sx-live-btns">
        <button
          type="button"
          className="sx-btn-outline sx-live-primary"
          disabled={busy}
          onClick={() => void useLiveJobStore.getState().compute()}
          data-testid="live-compute"
        >
          Compute this area
        </button>
        <DrawAgain />
      </div>
    </>
  );
}

/**
 * The visit pair picker (issue #145; #141's optional pair): the closest pair is chosen first; the
 * others at most 6 h apart are offered, closest first. Another pair is another area (its own id).
 */
function VisitPicker({ plan, busy }: { plan: LivePlan; busy: boolean }) {
  const pairs = [plan.visits, ...plan.alternatives.map((a) => a.visits)];
  const key = (p: readonly LiveVisit[]) => `${p[0]!.start}|${p[1]!.start}`;
  return (
    <select
      className="sx-live-select"
      aria-label="Visit pair"
      value={key(plan.visits)}
      disabled={busy}
      onChange={(e) => {
        const [a, b] = e.target.value.split('|') as [string, string];
        void useLiveJobStore.getState().choosePair([a, b]);
      }}
      data-testid="live-pair"
    >
      {pairs
        .slice()
        .sort((x, y) => Date.parse(x[0]!.start) - Date.parse(y[0]!.start))
        .map((p) => (
          <option key={key(p)} value={key(p)}>
            {visitsText({ visits: [p[0]!, p[1]!] })}
          </option>
        ))}
    </select>
  );
}

function DrawAgain() {
  return (
    <button
      type="button"
      className="sx-btn-outline"
      onClick={() => useAreaStore.getState().redraw()}
      data-testid="live-draw-again"
    >
      Choose another region
    </button>
  );
}

/** The step the screen reader hears once per step (not every count). */
function announceOf(status: LiveJobStatus | null): string {
  if (!status) return 'Starting.';
  if (status.state === 'queued') return 'Waiting. Another area is computing.';
  const i = status.steps.findIndex((s) => s.state === 'running');
  return i < 0 ? '' : `Step ${i + 1} of ${status.steps.length}: ${status.steps[i]!.label}.`;
}

function Job({
  job,
  status,
  busy,
  onMinimise,
}: {
  job: LiveJob | null;
  status: LiveJobStatus | null;
  busy: boolean;
  onMinimise(): void;
}) {
  const queued = status?.state === 'queued';
  const stop = () => void useLiveJobStore.getState().stop();
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" data-testid="live-announce">
        {announceOf(status)}
      </p>
      {queued ? (
        <Waiting status={status} job={job} />
      ) : (
        <>
          <ol className="sx-live-steps" aria-label="Progress" data-testid="live-steps">
            {(status?.steps ?? []).map((s) => {
              const n = stepCount(s);
              const bar =
                s.state === 'running' && s.total ? Math.min(1, (s.done ?? 0) / s.total) : null;
              return (
                <li
                  key={s.id}
                  data-state={s.state}
                  aria-current={s.state === 'running' ? 'step' : undefined}
                >
                  <span className="sx-live-mk" aria-hidden="true" />
                  <span>
                    {s.label}
                    <span className="sr-only">
                      {s.state === 'done' ? ', done' : s.state === 'running' ? ', now' : ', to do'}
                    </span>
                  </span>
                  <span className="sx-live-n">{n}</span>
                  {bar !== null && (
                    <span
                      className="sx-live-bar"
                      role="progressbar"
                      aria-label={`${s.label}: ${n}`}
                      aria-valuemin={0}
                      aria-valuemax={s.total}
                      aria-valuenow={s.done ?? 0}
                    >
                      <i style={{ transform: `scaleX(${bar})` }} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="sx-live-time" data-testid="live-time">
            <span>{status ? `${clock(status.elapsed_s)} elapsed` : 'Starting'}</span>
            <span>
              {status?.eta_s == null
                ? ''
                : status.eta_s > 0
                  ? `${aboutMinutes(status.eta_s)} left`
                  : 'almost done'}
            </span>
          </div>
          <p className="sx-live-m">
            You can close this card. The area keeps computing and opens here when it&rsquo;s ready.
          </p>
        </>
      )}
      <div className="sx-live-btns">
        <button
          type="button"
          className="sx-btn-outline"
          onClick={onMinimise}
          data-testid="live-minimise"
        >
          Minimise
        </button>
        <button
          type="button"
          className="sx-btn-outline"
          disabled={busy || !job}
          onClick={stop}
          data-testid="live-stop"
        >
          {queued ? 'Cancel' : 'Stop'}
        </button>
      </div>
    </>
  );
}

function Waiting({ status, job }: { status: LiveJobStatus | null; job: LiveJob | null }) {
  const run = job?.plan?.estimate_s ?? null;
  const pos = status?.queue_position ?? 1;
  const eta = status?.eta_s ?? null;
  // eta_s runs to the end of the job; the offer's estimate splits it into the wait and the run.
  const wait = run !== null && eta !== null ? Math.max(0, eta - run) : null;
  return (
    <>
      <p className="sx-live-p" data-testid="live-waiting">
        {pos > 1
          ? `Other areas are computing. Yours is number ${pos} in line.`
          : 'Another area is computing. Yours starts next.'}
      </p>
      <div className="sx-live-time" data-testid="live-time">
        {wait !== null && run !== null ? (
          <>
            <span>Starts in {aboutMinutes(wait)}</span>
            <span>then {aboutMinutes(run)}</span>
          </>
        ) : eta !== null ? (
          <span>{aboutMinutes(eta)} left</span>
        ) : null}
      </div>
    </>
  );
}

function Failed({ view, busy }: { view: Extract<LiveView, { kind: 'failed' }>; busy: boolean }) {
  const t = failureText(view.code, view.fromJob === true);
  return (
    <>
      <div className="sx-live-alert" role="status" data-testid="live-failed" data-code={view.code}>
        <b>{t.title}</b>
        <span>{t.line}</span>
      </div>
      <div className="sx-live-btns">
        {t.retry && (
          <button
            type="button"
            className="sx-btn-outline"
            disabled={busy}
            onClick={() => void useLiveJobStore.getState().retry()}
            data-testid="live-retry"
          >
            Try again
          </button>
        )}
        <DrawAgain />
      </div>
    </>
  );
}
