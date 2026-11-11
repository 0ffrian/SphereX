// Test helper (src/test/ is test-only code): render a React tree into jsdom with createRoot + act,
// as the repo's component tests do (no Testing Library dependency).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

export interface Mounted {
  host: HTMLDivElement;
  render(node: ReactNode): void;
  unmount(): void;
  q<T extends Element = HTMLElement>(testId: string): T | null;
}

export function mount(node?: ReactNode): Mounted {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const m: Mounted = {
    host,
    render: (n) => act(() => root.render(n)),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
    q: <T extends Element = HTMLElement>(id: string) =>
      host.querySelector<T>(`[data-testid="${id}"]`),
  };
  if (node !== undefined) m.render(node);
  return m;
}

/** A matchMedia stub: `reduced` answers prefers-reduced-motion. */
export function stubMatchMedia(reduced: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
