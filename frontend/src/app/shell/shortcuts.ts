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

/** True when the element is drawn (not `display: none` itself or through an ancestor, not `hidden`). */
export function isShown(el: Element | null | undefined): boolean {
  if (!el) return false;
  const v = el as Element & { checkVisibility?: () => boolean };
  if (typeof v.checkVisibility === 'function') return v.checkVisibility();
  return el.getClientRects().length > 0;
}

/**
 * Whether a popover that listens for Escape on `document` (the sky credit, A21.10) takes
 * this press: only Escape, not one already handled, not from a text field (it keeps its own
 * Escape, Q-170 (1)), and only while the popover is drawn (a popover hidden by the split view must
 * not take the build pane's Escape).
 */
export function popoverTakesEscape(
  e: { key: string; defaultPrevented: boolean; target: EventTarget | null },
  popover: Element | null | undefined,
): boolean {
  return (
    e.key === 'Escape' && !e.defaultPrevented && !isEditableTarget(e.target) && isShown(popover)
  );
}
