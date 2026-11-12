import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialAppData, useAppStore } from '@/state/store';
import { FrameRate } from './FrameRate';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('FrameRate', () => {
  it('shows the speed, opens a menu of speeds and sets the one chosen', async () => {
    await act(async () => root.render(<FrameRate />));
    const btn = q('frame-rate-button')!;
    expect(btn.getAttribute('aria-label')).toBe('Frame rate, 2 frames a second');
    expect(q('frame-rate-menu')).toBeNull();
    await act(async () => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(q('frame-rate-2')!.getAttribute('aria-checked')).toBe('true');
    await act(async () => q('frame-rate-4')!.click());
    expect(useAppStore.getState().sky.fps).toBe(4);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toContain('4');
  });

  it('Escape closes the menu and focus goes back to the button', async () => {
    await act(async () => root.render(<FrameRate />));
    const btn = q('frame-rate-button')!;
    await act(async () => btn.click());
    const menu = q('frame-rate-menu')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });
});
