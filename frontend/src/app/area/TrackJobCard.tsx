// Track it, computed on demand (issue #145, mock-up state 7): the object's Track job, with its steps,
// a count and a bar on the frame search, and the elapsed time; the Track view opens when it is done
// (trackJobStore). There is no Stop: the object job runner (#41) has none, so "Back to the results"
// leaves the job running on the server, and the object is Track-available when it ends.
import { backToScan } from '@/app/sky/areaDraw';
import { useEffect, useState } from 'react';
import { PanelCard } from '@/app/shell/PanelCard';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { Alert } from './areaBits';
import { clock, releaseName } from './liveJobStore';
import { TRACK_DAYS } from './trackJobApi';
import { trackFailureText, trackSteps, useTrackJobStore } from './trackJobStore';

export function TrackJobCard() {
  const view = useTrackJobStore((s) => s.view);
  const busy = useTrackJobStore((s) => s.busy);
  const back = useAreaStore((s) => s.trackBack);
  const closePanel = useShellStore((s) => s.closePanel);
  // The elapsed clock: the time is read in the effect (a render stays pure), once a second.
  const [now, setNow] = useState(() => view?.t0 ?? 0);
  const running = !!view && !view.failed;
  useEffect(() => {
    if (!running) return;
    const read = () => setNow(Date.now());
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, [running]);
  // The job keeps being followed: when it ends, the row says Track-available (and the Track view
  // opens only if this card is showing again).
  const goBack = () => {
    if (back === 'mover') {
      const s = useAreaStore.getState();
      s.openMover(s.sel);
    } else if (back === 'scan') backToScan();
    else useAreaStore.getState().openList();
  };
  if (!view) return null;
  const o = view.obj;
  const title = [o.id, o.name].filter(Boolean).join(' ');
  const steps = trackSteps(view.status);
  const nowStep = steps.findIndex((s) => s.state === 'running');
  const fail = view.failed ? trackFailureText(view.failed.code) : null;
  return (
    <PanelCard
      title={title}
      subtitle={[fail ? 'Track' : 'Preparing Track', releaseName(view.release)]
        .filter(Boolean)
        .join(' · ')}
      onClose={closePanel}
      onMinimise={() => useAreaStore.getState().setMinimised(true)}
      returnFocusTo='[data-testid="tool-known"]'
      testId="area-card"
    >
      <div
        className="sx-live"
        data-testid="track-job"
        data-state={fail ? 'failed' : (view.status?.state ?? 'starting')}
      >
        <p className="sr-only" role="status" aria-live="polite">
          {fail
            ? ''
            : nowStep >= 0
              ? `Step ${nowStep + 1} of ${steps.length}: ${steps[nowStep]!.label}.`
              : 'Starting.'}
        </p>
        {fail ? (
          <Alert
            title={fail.title}
            line={fail.line}
            testId="track-failed"
            code={view.failed!.code}
          />
        ) : (
          <>
            <ol className="sx-live-steps" aria-label="Track progress" data-testid="track-steps">
              {steps.map((s) => (
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
                  <span className="sx-live-n">{s.count}</span>
                  {s.bar !== null && (
                    <span
                      className="sx-live-bar"
                      role="progressbar"
                      aria-label={`${s.label}: ${s.count}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(s.bar * 100)}
                    >
                      <i style={{ transform: `scaleX(${s.bar})` }} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <div className="sx-live-time" data-testid="track-time">
              <span>{clock(Math.max(0, now - view.t0) / 1000)} elapsed</span>
            </div>
            <p className="sx-live-m">
              The path is searched over {TRACK_DAYS} days either side of this area&rsquo;s visits,
              not the whole release, so it takes minutes. When done, the Track view opens with the
              frames, the path and the spectrum.
            </p>
          </>
        )}
        <div className="sx-live-btns">
          {fail?.retry && (
            <button
              type="button"
              className="sx-btn-outline"
              disabled={busy}
              onClick={() => void useTrackJobStore.getState().retry()}
              data-testid="track-retry"
            >
              Try again
            </button>
          )}
          {!fail && (
            <button
              type="button"
              className="sx-btn-outline"
              onClick={() => useAreaStore.getState().setMinimised(true)}
              data-testid="track-minimise"
            >
              Minimise
            </button>
          )}
          <button
            type="button"
            className="sx-btn-outline"
            onClick={goBack}
            data-testid="track-back"
          >
            Back to the results
          </button>
        </div>
      </div>
    </PanelCard>
  );
}
