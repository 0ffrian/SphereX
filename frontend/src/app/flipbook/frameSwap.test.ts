// The shown frame changes only once its picture has decoded (frameSwap.ts), with the failure and
// timeout paths, and never freezes while requests keep coming.
import { describe, expect, it } from 'vitest';
import {
  INITIAL_SWAP,
  shownIndexIn,
  swapReducer,
  type SwapEvent,
  type SwapState,
  type SwapTarget,
} from './frameSwap';

const url = (i: number) => `/c/${i}.png`;
const t = (i: number, status: SwapTarget['status'] = 'loaded'): SwapEvent => ({
  type: 'target',
  target: { index: i, url: url(i), status },
});
const run = (s: SwapState, ...events: SwapEvent[]) => events.reduce(swapReducer, s);
const id = (s: SwapState) => {
  if (!s.decoding) throw new Error('no decode under way');
  return s.decoding.id;
};
const decoded = (s: SwapState) => swapReducer(s, { type: 'decoded', id: id(s) });
const failed = (s: SwapState) =>
  swapReducer(s, { type: 'failed', id: id(s), url: s.decoding!.url });
const aborted = (s: SwapState) => swapReducer(s, { type: 'aborted', id: id(s) });
const timeout = (s: SwapState) => swapReducer(s, { type: 'timeout', id: id(s) });

/** Frame 0 requested and decoded: the viewer shows its picture. */
function showing0(): SwapState {
  return decoded(run(INITIAL_SWAP, t(0)));
}

