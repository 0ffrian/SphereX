// "/" focuses the search field, except while typing in a field or with a modifier held.
import { describe, expect, it } from 'vitest';
import { isEditableTarget, isSearchShortcut } from './shortcuts';

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
