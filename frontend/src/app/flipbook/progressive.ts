// Progressive frame loading. A live backend downloads at most SX_LIVE_CUTOUTS_PER_REQUEST cutouts
// per `/frames` request and lists the rest as `cutouts:deferred:<n>` (A4.1). The cutouts it did
// download are cached, so the next request for the same object gets further. The flipbook shows
// the frames it has (playable) and asks again, one request at a time, until no `cutouts:deferred`
// remains, the user stops, or a new search starts. The bounded parallel download on the server is
// issue #41; this is only the client side.
//
// Logic only, no React and no store: the store wires it up (state/store.ts).
import type { ApiResult } from '@/app/api/client';
import { ApiError, isApiError, type ApiErrorKind } from '@/app/api/errors';
import type { Frame, FramesResponse } from '@/app/api/types';
import { parseMissing } from '@/app/refusals';

// ASSUMPTION: UI pacing and politeness, not physical values. Engineering choices for issue #41's
// interim: one request in flight per object, a short pause between parts, exponential backoff
// after an error, and a bounded number of consecutive failures before giving up.

/** Pause between a reply that still lists deferred cutouts and the next request. */
export const POLL_NEXT_DELAY_MS = 500;
/** First wait after a failed request; doubles per consecutive failure, up to the maximum. */
export const POLL_FIRST_BACKOFF_MS = 2000;
export const POLL_MAX_BACKOFF_MS = 30_000;
/** Consecutive server or network errors retried; one more gives up (the error box: Try again). */
export const POLL_MAX_ERRORS = 5;
/**
 * Consecutive client timeouts retried; one more gives up. A timeout is not a dead end: the server
 * keeps downloading (and caching) after the browser stops waiting, so the next request gets
 * further.
 */
export const POLL_MAX_TIMEOUTS = 5;
/**
 * Consecutive replies that still list deferred cutouts but got no further (same frames, same
 * deferred count) before giving up. Each one waits longer (backoffMs), so a backend that answers
 * but never downloads anything cannot keep the loop asking every POLL_NEXT_DELAY_MS for ever.
 */
export const POLL_MAX_STALLS = 5;
/** `code` of the ApiError a stalled run gives up with. */
export const POLL_STALLED_CODE = 'frames_stalled';
/** Progress updates in the polite live region at most this often (completion always speaks). */
export const PROGRESS_ANNOUNCE_MIN_MS = 15_000;

const TRUNCATED = 'frames:truncated';
const DEFERRED_PREFIX = 'cutouts:deferred:';
const RETRYABLE: ReadonlySet<ApiErrorKind> = new Set(['server', 'network']);

/** Total of the `cutouts:deferred:<n>` codes in `missing`; 0 when there are none. */
export function deferredCount(missing: readonly string[]): number {
  let n = 0;
  for (const code of new Set(missing)) {
    if (!code.startsWith(DEFERRED_PREFIX)) continue;
    const p = parseMissing(code);
    if (p.kind === 'note' && p.known) n += p.count;
  }
  return n;
}

/** True while the backend still has cutouts it did not download for this list. */
export function hasDeferred(missing: readonly string[]): boolean {
  return deferredCount(missing) > 0;
}

/** What the progress line counts, all from the latest reply merged with the frames shown. */
export interface FramesCounts {
  /** Frames in the list, playable now. */
  ready: number;
  /** Cutouts the backend has not downloaded yet (`cutouts:deferred:<n>`). */
  toDownload: number;
  /** Frames the archive listed that are not shown (any per-frame refusal, incl. failed cutouts). */
  notUsable: number;
  /** ready + toDownload + notUsable: the frames the archive search found. */
  found: number;
  /** The archive sent a shortened list (`frames:truncated`), so more frames may exist. */
  truncated: boolean;
}

export function framesCounts(frames: FramesResponse): FramesCounts {
  const shown = new Set(frames.frames.map((f) => f.frame_id));
  const refused = new Set<string>();
  for (const code of frames.missing) {
    const p = parseMissing(code);
    if (p.kind === 'frame' && !shown.has(p.frameId)) refused.add(p.frameId);
  }
  const ready = shown.size;
  const toDownload = deferredCount(frames.missing);
  return {
    ready,
    toDownload,
    notUsable: refused.size,
    found: ready + toDownload + refused.size,
    truncated: frames.missing.includes(TRUNCATED),
  };
}

function frameOrder(a: Frame, b: Frame): number {
  // The backend's order (frames.py): time, then wavelength, then frame id.
  const ta = Date.parse(a.time);
  const tb = Date.parse(b.time);
  if (ta !== tb) return ta - tb;
  if (a.wavelength_um !== b.wavelength_um) return a.wavelength_um - b.wavelength_um;
  return a.frame_id < b.frame_id ? -1 : a.frame_id > b.frame_id ? 1 : 0;
}

/**
 * The next part of a progressive frame list. The newer reply wins for every frame it lists and
 * for `missing`, `cached_at` and the other whole-list fields; a frame only the older list had is
 * kept (a cached cutout does not disappear, so this is only a safety net). Sorted in the backend's
 * order, so a frame that arrives late lands at its time, not at the end.
 */
