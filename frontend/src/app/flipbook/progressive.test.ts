// Progressive frame loading: deferred parsing, counts, merging, and the request loop.
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import type { Frame, FramesResponse } from '@/app/api/types';
import {
  backoffMs,
  deferredCount,
  framesCounts,
  hasDeferred,
  indexAfterMerge,
  mergeFrames,
  POLL_FIRST_BACKOFF_MS,
  POLL_MAX_BACKOFF_MS,
  POLL_MAX_ERRORS,
  POLL_MAX_TIMEOUTS,
  POLL_NEXT_DELAY_MS,
  pollFrames,
  type PollOptions,
} from './progressive';

// Test data only, not physical claims.
const frame = (id: string, minute: number, um = 1): Frame => ({
  frame_id: id,
  time: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  wavelength_um: um,
  x: 1,
  y: 1,
  cutout_url: `/v1/objects/o/cutouts/${id}.png`,
  flags: [],
});

const reply = (frames: Frame[], missing: string[] = [], id = 'o'): FramesResponse => ({
  id,
  frames,
  north_up: false,
  stretch: { kind: 'asinh', params: {} },
  data_release: 'test',
  cached_at: null,
  missing,
});

const ok = (r: FramesResponse): ApiResult<FramesResponse> => ({ data: r, fixture: null });

describe('deferred cutouts', () => {
  it('reads cutouts:deferred:<n>, sums repeats once, ignores malformed codes', () => {
    expect(deferredCount([])).toBe(0);
    expect(deferredCount(['cutouts:deferred:7'])).toBe(7);
    expect(deferredCount(['cutouts:deferred:7', 'cutouts:deferred:7'])).toBe(7);
    expect(deferredCount(['cutouts:deferred:x', 'cutouts:deferred:', 'cutout:f1'])).toBe(0);
    expect(deferredCount(['frames:truncated', 'cutouts:deferred:0'])).toBe(0);
    expect(hasDeferred(['saturated:f1', 'cutouts:deferred:3'])).toBe(true);
    expect(hasDeferred(['cutout:f1'])).toBe(false);
  });

  it('counts ready, to download, not usable and found', () => {
    const r = reply(
      [frame('a', 0), frame('b', 1)],
      ['cutouts:deferred:5', 'outside_cutout:c', 'cutout:d', 'cutout:d', 'frames:truncated'],
    );
    expect(framesCounts(r)).toEqual({
      ready: 2,
      toDownload: 5,
      notUsable: 2,
      found: 9,
      truncated: true,
    });
    // A refusal of a frame that is shown (should not happen) is not counted twice.
    expect(framesCounts(reply([frame('a', 0)], ['cutout:a'])).found).toBe(1);
  });
});

describe('mergeFrames', () => {
  it('takes the newer reply, keeps frames only the older one had, and sorts by time', () => {
    const prev = reply([frame('a', 0), frame('c', 2)], ['cutouts:deferred:2']);
    const next = reply([frame('a', 0, 2), frame('b', 1), frame('d', 3)], ['cutout:e']);
    const m = mergeFrames(prev, next);
    expect(m.frames.map((f) => f.frame_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(m.frames[0]!.wavelength_um).toBe(2);
    expect(m.missing).toEqual(['cutout:e']);
  });

  it('orders equal times by wavelength, then id; another object replaces the list', () => {
    const m = mergeFrames(reply([frame('z', 0, 3)]), reply([frame('y', 0, 3), frame('x', 0, 1)]));
    expect(m.frames.map((f) => f.frame_id)).toEqual(['x', 'y', 'z']);
    const other = reply([frame('q', 0)], [], 'other');
    expect(mergeFrames(reply([frame('a', 0)]), other)).toBe(other);
    expect(mergeFrames(null, other)).toBe(other);
  });

  it('keeps the user on the same frame when frames arrive before it', () => {
    const prev = [frame('b', 1), frame('c', 2)];
    const merged = [frame('a', 0), frame('b', 1), frame('c', 2)];
    expect(indexAfterMerge(prev, 1, merged, null)).toEqual({ index: 2, pendingFound: false });
  });

  it('jumps to a shared link frame once it arrives, else stays', () => {
    const merged = [frame('a', 0), frame('b', 1), frame('c', 2)];
    expect(indexAfterMerge([frame('a', 0)], 0, merged, 'c')).toEqual({
      index: 2,
      pendingFound: true,
    });
    expect(indexAfterMerge([frame('a', 0)], 0, merged, 'zz')).toEqual({
      index: 0,
      pendingFound: false,
    });
    expect(indexAfterMerge([], 5, [], null).index).toBe(0);
  });
});

describe('backoff', () => {
  it('doubles from 2 s and stops at 30 s', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(POLL_FIRST_BACKOFF_MS);
    expect(backoffMs(2)).toBe(2 * POLL_FIRST_BACKOFF_MS);
    expect(backoffMs(3)).toBe(4 * POLL_FIRST_BACKOFF_MS);
    expect(backoffMs(10)).toBe(POLL_MAX_BACKOFF_MS);
  });
});

/** A poll with a recorded fake sleep and a fetch that plays the given answers in order. */
function harness(
  answers: readonly (FramesResponse | ApiError)[],
  extra: Partial<PollOptions> = {},
) {
  const controller = new AbortController();
  const sleeps: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const replies: FramesResponse[] = [];
  const retries: { timeout: boolean; failures: number; delayMs: number }[] = [];
  const opts: PollOptions = {
    signal: controller.signal,
    fetch: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const a = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      await Promise.resolve();
      inFlight -= 1;
      if (a instanceof ApiError) throw a;
      return ok(a);
    },
    onReply: (res) => {
      replies.push(res.data);
      return hasDeferred(res.data.missing);
    },
    onRetry: (r) => retries.push({ timeout: r.timeout, failures: r.failures, delayMs: r.delayMs }),
    retryErrors: () => true,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  };
  return {
    controller,
    opts,
    sleeps,
    replies,
    retries,
    calls: () => calls,
    maxInFlight: () => maxInFlight,
  };
}

