// The runs list's Escape (A21.10): it closes the list and gives focus back to the button, unless
// the press was already taken, as the sky credit popover takes it in the capture phase. One Escape
// closes one thing.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunsStore } from '@/app/area/runsStore';
import { RunsMenu } from './RunsMenu';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
const initial = useRunsStore.getState();
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia (the animated icons ask for reduced motion)...
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  // Nor an IntersectionObserver (motion's in-view for the animated icons).
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useRunsStore.setState({ open: true, status: 'ready', runs: [] });
  await act(async () => root.render(<RunsMenu />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useRunsStore.setState(initial, true);
  vi.unstubAllGlobals();
});

const escape = (el: Element) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });

describe('RunsMenu Escape', () => {
  it('closes the list and focuses the runs button', async () => {
    const menu = host.querySelector('[data-testid="runs-menu"]')!;
    expect(menu).not.toBeNull();
    await escape(menu.querySelector('button') ?? menu);
    expect(useRunsStore.getState().open).toBe(false);
    expect(document.activeElement).toBe(host.querySelector('[data-testid="runs-button"]'));
  });

  it('leaves the list open when the press was already taken (the credit popover)', async () => {
    const take = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', take, true);
    try {
      const menu = host.querySelector('[data-testid="runs-menu"]')!;
      await escape(menu.querySelector('button') ?? menu);
      expect(useRunsStore.getState().open).toBe(true);
    } finally {
      window.removeEventListener('keydown', take, true);
    }
  });
});
