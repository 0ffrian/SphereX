// The runs list's Escape (A21.10): it closes the list and gives focus back to the button, unless
// the press was already taken, as by a handler inside the list (a menu, a popover). One Escape
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

describe('RunsMenu filter', () => {
  it('says so when a filter has no runs, instead of an empty list', async () => {
    const run = {
      run_id: 'run-20261113T070000-aaaaaa',
      kind: 'discovery',
      release: 'spherex_dr1',
      region: { ra: 207.9, dec: -11.45, width_deg: 3.6, height_deg: 1.2 },
      state: 'done',
      created_at: '2026-11-13T07:00:00Z',
      duration_s: 540,
      squares_total: 3,
      squares_done: 3,
      totals: { known: 2, found: 1, unexplained: 1, squares_done: 3, squares_skipped: 0 },
    };
    await act(async () => useRunsStore.setState({ runs: [run as never], filter: 'known' }));
    const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    expect(q('runs-rows')).toBeNull();
    expect(q('runs-none')?.textContent).toBe('No Known objects runs yet.');
    await act(async () => useRunsStore.setState({ filter: 'discovery' }));
    expect(q('runs-none')).toBeNull();
    expect(host.querySelectorAll('[data-testid="runs-row"]')).toHaveLength(1);
  });
});
