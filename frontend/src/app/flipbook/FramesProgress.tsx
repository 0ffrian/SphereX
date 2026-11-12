// Progress of a frame list that is still arriving (progressive.ts). With no frame ready, the
// picture area is black and holds the "Fetching" loader, the count, a thin line and Stop
// (FramesWait); once some are ready the picture shows and a small tab at its bottom carries the
// same (FramesTab). Never a live region of its own beyond the status role: the store sends
// updates to the one polite live region (LiveAnnouncer, R9). Frames that are not usable are
// listed in More > About, not here.
import type { FramesResponse } from '@/app/api/types';
import { framesGaveUpMessage, searchErrorMessage } from '@/app/messages';
import { FETCHING_LOOK } from '@/app/island/loaderLooks';
import GridLoader from '@/app/island/GridLoader';
import { ErrorBox } from '@/app/StatusBoxes';
import type { FramesProgress as Progress } from '@/state/store';
import { useAppStore } from '@/state/store';
import { framesCounts } from './progressive';

/** Black picture area while no frame is ready. Fills its (relative) parent. */
export function FramesWait({
  progress,
  frames,
}: {
  progress: Progress;
  frames: FramesResponse;
}) {
  const stop = useAppStore((s) => s.skyStopFrames);
  const resume = useAppStore((s) => s.skyContinueFrames);
  const counts = framesCounts(frames);
  if (progress.phase === 'failed' && progress.error) {
    return (
      <div className="fb-wait" data-testid="frames-progress" data-phase="failed">
        <ErrorBox
          message={`${framesGaveUpMessage(counts)} ${searchErrorMessage(progress.error, '')}`}
          detail={progress.error.detail}
          onRetry={resume}
        />
      </div>
    );
  }
  const fetching = progress.phase === 'fetching';
  const pct = counts.found > 0 ? (100 * counts.ready) / counts.found : 0;
  return (
    <div className="fb-wait" role="status" data-testid="frames-progress" data-phase={progress.phase}>
      {fetching && (
        <span aria-hidden="true" className="contents">
          <GridLoader {...FETCHING_LOOK} className="flex-none" />
        </span>
      )}
      <b data-testid="frames-progress-headline">{fetching ? 'Fetching frames' : 'Stopped'}</b>
      <span className="fb-n">
        {counts.ready} / {counts.found}
      </span>
      <i className="fb-prog" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </i>
      {fetching ? (
        <button type="button" className="fb-stop" onClick={stop} data-testid="frames-stop">
          Stop
        </button>
      ) : (
        <button type="button" className="fb-stop" onClick={resume} data-testid="frames-continue">
          Continue
        </button>
      )}
    </div>
  );
}

/** The small count, line and Stop at the bottom of the picture while the rest still arrives. */
export function FramesTab({ progress, frames }: { progress: Progress; frames: FramesResponse }) {
  const stop = useAppStore((s) => s.skyStopFrames);
  const resume = useAppStore((s) => s.skyContinueFrames);
  const counts = framesCounts(frames);
  if (progress.phase === 'failed' && progress.error) {
    return (
      <div className="fb-fetch" data-testid="frames-progress" data-phase="failed">
        <span>
          {counts.ready} / {counts.found}. Fetching stopped after several tries.
        </span>
        <button type="button" className="fb-stop" onClick={resume} data-testid="frames-continue">
          Try again
        </button>
      </div>
    );
  }
  const fetching = progress.phase === 'fetching';
  const pct = counts.found > 0 ? (100 * counts.ready) / counts.found : 0;
  return (
    <div className="fb-fetch" role="status" data-testid="frames-progress" data-phase={progress.phase}>
      <span data-testid="frames-progress-headline">
        {counts.ready} / {counts.found}
      </span>
      <i className="fb-prog" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </i>
      {fetching ? (
        <button type="button" className="fb-stop" onClick={stop} data-testid="frames-stop">
          Stop
        </button>
      ) : (
        <button type="button" className="fb-stop" onClick={resume} data-testid="frames-continue">
          Continue
        </button>
      )}
    </div>
  );
}