export function mergeFrames(prev: FramesResponse | null, next: FramesResponse): FramesResponse {
  if (!prev || prev.id !== next.id) return next;
  const byId = new Map<string, Frame>();
  for (const f of prev.frames) byId.set(f.frame_id, f);
  for (const f of next.frames) byId.set(f.frame_id, f);
  return { ...next, frames: [...byId.values()].sort(frameOrder) };
}

/**
 * Where playback stands after a merge: on the same frame (by id), so new frames never move the
 * picture. A frame named in a shared link that has just arrived wins, as long as the user has
 * not moved since (`pendingFrameId` is cleared when they do).
 */
export function indexAfterMerge(
  prev: readonly Frame[],
  prevIndex: number,
  merged: readonly Frame[],
  pendingFrameId: string | null,
): { index: number; pendingFound: boolean } {
  if (pendingFrameId !== null) {
    const wanted = merged.findIndex((f) => f.frame_id === pendingFrameId);
    if (wanted >= 0) return { index: wanted, pendingFound: true };
  }
  const current = prev[prevIndex]?.frame_id;
  const i = current === undefined ? -1 : merged.findIndex((f) => f.frame_id === current);
  if (i >= 0) return { index: i, pendingFound: false };
  return {
    index: Math.min(Math.max(prevIndex, 0), Math.max(merged.length - 1, 0)),
    pendingFound: false,
  };
}

/** Wait after `failures` consecutive failed requests (1 → 2 s, 2 → 4 s, … capped at 30 s). */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(POLL_MAX_BACKOFF_MS, POLL_FIRST_BACKOFF_MS * 2 ** (failures - 1));
}

/** A `setTimeout` that rejects with ApiError('aborted') when the signal fires. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ApiError('aborted', 'Stopped.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('aborted', 'Stopped.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface PollRetry {
  error: ApiError;
  /** A client timeout: the server is probably still working; asking again, not an error. */
  timeout: boolean;
  /** Consecutive failures of this kind so far (1 on the first). */
  failures: number;
  /** Failures of this kind allowed before giving up. */
  max: number;
  /** Wait before the next request. */
  delayMs: number;
}

export type PollOutcome =
  { kind: 'done' } | { kind: 'aborted' } | { kind: 'gave_up'; error: ApiError };

export interface PollOptions {
  fetch(signal: AbortSignal): Promise<ApiResult<FramesResponse>>;
  signal: AbortSignal;
  /** Handles one reply; returns true to ask for the next part. */
  onReply(res: ApiResult<FramesResponse>): boolean;
  onRetry?(retry: PollRetry): void;
  /**
   * Whether a server or network error is retried now. False before the first reply, so a broken
   * search shows its error at once, as it did before progressive loading.
   */
  retryErrors(): boolean;
  /** Wait before the first request (Continue after Stop starts at once: 0). */
  initialDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Asks for the frame list until `onReply` says it is complete. Never two requests at once: the
 * next request starts only after the previous one has answered (or failed) and the pause is over.
 */
export async function pollFrames(o: PollOptions): Promise<PollOutcome> {
  const sleep = o.sleep ?? abortableSleep;
  let errors = 0;
  let timeouts = 0;
  let stalls = 0;
  let lastProgress: string | null = null;
  let delay = o.initialDelayMs ?? 0;
  for (;;) {
    if (o.signal.aborted) return { kind: 'aborted' };
    if (delay > 0) {
      try {
        await sleep(delay, o.signal);
      } catch {
        return { kind: 'aborted' };
      }
      if (o.signal.aborted) return { kind: 'aborted' };
    }
    let res: ApiResult<FramesResponse>;
    try {
      res = await o.fetch(o.signal);
    } catch (e) {
      if (o.signal.aborted || (isApiError(e) && e.kind === 'aborted')) return { kind: 'aborted' };
      const error = isApiError(e)
        ? e
        : new ApiError('bad_response', e instanceof Error ? e.message : null);
      if (error.kind === 'timeout') {
        timeouts += 1;
        if (timeouts > POLL_MAX_TIMEOUTS) return { kind: 'gave_up', error };
        delay = backoffMs(timeouts);
        o.onRetry?.({
          error,
          timeout: true,
          failures: timeouts,
          max: POLL_MAX_TIMEOUTS,
          delayMs: delay,
        });
        continue;
      }
      if (RETRYABLE.has(error.kind) && o.retryErrors()) {
        errors += 1;
        if (errors > POLL_MAX_ERRORS) return { kind: 'gave_up', error };
        delay = backoffMs(errors);
        o.onRetry?.({
          error,
          timeout: false,
          failures: errors,
          max: POLL_MAX_ERRORS,
          delayMs: delay,
        });
        continue;
      }
      return { kind: 'gave_up', error };
    }
    if (o.signal.aborted) return { kind: 'aborted' };
    errors = 0;
    timeouts = 0;
    if (!o.onReply(res)) return { kind: 'done' };
    const progress = `${res.data.frames.length}:${deferredCount(res.data.missing)}`;
    if (progress === lastProgress) {
      stalls += 1;
      if (stalls > POLL_MAX_STALLS) {
        return {
          kind: 'gave_up',
          error: new ApiError(
            'server',
            `The server answered ${stalls} times in a row without downloading more cutouts.`,
            null,
            POLL_STALLED_CODE,
          ),
        };
      }
      delay = backoffMs(stalls);
    } else {
      stalls = 0;
      delay = POLL_NEXT_DELAY_MS;
    }
    lastProgress = progress;
  }
}
