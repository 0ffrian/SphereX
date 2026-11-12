// A21.5: a card restored from the island's pill (the pill unmounts, focus falls to <body>) focuses
// its heading; a bare card (the Flipbook) focuses the heading it draws itself.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanelCard } from './PanelCard';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  (document.activeElement as HTMLElement | null)?.blur();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('PanelCard focus on restore', () => {
  it('focuses the heading when focus was on <body>', async () => {
    await act(async () =>
      root.render(
        <PanelCard title="Known objects" icon="details" onClose={() => {}} returnFocusTo="body" testId="card">
          <p>body</p>
        </PanelCard>,
      ),
    );
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('Known objects');
  });

  it('a bare card focuses its own heading', async () => {
    await act(async () =>
      root.render(
        <PanelCard bare title="Flipbook" icon="details" onClose={() => {}} returnFocusTo="body" testId="card">
          <h2 tabIndex={-1}>Barnard&apos;s Star</h2>
        </PanelCard>,
      ),
    );
    expect(document.activeElement?.textContent).toBe("Barnard's Star");
  });

  it('leaves focus alone when it is somewhere else', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () =>
      root.render(
        <PanelCard title="Discovery" icon="details" onClose={() => {}} returnFocusTo="body" testId="card">
          <p>body</p>
        </PanelCard>,
      ),
    );
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