describe('frame swap', () => {
  it('shows nothing until the first picture decodes, then shows it', () => {
    let s = run(INITIAL_SWAP, t(0));
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'loading' });
    // Decoded in the hidden slot (1), not the front one.
    expect(s.decoding).toMatchObject({ slot: 1, url: url(0) });
    expect(s.srcs).toEqual([null, url(0)]);
    s = decoded(s);
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    expect(s.front).toBe(1);
    expect(s.decoding).toBeNull();
  });

  it('keeps the old picture until the next has decoded, then swaps slots', () => {
    let s = run(showing0(), t(1));
    // Requested 1, still showing 0; 1 decodes in the other slot.
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    expect(s.decoding).toMatchObject({ slot: 0, index: 1, url: url(1) });
    expect(s.srcs[s.front]).toBe(url(0));
    s = decoded(s);
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'picture' });
    expect(s.front).toBe(0);
    expect(s.srcs).toEqual([url(1), url(0)]);
    expect(s.late).toBe(0);
  });

  it('ignores a decode result that is not the one under way', () => {
    const s = run(showing0(), t(1));
    expect(swapReducer(s, { type: 'decoded', id: id(s) + 7 })).toBe(s);
    expect(swapReducer(s, { type: 'failed', id: id(s) - 1, url: url(1) })).toBe(s);
  });

  it('shows a frame whose cutout failed at once, without decoding it', () => {
    const s = run(showing0(), t(1, 'failed'));
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'failed' });
    expect(s.decoding).toBeNull();
  });

  it('shows a frame that fails to decode as unavailable and moves on', () => {
    let s = failed(run(showing0(), t(1)));
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'failed' });
    expect(s.failed).toBe(1);
    // The next request decodes normally.
    s = decoded(run(s, t(2)));
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'picture' });
  });

  it('stops holding the old picture when the requested frame times out, and still shows it later', () => {
    let s = timeout(run(showing0(), t(1)));
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'loading' });
    expect(s.decoding).toMatchObject({ url: url(1), late: true });
    // A second timeout for the same decode does nothing.
    expect(timeout(s)).toBe(s);
    s = decoded(s);
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'picture' });
  });

  it('drops an older decode that times out and decodes the newest request', () => {
    let s = run(showing0(), t(1), t(2));
    expect(s.decoding).toMatchObject({ url: url(1) });
    expect(s.late).toBe(1);
    s = timeout(s);
    expect(s.timedOut).toBe(1);
    expect(s.decoding).toMatchObject({ url: url(2) });
    // Still the last picture that decoded.
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    s = decoded(s);
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'picture' });
  });

  it('does not freeze when every decode is slower than the timer', () => {
    // Two requests arrive during each decode: every decode that ends is shown (it is newer than
    // the picture on screen), then the newest request is decoded; the ones between are passed.
    let s = showing0();
    const seen: number[] = [];
    for (let i = 1; i <= 9; i += 2) {
      s = run(s, t(i), t(i + 1));
      s = decoded(s); // shown although a newer frame is already requested
      seen.push(s.shown!.index);
    }
    expect(seen).toEqual([1, 2, 4, 6, 8]);
    expect(s.late).toBeGreaterThan(0);
    expect(s.decoding).toMatchObject({ url: url(10) });
    s = decoded(s);
    expect(s.shown?.index).toBe(10);
  });

  it('does not show an older picture over a requested frame that is loading or unavailable', () => {
    // The user moves to a cutout that is not downloaded yet while 1 decodes.
    let s = run(showing0(), t(1), t(5, 'pending'));
    expect(s.shown).toEqual({ index: 5, url: url(5), kind: 'loading' });
    s = decoded(s); // 1 decoded: not shown, 5 decodes next
    expect(s.shown?.index).toBe(5);
    expect(s.decoding).toMatchObject({ url: url(5) });
    s = run(s, t(6, 'failed'));
    expect(s.shown).toEqual({ index: 6, url: url(6), kind: 'failed' });
    s = decoded(s); // 5 decoded late: still 6 unavailable
    expect(s.shown).toEqual({ index: 6, url: url(6), kind: 'failed' });
  });

  it('drops a decode past its timeout when another frame is requested', () => {
    let s = timeout(run(showing0(), t(4, 'pending')));
    expect(s.decoding).toMatchObject({ url: url(4), late: true });
    s = run(s, t(2));
    expect(s.timedOut).toBe(1);
    expect(s.decoding).toMatchObject({ url: url(2), late: false });
  });

  it('shows the front slot at once when the user steps back to it, and keeps it', () => {
    let s = run(showing0(), t(1));
    const front = s.front;
    s = run(s, t(0)); // back before 1 has decoded
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    s = decoded(s); // 1 decoded late: the front slot (0's picture) stays
    expect(s.front).toBe(front);
    expect(s.srcs[s.front]).toBe(url(0));
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    expect(s.decoding).toBeNull();
    // The same request again changes nothing.
    expect(run(s, t(0))).toBe(s);
  });

  it('reuses the hidden slot when it already holds the requested cutout', () => {
    let s = decoded(run(showing0(), t(1))); // front: 1's slot, hidden: 0's
    s = run(s, t(0));
    // No new src: decoding an image that has decoded already resolves at once.
    expect(s.srcs[s.decoding!.slot]).toBe(url(0));
    expect(s.decoding!.slot).not.toBe(s.front);
    s = decoded(s);
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
  });

  it('follows a frame whose index moved (a growing list) without decoding it again', () => {
    const s = run(showing0(), {
      type: 'target',
      target: { index: 3, url: url(0), status: 'loaded' },
    });
    expect(s.shown).toEqual({ index: 3, url: url(0), kind: 'picture' });
    expect(s.decoding).toBeNull();
  });
});

