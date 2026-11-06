// The 3D viewer panel with a fake renderer (no GPU): controls, legend, badges, refused layers,
// canvas label and live announcements (R5.3, R7.3, R9, D-02, D-21).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialAppData, useAppStore } from '@/state/store';
import { fixture } from '@/test/sharedFixtures';
import type { RenderPlan } from '@/viewer/planTypes';
import { CANDIDATE_MESSAGE } from '@/viewer/renderPlan';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const shown: RenderPlan[] = [];
const fake = {
  backend: 'webgl2' as const,
  showPlan: vi.fn((p: RenderPlan) => void shown.push(p)),
  clearObject: vi.fn(),
  setLoadFailedHandler: vi.fn(),
  rotate: vi.fn(),
  zoom: vi.fn(),
  resetView: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('@/viewer/ViewerApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/viewer/ViewerApp')>();
  return { ...actual, ViewerApp: { create: vi.fn(async () => fake) } };
});

// Imported after the mock is registered (vi.mock is hoisted).
import { ViewerPanel } from './ViewerPanel';

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<ViewerPanel />);
  });
  await act(async () => {}); // let ViewerApp.create resolve
}

const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as
    HTMLButtonElement | undefined;
const click = async (name: string) => {
  const b = button(name);
  expect(b, `button "${name}"`).toBeDefined();
  await act(async () => {
    b!.click();
  });
};
const canvasLabel = () => container.querySelector('canvas')?.getAttribute('aria-label') ?? '';

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  shown.length = 0;
  Object.values(fake).forEach((f) => typeof f === 'function' && 'mockClear' in f && f.mockClear());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ViewerPanel', () => {
  it('shows the placeholder when no object is loaded', async () => {
    await mount();
    expect(container.textContent).toContain('Viewer placeholder: no object loaded');
    expect(canvasLabel()).toContain('no object loaded');
    expect(container.querySelector('[role="group"][aria-label="Honesty level"]')).toBeNull();
  });

  it('starts at + Estimated and gives each layer a badge, with refused layers in plain words', async () => {
    const { card, params } = fixture('asteroid_procedural');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(button('+ Estimated')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Measured only')?.getAttribute('aria-pressed')).toBe('false');
    const badges = [
      ...container.querySelectorAll('[data-testid="legend"] [data-testid="provenance-badge"]'),
    ];
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.map((b) => b.textContent)).toEqual(expect.arrayContaining(['Estimated']));
    expect(text('missing-list')).toContain(
      'Surface relief: hidden at this level. This layer is marked “Default”.',
    );
    expect(text('missing-list')).toContain('Switch to “+ Artistic”');
    expect(canvasLabel()).toContain(card.name);
    expect(shown.at(-1)?.honesty).toBe('derived');
  });

  it('Measured only draws nothing but measured layers, updates the label and announces it', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    const before = canvasLabel();
    await click('Measured only');
    expect(useAppStore.getState().honesty).toBe('measured');
    const last = shown.at(-1)!;
    expect(last.drawn.every((l) => l.tag === 'measured')).toBe(true);
    for (const li of container.querySelectorAll(
      '[data-testid="legend"] [data-testid="provenance-badge"]',
    )) {
      expect(li.textContent).toBe('Measured');
    }
    expect(canvasLabel()).not.toBe(before);
    expect(text('viewer-announcer')).toMatch(/^Measured only\./);
  });

  it('changing the view mode updates the label and announces it', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    await click('SPHEREx infrared');
    expect(button('SPHEREx infrared')?.getAttribute('aria-pressed')).toBe('true');
    expect(canvasLabel()).toContain('SPHEREx infrared false colour');
    expect(text('viewer-announcer')).toMatch(/^SPHEREx infrared view\./);
  });

  it('disables a mode that is not available and says why in the list', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(button('Visible colour')?.disabled).toBe(true);
    expect(text('missing-list')).toContain('Visible-colour view: not drawn.');
  });

  it('the comet has an epoch toggle that changes the shells and is announced', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    await click('Aug 2025');
    expect(button('Aug 2025')?.getAttribute('aria-pressed')).toBe('true');
    expect(shown.at(-1)?.epoch).toBe('2025-08');
    expect(shown.at(-1)?.shells).toHaveLength(3);
    expect(text('viewer-announcer')).toMatch(/^August 2025\. Gas shells: CO₂, H₂O, CO\./);
    await click('Dec 2025');
    expect(shown.at(-1)?.shells).toHaveLength(0); // the fixture card holds August Q only
    expect(text('missing-list')).toContain('Gas shells: not shown for December 2025.');
  });

  it('shows the scale bar with a comparison', async () => {
    const { card, params } = fixture('asteroid_shape');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('scale-bar')).toContain('10 km across');
    expect(text('scale-bar')).toContain('Le Morne Brabant');
  });

  it('a candidate shows the R7.6 message, no view-mode or epoch controls, and no scale bar', async () => {
    const { card, params } = fixture('candidate');
    useAppStore.getState().setObject(card, params);
    await mount();
    expect(text('viewer-message')).toBe(CANDIDATE_MESSAGE);
    expect(container.querySelector('[role="group"][aria-label="View mode"]')).toBeNull();
    expect(container.querySelector('[data-testid="scale-bar"]')).toBeNull();
  });

  it('shows what happens when nothing can be drawn at the chosen level', async () => {
    const { card, params } = fixture('brown_dwarf');
    useAppStore.getState().setObject(card, params);
    useAppStore.getState().setHonesty('measured');
    await mount();
    expect(container.querySelector('[data-testid="viewer-nothing"]')).not.toBeNull();
    expect(text('missing-list')).toContain('hidden at this level');
  });

  it('every control is at least 24 px (44 px by class)', async () => {
    const { card, params } = fixture('comet');
    useAppStore.getState().setObject(card, params);
    await mount();
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) expect(b.className).toMatch(/min-h-11/);
  });
});
