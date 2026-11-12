// Reduced motion stays handled by the verbatim GridLoader's own useReducedMotion (WCAG 2.2.2).
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { IDLE_LOOK } from './loaderLooks';

const reduced = vi.hoisted(() => ({ value: true }));
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  useReducedMotion: () => reduced.value,
}));

import GridLoader from './GridLoader';

function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(<GridLoader {...IDLE_LOOK} />));
  return host;
}

describe('GridLoader reduced motion', () => {
  it('draws a lit, still pattern under reduced motion and an animated one otherwise', () => {
    reduced.value = true;
    const still = render();
    reduced.value = false;
    const moving = render();
    expect(still.innerHTML).not.toBe(moving.innerHTML);
    expect(still.querySelectorAll('div').length).toBeGreaterThan(0);
  });
});
