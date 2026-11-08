// useFrameSwap against real <img> elements (jsdom, with decode(), complete and naturalWidth
// stubbed): the shown frame changes only after the hidden slot has decoded; a decode() rejection
// on an image that loaded, a decode cut short and a timeout never show "unavailable"; only a real
// load error does, for that frame's own URL; replaced <img> elements are decoded again.
import { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECODE_TIMEOUT_MS, type SwapState, type SwapTarget } from './frameSwap';
import { imageOutcome, useFrameSwap } from './useFrameSwap';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Pending {
  img: HTMLImageElement;
  src: string;
  resolve(): void;
  reject(): void;
}

let host: HTMLDivElement;
let root: Root;
let pending: Pending[];
let last: SwapState;
const sizes: string[] = [];
/** What each stubbed image reports, by src (default: loaded, 59×34). */
const images = new Map<string, { complete: boolean; w: number }>();
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

function record(s: SwapState) {
  last = s;
}

function Harness({ target, mounted = true }: { target: SwapTarget; mounted?: boolean }) {
  const swap = useFrameSwap(target, (url, s) => sizes.push(`${url} ${s.w}x${s.h}`));
  useLayoutEffect(() => record(swap.state));
  if (!mounted) return null;
  return (
    <>
      {([0, 1] as const).map((slot) => (
        <img key={slot} ref={swap.slots[slot]} src={swap.state.srcs[slot] ?? undefined} alt="" />
      ))}
    </>
  );
}

const URL = (i: number) => `/c/${i}.png`;
const target = (i: number, status: SwapTarget['status'] = 'loaded'): SwapTarget => ({
  index: i,
  url: URL(i),
  status,
});
const render = (t: SwapTarget, mounted = true) =>
  act(() => root.render(<Harness target={t} mounted={mounted} />));
const flush = () =>
  act(async () => {
    for (let k = 0; k < 3; k++) await Promise.resolve();
  });
async function finish(p: Pending | undefined, ok: boolean) {
  if (!p) throw new Error('no decode() call');
  if (ok) p.resolve();
  else p.reject();
  await flush();
}
const decodeOf = (i: number) => pending.filter((p) => p.src === URL(i)).at(-1);
const info = (img: HTMLImageElement) =>
  images.get(img.getAttribute('src') ?? '') ?? { complete: true, w: 59 };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  pending = [];
  sizes.length = 0;
  images.clear();
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value(this: HTMLImageElement) {
      return new Promise<void>((resolve, reject) => {
        pending.push({
          img: this,
          src: this.getAttribute('src') ?? '',
          resolve,
          reject: () => reject(new DOMException('The source image cannot be decoded.')),
        });
      });
    },
  });
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return info(this).complete;
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(function (
    this: HTMLImageElement,
  ) {
    return info(this).w;
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(34);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
  else delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
});

describe('imageOutcome', () => {
  it('reads the element: other src, loading, decoded or broken', () => {
    const img = document.createElement('img');
    img.setAttribute('src', URL(1));
    expect(imageOutcome(img, URL(2))).toBe('other-src');
    images.set(URL(1), { complete: false, w: 0 });
    expect(imageOutcome(img, URL(1))).toBe('loading');
    images.set(URL(1), { complete: true, w: 59 });
    expect(imageOutcome(img, URL(1))).toBe('decoded');
    images.set(URL(1), { complete: true, w: 0 });
    expect(imageOutcome(img, URL(1))).toBe('broken');
  });
});

