// What the island says while it thinks (#66). The sentences are the ones the loading box said
// inside the panel (never blank, and the retry and elapsed-time lines are kept), now in the island.
import type { SkyState } from '@/state/store';
import { searchPlaceText } from '@/app/sky/positionTags';
import { framesRetryText, framesSearchingText } from '@/app/messages';

/** Statuses in which the island thinks: the object is being found or its frames searched. */
export function isThinking(status: SkyState['status']): boolean {
  return status === 'resolving' || status === 'loading_frames';
}

/** The sentence under "Thinking"; null when nothing is loading. */
export function thinkingSentence(sky: SkyState): string | null {
  if (sky.status === 'resolving') return `Finding “${sky.query?.q ?? ''}”…`;
  if (sky.status === 'loading_frames') {
    return framesSearchingText(sky.resolved ? searchPlaceText(sky.resolved) : (sky.query?.q ?? ''));
  }
  return null;
}

/** The retry line while the archive search is asked again, or null. */
export function thinkingRetry(sky: SkyState): string | null {
  return sky.status === 'loading_frames' && sky.progress?.retry
    ? framesRetryText(sky.progress.retry)
    : null;
}
