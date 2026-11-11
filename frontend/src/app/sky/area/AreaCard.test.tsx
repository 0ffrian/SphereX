// Area card, visits and blink, honesty switch, rail entry, Escape (A18.1 to A18.3; issue #96).
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/app/api/client';
import { RailIcon } from '@/app/shell/railIcons';
import { useShellStore } from '@/app/shell/shellStore';
import { setSkyDrawHandler } from '@/app/sky/layers';
import { useSkyFlyStore } from '@/app/sky/skyFlyTo';
import { initialAreaState, resetAreaRequests } from '@/state/area';
import { initialAppData, setSkyApi, useAppStore } from '@/state/store';
import { fixtureFetch } from '@/test/fixtureFetch';
import { mount, stubMatchMedia, type Mounted } from '@/test/mount';
import { AreaCard } from './AreaCard';
import { enterAreaTool } from './areaTool';
import { BLINK_MS } from './blink';
import { useBlink, useDrawEscape } from './useAreaLifecycle';
import { VisitControls } from './VisitControls';

const fixtureApi = createApiClient({ fetchImpl: fixtureFetch });
const store = () => useAppStore.getState();

function Lifecycle() {
  useBlink();
  useDrawEscape();
  return null;
}

const click = (el: Element | null) => act(() => (el as HTMLElement).click());

describe('Area card', () => {
  let m: Mounted;
  beforeEach(() => {
    stubMatchMedia(false);
    resetAreaRequests();
    useAppStore.setState({ ...initialAppData, area: initialAreaState });
    useShellStore.setState({ tool: 'sky', pointerMode: 'pan', cardRequested: false });
    setSkyApi(fixtureApi);
  });
  afterEach(() => m?.unmount());

  it('is a rail tool with a dashed-square icon (strokes of length 1)', () => {
    m = mount(<RailIcon id="area" />);
    const paths = m.host.querySelectorAll('path, circle');
    expect(paths.length).toBeGreaterThan(4);
    for (const p of paths) expect(p.getAttribute('pathLength')).toBe('1');
  });

  it('opens on the tool with the draw hint, draw mode and focus on its heading; no live region', async () => {
    m = mount(<AreaCard />);
    await act(async () => enterAreaTool());
    expect(useShellStore.getState().pointerMode).toBe('draw');
    expect(m.q('area-card-subtitle')?.textContent).toBe(
      'Drag a square over the part of the sky you want to search',
    );
    expect(m.q('area-use-middle')).not.toBeNull();
    expect(m.q('area-keep-last')).toBeNull();
    expect(document.activeElement).toBe(m.q('area-card-title'));
    expect(m.host.querySelector('[aria-live]')).toBeNull();
  });

  it('lists the prepared areas with Fly there when the square is not prepared', async () => {
    m = mount(<AreaCard />);
    await act(async () => enterAreaTool());
    await act(async () => void (await store().areaSearchSquare({ ra: 30, dec: 0, sideDeg: 0.5 })));
    expect(m.q('area-not-prepared')?.textContent).toMatch(/not prepared/);
    const fly = m.host.querySelectorAll<HTMLButtonElement>('[data-testid="area-fly-there"]');
    expect(fly).toHaveLength(2);
    const seq = useSkyFlyStore.getState().seq;
    click(fly[0]!);
    expect(useSkyFlyStore.getState()).toMatchObject({
      seq: seq + 1,
      cmd: { box: { area_id: 'fixture:area-main' } },
    });
    expect(m.q('area-keep-last')).not.toBeNull();
  });

  it('after a snap: title, precomputed run date, layers, visits, badges; Measured only note', async () => {
    m = mount(<AreaCard />);
    await act(async () => enterAreaTool());
    await act(async () => void (await store().areaOpen('fixture:area-main', 'fly')));
    await act(async () => {
      await vi.waitFor(() => expect(store().area.tracks.status).toBe('ready'));
    });
    expect(m.q('area-card-title')?.textContent).toBe('Area · 1.00° × 0.60°');
    expect(m.q('area-card-subtitle')?.textContent).toBe(
      '16 SPHEREx frames in 2 visits · 15 to 16 Jan 2026',
    );
    expect(m.q('area-precomputed')?.textContent).toBe('Precomputed · run 2026-11-10 12:00:00 UTC');
    expect(m.q<HTMLInputElement>('area-layer-dots')?.checked).toBe(true);
    expect(m.q<HTMLInputElement>('area-layer-tracks')?.checked).toBe(true);
    expect(m.host.querySelectorAll('[data-testid="area-badge-row"]').length).toBeGreaterThan(4);
    // Synthetic data never wears Measured.
    expect(m.q('area-badges')?.textContent).not.toMatch(/Measured/);
    click(m.q('area-honesty-measured'));
    expect(store().honesty).toBe('measured');
    expect(m.q('area-measured-note')?.textContent).toBe('Tracks and known paths are Estimated');
    click(m.q('area-honesty-derived'));
    expect(store().honesty).toBe('derived');
    useAppStore.setState({ honesty: 'artistic' });
    await act(async () => undefined);
    expect(m.q('area-artistic-note')).not.toBeNull();
    click(m.q('area-honesty-derived'));
    expect(store().honesty).toBe('artistic');
  });

  it('× leaves the tool, keeps the area and focuses the rail button', async () => {
    const rail = document.createElement('button');
    rail.dataset.testid = 'tool-area';
    document.body.appendChild(rail);
    m = mount(<AreaCard />);
    await act(async () => enterAreaTool());
    await act(async () => void (await store().areaOpen('fixture:area-main', 'fly')));
    click(m.q('area-card-close'));
    expect(useShellStore.getState().tool).toBe('sky');
    expect(store().area.areaId).toBe('fixture:area-main');
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(document.activeElement).toBe(rail);
    rail.remove();
    // Choosing the tool again restores the card in pan mode.
    await act(async () => enterAreaTool());
    expect(useShellStore.getState().pointerMode).toBe('pan');
    expect(m.q('area-card-title')?.textContent).toBe('Area · 1.00° × 0.60°');
  });
});

