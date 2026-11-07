// Which frame the flipbook viewer shows, and when it changes (A1.1). The requested frame (the
// store's `sky.index`, moved by the playback timer, the keys or the scrubber) and the shown frame
// are kept apart: the next picture is decoded in a hidden <img> slot and the two slots swap only
// once it has decoded, so the box never shows an empty, black <img> for a frame. The picture, its
// placement, tint, ring, hatching and every caption follow the shown frame, so they change in the
// same render. Two <img> elements are kept for the whole object (slots 0 and 1); neither is
// remounted per frame.
//
// - A requested frame whose cutout failed is shown at once as "cutout unavailable".
// - One decode at a time. A request that arrives while one runs waits for it; when it ends, that
//   picture is shown if it was requested after the frame on screen (so a slow decode cannot freeze
//   playback, and the picture never steps back to a frame requested before it), then the newest
//   request is decoded. A decode of a cutout that had not downloaded when it started is not
//   waited for: the newest request replaces it (rapid scrubbing over frames still loading).
// - A decode that takes longer than DECODE_TIMEOUT_MS stops holding the old picture: for the
//   requested frame the viewer shows it as loading and it is shown once it loads (never as
//   unavailable); for an older frame the decode is dropped and counted in `timedOut`.
// - `failed` is only a real load or decode error of that frame's own URL (useFrameSwap.ts checks
//   the element before reporting it): it shows the requested frame as unavailable, or drops an
//   older frame. A decode that was cut short (`aborted`, e.g. the browser gave up on decode()
//   while the image is still loading) is never a failure: the viewer waits for the image instead.
// - `reset`: the <img> elements were replaced (the viewer was hidden and shown again), so nothing
//   decoded before is on screen; the requested frame is decoded again.
// The playback timer never waits for this: it keeps its own pace (session.tsx).
// Logic only; useFrameSwap.ts runs it against the two <img> elements.
import type { CutoutStatus } from './useCutoutPreload';

/**
 * ASSUMPTION (UI pacing, not data): a decoded PNG cutout of ~60×60 px takes a few ms; 1 s means
 * something is wrong (or the image is still downloading), so the viewer stops holding the old
 * picture.
 */
export const DECODE_TIMEOUT_MS = 1000;

export type SlotId = 0 | 1;

export interface SwapTarget {
  index: number;
  url: string;
  status: CutoutStatus;
}

/** `picture`: the front slot's decoded image; `failed`: "cutout unavailable"; `loading`: no picture yet. */
export type ShownKind = 'picture' | 'failed' | 'loading';

export interface Shown {
  index: number;
  url: string;
  kind: ShownKind;
}

export interface Decoding {
  /** Changes for every decode started, so a late result of an older one is ignored. */
  id: number;
  slot: SlotId;
  index: number;
  url: string;
  /** The request (SwapState.seq) it serves. */
  seq: number;
  /** Its cutout had not downloaded (status `pending`) when it was last requested. */
  pending: boolean;
  /** Past DECODE_TIMEOUT_MS: the viewer no longer holds the old picture for it. */
  late: boolean;
}

export interface SwapState {
  /** The `src` of each <img> slot. */
  srcs: readonly [string | null, string | null];
  /** The slot drawn when the shown kind is `picture`; the other one is hidden. */
  front: SlotId;
  /** The front slot's image has decoded. */
  frontReady: boolean;
  decoding: Decoding | null;
  target: SwapTarget | null;
  shown: Shown | null;
  /** Counts requests for another cutout, so "requested after the shown frame" can be told. */
  seq: number;
  /** The request the shown frame answers (or the newest one, when it is shown as loading). */
  shownSeq: number;
  /** Times the requested frame changed before the previous request reached the screen. */
  late: number;
  /** Older-frame decodes dropped: past DECODE_TIMEOUT_MS, or cut short. Never a failure. */
  timedOut: number;
  /** Real load or decode errors (the frame shows as unavailable, or an older one is dropped). */
  failed: number;
  nextId: number;
}

export type SwapEvent =
  | { type: 'target'; target: SwapTarget }
  | { type: 'decoded'; id: number }
  | { type: 'failed'; id: number; url: string }
  | { type: 'aborted'; id: number }
  | { type: 'timeout'; id: number }
  | { type: 'reset' };

export const INITIAL_SWAP: SwapState = {
  srcs: [null, null],
  front: 0,
  frontReady: false,
  decoding: null,
  target: null,
  shown: null,
  seq: 0,
  shownSeq: 0,
  late: 0,
  timedOut: 0,
  failed: 0,
  nextId: 1,
};

const other = (s: SlotId): SlotId => (s === 0 ? 1 : 0);

function withSrc(srcs: SwapState['srcs'], slot: SlotId, url: string): SwapState['srcs'] {
  return slot === 0 ? [url, srcs[1]] : [srcs[0], url];
}

function sameShown(a: Shown | null, b: Shown): boolean {
  return a !== null && a.index === b.index && a.url === b.url && a.kind === b.kind;
}

function show(s: SwapState, shown: Shown, seq: number): SwapState {
  return sameShown(s.shown, shown) && s.shownSeq === seq ? s : { ...s, shown, shownSeq: seq };
}

/** The viewer shows an older frame than the requested one (it holds it until the next decodes). */
function holdingOlder(s: SwapState): boolean {
  return s.target !== null && (s.shown === null || s.shown.url !== s.target.url);
}

