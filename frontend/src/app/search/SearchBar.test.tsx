import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { isEditableTarget, isSearchShortcut } from '@/app/shell/shortcuts';
import { DEMO_TARGETS, filterTargets } from './demoTargets';
import { CLOSING_HINT, NO_MATCH_HINT, SearchBar } from './SearchBar';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe('SearchBar (the demo list as an ARIA combobox)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let skySearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    skySearch = vi.fn(() => Promise.resolve());
    useAppStore.setState({ skySearch } as never);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<SearchBar />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const input = () => host.querySelector<HTMLInputElement>('[data-testid="search-input"]')!;
  const listbox = () => host.querySelector('[role="listbox"]');
  const options = () => [...host.querySelectorAll('[role="option"]')];
  const names = () => options().map((o) => o.querySelector('span')!.textContent);

  const focus = () => act(() => input().focus());
  const type = (value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  const key = (k: string) =>
    act(() => {
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    });

  it('has no "Try:" chips, and the list is closed until the field is used', () => {
    expect(host.textContent).not.toContain('Try:');
    expect(host.querySelector('.sx-chips, .sx-chip')).toBeNull();
    expect(listbox()).toBeNull();
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on focus with all 16 rows in order, and wires the ARIA ids', () => {
    focus();
    expect(options()).toHaveLength(16);
    expect(names().slice(0, 3)).toEqual(["Barnard's Star", 'Epsilon Indi B', 'WISE 0855-0714']);
    expect(names()[15]).toBe('Crab Nebula');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(listbox()!.id);
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('opens with the "/" shortcut, which focuses the field', () => {
    expect(
      isSearchShortcut({
        key: '/',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        editable: isEditableTarget(document.body),
        handled: false,
      }),
    ).toBe(true);
    // App.tsx's handler does exactly this to the field.
    act(() => {
      input().focus();
      input().select();
    });
    expect(options()).toHaveLength(16);
    expect(document.activeElement).toBe(input());
  });

  it('shows a class label only when the row has one, and never a made-up one', () => {
    expect(DEMO_TARGETS.every((t) => t.classLabel === null)).toBe(true);
    focus();
    expect(host.querySelectorAll('[role="option"] em')).toHaveLength(0);
  });

  it('filters on the name and aliases, ignoring case, apostrophes and spaces', () => {
    focus();
    type('oumuamua');
    expect(names()).toEqual(["'Oumuamua"]);
    type('Wise 0855');
    expect(names()).toEqual(['WISE 0855-0714']);
    type('BARNARDS');
    expect(names()).toEqual(["Barnard's Star"]);
    type('trappist');
    expect(names()).toEqual(['TRAPPIST-1 f', 'TRAPPIST-1 e']);
    expect(filterTargets(DEMO_TARGETS, "o'um uamua").map((t) => t.name)).toEqual(["'Oumuamua"]);
  });

  it('ArrowDown and ArrowUp move the highlight, and Enter picks it', () => {
    focus();
    key('ArrowDown');
    key('ArrowDown');
    const second = options()[1]!;
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(input().getAttribute('aria-activedescendant')).toBe(second.id);
    key('ArrowUp');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    key('ArrowDown');
    key('Enter');
    expect(skySearch).toHaveBeenCalledTimes(1);
    expect(skySearch).toHaveBeenCalledWith({ q: 'Epsilon Indi B', kind: 'name', origin: 'input' });
    expect(input().value).toBe('Epsilon Indi B');
    expect(listbox()).toBeNull(); // a pick closes the list
    expect(document.activeElement).toBe(input());
  });

  it('a click on a row picks it and keeps focus in the input', () => {
    focus();
    act(() => options()[8]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(skySearch).toHaveBeenCalledWith({ q: "'Oumuamua", kind: 'name', origin: 'input' });
    expect(document.activeElement).toBe(input());
  });

  it('Escape closes the list and keeps the text; typing opens it again', () => {
    focus();
    type('crab');
    key('Escape');
    expect(listbox()).toBeNull();
    expect(input().value).toBe('crab');
    expect(skySearch).not.toHaveBeenCalled();
    type('crab ');
    expect(names()).toEqual(['Crab Nebula']);
  });

  it('closes when focus leaves the field', () => {
    focus();
    act(() => input().blur());
    expect(listbox()).toBeNull();
  });

  it('text that matches no row shows the hint and still submits through parseQuery', () => {
    focus();
    type('433 Eros');
    expect(options()).toHaveLength(0);
    expect(host.textContent).toContain(NO_MATCH_HINT);
    expect(NO_MATCH_HINT).toBe('No demo object matches. Press Enter to search the catalogues.');
    key('Enter'); // no highlighted row: nothing is picked
    expect(skySearch).not.toHaveBeenCalled();
    act(() => host.querySelector('form')!.requestSubmit());
    expect(skySearch).toHaveBeenCalledWith({ q: '433 Eros', kind: 'name', origin: 'input' });
    expect(listbox()).toBeNull(); // submit closes the list
  });

  it('coordinates go through parseQuery as coords', () => {
    focus();
    type('269.452, 4.693');
    act(() => host.querySelector('form')!.requestSubmit());
    expect(skySearch).toHaveBeenCalledWith({ q: '269.452,4.693', kind: 'coords', origin: 'input' });
  });

  it('the closing hint is exact, and a format parseQuery accepts', () => {
    focus();
    expect(CLOSING_HINT).toBe('Try "WISE 0855" or "269.452, 4.693"');
    expect(host.textContent).toContain(CLOSING_HINT);
  });
});