describe('VisitControls and blink', () => {
  let m: Mounted;
  beforeEach(() => {
    resetAreaRequests();
    useAppStore.setState({ ...initialAppData, area: initialAreaState });
    useShellStore.setState({
      tool: 'area',
      pointerMode: 'pan',
      build: { ...useShellStore.getState().build, open: false },
    });
    setSkyApi(fixtureApi);
  });
  afterEach(() => {
    m?.unmount();
    vi.useRealTimers();
  });

  it('one option per visit and a pressed blink with a visible stop', async () => {
    stubMatchMedia(false);
    await store().areaOpen('fixture:area-multivisit', 'fly');
    m = mount(<VisitControls />);
    const radios = m.host.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(4);
    expect(radios[0]!.textContent).toBe('Visit 1 · 3 Feb 06:00 UTC');
    const blink = m.q('area-blink')!;
    expect(blink.getAttribute('aria-label')).toBe('Blink the 4 visits');
    click(blink);
    expect(blink.getAttribute('aria-pressed')).toBe('true');
    expect(m.q('area-blink-stop')).not.toBeNull();
    click(blink);
    expect(blink.getAttribute('aria-pressed')).toBe('false');
  });

  it('under reduced motion: "Next visit", no aria-pressed, each press steps and is said', async () => {
    stubMatchMedia(true);
    await store().areaOpen('fixture:area-main', 'fly');
    m = mount(<VisitControls />);
    expect(m.q('area-blink')).toBeNull();
    const next = m.q('area-next-visit')!;
    expect(next.hasAttribute('aria-pressed')).toBe(false);
    click(next);
    expect(store().area.visit).toBe(2);
    expect(store().sky.announcement).toMatch(/^Visit 2 of 2/);
  });

  it('fewer than two visits: says so, no blink', () => {
    stubMatchMedia(false);
    m = mount(<VisitControls />);
    expect(m.q('area-needs-two-visits')?.textContent).toBe('Needs two visits to compare');
  });

  it('cycles 1→2→3→4→1 every 750 ms and stops on each stop condition', async () => {
    stubMatchMedia(false);
    await store().areaOpen('fixture:area-multivisit', 'fly');
    vi.useFakeTimers();
    m = mount(<Lifecycle />);
    const start = () => act(() => store().areaSetBlink(true));
    start();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(BLINK_MS));
      seen.push(store().area.visit);
    }
    expect(seen).toEqual([2, 3, 4, 1]);
    // Tool change.
    act(() => useShellStore.getState().setTool('sky'));
    expect(store().area.blink).toBe(false);
    act(() => useShellStore.setState({ tool: 'area' }));
    // Split pane opens.
    start();
    act(() => useShellStore.setState({ build: { ...useShellStore.getState().build, open: true } }));
    expect(store().area.blink).toBe(false);
    act(() =>
      useShellStore.setState({ build: { ...useShellStore.getState().build, open: false } }),
    );
    // Card closes.
    start();
    act(() => store().areaCloseCard());
    expect(store().area.blink).toBe(false);
    act(() => store().areaShowCard());
    // Page hidden.
    start();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(store().area.blink).toBe(false);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    // No tick after stopping.
    const v = store().area.visit;
    act(() => vi.advanceTimersByTime(BLINK_MS * 3));
    expect(store().area.visit).toBe(v);
  });
});

describe('Escape while drawing (rank 3, capture phase)', () => {
  let m: Mounted;
  afterEach(() => m?.unmount());

  it('leaves drawing, drops the drag, marks the event handled; skipped in a text field', () => {
    useShellStore.setState({ tool: 'area', pointerMode: 'draw' });
    const cancel = vi.fn();
    const off = setSkyDrawHandler({ start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel });
    m = mount(<Lifecycle />);
    let laterSawHandled = false;
    const later = (e: KeyboardEvent) => (laterSawHandled = e.defaultPrevented);
    window.addEventListener('keydown', later);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(
      () =>
        void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(useShellStore.getState().pointerMode).toBe('draw');
    act(
      () =>
        void window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }),
        ),
    );
    expect(useShellStore.getState().pointerMode).toBe('pan');
    expect(cancel).toHaveBeenCalled();
    expect(laterSawHandled).toBe(true);
    window.removeEventListener('keydown', later);
    input.remove();
    off();
  });
});
