// Runs frameSwap.ts against the flipbook's two <img> slots. Each decode is HTMLImageElement.decode()
// on the hidden slot, with a DECODE_TIMEOUT_MS timer. decode() can reject for an image that is
// fine (the browser may give up on it, e.g. in a background tab or while the image still loads),
// so a rejection is never taken at its word: the element itself says what happened (imageOutcome).
// The requested frame goes in through a layout effect, so a frame shown at once (failed, or
// already in the front slot) is never painted with the old caption first.
import { useEffect, useLayoutEffect, useReducer, useRef, type RefObject } from 'react';
import {
  DECODE_TIMEOUT_MS,
  INITIAL_SWAP,
  swapReducer,
  type SlotId,
  type SwapState,
  type SwapTarget,
} from './frameSwap';
import type { PixelSize } from './frameGrid';

/** What an <img> slot holds for `url` once decode() has settled or timed out. */
export type ImageOutcome = 'decoded' | 'broken' | 'loading' | 'other-src';

/**
 * Read the element, not the promise: `other-src` when its src is no longer `url` (cut short, not a
 * failure); `decoded` when the image has loaded (the browser paints it even if decode() gave up);
 * `broken` only for a completed request with no image (a real load or decode error); else
 * `loading`.
 */
export function imageOutcome(img: HTMLImageElement, url: string): ImageOutcome {
  if (img.getAttribute('src') !== url) return 'other-src';
  if (!img.complete) return 'loading';
  return img.naturalWidth > 0 ? 'decoded' : 'broken';
}

/** decode() where there is one (not in jsdom); resolves to whether it succeeded, never rejects. */
function tryDecode(img: HTMLImageElement): Promise<boolean> {
  if (typeof img.decode !== 'function') return Promise.resolve(false);
  return img.decode().then(
    () => true,
    () => false,
  );
}

export interface FrameSwap {
  state: SwapState;
  slots: readonly [RefObject<HTMLImageElement | null>, RefObject<HTMLImageElement | null>];
}

/**
 * `target`: the requested frame, or null when there is none. `onSize`: the natural size of each
 * decoded cutout, reported before it is shown (for frames whose size the reply does not state).
 */
export function useFrameSwap(
  target: SwapTarget | null,
  onSize: (url: string, size: PixelSize) => void,
): FrameSwap {
  const [state, dispatch] = useReducer(swapReducer, INITIAL_SWAP);
  const slot0 = useRef<HTMLImageElement | null>(null);
  const slot1 = useRef<HTMLImageElement | null>(null);
  const onSizeRef = useRef(onSize);
  useLayoutEffect(() => {
    onSizeRef.current = onSize;
  });

  // The <img> elements were replaced (the viewer unmounts while the composite shows): what the old
  // ones had decoded is gone, so start again before the new ones are painted.
  const seen = useRef<{ els: readonly (HTMLImageElement | null)[]; mounted: boolean }>({
    els: [null, null],
    mounted: false,
  });
  useLayoutEffect(() => {
    const els = [slot0.current, slot1.current];
    const prev = seen.current;
    const replaced = prev.mounted && els.some((el, i) => el !== null && el !== prev.els[i]);
    seen.current = { els, mounted: prev.mounted || els.some((el) => el !== null) };
    if (replaced) dispatch({ type: 'reset' });
  });

  const index = target?.index;
  const url = target?.url;
  const status = target?.status;
  useLayoutEffect(() => {
    if (index === undefined || url === undefined || status === undefined) return;
    dispatch({ type: 'target', target: { index, url, status } });
  }, [index, url, status]);

  const decoding = state.decoding;
  const id = decoding?.id;
  const slot: SlotId | undefined = decoding?.slot;
  const decodingUrl = decoding?.url;
  useEffect(() => {
    if (id === undefined || slot === undefined || decodingUrl === undefined) return;
    const img = (slot === 0 ? slot0 : slot1).current;
    if (!img) return;
    let live = true;
    let waiting = false;

    const report = (outcome: ImageOutcome) => {
      if (!live) return;
      if (outcome === 'decoded') {
        onSizeRef.current(decodingUrl, { w: img.naturalWidth, h: img.naturalHeight });
        dispatch({ type: 'decoded', id });
      } else if (outcome === 'broken') {
        dispatch({ type: 'failed', id, url: decodingUrl });
      } else if (outcome === 'other-src') {
        dispatch({ type: 'aborted', id });
      } else {
        // Still loading: wait for the element's own load or error (it ends either way).
        waitForLoad();
      }
    };
    const onEvent = () => {
      img.removeEventListener('load', onEvent);
      img.removeEventListener('error', onEvent);
      const o = imageOutcome(img, decodingUrl);
      // After load or error the request is complete; if it still reads as loading, a new request
      // replaced it: cut short, not a failure.
      report(o === 'loading' ? 'other-src' : o);
    };
    const waitForLoad = () => {
      if (waiting) return;
      waiting = true;
      img.addEventListener('load', onEvent);
      img.addEventListener('error', onEvent);
      // It may have finished between the check and the listeners.
      const o = imageOutcome(img, decodingUrl);
      if (o !== 'loading') onEvent();
    };

    // Whether decode() resolved or rejected, the element decides (a rejection on a loaded image is
    // the browser giving up on decode(), not a broken image).
    void tryDecode(img).then(() => report(imageOutcome(img, decodingUrl)));
    const timer = setTimeout(() => {
      if (!live) return;
      const o = imageOutcome(img, decodingUrl);
      // Loaded but decode() has not answered: show it anyway. Otherwise stop holding the old
      // picture (frameSwap.ts) and keep waiting for the image.
      if (o === 'decoded' || o === 'broken') report(o);
      else {
        dispatch({ type: 'timeout', id });
        if (o === 'loading') waitForLoad();
      }
    }, DECODE_TIMEOUT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      img.removeEventListener('load', onEvent);
      img.removeEventListener('error', onEvent);
    };
  }, [id, slot, decodingUrl]);

  return { state, slots: [slot0, slot1] };
}