const part1 = reply([frame('a', 0)], ['cutouts:deferred:2']);
const part2 = reply([frame('a', 0), frame('b', 1)], ['cutouts:deferred:1']);
const done = reply([frame('a', 0), frame('b', 1), frame('c', 2)]);

describe('pollFrames', () => {
  it('asks again one request at a time until no cutouts are deferred', async () => {
    const h = harness([part1, part2, done]);
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'done' });
    expect(h.calls()).toBe(3);
    expect(h.maxInFlight()).toBe(1);
    expect(h.replies.map((r) => r.frames.length)).toEqual([1, 2, 3]);
    // No wait before the first request; a short pause between parts.
    expect(h.sleeps).toEqual([POLL_NEXT_DELAY_MS, POLL_NEXT_DELAY_MS]);
  });

  it('stops when the caller says so (a stale reply, or a new search)', async () => {
    const h = harness([part1, part2, done], { onReply: () => false });
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'done' });
    expect(h.calls()).toBe(1);
  });

  it('Stop (abort) ends the loop during the pause and drops a reply that lands after it', async () => {
    const h = harness([part1, part2, done]);
    h.opts.sleep = async () => {
      h.controller.abort();
    };
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'aborted' });
    expect(h.calls()).toBe(1);

    const late = harness([part1]);
    late.opts.fetch = async () => {
      late.controller.abort();
      return ok(part1);
    };
    await expect(pollFrames(late.opts)).resolves.toEqual({ kind: 'aborted' });
    expect(late.replies).toEqual([]);
  });

  it('an aborted request is not an error', async () => {
    const h = harness([new ApiError('aborted', null)]);
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'aborted' });
    expect(h.retries).toEqual([]);
  });

  it('backs off after server errors, resets on success, then gives up after the limit', async () => {
    const err = new ApiError('server', 'busy', 503);
    const h = harness([part1, err, err, part2, ...Array<ApiError>(POLL_MAX_ERRORS + 1).fill(err)]);
    const outcome = await pollFrames(h.opts);
    expect(outcome).toEqual({ kind: 'gave_up', error: err });
    expect(h.replies).toHaveLength(2);
    const waits = h.retries.map((r) => r.delayMs);
    // 2 s, 4 s; success; then 2 s, 4 s, 8 s, 16 s, 30 s and give up on the next failure.
    expect(waits).toEqual([2000, 4000, 2000, 4000, 8000, 16000, 30000]);
    expect(h.calls()).toBe(4 + POLL_MAX_ERRORS + 1);
  });

  it('a client timeout is "still working": asked again, not counted as an error', async () => {
    const timeout = new ApiError('timeout', 'No answer within 90 s.');
    const h = harness([timeout, timeout, part1, done], { retryErrors: () => false });
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'done' });
    expect(h.retries).toEqual([
      { timeout: true, failures: 1, delayMs: POLL_FIRST_BACKOFF_MS },
      { timeout: true, failures: 2, delayMs: POLL_FIRST_BACKOFF_MS },
    ]);
    expect(h.replies).toHaveLength(2);
  });

  it('gives up after too many timeouts in a row', async () => {
    const timeout = new ApiError('timeout', 'No answer within 90 s.');
    const h = harness([timeout]);
    const outcome = await pollFrames(h.opts);
    expect(outcome.kind).toBe('gave_up');
    expect(h.calls()).toBe(POLL_MAX_TIMEOUTS + 1);
  });

  it('before the first reply, a server error ends the search at once (no retries)', async () => {
    const err = new ApiError('server', 'down', 503);
    const h = harness([err], { retryErrors: () => false });
    await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'gave_up', error: err });
    expect(h.calls()).toBe(1);
  });

  it('never retries a 404 or a reply it cannot read', async () => {
    for (const err of [new ApiError('not_found', null, 404), new ApiError('bad_response', null)]) {
      const h = harness([part1, err]);
      await expect(pollFrames(h.opts)).resolves.toEqual({ kind: 'gave_up', error: err });
      expect(h.calls()).toBe(2);
    }
  });

  it('uses a real abortable timer by default', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([part1, done]);
      delete h.opts.sleep;
      const run = pollFrames(h.opts);
      await vi.advanceTimersByTimeAsync(POLL_NEXT_DELAY_MS - 1);
      expect(h.calls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(run).resolves.toEqual({ kind: 'done' });
      expect(h.calls()).toBe(2);

      const s = harness([part1, done]);
      delete s.opts.sleep;
      const stopped = pollFrames(s.opts);
      await vi.advanceTimersByTimeAsync(10);
      s.controller.abort();
      await expect(stopped).resolves.toEqual({ kind: 'aborted' });
      expect(s.calls()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
