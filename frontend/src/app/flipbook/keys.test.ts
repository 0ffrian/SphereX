import { describe, expect, it } from 'vitest';
import { flipbookKeyAction, type FlipbookKeyInput } from './keys';

const key = (k: string, extra: Partial<FlipbookKeyInput> = {}): FlipbookKeyInput => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  onControl: false,
  canPlay: true,
  ...extra,
});

describe('flipbook keys (R9)', () => {
  it.each([
    [' ', 'toggle'],
    ['k', 'toggle'],
    ['K', 'toggle'],
    ['ArrowLeft', 'prev'],
    ['ArrowRight', 'next'],
    ['Home', 'first'],
    ['End', 'last'],
    ['a', null],
    ['Enter', null],
  ] as const)('%j → %s', (k, action) => {
    expect(flipbookKeyAction(key(k))).toBe(action);
  });

  it('leaves keys alone while focus is on a button or form field', () => {
    for (const k of [' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(flipbookKeyAction(key(k, { onControl: true }))).toBeNull();
    }
  });

  // Review finding 5: Alt+← stepped a frame and swallowed the browser's Back; Ctrl+K toggled play.
  it.each(['altKey', 'ctrlKey', 'metaKey'] as const)('ignores keys with %s held', (mod) => {
    for (const k of [' ', 'k', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(flipbookKeyAction(key(k, { [mod]: true }))).toBeNull();
    }
  });

  // Review finding 9: Space/K started play while the Play button was disabled for preload.
  it('does not toggle play while the Play button is disabled', () => {
    // Re-review item 1: still consumed (`block`), so Space does not scroll the page.
    expect(flipbookKeyAction(key(' ', { canPlay: false }))).toBe('block');
    expect(flipbookKeyAction(key('k', { canPlay: false }))).toBe('block');
    expect(flipbookKeyAction(key(' ', { canPlay: false, onControl: true }))).toBeNull();
    expect(flipbookKeyAction(key(' ', { canPlay: false, ctrlKey: true }))).toBeNull();
    expect(flipbookKeyAction(key('ArrowRight', { canPlay: false }))).toBe('next');
  });
});
