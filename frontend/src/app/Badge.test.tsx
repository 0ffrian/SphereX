// D-02 Estimated badge: the formula reaches keyboard and touch users, not only mouse hover.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EstimatedBadge } from './Badge';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('EstimatedBadge', () => {
  let host: HTMLDivElement;
  let root: Root;
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<EstimatedBadge tooltip="hue = wavelength" />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('is a focusable button whose name carries the formula', () => {
    const badge = q('badge-estimated')!;
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('type')).toBe('button');
    expect(badge.textContent).toBe('Estimated: hue = wavelength');
    expect(badge.getAttribute('title')).toBe('hue = wavelength');
    expect(q('badge-estimated-note')).toBeNull();
  });

  it('a press shows the formula as visible text; a second press or Escape hides it', () => {
    const badge = q('badge-estimated')!;
    act(() => badge.click());
    const note = q('badge-estimated-note')!;
    expect(note.textContent).toBe('hue = wavelength');
    // Visual only: screen readers already read it in the button's name.
    expect(note.getAttribute('aria-hidden')).toBe('true');
    act(() => badge.click());
    expect(q('badge-estimated-note')).toBeNull();

    act(() => badge.click());
    act(() => {
      badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('badge-estimated-note')).toBeNull();
  });
});
