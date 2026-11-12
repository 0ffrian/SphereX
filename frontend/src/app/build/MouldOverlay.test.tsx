// Q-451: the mould show finishes only the build it covered. The usual order on a first open is
// show on (the viewer is loading), then the build starts; a show still finishing when a new build
// starts (Replay during its rush) covers nothing.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_SHOW_MS, MouldOverlay } from './MouldAnimation';
import { useMouldLive } from './mouldLive';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const overlay = (active: boolean) => (
  <MouldOverlay active={active} id="x" kind="star" steps={4} reduced={false} caption="Loading" />
);

describe('MouldOverlay and the build it covers', () => {
  it('a build that starts while the show is on is the one its end finishes', async () => {
    await act(async () => root.render(overlay(true)));
    // The build starts after the show came on (first open: the viewer was still loading).
    const build = useMouldLive.getState().startBuild();
    await act(async () => root.render(overlay(false)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_SHOW_MS + 100);
    });
    expect(useMouldLive.getState().shownFor).toBe(build);
  });

  it('a build that starts while the show is already finishing is not ended by it', async () => {
    await act(async () => root.render(overlay(true)));
    const first = useMouldLive.getState().startBuild();
    await act(async () => root.render(overlay(false))); // the rush begins
    const replay = useMouldLive.getState().startBuild(); // Replay during the rush
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_SHOW_MS + 100);
    });
    expect(useMouldLive.getState().shownFor).not.toBe(replay);
    expect(useMouldLive.getState().shownFor).not.toBe(first);
  });
});