describe('useFrameSwap', () => {
  it('changes the shown frame only after decode() resolves on the hidden slot', async () => {
    render(target(0));
    expect(last.shown?.kind).toBe('loading');
    expect(pending.map((p) => p.src)).toEqual([URL(0)]);
    await finish(decodeOf(0), true);
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    expect(sizes).toEqual([`${URL(0)} 59x34`]);
    const front = last.front;

    render(target(1));
    // Requested 1: the hidden slot loads it, the viewer still shows 0.
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    const imgs = host.querySelectorAll('img');
    expect(imgs[front]!.getAttribute('src')).toBe(URL(0));
    expect(imgs[front === 0 ? 1 : 0]!.getAttribute('src')).toBe(URL(1));
    await finish(decodeOf(1), true);
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
    expect(last.front).not.toBe(front);
    // The same two elements throughout: nothing was remounted.
    expect(host.querySelectorAll('img')[0]).toBe(imgs[0]);
    expect(host.querySelectorAll('img')[1]).toBe(imgs[1]);
  });

  it('shows a loaded image even when decode() rejects (never "unavailable")', async () => {
    render(target(0));
    await finish(decodeOf(0), true);
    render(target(1));
    await finish(decodeOf(1), false); // the browser gave up on decode(); the image is loaded
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
    expect(last.failed).toBe(0);
  });

  it('waits for the image when decode() rejects while it still loads', async () => {
    render(target(0));
    await finish(decodeOf(0), true);
    images.set(URL(1), { complete: false, w: 0 });
    render(target(1));
    await finish(decodeOf(1), false);
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    expect(last.failed).toBe(0);
    images.set(URL(1), { complete: true, w: 59 });
    act(() => decodeOf(1)!.img.dispatchEvent(new Event('load')));
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
  });

  it('shows "unavailable" only for a real load error of that frame', async () => {
    render(target(0));
    await finish(decodeOf(0), true);
    images.set(URL(1), { complete: true, w: 0 }); // the request completed with no image
    render(target(1));
    await finish(decodeOf(1), false);
    expect(last.shown).toMatchObject({ index: 1, kind: 'failed' });
    expect(last.failed).toBe(1);
    render(target(2));
    await finish(decodeOf(2), true);
    expect(last.shown).toMatchObject({ index: 2, kind: 'picture' });
  });

  it('a decode cut short (the slot holds another src) is not a failure', async () => {
    render(target(0));
    await finish(decodeOf(0), true);
    render(target(1));
    const p = decodeOf(1)!;
    p.img.setAttribute('src', '/someone-else.png');
    await finish(p, false);
    expect(last.failed).toBe(0);
    expect(last.shown).toMatchObject({ index: 1, kind: 'loading' });
  });

  it('shows a loaded image at the timeout when decode() never answers', async () => {
    vi.useFakeTimers();
    render(target(0));
    await finish(decodeOf(0), true);
    render(target(1));
    act(() => vi.advanceTimersByTime(DECODE_TIMEOUT_MS - 1));
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    act(() => vi.advanceTimersByTime(1));
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
    expect(last.failed).toBe(0);
  });

  it('stops holding the old picture at the timeout while the image loads, then shows it', async () => {
    vi.useFakeTimers();
    render(target(0));
    await finish(decodeOf(0), true);
    images.set(URL(1), { complete: false, w: 0 });
    render(target(1));
    act(() => vi.advanceTimersByTime(DECODE_TIMEOUT_MS));
    expect(last.shown).toMatchObject({ index: 1, kind: 'loading' });
    images.set(URL(1), { complete: true, w: 59 });
    act(() => decodeOf(1)!.img.dispatchEvent(new Event('load')));
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
    expect(last.failed).toBe(0);
  });

  it('drops an older decode that hangs and shows the newest request', async () => {
    vi.useFakeTimers();
    render(target(0));
    await finish(decodeOf(0), true);
    images.set(URL(1), { complete: false, w: 0 });
    render(target(1));
    render(target(2)); // 1 still decoding
    act(() => vi.advanceTimersByTime(DECODE_TIMEOUT_MS));
    expect(last.timedOut).toBe(1);
    await finish(decodeOf(2), true);
    expect(last.shown).toMatchObject({ index: 2, kind: 'picture' });
    // 1's decode answering late changes nothing.
    await finish(decodeOf(1), false);
    expect(last.shown).toMatchObject({ index: 2, kind: 'picture' });
    expect(last.failed).toBe(0);
  });

  it('shows a failed cutout at once, without a decode', () => {
    render(target(0, 'failed'));
    expect(last.shown).toMatchObject({ index: 0, kind: 'failed' });
    expect(pending).toEqual([]);
  });

  it('the reported case: preloaded cutouts whose decode() rejects are shown, never "unavailable"', async () => {
    // Every cutout loaded (preloaded, in the cache); the browser rejects every decode() call, as
    // Chrome may for a hidden or background-tab image. Played through, then paused on each.
    render(target(0));
    await finish(decodeOf(0), false);
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    for (let i = 1; i <= 6; i++) {
      render(target(i));
      await finish(decodeOf(i), false);
      expect(last.shown).toMatchObject({ index: i, kind: 'picture' });
    }
    expect(last.failed).toBe(0);
    expect(last.timedOut).toBe(0);
  });

  it('works under StrictMode (effects run twice): one shown picture per frame, no failure', async () => {
    const strict = (t: SwapTarget) =>
      act(() =>
        root.render(
          <StrictMode>
            <Harness target={t} />
          </StrictMode>,
        ),
      );
    strict(target(0));
    // The doubled effect asks for decode() twice; the first answer is from a cleaned-up run.
    for (const p of pending.filter((q) => q.src === URL(0))) p.reject();
    await flush();
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
    strict(target(1));
    for (const p of pending.filter((q) => q.src === URL(1))) p.resolve();
    await flush();
    expect(last.shown).toMatchObject({ index: 1, kind: 'picture' });
    expect(last.failed).toBe(0);
    // The same <img> elements throughout: StrictMode's re-run is not a replacement.
    expect(last.nextId).toBe(3);
  });

  it('decodes again when the <img> elements are replaced', async () => {
    render(target(0));
    await finish(decodeOf(0), true);
    render(target(0), false); // the viewer is hidden (composite)
    render(target(0), true); // and shown again: new elements
    expect(last.shown).toMatchObject({ index: 0, kind: 'loading' });
    const again = decodeOf(0)!;
    expect(again.img.isConnected).toBe(true);
    await finish(again, true);
    expect(last.shown).toMatchObject({ index: 0, kind: 'picture' });
  });
});