/** Move towards showing `s.target`. */
function settle(s: SwapState): SwapState {
  const t = s.target;
  if (t === null) return s;
  if (t.status === 'failed') return show(s, { index: t.index, url: t.url, kind: 'failed' }, s.seq);
  if (s.frontReady && s.srcs[s.front] === t.url) {
    return show(s, { index: t.index, url: t.url, kind: 'picture' }, s.seq);
  }
  if (s.decoding !== null && s.decoding.url !== t.url && (s.decoding.late || s.decoding.pending)) {
    // A decode past its timeout, or of a cutout still downloading, is not waited for: drop it and
    // decode the new request. (Playback only moves to downloaded frames, so it is not starved.)
    return settle({
      ...s,
      decoding: null,
      timedOut: s.timedOut + (s.decoding.late ? 1 : 0),
    });
  }
  if (s.decoding !== null) {
    if (s.decoding.url === t.url) {
      const pending = t.status === 'pending';
      const old = s.decoding;
      const d =
        old.index === t.index && old.seq === s.seq && old.pending === pending
          ? old
          : { ...old, index: t.index, seq: s.seq, pending };
      const next = d === old ? s : { ...s, decoding: d };
      return d.late || t.status === 'pending' || next.shown === null ? loading(next, t) : next;
    }
    // Wait for the decode under way (or its timeout); the shown frame stays as it is, unless the
    // requested cutout is not even downloaded yet.
    return t.status === 'pending' || s.shown === null ? loading(s, t) : s;
  }
  const slot = other(s.front);
  const started: SwapState = {
    ...s,
    srcs: withSrc(s.srcs, slot, t.url),
    decoding: {
      id: s.nextId,
      slot,
      index: t.index,
      url: t.url,
      seq: s.seq,
      pending: t.status === 'pending',
      late: false,
    },
    nextId: s.nextId + 1,
  };
  return t.status === 'pending' || s.shown === null ? loading(started, t) : started;
}

function loading(s: SwapState, t: SwapTarget): SwapState {
  return show(s, { index: t.index, url: t.url, kind: 'loading' }, s.seq);
}

export function swapReducer(s: SwapState, e: SwapEvent): SwapState {
  switch (e.type) {
    case 'target': {
      const t = e.target;
      const prev = s.target;
      if (prev && prev.index === t.index && prev.url === t.url && prev.status === t.status) {
        return s;
      }
      const another = prev === null || prev.url !== t.url;
      const moved = prev !== null && another && holdingOlder(s);
      return settle({
        ...s,
        target: t,
        seq: s.seq + (another ? 1 : 0),
        late: s.late + (moved ? 1 : 0),
      });
    }
    case 'decoded': {
      const d = s.decoding;
      if (d === null || d.id !== e.id) return s;
      // settle() shows it when it is the requested frame. A frame passed since is shown too when it
      // was requested after the frame on screen, so playback moves on even when decodes are slow;
      // never one requested before it (after a frame shown as unavailable or loading, or when the
      // user stepped back), so the picture never goes backwards.
      const requested = s.target?.url === d.url;
      const older = !requested && d.seq > s.shownSeq;
      if (!requested && !older && s.shown?.kind === 'picture') {
        // The front slot's picture stays on screen (e.g. the user stepped back to it).
        return settle({ ...s, decoding: null });
      }
      // The decoded slot becomes the front; the old front is now hidden and free.
      let next: SwapState = { ...s, front: d.slot, frontReady: true, decoding: null };
      if (older) next = show(next, { index: d.index, url: d.url, kind: 'picture' }, d.seq);
      return settle(next);
    }
    case 'failed': {
      const d = s.decoding;
      // Only the decode under way, and only for its own URL.
      if (d === null || d.id !== e.id || d.url !== e.url) return s;
      const next: SwapState = { ...s, decoding: null, failed: s.failed + 1 };
      if (s.target?.url === d.url) {
        // Do not retry it on this request: show it as unavailable.
        return show(next, { index: s.target.index, url: d.url, kind: 'failed' }, s.seq);
      }
      return settle(next);
    }
    case 'timeout':
    case 'aborted': {
      const d = s.decoding;
      if (d === null || d.id !== e.id || d.late) return s;
      if (s.target?.url === d.url) {
        // The requested frame: stop holding the old picture; it is shown once it loads.
        return loading({ ...s, decoding: { ...d, late: true } }, s.target);
      }
      return settle({ ...s, decoding: null, timedOut: s.timedOut + 1 });
    }
    case 'reset': {
      const fresh: SwapState = {
        ...INITIAL_SWAP,
        target: s.target,
        seq: s.seq,
        late: s.late,
        timedOut: s.timedOut,
        failed: s.failed,
        nextId: s.nextId,
      };
      return settle(fresh);
    }
  }
}

/**
 * The index of the shown frame in the current list: `shown.index` while it still names the same
 * cutout, else wherever that cutout sits now (the list can grow, progressive.ts), else null.
 */
export function shownIndexIn(
  shown: Shown | null,
  urls: (i: number) => string | undefined,
  n: number,
): number | null {
  if (shown === null) return null;
  if (urls(shown.index) === shown.url) return shown.index;
  for (let i = 0; i < n; i++) if (urls(i) === shown.url) return i;
  return null;
}