describe('frame swap: the picture never steps back', () => {
  it('does not show a frame requested before one already shown as unavailable', () => {
    // A slow decode of 1; 2 fails (shown at once); 3 is requested; then 1 finishes.
    let s = run(showing0(), t(1), t(2, 'failed'), t(3));
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'failed' });
    s = decoded(s);
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'failed' });
    expect(s.decoding).toMatchObject({ url: url(3) });
    s = decoded(s);
    expect(s.shown).toEqual({ index: 3, url: url(3), kind: 'picture' });
  });

  it('keeps playing past an unavailable frame when every decode is slower than the timer', () => {
    let s = run(showing0(), t(1), t(2, 'failed'), t(3));
    const seen: number[] = [];
    for (let i = 4; i <= 8; i++) {
      s = decoded(run(s, t(i)));
      seen.push(s.shown!.index);
    }
    // 1 was requested before the unavailable 2: never shown. Each later decode is.
    expect(seen).toEqual([2, 4, 5, 6, 7]);
    expect(s.shown?.kind).toBe('picture');
  });

  it('does not show a frame the user stepped past and back from', () => {
    // On 0, request 1, back to 0 (shown at once from the front slot), then 1 finishes.
    let s = run(showing0(), t(1), t(0));
    s = decoded(s);
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
  });

  it('shows the frame on screen as a picture once it has decoded, even if another is requested', () => {
    // Scrubbed to 3 (still downloading) and on to 4: 3 is replaced, not waited for.
    let s = run(showing0(), t(3, 'pending'));
    expect(s.shown).toEqual({ index: 3, url: url(3), kind: 'loading' });
    s = run(s, t(4));
    expect(s.decoding).toMatchObject({ url: url(4), pending: false });
    expect(s.timedOut).toBe(0);
    s = decoded(s);
    expect(s.shown).toEqual({ index: 4, url: url(4), kind: 'picture' });
  });

  it('keeps waiting for a requested cutout that finishes downloading during its decode', () => {
    let s = run(showing0(), t(3, 'pending'), t(3, 'loaded'));
    expect(s.decoding).toMatchObject({ url: url(3), pending: false });
    s = run(s, t(4)); // a downloaded cutout's decode is waited for, as in playback
    expect(s.decoding).toMatchObject({ url: url(3) });
  });
});

describe('frame swap: failure is only a real error of that frame', () => {
  it('ignores a failure reported for another URL than the decode under way', () => {
    const s = run(showing0(), t(1));
    expect(swapReducer(s, { type: 'failed', id: id(s), url: url(0) })).toBe(s);
    expect(swapReducer(s, { type: 'failed', id: id(s), url: url(2) })).toBe(s);
  });

  it('never shows a cut-short decode of the requested frame as unavailable', () => {
    let s = aborted(run(showing0(), t(1)));
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'loading' });
    expect(s.failed).toBe(0);
    // Once the image loads it is shown.
    s = decoded(s);
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'picture' });
  });

  it('drops a cut-short decode of an older frame without a failure', () => {
    let s = aborted(run(showing0(), t(1), t(2)));
    expect(s.failed).toBe(0);
    expect(s.timedOut).toBe(1);
    expect(s.decoding).toMatchObject({ url: url(2) });
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    s = decoded(s);
    expect(s.shown?.kind).toBe('picture');
  });

  it('never shows a timed-out frame as unavailable', () => {
    let s = timeout(run(showing0(), t(1)));
    expect(s.shown?.kind).toBe('loading');
    expect(s.failed).toBe(0);
    // Played on and back: still decoded, never "failed".
    s = run(s, t(2));
    expect(s.shown?.kind).not.toBe('failed');
    s = decoded(s);
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'picture' });
  });

  it('a real failure of an older frame drops it and shows the newest request', () => {
    let s = failed(run(showing0(), t(1), t(2)));
    expect(s.failed).toBe(1);
    // 1 was never the frame on screen: nothing says "unavailable".
    expect(s.shown).toEqual({ index: 0, url: url(0), kind: 'picture' });
    s = decoded(s);
    expect(s.shown).toEqual({ index: 2, url: url(2), kind: 'picture' });
  });

  it('starts again when the <img> elements were replaced', () => {
    let s = decoded(run(showing0(), t(1)));
    s = swapReducer(s, { type: 'reset' });
    // Nothing decoded is on screen any more: the requested frame decodes again.
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'loading' });
    expect(s.frontReady).toBe(false);
    expect(s.decoding).toMatchObject({ url: url(1) });
    s = decoded(s);
    expect(s.shown).toEqual({ index: 1, url: url(1), kind: 'picture' });
  });
});

describe('shownIndexIn', () => {
  const urls = ['/a', '/b', '/c'];
  const at = (i: number) => urls[i];
  it('finds the shown cutout by index, else by URL, else null', () => {
    expect(shownIndexIn(null, at, 3)).toBeNull();
    expect(shownIndexIn({ index: 1, url: '/b', kind: 'picture' }, at, 3)).toBe(1);
    expect(shownIndexIn({ index: 0, url: '/c', kind: 'picture' }, at, 3)).toBe(2);
    expect(shownIndexIn({ index: 0, url: '/x', kind: 'picture' }, at, 3)).toBeNull();
  });
});
