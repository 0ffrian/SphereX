// Progress of a frame list that is still arriving (progressive.ts): how many frames are ready, how
// many the archive found, Stop / Continue, and the retry or give-up state. Never a live region
// itself: the store sends the updates to the one polite live region (LiveAnnouncer, R9). The dot
// pulses only without `prefers-reduced-motion` (index.css stops animations otherwise).
import type { FramesResponse } from '@/app/api/types';
import {
  FRAMES_PLAY_WHILE_LOADING,
  framesGaveUpMessage,
  framesProgressDetail,
  framesProgressHeadline,
  framesRetryText,
  framesStoppedHeadline,
  searchErrorMessage,
  type ProgressWhere,
} from '@/app/messages';
import { ErrorBox } from '@/app/StatusBoxes';
import { buttonClass } from '@/app/ui';
import type { FramesProgress as Progress } from '@/state/store';
import { useAppStore } from '@/state/store';
import { framesCounts } from './progressive';

export function FramesProgress({
  progress,
  frames,
  where,
}: {
  progress: Progress;
  frames: FramesResponse;
  where: ProgressWhere;
}) {
  const stop = useAppStore((s) => s.skyStopFrames);
  const resume = useAppStore((s) => s.skyContinueFrames);
  const counts = framesCounts(frames);

  if (progress.phase === 'failed' && progress.error) {
    return (
      <div className="flex flex-col gap-2" data-testid="frames-progress" data-phase="failed">
        <ErrorBox
          message={`${framesGaveUpMessage(counts)} ${searchErrorMessage(progress.error, '')}`}
          detail={progress.error.detail}
          onRetry={resume}
        />
      </div>
    );
  }

  const fetching = progress.phase === 'fetching';
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200"
      data-testid="frames-progress"
      data-phase={progress.phase}
    >
      <p className="flex items-start gap-3">
        {fetching && (
          <span
            className="mt-1 inline-block size-3 flex-none animate-pulse rounded-full bg-sky-400"
            aria-hidden="true"
          />
        )}
        <span data-testid="frames-progress-headline">
          {fetching ? framesProgressHeadline(counts, where) : framesStoppedHeadline(counts)}
        </span>
      </p>
      {/* A text bar, not a <progress>: the total can grow while the archive is searched. */}
      <div
        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-neutral-800"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-sky-400"
          style={{ width: `${counts.found > 0 ? (100 * counts.ready) / counts.found : 0}%` }}
        />
      </div>
      {fetching && progress.retry && (
        <p className="text-amber-200" data-testid="frames-progress-retry">
          {framesRetryText(progress.retry)}
        </p>
      )}
      {/* Stop / Continue right under the headline, so it is in view on a phone's bottom sheet. */}
      <div className="flex flex-wrap gap-2">
        {fetching ? (
          <button type="button" className={buttonClass} onClick={stop} data-testid="frames-stop">
            Stop fetching
          </button>
        ) : (
          <button
            type="button"
            className={buttonClass}
            onClick={resume}
            data-testid="frames-continue"
          >
            Continue fetching
          </button>
        )}
      </div>
      <p className="text-neutral-400" data-testid="frames-progress-detail">
        {framesProgressDetail(counts)}
        {counts.ready > 0 && fetching && ` ${FRAMES_PLAY_WHILE_LOADING}`}
      </p>
    </div>
  );
}
