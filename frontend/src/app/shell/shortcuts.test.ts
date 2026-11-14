// "/" focuses the search field, except while typing in a field or with a modifier held.
import { describe, expect, it } from 'vitest';
import { isEditableTarget, isSearchShortcut, isShown, popoverTakesEscape } from './shortcuts';

const base = {
  key: '/',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  editable: false,
  handled: false,
};

describe('isSearchShortcut', () => {
  it('"/" from the page focuses the search', () => {
    expect(isSearchShortcut(base)).toBe(true);
  });
  it('not while typing in a field', () => {
    expect(isSearchShortcut({ ...base, editable: true })).toBe(false);
  });
  it('not with Ctrl, Alt or Meta, and not other keys', () => {
    expect(isSearchShortcut({ ...base, ctrlKey: true })).toBe(false);
    expect(isSearchShortcut({ ...base, altKey: true })).toBe(false);
    expect(isSearchShortcut({ ...base, metaKey: true })).toBe(false);
    expect(isSearchShortcut({ ...base, key: '?' })).toBe(false);
    expect(isSearchShortcut({ ...base, key: 's' })).toBe(false);
  });
  it('not when something else already handled the key', () => {
    expect(isSearchShortcut({ ...base, handled: true })).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('inputs, textareas, selects and contenteditable are editable; buttons are not', () => {
    const make = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host);
      return host.firstElementChild!;
    };
    expect(isEditableTarget(make('<input type="text">'))).toBe(true);
    expect(isEditableTarget(make('<input type="range">'))).toBe(true);
    expect(isEditableTarget(make('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(make('<select><option>a</option></select>'))).toBe(true);
    expect(isEditableTarget(make('<div contenteditable="true"></div>'))).toBe(true);
    expect(isEditableTarget(make('<button>Play</button>'))).toBe(false);
    expect(isEditableTarget(make('<canvas></canvas>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('popoverTakesEscape (the sky credit popover, A21.10)', () => {
  const shown = (visible: boolean) => {
    const el = document.createElement('div');
    (el as unknown as { checkVisibility: () => boolean }).checkVisibility = () => visible;
    return el;
  };
  const press = (
    over: Partial<{ key: string; defaultPrevented: boolean; target: EventTarget | null }> = {},
  ) => ({
    key: 'Escape',
    defaultPrevented: false,
    target: document.body as EventTarget | null,
    ...over,
  });
  it('takes Escape while the popover is drawn', () => {
    expect(popoverTakesEscape(press(), shown(true))).toBe(true);
  });
  it('not other keys, and not a press already handled', () => {
    expect(popoverTakesEscape(press({ key: 'Enter' }), shown(true))).toBe(false);
    expect(popoverTakesEscape(press({ defaultPrevented: true }), shown(true))).toBe(false);
  });
  it('not from a text field: the search keeps its Escape (Q-170 (1))', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(popoverTakesEscape(press({ target: input }), shown(true))).toBe(false);
    input.remove();
  });
  it('not while the popover is hidden (the split view hides it), or gone', () => {
    expect(popoverTakesEscape(press(), shown(false))).toBe(false);
    expect(popoverTakesEscape(press(), null)).toBe(false);
  });
});

describe('isShown', () => {
  it('uses checkVisibility where the browser has it, else the element has boxes', () => {
    const el = document.createElement('div');
    // jsdom has no layout: no boxes, so not shown.
    expect(isShown(el)).toBe(false);
    (el as unknown as { checkVisibility: () => boolean }).checkVisibility = () => true;
    expect(isShown(el)).toBe(true);
    expect(isShown(null)).toBe(false);
  });
});
