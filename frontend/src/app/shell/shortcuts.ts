// Global keyboard shortcut: "/" focuses the search field (as in the mock-up), unless the user is
// typing somewhere or holds a modifier. Pure, so the rule is unit-tested.

export interface ShortcutInput {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** The event target is an editable field (input, textarea, select or contenteditable). */
  editable: boolean;
  /** The key is already handled (defaultPrevented). */
  handled: boolean;
}

export function isSearchShortcut(e: ShortcutInput): boolean {
  return e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.editable && !e.handled;
}

/** True for inputs, textareas, selects and contenteditable elements. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}
